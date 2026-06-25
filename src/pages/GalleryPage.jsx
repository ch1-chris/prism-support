import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { tutorials as tutorialsApi, brandAccess, auth } from '../lib/api';

function groupByCategory(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.category?.trim() || 'General';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return Array.from(groups.entries());
}

export default function GalleryPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null);

  const [brand, setBrand] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);
  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState(null);
  const [codeBusy, setCodeBusy] = useState(false);

  const loadTutorials = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await tutorialsApi.list();
      setItems(res.tutorials || []);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [statusRes, authRes] = await Promise.all([
          brandAccess.status().catch(() => ({ brand: null })),
          auth.status().catch(() => ({ authenticated: false })),
        ]);
        if (cancelled) return;
        const activeBrand = statusRes.brand || null;
        const admin = authRes.authenticated === true;
        setBrand(activeBrand);
        setIsAdmin(admin);
        // Only fetch videos once the visitor is allowed to see them.
        if (activeBrand || admin) await loadTutorials();
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadTutorials]);

  async function handleRedeem(e) {
    e.preventDefault();
    const code = codeInput.trim();
    if (!code) return;
    setCodeBusy(true);
    setCodeError(null);
    try {
      const res = await brandAccess.redeem(code);
      setBrand(res.brand || null);
      setCodeInput('');
      await loadTutorials();
    } catch (err) {
      setCodeError(err.message || 'That code is not valid');
    } finally {
      setCodeBusy(false);
    }
  }

  async function handleExit() {
    setCodeBusy(true);
    try {
      await brandAccess.exit();
      setBrand(null);
      setCodeError(null);
      // Non-admins drop back to the gate; admins keep previewing the global list.
      if (isAdmin) await loadTutorials();
      else setItems([]);
    } catch (err) {
      setCodeError(err.message || String(err));
    } finally {
      setCodeBusy(false);
    }
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') setActive(null);
    }
    if (active) {
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
  }, [active]);

  const groups = groupByCategory(items);

  return (
    <div className="chat-page gallery-page">
      <header className="chat-topbar">
        <div className="chat-topbar-inner">
          <div className="chat-brand">
            <img src="/prism-logo.png" alt="Prism" className="chat-brand-icon" />
            <span className="chat-brand-text">Tutorial Gallery</span>
          </div>
          <div className="chat-topbar-controls">
            {brand && (
              <button className="chat-new-btn" onClick={handleExit} disabled={codeBusy} title="Stop viewing this account's tutorials">
                Exit {brand.name}
              </button>
            )}
            <Link to="/faq" className="chat-new-btn">FAQ</Link>
            <Link to="/" className="chat-new-btn">Back to chat</Link>
          </div>
        </div>
      </header>

      {brand && (
        <div style={{
          padding: '10px 24px',
          background: 'var(--grey-50)',
          borderBottom: '1px solid var(--grey-100)',
          fontSize: 13,
          color: 'var(--text-secondary)',
        }}>
          Viewing <strong style={{ color: 'var(--text-primary)' }}>{brand.name}</strong> tutorials, plus general walkthroughs.
        </div>
      )}

      {checking ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 14 }}>
          <div className="spinner" /> Loading…
        </div>
      ) : (!brand && !isAdmin) ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <form className="login-card" onSubmit={handleRedeem} style={{ maxWidth: 420 }}>
            <img src="/prism-logo.png" alt="Prism" style={{ width: 56, height: 56, borderRadius: 12, marginBottom: 12 }} />
            <h1>Tutorial Videos</h1>
            <p>Enter your access code to view your tutorials.</p>
            <div className="field">
              <label htmlFor="gallery-code">Access code</label>
              <input
                id="gallery-code"
                type="text"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="Your access code"
                autoFocus
              />
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} disabled={codeBusy || !codeInput.trim()}>
              {codeBusy ? 'Checking…' : 'View tutorials'}
            </button>
            {codeError && <p className="error-text">{codeError}</p>}
          </form>
        </div>
      ) : (
      <div className="gallery-tutorials" style={{ flex: 1, overflowY: 'auto', padding: '32px 24px' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600 }}>Tutorials</h1>
            <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>
              Short walkthroughs for getting around Prism
            </p>
          </div>

          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', padding: 20 }}>
              <div className="spinner" /> Loading tutorials…
            </div>
          )}

          {error && (
            <div className="error-banner">{error}</div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="empty-state">
              <p>No tutorials available yet.</p>
              <p style={{ marginTop: 4 }}>Check back soon — your team will publish walkthroughs here.</p>
            </div>
          )}

          {!loading && !error && groups.map(([category, list]) => (
            <section key={category} style={{ marginBottom: 32 }}>
              <h2 style={{
                margin: '0 0 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-secondary)',
              }}>
                {category}
              </h2>
              <div className="media-grid">
                {list.map((t) => (
                  <button
                    key={t.id}
                    className="media-card"
                    onClick={() => setActive(t)}
                    style={{
                      textAlign: 'left',
                      cursor: 'pointer',
                      background: 'var(--grey-0)',
                      border: '1px solid var(--grey-100)',
                      padding: 0,
                      font: 'inherit',
                      color: 'inherit',
                    }}
                  >
                    <div className="media-card-preview" style={{ position: 'relative' }}>
                      {t.thumbnail_url ? (
                        <img src={t.thumbnail_url} alt={t.title} />
                      ) : (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '100%',
                          height: '100%',
                          background: 'linear-gradient(135deg, var(--grey-100), var(--grey-50))',
                          color: 'var(--text-muted)',
                        }}>
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <polygon points="6 4 20 12 6 20 6 4" />
                          </svg>
                        </div>
                      )}
                      <div style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(0,0,0,0.15)',
                        opacity: 0,
                        transition: 'opacity 0.15s',
                      }} className="gallery-play-overlay">
                        <div style={{
                          width: 56,
                          height: 56,
                          borderRadius: '50%',
                          background: 'rgba(0,0,0,0.6)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                        }}>
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="6 4 20 12 6 20 6 4" />
                          </svg>
                        </div>
                      </div>
                    </div>
                    <div className="media-card-info">
                      <div className="media-card-title" title={t.title}>{t.title}</div>
                      {t.description && (
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
                          {t.description.length > 140 ? `${t.description.slice(0, 140)}…` : t.description}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      )}

      {active && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setActive(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--grey-0)',
              borderRadius: 'var(--radius-md)',
              maxWidth: 960,
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            }}
          >
            <div style={{ position: 'relative', background: '#000' }}>
              <video
                src={active.video_url}
                poster={active.thumbnail_url || undefined}
                controls
                autoPlay
                style={{ display: 'block', width: '100%', maxHeight: '70vh' }}
              />
              <button
                onClick={() => setActive(null)}
                aria-label="Close"
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.7)',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: 20 }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>{active.title}</h2>
              {active.category && (
                <div style={{
                  marginTop: 6,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--text-muted)',
                }}>
                  {active.category}
                </div>
              )}
              {active.description && (
                <p style={{ marginTop: 12, color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {active.description}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
