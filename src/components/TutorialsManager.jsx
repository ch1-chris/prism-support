import { useState, useEffect, useRef } from 'react';
import { tutorials as tutorialsApi } from '../lib/api';

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const EMPTY_DRAFT = {
  title: '',
  description: '',
  category: '',
  video_url: '',
  thumbnail_url: '',
  published: true,
  display_order: 0,
};

export default function TutorialsManager() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [showForm, setShowForm] = useState(false);
  const [videoProgress, setVideoProgress] = useState(null);
  const [thumbProgress, setThumbProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  const videoInputRef = useRef();
  const thumbInputRef = useRef();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await tutorialsApi.listAdmin();
      setItems(res.tutorials || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function startCreate() {
    setEditingId(null);
    setDraft({ ...EMPTY_DRAFT, display_order: items.length });
    setShowForm(true);
  }

  function startEdit(item) {
    setEditingId(item.id);
    setDraft({
      title: item.title || '',
      description: item.description || '',
      category: item.category || '',
      video_url: item.video_url || '',
      thumbnail_url: item.thumbnail_url || '',
      published: item.published !== false,
      display_order: item.display_order ?? 0,
    });
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setVideoProgress(null);
    setThumbProgress(null);
  }

  async function handleVideoFile(file) {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      alert('Please choose a video file');
      return;
    }
    setVideoProgress({ loaded: 0, total: file.size });
    try {
      const res = await tutorialsApi.uploadVideo(file, (p) => {
        setVideoProgress({ loaded: p.loaded, total: p.total });
      });
      setDraft((d) => ({ ...d, video_url: res.video_url }));
    } catch (err) {
      alert(`Video upload failed: ${err.message}`);
    } finally {
      setVideoProgress(null);
      if (videoInputRef.current) videoInputRef.current.value = '';
    }
  }

  async function handleThumbnailFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please choose an image file');
      return;
    }
    setThumbProgress({ loaded: 0, total: file.size });
    try {
      const res = await tutorialsApi.uploadThumbnail(file, (p) => {
        setThumbProgress({ loaded: p.loaded, total: p.total });
      });
      setDraft((d) => ({ ...d, thumbnail_url: res.thumbnail_url }));
    } catch (err) {
      alert(`Thumbnail upload failed: ${err.message}`);
    } finally {
      setThumbProgress(null);
      if (thumbInputRef.current) thumbInputRef.current.value = '';
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!draft.title.trim()) {
      alert('Title is required');
      return;
    }
    if (!draft.video_url.trim()) {
      alert('Video URL is required (upload a file or paste a URL)');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        category: draft.category.trim() || null,
        video_url: draft.video_url.trim(),
        thumbnail_url: draft.thumbnail_url.trim() || null,
        published: draft.published,
        display_order: Number(draft.display_order) || 0,
      };
      if (editingId) {
        const updated = await tutorialsApi.update(editingId, payload);
        setItems((prev) => prev.map((it) => (it.id === editingId ? updated : it)));
      } else {
        const created = await tutorialsApi.create(payload);
        setItems((prev) => [...prev, created].sort((a, b) =>
          (a.display_order ?? 0) - (b.display_order ?? 0)
        ));
      }
      cancelForm();
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete tutorial "${item.title}" and its uploaded files?`)) return;
    setBusy(true);
    try {
      await tutorialsApi.remove(item.id);
      setItems((prev) => prev.filter((it) => it.id !== item.id));
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function move(item, direction) {
    const sorted = [...items].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
    const index = sorted.findIndex((it) => it.id === item.id);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= sorted.length) return;

    const reordered = [...sorted];
    [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
    const payload = reordered.map((it, idx) => ({ id: it.id, display_order: idx }));

    setBusy(true);
    try {
      await tutorialsApi.reorder(payload);
      setItems(reordered.map((it, idx) => ({ ...it, display_order: idx })));
    } catch (err) {
      alert(`Reorder failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="info-box" style={{ marginBottom: 16 }}>
        Manage the public tutorial gallery. Upload videos and thumbnails, set categories, and reorder cards. Unpublished tutorials are hidden from <code>/gallery</code>.
        <br />
        <small style={{ color: 'var(--text-muted)' }}>
          Files upload directly to Supabase Storage. The <code>helpbot-uploads</code> bucket&apos;s File size limit (Storage &rarr; Buckets &rarr; Edit) caps how large a video can be.
        </small>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {items.length} tutorial{items.length !== 1 ? 's' : ''}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={load} disabled={loading || busy}>Refresh</button>
          {!showForm && (
            <button className="btn btn-sm btn-primary" onClick={startCreate} disabled={busy}>
              + New tutorial
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

      {showForm && (
        <form
          onSubmit={handleSave}
          style={{
            border: '1px solid var(--grey-100)',
            borderRadius: 'var(--radius-md)',
            padding: 16,
            marginBottom: 16,
            background: 'var(--grey-50)',
          }}
        >
          <h3 style={{ marginTop: 0 }}>
            {editingId ? `Edit tutorial #${editingId}` : 'New tutorial'}
          </h3>

          <div className="field">
            <label htmlFor="tut-title">Title *</label>
            <input
              id="tut-title"
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="tut-desc">Description</label>
            <textarea
              id="tut-desc"
              rows={3}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label htmlFor="tut-cat">Category</label>
              <input
                id="tut-cat"
                type="text"
                placeholder="e.g. Editing, Export"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="tut-order">Display order</label>
              <input
                id="tut-order"
                type="number"
                value={draft.display_order}
                onChange={(e) => setDraft({ ...draft, display_order: e.target.value })}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="tut-video-file">Video file (upload)</label>
            <input
              id="tut-video-file"
              ref={videoInputRef}
              type="file"
              accept="video/*"
              onChange={(e) => handleVideoFile(e.target.files?.[0])}
              disabled={!!videoProgress}
            />
            {videoProgress && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Uploading… {formatBytes(videoProgress.loaded)} / {formatBytes(videoProgress.total)}
              </div>
            )}
          </div>

          <div className="field">
            <label htmlFor="tut-video-url">Video URL *</label>
            <input
              id="tut-video-url"
              type="url"
              placeholder="https://… (auto-filled after upload)"
              value={draft.video_url}
              onChange={(e) => setDraft({ ...draft, video_url: e.target.value })}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="tut-thumb-file">Thumbnail (upload)</label>
            <input
              id="tut-thumb-file"
              ref={thumbInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => handleThumbnailFile(e.target.files?.[0])}
              disabled={!!thumbProgress}
            />
            {thumbProgress && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Uploading… {formatBytes(thumbProgress.loaded)} / {formatBytes(thumbProgress.total)}
              </div>
            )}
          </div>

          <div className="field">
            <label htmlFor="tut-thumb-url">Thumbnail URL</label>
            <input
              id="tut-thumb-url"
              type="url"
              placeholder="https://… (optional, auto-filled after upload)"
              value={draft.thumbnail_url}
              onChange={(e) => setDraft({ ...draft, thumbnail_url: e.target.value })}
            />
            {draft.thumbnail_url && (
              <img
                src={draft.thumbnail_url}
                alt="Thumbnail preview"
                style={{
                  marginTop: 8,
                  maxHeight: 120,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--grey-100)',
                }}
              />
            )}
          </div>

          <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              id="tut-published"
              type="checkbox"
              checked={draft.published}
              onChange={(e) => setDraft({ ...draft, published: e.target.checked })}
              style={{ width: 'auto' }}
            />
            <label htmlFor="tut-published" style={{ margin: 0 }}>Published (visible on /gallery)</label>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={busy || !!videoProgress || !!thumbProgress}>
              {busy ? 'Saving…' : editingId ? 'Save changes' : 'Create tutorial'}
            </button>
            <button type="button" className="btn" onClick={cancelForm} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 20, color: 'var(--text-muted)' }}>
          <div className="spinner" /> Loading tutorials…
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <p>No tutorials yet.</p>
          <p style={{ marginTop: 4 }}>Click &quot;New tutorial&quot; above to add one.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[...items]
            .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
            .map((item, idx, arr) => (
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
                }}
              >
                <div style={{
                  width: 96,
                  height: 56,
                  flexShrink: 0,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--grey-100)',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {item.thumbnail_url ? (
                    <img src={item.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>no thumb</span>
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 14 }}>{item.title}</strong>
                    {!item.published && (
                      <span className="badge badge-default" style={{ background: 'var(--grey-100)' }}>draft</span>
                    )}
                    {item.category && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        {item.category}
                      </span>
                    )}
                  </div>
                  {item.description && (
                    <div style={{
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      marginTop: 4,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {item.description}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    order {item.display_order ?? 0} · <a href={item.video_url} target="_blank" rel="noreferrer">video</a>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className="btn btn-sm"
                    onClick={() => move(item, 'up')}
                    disabled={busy || idx === 0}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => move(item, 'down')}
                    disabled={busy || idx === arr.length - 1}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button className="btn btn-sm" onClick={() => startEdit(item)} disabled={busy}>
                    Edit
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => handleDelete(item)}
                    disabled={busy}
                  >
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
