import { useState } from 'react';
import { chat } from '../lib/api';

export default function ChatMessage({ msg, onEscalate }) {
  const [feedback, setFeedback] = useState(msg.feedback || null);

  async function handleFeedback(value) {
    const newValue = feedback === value ? null : value;
    setFeedback(newValue);
    try {
      await chat.feedback(msg.id, msg.analyticsId, newValue);
    } catch (err) {
      console.error('Failed to submit feedback:', err);
    }
  }

  if (msg.role === 'user') {
    return (
      <div className="chat-msg chat-msg-user">
        <div className="chat-msg-bubble chat-msg-bubble-user">{msg.content}</div>
        <div className="chat-msg-avatar chat-msg-avatar-user">You</div>
      </div>
    );
  }

  const showEscalation = msg.content?.toLowerCase().includes("i don't have information") ||
    msg.content?.toLowerCase().includes("contact our support") ||
    msg.content?.toLowerCase().includes("contact support");

  return (
    <div className="chat-msg chat-msg-assistant">
      <div className="chat-msg-avatar chat-msg-avatar-ai">◈</div>
      <div>
        <div className="chat-msg-bubble chat-msg-bubble-ai">{msg.content}</div>
        <div className="chat-msg-actions">
          <button
            className={`chat-action-btn ${feedback === 1 ? 'active-up' : ''}`}
            onClick={() => handleFeedback(1)}
            title="Helpful"
            aria-label="Mark as helpful"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
              <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
            </svg>
          </button>
          <button
            className={`chat-action-btn ${feedback === -1 ? 'active-down' : ''}`}
            onClick={() => handleFeedback(-1)}
            title="Not helpful"
            aria-label="Mark as not helpful"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z" />
              <path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
            </svg>
          </button>
        </div>
        {showEscalation && onEscalate && (
          <div className="chat-escalation">
            <span>Need more help?</span>
            <button className="chat-escalation-btn" onClick={() => onEscalate()}>
              Open support ticket
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
