import { useState, useRef } from 'react';
import { kb } from '../lib/api';

export default function UploadZone({ version, onEntryAdded }) {
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState('');
  const fileRef = useRef();

  async function handleFiles(files) {
    for (const file of files) {
      setProcessing(`Processing ${file.name}…`);
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('version', version || 'latest');
        const entry = await kb.processUpload(formData);
        onEntryAdded(entry);
      } catch (err) {
        alert(`Error processing ${file.name}: ${err.message}`);
      }
    }
    setProcessing('');
    if (fileRef.current) fileRef.current.value = '';
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    handleFiles(Array.from(e.dataTransfer.files));
  }

  return (
    <div>
      <div className="info-box">
        Drop in screenshots, screen recordings, voice notes, text files, or markdown docs. Claude will read and extract knowledge from each one automatically.
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,audio/*,video/*,.txt,.md"
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(Array.from(e.target.files))}
      />
      <div
        className={`upload-zone ${dragging ? 'dragging' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Upload files"
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-muted)' }}>
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        {processing ? (
          <p><strong>{processing}</strong></p>
        ) : (
          <>
            <p><strong>Click or drag files to upload</strong></p>
            <p>PNG, JPG, MP4, MOV, MP3, M4A, TXT, MD</p>
          </>
        )}
      </div>
    </div>
  );
}
