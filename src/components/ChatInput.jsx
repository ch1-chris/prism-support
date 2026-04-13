import { useState } from 'react';

export default function ChatInput({ onSend, disabled }) {
  const [value, setValue] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue('');
  }

  return (
    <div className="chat-input-bar">
      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          className="chat-input-field"
          placeholder="Ask a question…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          autoFocus
          aria-label="Type your question"
        />
        <button
          className="chat-send-btn"
          disabled={disabled || !value.trim()}
          type="submit"
          aria-label="Send message"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
      <p className="chat-input-hint">
        Prism Support can make mistakes. Verify important information.
      </p>
    </div>
  );
}
