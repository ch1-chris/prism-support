import { useState, useRef } from 'react';
import { kb } from '../lib/api';

const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/x-matroska'];

function isVideo(file) {
  return VIDEO_TYPES.includes(file.type) || file.type.startsWith('video/');
}

export default function UploadZone({ version, onEntryAdded }) {
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState('');
  const [videoProgress, setVideoProgress] = useState(null);
  const fileRef = useRef();

  async function handleFiles(files) {
    for (const file of files) {
      if (isVideo(file)) {
        await handleVideoFile(file);
      } else {
        await handleRegularFile(file);
      }
    }
    setProcessing('');
    setVideoProgress(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleRegularFile(file) {
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

  async function handleVideoFile(file) {
    setVideoProgress({ step: 'uploading', message: `Uploading ${file.name}…`, current: 0, total: 0 });

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('version', version || 'latest');

      const response = await kb.processVideo(formData);

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Upload failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6);
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);

            if (event.type === 'progress') {
              setVideoProgress({
                step: event.step,
                message: event.message,
                current: event.current || 0,
                total: event.total || 0,
              });
            } else if (event.type === 'entry') {
              onEntryAdded(event.entry);
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          } catch (parseErr) {
            if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
          }
        }
      }
    } catch (err) {
      alert(`Error processing video ${file.name}: ${err.message}`);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    handleFiles(Array.from(e.dataTransfer.files));
  }

  const isProcessing = !!processing || !!videoProgress;

  return (
    <div>
      <div className="info-box">
        Drop in screenshots, tutorial videos, voice notes, text files, or markdown docs. Claude will read and extract knowledge from each one automatically. Tutorial videos are transcribed, split into topics, and analyzed frame-by-frame.
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,audio/*,video/*,.txt,.md"
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(Array.from(e.target.files))}
        disabled={isProcessing}
      />
      <div
        className={`upload-zone ${dragging ? 'dragging' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Upload files"
        onClick={() => !isProcessing && fileRef.current?.click()}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !isProcessing) { e.preventDefault(); fileRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-muted)' }}>
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>

        {videoProgress ? (
          <div style={{ marginTop: 8 }}>
            <p><strong>{videoProgress.message}</strong></p>
            {videoProgress.total > 0 && (
              <div className="video-progress-bar" style={{ marginTop: 10 }}>
                <div className="video-progress-track">
                  <div
                    className="video-progress-fill"
                    style={{ width: `${(videoProgress.current / videoProgress.total) * 100}%` }}
                  />
                </div>
                <span className="video-progress-label">
                  {videoProgress.current} / {videoProgress.total}
                </span>
              </div>
            )}
            {!videoProgress.total && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <div className="spinner" />
              </div>
            )}
          </div>
        ) : processing ? (
          <p><strong>{processing}</strong></p>
        ) : (
          <>
            <p><strong>Click or drag files to upload</strong></p>
            <p>PNG, JPG, MP4, MOV, WEBM, MP3, M4A, TXT, MD</p>
          </>
        )}
      </div>
    </div>
  );
}
