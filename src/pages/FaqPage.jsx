import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import Markdown from 'react-markdown';
import { faq as faqApi } from '../lib/api';

function formatDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export default function FaqPage() {
  const [faqs, setFaqs] = useState([]);
  const [lastGeneratedAt, setLastGeneratedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    faqApi.list()
      .then((res) => {
        if (cancelled) return;
        setFaqs(res.faqs || []);
        setLastGeneratedAt(res.last_generated_at || null);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return faqs;
    const q = search.trim().toLowerCase();
    return faqs.filter((f) =>
      f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q)
    );
  }, [faqs, search]);

  return (
    <div className="chat-page">
      <header className="chat-topbar">
        <div className="chat-topbar-inner">
          <div className="chat-brand">
            <img src="/prism-logo.png" alt="Prism" className="chat-brand-icon" />
            <span className="chat-brand-text">FAQ</span>
          </div>
          <div className="chat-topbar-controls">
            <Link to="/gallery" className="chat-new-btn">Tutorials</Link>
            <Link to="/" className="chat-new-btn">Back to chat</Link>
          </div>
        </div>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600 }}>Frequently asked questions</h1>
            <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>
              Generated from the Prism knowledge base. Can&apos;t find what you need? Ask the chat assistant.
            </p>
            {lastGeneratedAt && (
              <p style={{
                margin: '8px 0 0',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-muted)',
              }}>
                Last updated {formatDate(lastGeneratedAt)}
              </p>
            )}
          </div>

          {!loading && !error && faqs.length > 0 && (
            <input
              type="text"
              placeholder="Search FAQ…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', marginBottom: 16 }}
            />
          )}

          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', padding: 20 }}>
              <div className="spinner" /> Loading FAQ…
            </div>
          )}

          {error && (
            <div className="error-banner">{error}</div>
          )}

          {!loading && !error && faqs.length === 0 && (
            <div className="empty-state">
              <p>No FAQ entries yet.</p>
              <p style={{ marginTop: 4 }}>An admin needs to generate the FAQ from the knowledge base.</p>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && faqs.length > 0 && (
            <div className="empty-state">
              <p>No questions match &quot;{search}&quot;.</p>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map((f) => {
              const open = openId === f.id;
              return (
                <div
                  key={f.id}
                  style={{
                    border: '1px solid var(--grey-100)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--grey-0)',
                    overflow: 'hidden',
                  }}
                >
                  <button
                    onClick={() => setOpenId(open ? null : f.id)}
                    aria-expanded={open}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '14px 16px',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      font: 'inherit',
                      color: 'var(--grey-900)',
                      fontWeight: 500,
                    }}
                  >
                    <span style={{ flex: 1 }}>{f.question}</span>
                    <span style={{
                      transition: 'transform 0.15s',
                      transform: open ? 'rotate(180deg)' : 'rotate(0)',
                      color: 'var(--text-muted)',
                    }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </span>
                  </button>
                  {open && (
                    <div style={{
                      padding: '0 16px 16px',
                      borderTop: '1px solid var(--grey-100)',
                      paddingTop: 16,
                      color: 'var(--text-secondary)',
                      lineHeight: 1.55,
                      fontSize: 14,
                    }}>
                      <Markdown>{f.answer}</Markdown>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
