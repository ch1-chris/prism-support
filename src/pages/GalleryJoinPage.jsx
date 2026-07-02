import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { tutorials as tutorialsApi } from '../lib/api';

export default function GalleryJoinPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await tutorialsApi.redeemMagicLink(token);
        if (cancelled) return;
        navigate(`/gallery/${res.tutorialId}`, { replace: true });
      } catch (err) {
        if (!cancelled) setError(err.message || 'This link has expired or is no longer valid');
      }
    })();
    return () => { cancelled = true; };
  }, [token, navigate]);

  return (
    <div className="chat-page gallery-page">
      <header className="chat-topbar">
        <div className="chat-topbar-inner">
          <div className="chat-brand">
            <img src="/prism-logo.png" alt="Prism" className="chat-brand-icon" />
            <span className="chat-brand-text">Tutorial Gallery</span>
          </div>
          <div className="chat-topbar-controls">
            <Link to="/" className="chat-new-btn">Back to chat</Link>
          </div>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        {error ? (
          <div className="login-card" style={{ maxWidth: 420, textAlign: 'center' }}>
            <img src="/prism-logo.png" alt="Prism" style={{ width: 56, height: 56, borderRadius: 12, marginBottom: 12 }} />
            <h1>Link unavailable</h1>
            <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
            <Link to="/gallery" className="btn btn-primary" style={{ display: 'inline-block', marginTop: 16 }}>
              Go to gallery
            </Link>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 14 }}>
            <div className="spinner" /> Opening tutorial…
          </div>
        )}
      </div>
    </div>
  );
}
