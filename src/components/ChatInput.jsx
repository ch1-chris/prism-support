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
    <form className="chat-input-row" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Ask about the app…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        autoFocus
        aria-label="Type your question"
      />
      <button className="btn btn-primary" disabled={disabled || !value.trim()}>
        Send
      </button>
    </form>
  );
}
