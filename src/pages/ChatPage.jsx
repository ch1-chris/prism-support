import { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { chat } from '../lib/api';
import ChatMessage from '../components/ChatMessage';
import ChatInput from '../components/ChatInput';
import FollowUps from '../components/FollowUps';
import LanguageSelector, { getSupportedLanguage } from '../components/LanguageSelector';
import Markdown from 'react-markdown';

const SESSION_KEY = 'prism-support-session-id';

function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = uuidv4();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function detectLanguage() {
  return getSupportedLanguage(navigator.language);
}

const RATE_LIMIT_MESSAGE = "We're processing too many requests at the moment. Please try again in a few minutes, or contact your Prism account rep for urgent questions.";

const SUGGESTIONS = [
  { text: 'How do I export my project?', icon: '↗', color: 'var(--section-distribution)' },
  { text: 'Where is the trim tool?', icon: '✂', color: 'var(--section-editing)' },
  { text: 'What keyboard shortcuts are available?', icon: '⌨', color: 'var(--section-writers)' },
  { text: 'How do I add captions?', icon: '☰', color: 'var(--section-home)' },
  { text: 'How do I manage my projects?', icon: '◈', color: 'var(--section-library)' },
  { text: 'What file formats are supported?', icon: '◎', color: 'var(--section-finance)' },
];

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [followUps, setFollowUps] = useState([]);
  const [version] = useState('all');
  const [language, setLanguage] = useState(detectLanguage);
  const [sessionId] = useState(getSessionId);
  const [loaded, setLoaded] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [attachedFile, setAttachedFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const chatEndRef = useRef();
  const dragCounter = useRef(0);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  useEffect(() => {
    async function init() {
      try {
        const history = await chat.getSession(sessionId).catch((err) => { console.error('Failed to load session history:', err); return []; });
        if (history?.length) setMessages(history);
      } catch (err) { console.error('Failed to initialize chat:', err); }
      setLoaded(true);
    }
    init();
  }, [sessionId]);

  function attachImage(file) {
    if (file && file.type.startsWith('image/')) {
      setAttachedFile(file);
    }
  }

  function handleDragEnter(e) {
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) setDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) { dragCounter.current = 0; setDragging(false); }
  }

  function handleDragOver(e) { e.preventDefault(); }

  function handleDrop(e) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) attachImage(file);
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        attachImage(item.getAsFile());
        return;
      }
    }
  }

  const sendMessage = useCallback(async (textOrObj) => {
    const text = typeof textOrObj === 'string' ? textOrObj : textOrObj.text;
    const file = typeof textOrObj === 'string' ? attachedFile : textOrObj.file;

    const userMsg = { role: 'user', content: text };
    if (file) userMsg.imageUrl = URL.createObjectURL(file);
    setMessages((prev) => [...prev, userMsg]);
    setAttachedFile(null);
    setStreaming(true);
    setStreamText('');
    setFollowUps([]);

    try {
      const response = await chat.stream(text, sessionId, version, language, file);

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (response.status === 429) {
          throw new Error(RATE_LIMIT_MESSAGE);
        }
        throw new Error(body.error || `Request failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let msgFollowUps = [];
      let analyticsId = null;
      let lineBuffer = '';
      const stripFollowups = (t) => t.replace(/<!--followups:\[.*?\]-->/s, '').trim();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6);
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);
            if (event.type === 'text') {
              fullText += event.content;
              setStreamText(stripFollowups(fullText));
            } else if (event.type === 'followups') {
              msgFollowUps = event.content || [];
            } else if (event.type === 'done') {
              analyticsId = event.analyticsId;
            } else if (event.type === 'error') {
              fullText += `\n\nError: ${event.content}`;
              setStreamText(stripFollowups(fullText));
            }
          } catch { /* skip malformed events */ }
        }
      }

      if (lineBuffer.startsWith('data: ')) {
        try {
          const event = JSON.parse(lineBuffer.slice(6));
          if (event.type === 'text') {
            fullText += event.content;
            setStreamText(stripFollowups(fullText));
          } else if (event.type === 'followups') {
            msgFollowUps = event.content || [];
          } else if (event.type === 'done') {
            analyticsId = event.analyticsId;
          } else if (event.type === 'error') {
            fullText += `\n\nError: ${event.content}`;
            setStreamText(stripFollowups(fullText));
          }
        } catch { /* skip malformed trailing data */ }
      }

      const cleanedText = stripFollowups(fullText);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: cleanedText, follow_ups: msgFollowUps, analyticsId },
      ]);
      setFollowUps(msgFollowUps);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Sorry, something went wrong: ${err.message}` },
      ]);
    } finally {
      setStreaming(false);
      setStreamText('');
    }
  }, [sessionId, version, language]);

  async function handleEscalate() {
    setEscalating(true);
    try {
      const summary = window.prompt('Briefly describe what you need help with:');
      if (summary !== null) {
        await chat.escalate(sessionId, summary);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: 'A support ticket has been created with your conversation history. Our team will follow up with you.',
          },
        ]);
      }
    } catch (err) {
      alert(`Failed to create ticket: ${err.message}`);
    } finally {
      setEscalating(false);
    }
  }

  function handleNewSession() {
    const newId = uuidv4();
    localStorage.setItem(SESSION_KEY, newId);
    window.location.reload();
  }

  const showOnboarding = loaded && messages.length === 0;

  return (
    <div
      className="chat-page"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      {dragging && (
        <div className="chat-drop-overlay">
          <div className="chat-drop-overlay-inner">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
            <span>Drop screenshot here</span>
          </div>
        </div>
      )}
      <header className="chat-topbar">
        <div className="chat-topbar-inner">
          <div className="chat-brand">
            <img src="/prism-logo.png" alt="Prism" className="chat-brand-icon" />
            <span className="chat-brand-text">Prism Support</span>
          </div>
          <div className="chat-topbar-controls">
            <LanguageSelector value={language} onChange={setLanguage} />
            <button className="chat-new-btn" onClick={handleNewSession} title="New conversation">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>New chat</span>
            </button>
          </div>
        </div>
      </header>

      {showOnboarding ? (
        <div className="chat-onboarding-layout">
          <div className="chat-onboarding">
            <div className="chat-hero">
              <div className="chat-hero-badge">Support Assistant</div>
              <h1 className="chat-hero-title">
                How can we help<br />you today?
              </h1>
              <p className="chat-hero-subtitle">
                Ask anything about the video editor — from basic features to advanced workflows.
              </p>
            </div>

            <div className="chat-suggestions">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  className="chat-suggestion-card"
                  onClick={() => sendMessage(s.text)}
                >
                  <span className="chat-suggestion-icon" style={{ background: s.color }}>
                    {s.icon}
                  </span>
                  <span className="chat-suggestion-text">{s.text}</span>
                  <span className="chat-suggestion-arrow">→</span>
                </button>
              ))}
            </div>

            <ChatInput onSend={sendMessage} disabled={streaming || escalating} file={attachedFile} onClearFile={() => setAttachedFile(null)} />
          </div>
        </div>
      ) : (
        <>
          <div className="chat-body">
            <div className="chat-scroll">
              {messages.map((msg, i) => (
                <ChatMessage
                  key={i}
                  msg={msg}
                  onEscalate={msg.role === 'assistant' ? handleEscalate : null}
                />
              ))}

              {streaming && (
                <>
                  {streamText ? (
                    <div className="chat-msg chat-msg-assistant">
                      <img src="/prism-logo.png" alt="Prism" className="chat-msg-avatar chat-msg-avatar-ai" />
                      <div className="chat-msg-bubble chat-msg-bubble-ai"><Markdown>{streamText}</Markdown></div>
                    </div>
                  ) : (
                    <div className="chat-msg chat-msg-assistant">
                      <img src="/prism-logo.png" alt="Prism" className="chat-msg-avatar chat-msg-avatar-ai" />
                      <div className="chat-msg-thinking">
                        <div className="chat-thinking-dots">
                          <span /><span /><span />
                        </div>
                        Thinking…
                      </div>
                    </div>
                  )}
                </>
              )}

              {!streaming && followUps.length > 0 && (
                <FollowUps questions={followUps} onSelect={sendMessage} />
              )}

              <div ref={chatEndRef} />
            </div>
          </div>

          <ChatInput onSend={sendMessage} disabled={streaming || escalating} file={attachedFile} onClearFile={() => setAttachedFile(null)} />
        </>
      )}
    </div>
  );
}
