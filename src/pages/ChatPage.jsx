import { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { chat, kb } from '../lib/api';
import ChatMessage from '../components/ChatMessage';
import ChatInput from '../components/ChatInput';
import FollowUps from '../components/FollowUps';
import VersionSelector from '../components/VersionSelector';
import LanguageSelector, { getSupportedLanguage } from '../components/LanguageSelector';

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

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [followUps, setFollowUps] = useState([]);
  const [versions, setVersions] = useState([]);
  const [version, setVersion] = useState('all');
  const [language, setLanguage] = useState(detectLanguage);
  const [sessionId] = useState(getSessionId);
  const [loaded, setLoaded] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const chatEndRef = useRef();

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  // Load session history and versions on mount
  useEffect(() => {
    async function init() {
      try {
        const [history, versionList] = await Promise.all([
          chat.getSession(sessionId).catch((err) => { console.error('Failed to load session history:', err); return []; }),
          kb.getVersions().catch((err) => { console.error('Failed to load versions:', err); return []; }),
        ]);
        if (history?.length) setMessages(history);
        if (versionList?.length) setVersions(versionList);
      } catch (err) { console.error('Failed to initialize chat:', err); }
      setLoaded(true);
    }
    init();
  }, [sessionId]);

  const sendMessage = useCallback(async (text) => {
    const userMsg = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setStreaming(true);
    setStreamText('');
    setFollowUps([]);

    try {
      const response = await chat.stream(text, sessionId, version, language);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let msgFollowUps = [];
      let analyticsId = null;
      let lineBuffer = '';

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
              setStreamText(fullText);
            } else if (event.type === 'followups') {
              msgFollowUps = event.content || [];
            } else if (event.type === 'done') {
              analyticsId = event.analyticsId;
            } else if (event.type === 'error') {
              fullText += `\n\nError: ${event.content}`;
              setStreamText(fullText);
            }
          } catch { /* skip malformed events */ }
        }
      }

      if (lineBuffer.startsWith('data: ')) {
        try {
          const event = JSON.parse(lineBuffer.slice(6));
          if (event.type === 'text') {
            fullText += event.content;
            setStreamText(fullText);
          } else if (event.type === 'followups') {
            msgFollowUps = event.content || [];
          } else if (event.type === 'done') {
            analyticsId = event.analyticsId;
          } else if (event.type === 'error') {
            fullText += `\n\nError: ${event.content}`;
            setStreamText(fullText);
          }
        } catch { /* skip malformed trailing data */ }
      }

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: fullText, follow_ups: msgFollowUps, analyticsId },
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
    <div className="chat-container">
      <div className="chat-header">
        <h1>Prism Support</h1>
        <div className="selectors-row">
          <VersionSelector versions={versions} value={version} onChange={setVersion} />
          <LanguageSelector value={language} onChange={setLanguage} />
        </div>
        <button className="btn btn-sm btn-ghost" onClick={handleNewSession} title="New conversation">
          New chat
        </button>
      </div>

      <div className="chat-messages">
        {showOnboarding && (
          <div className="onboarding">
            <h2>Welcome to Prism Support</h2>
            <p>I can answer questions about the video editor. What are you trying to do today?</p>
            <div className="onboarding-suggestions">
              <button className="onboarding-suggestion" onClick={() => sendMessage('How do I export my project?')}>
                How do I export my project?
              </button>
              <button className="onboarding-suggestion" onClick={() => sendMessage('Where is the trim tool?')}>
                Where is the trim tool?
              </button>
              <button className="onboarding-suggestion" onClick={() => sendMessage('What keyboard shortcuts are available?')}>
                What keyboard shortcuts are available?
              </button>
            </div>
          </div>
        )}

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
              <div className="msg msg-assistant">{streamText}</div>
            ) : (
              <div className="msg-thinking">
                <div className="spinner" /> Thinking…
              </div>
            )}
          </>
        )}

        {!streaming && followUps.length > 0 && (
          <FollowUps questions={followUps} onSelect={sendMessage} />
        )}

        <div ref={chatEndRef} />
      </div>

      <ChatInput onSend={sendMessage} disabled={streaming || escalating} />
    </div>
  );
}
