import { useState, useEffect, useRef, useCallback } from 'react';
import { adminChat } from '../lib/api';

const SUGGESTIONS = [
  'What gaps do you see in the knowledge base?',
  'Summarize what you know about my app',
  'What areas need more documentation?',
];

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export default function AdminChat() {
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [input, setInput] = useState('');
  const [files, setFiles] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const chatEndRef = useRef();
  const fileInputRef = useRef();

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  useEffect(() => {
    adminChat.history()
      .then((data) => setMessages(data || []))
      .catch((err) => console.error('Failed to load admin chat history:', err))
      .finally(() => setLoaded(true));
  }, []);

  const sendMessage = useCallback(async (text, attachedFiles) => {
    const filesToSend = attachedFiles || [];
    const previews = filesToSend.map(f => ({
      name: f.name,
      url: IMAGE_TYPES.includes(f.type) ? URL.createObjectURL(f) : null,
    }));

    const displayContent = buildDisplayContent(text, filesToSend);
    const userMsg = { role: 'user', content: displayContent, previews };
    setMessages((prev) => [...prev, userMsg]);
    setStreaming(true);
    setStreamText('');
    setInput('');
    setFiles([]);

    try {
      const response = await adminChat.stream(text, filesToSend.length ? filesToSend : null);
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

  function buildDisplayContent(text, attachedFiles) {
    const parts = [];
    if (attachedFiles?.length) {
      for (const f of attachedFiles) {
        if (IMAGE_TYPES.includes(f.type)) {
          parts.push(`[Image: ${f.name}]`);
        } else {
          parts.push(`[File: ${f.name}]`);
        }
      }
    }
    if (text?.trim()) parts.push(text.trim());
    return parts.join('\n');
  }

  function handleFileSelect(e) {
    const selected = Array.from(e.target.files);
    if (selected.length) {
      setFiles((prev) => [...prev, ...selected]);
    }
    e.target.value = '';
  }

  function removeFile(index) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

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
    if ((!input.trim() && files.length === 0) || streaming) return;
    sendMessage(input.trim(), files);
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pastedFiles = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) pastedFiles.push(file);
      }
    }
    if (pastedFiles.length) {
      e.preventDefault();
      setFiles((prev) => [...prev, ...pastedFiles]);
    }
  }

  const showOnboarding = loaded && messages.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', minHeight: 400 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
          Chat with Claude about your KB content. Attach screenshots or files for context.
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
            <p>Use this chat to teach the assistant about your software and verify what it knows. You can paste or attach screenshots.</p>
            <div className="onboarding-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="onboarding-suggestion" onClick={() => sendMessage(s, [])}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={msg.role === 'user' ? { alignSelf: 'flex-end', maxWidth: '85%' } : undefined}>
            {msg.previews?.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6, justifyContent: 'flex-end' }}>
                {msg.previews.map((p, j) => (
                  p.url ? (
                    <img
                      key={j}
                      src={p.url}
                      alt={p.name}
                      style={{ maxWidth: 200, maxHeight: 150, borderRadius: 8, border: '1px solid var(--border)', objectFit: 'cover' }}
                    />
                  ) : (
                    <span key={j} className="badge badge-default" style={{ fontSize: 11 }}>{p.name}</span>
                  )
                ))}
              </div>
            )}
            <div className={`msg ${msg.role === 'user' ? 'msg-user' : 'msg-assistant'}`}>
              {msg.content}
            </div>
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

      {files.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, padding: '8px 12px', background: 'var(--grey-50)', borderRadius: 8, alignItems: 'center' }}>
          {files.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)', fontSize: 12 }}>
              {IMAGE_TYPES.includes(f.type) && (
                <img
                  src={URL.createObjectURL(f)}
                  alt={f.name}
                  style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover' }}
                />
              )}
              <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <button
                onClick={() => removeFile(i)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--grey-500)', fontSize: 14, padding: 0, lineHeight: 1 }}
                aria-label={`Remove ${f.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <form className="chat-input-row" onSubmit={handleSubmit}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.txt,.md,.csv,.json,.log,.xml,.html,.css,.js"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          className="btn btn-icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={streaming}
          aria-label="Attach files"
          title="Attach files"
        >
          +
        </button>
        <input
          type="text"
          placeholder="Tell Claude about your app, or ask what it knows…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={handlePaste}
          disabled={streaming}
          autoFocus
          aria-label="Training chat message"
        />
        <button className="btn btn-primary" disabled={streaming || (!input.trim() && files.length === 0)}>
          Send
        </button>
      </form>
    </div>
  );
}
