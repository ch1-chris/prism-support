import { useState } from 'react';
import { kb } from '../lib/api';

const SOURCE_LABELS = {
  image_upload: 'IMG',
  text_file: 'TXT',
  changelog: 'LOG',
  description: 'DESC',
  voice_note: 'MIC',
  bulk_import: 'IMP',
  tutorial_video: 'VID',
  training_chat: 'CHAT',
};

function isImageUrl(url) {
  return url && url.includes('/images/');
}

export default function KBEntryCard({ entry, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(entry.content);
  const [editTitle, setEditTitle] = useState(entry.title);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await kb.update(entry.id, { title: editTitle, content: editContent });
      onUpdate(updated);
      setEditing(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${entry.title}"?`)) return;
    try {
      await kb.delete(entry.id);
      onDelete(entry.id);
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleRemoveFile() {
    if (!window.confirm('Remove the stored file? The KB entry will remain.')) return;
    try {
      await kb.removeFile(entry.id);
      onUpdate({ ...entry, file_url: null });
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="kb-entry">
      <div className="kb-entry-header">
        <span className={`source-icon source-${entry.source}`}>
          {SOURCE_LABELS[entry.source] || '?'}
        </span>
        {editing ? (
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            style={{ flex: 1, fontSize: 13 }}
          />
        ) : (
          <span className="kb-entry-title">{entry.title}</span>
        )}
        {entry.version && entry.version !== 'latest' && (
          <span className="badge badge-blue">{entry.version}</span>
        )}
        {entry.file_url && (
          <span className="badge badge-default" title="Has stored file">
            {isImageUrl(entry.file_url) ? 'IMG' : 'FILE'}
          </span>
        )}
        {entry.is_stale && (
          <span className="badge badge-amber" title={entry.stale_reason}>Stale</span>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {new Date(entry.updated_at).toLocaleDateString()}
        </span>
        {editing ? (
          <>
            <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn btn-sm" onClick={() => { setEditing(false); setEditTitle(entry.title); setEditContent(entry.content); }}>Cancel</button>
          </>
        ) : (
          <>
            <button className="btn btn-sm" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Hide' : 'View'}
            </button>
            <button className="btn btn-sm" onClick={() => { setEditing(true); setExpanded(true); }}>
              Edit
            </button>
            <button className="btn btn-sm btn-danger" onClick={handleDelete}>Del</button>
          </>
        )}
      </div>

      {expanded && entry.file_url && (
        <div className="kb-entry-file" style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          {isImageUrl(entry.file_url) ? (
            <a href={entry.file_url} target="_blank" rel="noreferrer">
              <img
                src={entry.file_url}
                alt={entry.title}
                style={{
                  maxWidth: 200,
                  maxHeight: 140,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  objectFit: 'cover',
                }}
              />
            </a>
          ) : (
            <a
              href={entry.file_url}
              target="_blank"
              rel="noreferrer"
              className="btn btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Open file
            </a>
          )}
          <button
            className="btn btn-sm"
            onClick={handleRemoveFile}
            title="Remove stored file"
            style={{ fontSize: 11, color: 'var(--text-muted)' }}
          >
            Remove file
          </button>
        </div>
      )}

      {expanded && editing ? (
        <textarea
          rows={8}
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          style={{ marginTop: 10, fontSize: 13 }}
        />
      ) : expanded ? (
        <div className="kb-entry-expanded">{entry.content}</div>
      ) : (
        <div className="kb-entry-preview">{entry.content}</div>
      )}
      {expanded && entry.feature_name && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
          <strong>Feature:</strong> {entry.feature_name}
          {entry.ui_location && <> &middot; <strong>Location:</strong> {entry.ui_location}</>}
          {entry.keyboard_shortcut && <> &middot; <strong>Shortcut:</strong> {entry.keyboard_shortcut}</>}
        </div>
      )}
    </div>
  );
}
