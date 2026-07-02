import { useState, useEffect, useRef } from 'react';
import { tutorials as tutorialsApi, brands as brandsApi } from '../lib/api';

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
  is_global: true,
  brand_ids: [],
};

export default function TutorialsManager() {
  const [items, setItems] = useState([]);
  const [brandList, setBrandList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [showForm, setShowForm] = useState(false);
  const [videoProgress, setVideoProgress] = useState(null);
  const [thumbProgress, setThumbProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [magicLinkBrandId, setMagicLinkBrandId] = useState({});
  const [magicLinkBusyId, setMagicLinkBusyId] = useState(null);
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

  async function loadBrands() {
    try {
      const res = await brandsApi.list();
      setBrandList(res.brands || []);
    } catch (err) {
      console.error('Failed to load brands:', err);
    }
  }

  useEffect(() => { load(); loadBrands(); }, []);

  function brandNamesFor(item) {
    if (!item.brand_ids?.length) return [];
    return item.brand_ids
      .map((id) => brandList.find((b) => b.id === id)?.name)
      .filter(Boolean);
  }

  function magicLinkBrandCandidates(item) {
    if (!item.published) return [];
    if (item.brand_ids?.length) return item.brand_ids;
    if (item.is_global !== false) return brandList.map((b) => b.id);
    return [];
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

  function copyWatchLink(item) {
    copy(`${window.location.origin}/gallery/${item.id}`, `watch-${item.id}`);
  }

  async function copyMagicLink(item) {
    const candidates = magicLinkBrandCandidates(item);
    const brandId = magicLinkBrandId[item.id] ?? (candidates.length === 1 ? candidates[0] : null);
    if (!brandId) {
      alert('Select an account for this magic link.');
      return;
    }
    setMagicLinkBusyId(item.id);
    try {
      const res = await tutorialsApi.createMagicLink(item.id, brandId);
      await copy(res.url, `magic-${item.id}`);
    } catch (err) {
      alert(`Magic link failed: ${err.message}`);
    } finally {
      setMagicLinkBusyId(null);
    }
  }

  function toggleBrand(id) {
    setDraft((d) => {
      const set = new Set(d.brand_ids || []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...d, brand_ids: Array.from(set) };
    });
  }

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
      is_global: item.is_global !== false,
      brand_ids: item.brand_ids || [],
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
        is_global: draft.is_global,
        brand_ids: draft.is_global ? [] : (draft.brand_ids || []),
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

          <div className="field">
            <label style={{ marginBottom: 6 }}>Visibility</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontWeight: 'normal' }}>
                <input
                  type="radio"
                  name="tut-visibility"
                  checked={draft.is_global}
                  onChange={() => setDraft({ ...draft, is_global: true })}
                  style={{ width: 'auto' }}
                />
                Global — visible to everyone
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontWeight: 'normal' }}>
                <input
                  type="radio"
                  name="tut-visibility"
                  checked={!draft.is_global}
                  onChange={() => setDraft({ ...draft, is_global: false })}
                  style={{ width: 'auto' }}
                />
                Specific accounts only
              </label>
            </div>

            {!draft.is_global && (
              <div style={{
                marginTop: 8,
                padding: 12,
                border: '1px solid var(--grey-100)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--grey-0)',
              }}>
                {brandList.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                    No accounts yet. Create one in the Accounts tab, then assign it here.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {brandList.map((b) => (
                      <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontWeight: 'normal' }}>
                        <input
                          type="checkbox"
                          checked={(draft.brand_ids || []).includes(b.id)}
                          onChange={() => toggleBrand(b.id)}
                          style={{ width: 'auto' }}
                        />
                        {b.name}
                      </label>
                    ))}
                  </div>
                )}
                {(draft.brand_ids || []).length === 0 && (
                  <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                    No accounts selected — this video stays hidden from everyone except admins until you assign one.
                  </p>
                )}
              </div>
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
                    {item.is_global !== false ? (
                      <span className="badge badge-default" style={{ background: 'var(--grey-100)' }}>global</span>
                    ) : item.brand_ids?.length ? (
                      <span className="badge badge-default" style={{ background: 'var(--grey-100)' }} title={brandNamesFor(item).join(', ')}>
                        {brandNamesFor(item).join(', ') || `${item.brand_ids.length} account(s)`}
                      </span>
                    ) : (
                      <span className="badge badge-default" style={{ background: 'var(--grey-100)' }} title="Hidden from everyone except admins">
                        admin only
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

                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {magicLinkBrandCandidates(item).length > 1 && (
                    <select
                      value={magicLinkBrandId[item.id] ?? ''}
                      onChange={(e) => {
                        const val = Number.parseInt(e.target.value, 10);
                        setMagicLinkBrandId((prev) => ({ ...prev, [item.id]: val }));
                      }}
                      disabled={busy || magicLinkBusyId === item.id}
                      style={{ fontSize: 12, maxWidth: 140 }}
                      aria-label={`Account for magic link: ${item.title}`}
                    >
                      <option value="">Account…</option>
                      {magicLinkBrandCandidates(item).map((id) => {
                        const name = brandList.find((b) => b.id === id)?.name ?? id;
                        return <option key={id} value={id}>{name}</option>;
                      })}
                    </select>
                  )}
                  {magicLinkBrandCandidates(item).length > 0 && (
                    <button
                      className="btn btn-sm"
                      onClick={() => copyMagicLink(item)}
                      disabled={busy || magicLinkBusyId === item.id}
                      title="One-click link for emails (does not expose the access code)"
                    >
                      {copiedId === `magic-${item.id}` ? 'Copied!' : magicLinkBusyId === item.id ? 'Creating…' : 'Copy magic link'}
                    </button>
                  )}
                  {item.published && (
                    <button
                      className="btn btn-sm"
                      onClick={() => copyWatchLink(item)}
                      disabled={busy}
                      title="Deep link; viewer still needs the gallery access code"
                    >
                      {copiedId === `watch-${item.id}` ? 'Copied!' : 'Copy watch link'}
                    </button>
                  )}
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
