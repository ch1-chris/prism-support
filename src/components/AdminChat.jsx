import { useState, useEffect, useRef, useCallback } from 'react';
import { adminChat } from '../lib/api';

const SUGGESTIONS = [
  'What gaps do you see in the knowledge base?',
  'Summarize what you know about my app',
  'What areas need more documentation?',
];

export default function AdminChat() {
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);
  const chatEndRef = useRef();

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  useEffect(() => {
    adminChat.history()
      .then((data) => setMessages(data || []))
      .catch((err) => console.error('Failed to load admin chat history:', err))
      .finally(() => setLoaded(true));
  }, []);

  const sendMessage = useCallback(async (text) => {
    const userMsg = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setStreaming(true);
    setStreamText('');
    setInput('');

    try {
      const response = await adminChat.stream(text);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
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
          } else if (event.type === 'error') {
            fullText += `\n\nError: ${event.content}`;
            setStreamText(fullText);
          }
        } catch { /* skip malformed trailing data */ }
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: fullText }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Something went wrong: ${err.message}` },
      ]);
    } finally {
      setStreaming(false);
      setStreamText('');
    }
  }, []);

  async function handleClear() {
    if (!window.confirm('Clear the entire training chat history?')) return;
    try {
      await adminChat.clear();
      setMessages([]);
    } catch (err) {
      alert(`Failed to clear chat: ${err.message}`);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim() || streaming) return;
    sendMessage(input.trim());
  }

  const showOnboarding = loaded && messages.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', minHeight: 400 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
          Chat with Claude about your KB content. Verify understanding and find gaps.
        </p>
        <button
          className="btn btn-sm btn-ghost"
          onClick={handleClear}
          disabled={streaming || messages.length === 0}
        >
          Clear chat
        </button>
      </div>

      <div className="chat-messages" style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 12 }}>
        {showOnboarding && (
          <div className="onboarding">
            <h2>Training Chat</h2>
            <p>Use this chat to teach the assistant about your software and verify what it knows.</p>
            <div className="onboarding-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="onboarding-suggestion" onClick={() => sendMessage(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`msg ${msg.role === 'user' ? 'msg-user' : 'msg-assistant'}`}>
            {msg.content}
          </div>
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

        <div ref={chatEndRef} />
      </div>

      <form className="chat-input-row" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Tell Claude about your app, or ask what it knows…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={streaming}
          autoFocus
          aria-label="Training chat message"
        />
        <button className="btn btn-primary" disabled={streaming || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
