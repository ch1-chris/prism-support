import { useState, useEffect } from 'react';
import { analytics } from '../lib/api';

export default function SupportTickets() {
  const [tickets, setTickets] = useState([]);
  const [filter, setFilter] = useState('open');
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    analytics.tickets(filter)
      .then(setTickets)
      .catch((err) => {
        console.error('Failed to load tickets:', err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [filter]);

  async function updateStatus(id, status) {
    try {
      const updated = await analytics.updateTicket(id, status);
      setTickets((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (err) {
      alert(err.message);
    }
  }

  if (loading) return <div className="empty-state"><div className="spinner" /></div>;
  if (error) return <div className="empty-state">Failed to load tickets: {error}</div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['open', 'resolved', 'closed', 'all'].map((s) => (
          <button
            key={s}
            className={`btn btn-sm ${filter === s ? 'btn-primary' : ''}`}
            onClick={() => setFilter(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {tickets.length === 0 ? (
        <div className="empty-state">No {filter === 'all' ? '' : filter} tickets.</div>
      ) : (
        tickets.map((ticket) => (
          <div key={ticket.id} className="kb-entry">
            <div className="kb-entry-header">
              <span className={`badge ${ticket.status === 'open' ? 'badge-red' : ticket.status === 'resolved' ? 'badge-green' : 'badge-default'}`}>
                {ticket.status}
              </span>
              <span className="kb-entry-title">
                Ticket #{ticket.id}
                {ticket.user_summary && ` — ${ticket.user_summary}`}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {new Date(ticket.created_at).toLocaleString()}
              </span>
              <button className="btn btn-sm" onClick={() => setExpanded(expanded === ticket.id ? null : ticket.id)}>
                {expanded === ticket.id ? 'Hide' : 'View'}
              </button>
              {ticket.status === 'open' && (
                <button className="btn btn-sm" onClick={() => updateStatus(ticket.id, 'resolved')}>
                  Resolve
                </button>
              )}
              {ticket.status !== 'closed' && (
                <button className="btn btn-sm btn-danger" onClick={() => updateStatus(ticket.id, 'closed')}>
                  Close
                </button>
              )}
            </div>
            {expanded === ticket.id && ticket.conversation && (
              <div style={{ marginTop: 12 }}>
                {(Array.isArray(ticket.conversation) ? ticket.conversation : []).map((msg, i) => (
                  <div key={i} style={{ marginBottom: 8, fontSize: 13 }}>
                    <strong style={{ color: msg.role === 'user' ? 'var(--blue)' : 'var(--text-secondary)' }}>
                      {msg.role === 'user' ? 'User' : 'Bot'}:
                    </strong>{' '}
                    <span style={{ color: 'var(--text-secondary)' }}>{msg.content}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
