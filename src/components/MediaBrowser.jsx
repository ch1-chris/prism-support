import { useState, useEffect } from 'react';
import { kb } from '../lib/api';

function isImageUrl(url) {
  return url && url.includes('/images/');
}

function filenameFromUrl(url) {
  try {
    const parts = url.split('/');
    const raw = parts[parts.length - 1];
    const withoutTimestamp = raw.replace(/^\d+-/, '');
    return decodeURIComponent(withoutTimestamp);
  } catch {
    return 'Unknown file';
  }
}

function sourceLabel(source) {
  const labels = {
    image_upload: 'Image upload',
    tutorial_video: 'Tutorial video',
    voice_note: 'Voice note',
  };
  return labels[source] || source;
}

export default function MediaBrowser() {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [removing, setRemoving] = useState(null);

  async function loadMedia() {
    setLoading(true);
    setError(null);
    try {
      const result = await kb.listMedia();
      setEntries(result.entries);
      setTotal(result.total);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMedia();
  }, []);

  async function handleRemoveFile(entry) {
    if (!window.confirm(`Remove stored file for "${entry.title}"? The KB entry will remain.`)) return;
    setRemoving(entry.id);
    try {
      await kb.removeFile(entry.id);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      setTotal((c) => c - 1);
    } catch (err) {
      alert(err.message);
    } finally {
      setRemoving(null);
    }
  }

  async function handleDeleteEntry(entry) {
    if (!window.confirm(`Delete "${entry.title}" and its stored file?`)) return;
    setRemoving(entry.id);
    try {
      await kb.delete(entry.id);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      setTotal((c) => c - 1);
    } catch (err) {
      alert(err.message);
    } finally {
      setRemoving(null);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 20, color: 'var(--text-muted)' }}>
        <div className="spinner" /> Loading media files…
      </div>
    );
  }

  if (error) {
    return <div className="error-banner">{error}</div>;
  }

  return (
    <div>
      <div className="info-box" style={{ marginBottom: 16 }}>
        Stored files attached to KB entries. Images are retained permanently; media files (audio/video) are automatically cleaned up after 5 days. Removing a file only deletes the stored file — the KB entry and its extracted knowledge remain.
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {total} file{total !== 1 ? 's' : ''} stored
        </span>
        <button className="btn btn-sm" onClick={loadMedia}>Refresh</button>
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">
          <p>No stored files.</p>
          <p style={{ marginTop: 4 }}>Upload images or videos in the Upload tab to see them here.</p>
        </div>
      ) : (
        <div className="media-grid">
          {entries.map((entry) => {
            const isImage = isImageUrl(entry.file_url);
            const filename = filenameFromUrl(entry.file_url);
            const isBeingRemoved = removing === entry.id;

            return (
              <div key={entry.id} className="media-card" style={{ opacity: isBeingRemoved ? 0.5 : 1 }}>
                <div className="media-card-preview">
                  {isImage ? (
                    <a href={entry.file_url} target="_blank" rel="noreferrer">
                      <img src={entry.file_url} alt={entry.title} />
                    </a>
                  ) : (
                    <a href={entry.file_url} target="_blank" rel="noreferrer" className="media-card-file-icon">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <polygon points="10 12.5 10 18.5 16 15.5 10 12.5" />
                      </svg>
                    </a>
                  )}
                </div>
                <div className="media-card-info">
                  <div className="media-card-title" title={entry.title}>{entry.title}</div>
                  <div className="media-card-meta">
                    <span>{sourceLabel(entry.source)}</span>
                    <span>{new Date(entry.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="media-card-filename" title={filename}>{filename}</div>
                </div>
                <div className="media-card-actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => handleRemoveFile(entry)}
                    disabled={isBeingRemoved}
                    title="Remove file only (keep KB entry)"
                  >
                    Remove file
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => handleDeleteEntry(entry)}
                    disabled={isBeingRemoved}
                    title="Delete entry and file"
                  >
                    Delete all
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
