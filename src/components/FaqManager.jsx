import { useState, useEffect, useMemo } from 'react';
import Markdown from 'react-markdown';
import { faq as faqApi } from '../lib/api';

function formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function FaqManager() {
  const [faqs, setFaqs] = useState([]);
  const [lastGeneratedAt, setLastGeneratedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState('');
  const [refreshError, setRefreshError] = useState(null);
  const [openId, setOpenId] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await faqApi.list();
      setFaqs(res.faqs || []);
      setLastGeneratedAt(res.last_generated_at || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const f of faqs) {
      const key = f.category?.trim() || 'General';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(f);
    }
    return Array.from(map.entries());
  }, [faqs]);

  const categoryCount = grouped.length;

  async function handleRefresh() {
    if (refreshing) return;
    if (!window.confirm('Regenerate the FAQ from the current knowledge base? This will replace all existing FAQ entries.')) {
      return;
    }
    setRefreshing(true);
    setProgress('Starting…');
    setRefreshError(null);
    try {
      const response = await faqApi.refresh();
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${response.status})`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;

      while (!done) {
        const chunk = await reader.read();
        if (chunk.done) { done = true; break; }
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6);
          if (!jsonStr) continue;
          try {
            const event = JSON.parse(jsonStr);
            if (event.type === 'progress') {
              setProgress(event.message);
            } else if (event.type === 'done') {
              setProgress('');
              setLastGeneratedAt(event.last_generated_at);
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }
      if (buffer.startsWith('data: ')) {
        try {
          const event = JSON.parse(buffer.slice(6));
          if (event.type === 'done') {
            setLastGeneratedAt(event.last_generated_at);
          } else if (event.type === 'error') {
            throw new Error(event.message);
          }
        } catch { /* ignore trailing */ }
      }

      await load();
    } catch (err) {
      setRefreshError(err.message || String(err));
    } finally {
      setRefreshing(false);
      setProgress('');
    }
  }

  return (
    <div>
      <div className="info-box" style={{ marginBottom: 16 }}>
        The public <code>/faq</code> page is generated from current knowledge base entries by Claude. Click <strong>Regenerate</strong> to wipe and rebuild it. Claude picks 3-6 categories from the content and groups questions under them. Existing FAQ entries are deleted on every refresh.
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {faqs.length} FAQ entr{faqs.length === 1 ? 'y' : 'ies'}
          {categoryCount > 0 && (
            <> across {categoryCount} categor{categoryCount === 1 ? 'y' : 'ies'}</>
          )}
          {lastGeneratedAt && (
            <> · last generated {formatDate(lastGeneratedAt)}</>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={load} disabled={loading || refreshing}>
            Refresh view
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={handleRefresh}
            disabled={refreshing}
            style={{ background: '#7040FF', color: '#fff', borderColor: '#7040FF' }}
          >
            {refreshing ? 'Regenerating…' : 'Regenerate from KB'}
          </button>
        </div>
      </div>

      {refreshing && progress && (
        <div className="info-box" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="spinner" style={{ width: 16, height: 16 }} />
          {progress}
        </div>
      )}

      {refreshError && (
        <div className="error-banner" style={{ marginBottom: 12 }}>
          Regeneration failed: {refreshError}
        </div>
      )}

      {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 20, color: 'var(--text-muted)' }}>
          <div className="spinner" /> Loading FAQ…
        </div>
      ) : faqs.length === 0 ? (
        <div className="empty-state">
          <p>No FAQ entries yet.</p>
          <p style={{ marginTop: 4 }}>Click <strong>Regenerate from KB</strong> to create them.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {grouped.map(([category, items]) => (
            <section key={category}>
              <h3 style={{
                margin: '0 0 8px',
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
              }}>
                {category}
                <span style={{ marginLeft: 8, fontWeight: 400 }}>
                  ({items.length})
                </span>
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map((f) => {
                  const open = openId === f.id;
                  return (
                    <div
                      key={f.id}
                      style={{
                        border: '1px solid var(--grey-100)',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--grey-0)',
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
                          padding: '12px 16px',
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
                        {f.source_kb_ids?.length > 0 && (
                          <span style={{
                            fontSize: 11,
                            color: 'var(--text-muted)',
                            fontFamily: 'var(--font-mono)',
                          }}>
                            {f.source_kb_ids.length} source{f.source_kb_ids.length !== 1 ? 's' : ''}
                          </span>
                        )}
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
                          paddingTop: 12,
                          color: 'var(--text-secondary)',
                          fontSize: 14,
                          lineHeight: 1.55,
                        }}>
                          <Markdown>{f.answer}</Markdown>
                          {f.source_kb_ids?.length > 0 && (
                            <div style={{
                              marginTop: 12,
                              fontSize: 11,
                              color: 'var(--text-muted)',
                              fontFamily: 'var(--font-mono)',
                            }}>
                              Source KB IDs: {f.source_kb_ids.join(', ')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
