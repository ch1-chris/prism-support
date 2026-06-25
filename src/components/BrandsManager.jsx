import { useState, useEffect } from 'react';
import { brands as brandsApi } from '../lib/api';

export default function BrandsManager() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  const galleryUrl = `${window.location.origin}/gallery`;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await brandsApi.list();
      setItems(res.brands || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const created = await brandsApi.create({ name });
      setItems((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
    } catch (err) {
      alert(`Create failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerate(item) {
    if (!window.confirm(`Generate a new code for "${item.name}"? The old code will stop working immediately.`)) return;
    setBusy(true);
    try {
      const updated = await brandsApi.update(item.id, { regenerate_code: true });
      setItems((prev) => prev.map((b) => (b.id === item.id ? updated : b)));
    } catch (err) {
      alert(`Regenerate failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete account "${item.name}"? Its access code stops working and its video assignments are removed.`)) return;
    setBusy(true);
    try {
      await brandsApi.remove(item.id);
      setItems((prev) => prev.filter((b) => b.id !== item.id));
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function copy(text, id) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      alert('Copy failed — your browser blocked clipboard access.');
    }
  }

  return (
    <div>
      <div className="info-box" style={{ marginBottom: 16 }}>
        Accounts are your clients (e.g. Billboard). Each gets a unique access code. Share <code>{galleryUrl}</code> and
        the code with the client; when they enter it on the gallery they see global tutorials plus the videos assigned
        to their account. Assign videos to an account from the <strong>Gallery</strong> tab.
      </div>

      <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="New account name (e.g. Billboard)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={{ flex: 1, minWidth: 220 }}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !newName.trim()}>
          {busy ? 'Working…' : '+ Create account'}
        </button>
        <button type="button" className="btn btn-sm" onClick={load} disabled={loading || busy}>Refresh</button>
      </form>

      {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 20, color: 'var(--text-muted)' }}>
          <div className="spinner" /> Loading accounts…
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <p>No accounts yet.</p>
          <p style={{ marginTop: 4 }}>Create one above to start sharing brand-specific tutorials.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                gap: 12,
                padding: 12,
                border: '1px solid var(--grey-100)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--grey-0)',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 1, minWidth: 220 }}>
                <strong style={{ fontSize: 14 }}>{item.name}</strong>
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <code style={{
                    fontSize: 13,
                    padding: '3px 8px',
                    background: 'var(--grey-50)',
                    border: '1px solid var(--grey-100)',
                    borderRadius: 'var(--radius-sm)',
                  }}>
                    {item.access_code}
                  </code>
                  <button className="btn btn-sm" onClick={() => copy(item.access_code, `code-${item.id}`)}>
                    {copiedId === `code-${item.id}` ? 'Copied!' : 'Copy code'}
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => copy(`${galleryUrl}\nAccess code: ${item.access_code}`, `link-${item.id}`)}
                  >
                    {copiedId === `link-${item.id}` ? 'Copied!' : 'Copy link + code'}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-sm" onClick={() => handleRegenerate(item)} disabled={busy}>
                  Regenerate code
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(item)} disabled={busy}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
