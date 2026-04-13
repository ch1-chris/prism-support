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
    return <div className="msg msg-user">{msg.content}</div>;
  }

  const showEscalation = msg.content?.toLowerCase().includes("i don't have information") ||
    msg.content?.toLowerCase().includes("contact our support") ||
    msg.content?.toLowerCase().includes("contact support");

  return (
    <div style={{ alignSelf: 'flex-start', maxWidth: '85%' }}>
      <div className="msg msg-assistant">{msg.content}</div>
      <div className="msg-actions">
        <button
          className={`msg-action-btn ${feedback === 1 ? 'active-up' : ''}`}
          onClick={() => handleFeedback(1)}
          title="Helpful"
          aria-label="Mark as helpful"
        >
          &#x1F44D;
        </button>
        <button
          className={`msg-action-btn ${feedback === -1 ? 'active-down' : ''}`}
          onClick={() => handleFeedback(-1)}
          title="Not helpful"
          aria-label="Mark as not helpful"
        >
          &#x1F44E;
        </button>
      </div>
      {showEscalation && onEscalate && (
        <div className="escalation-bar">
          <span>Need more help?</span>
          <button className="btn btn-sm" onClick={() => onEscalate()}>
            Open support ticket
          </button>
        </div>
      )}
    </div>
  );
}
