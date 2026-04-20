import { useState, useRef } from 'react';
import { kb } from '../lib/api';

const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/x-matroska'];

function isVideo(file) {
  return VIDEO_TYPES.includes(file.type) || file.type.startsWith('video/');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function UploadZone({ version, onEntryAdded }) {
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(null);
  const fileRef = useRef();

  async function handleFiles(files) {
    for (const file of files) {
      if (isVideo(file)) {
        await handleVideoFile(file);
      } else {
        await handleRegularFile(file);
      }
    }
    setProgress(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleRegularFile(file) {
    setProgress({
      phase: 'uploading',
      message: `Uploading ${file.name}…`,
      loaded: 0,
      total: file.size,
    });

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('version', version || 'latest');

      const entry = await kb.processUpload(formData, (p) => {
        if (p.loaded < p.total) {
          setProgress({
            phase: 'uploading',
            message: `Uploading ${file.name}…`,
            loaded: p.loaded,
            total: p.total,
          });
        } else {
          setProgress({
            phase: 'analyzing',
            message: `Analyzing ${file.name} with Claude…`,
            loaded: 0,
            total: 0,
          });
        }
      });

      onEntryAdded(entry);
    } catch (err) {
      alert(`Error processing ${file.name}: ${err.message}`);
    }
  }

  async function handleVideoFile(file) {
    setProgress({
      phase: 'uploading',
      message: `Uploading ${file.name}…`,
      loaded: 0,
      total: file.size,
    });

    try {
      const formData = new FormData();
      formData.append('file', file);

      const { fileUrl, tmpPath } = await kb.uploadVideo(formData, (p) => {
        setProgress({
          phase: 'uploading',
          message: `Uploading ${file.name}…`,
          loaded: p.loaded,
          total: p.total,
        });
      });

      setProgress({
        phase: 'processing',
        message: 'Upload complete — starting video analysis…',
      });

      const response = await kb.processVideo({
        tmpPath,
        fileUrl,
        version: version || 'latest',
        mimetype: file.type,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Processing failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = '';
      let receivedDone = false;

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
              setProgress({
                phase: 'processing',
                message: event.message,
                current: event.current || 0,
                total: event.total || 0,
                step: event.step,
              });
            } else if (event.type === 'entry') {
              onEntryAdded(event.entry);
            } else if (event.type === 'done') {
              receivedDone = true;
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          } catch (parseErr) {
            if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
          }
        }
      }

      if (!receivedDone) {
        throw new Error('Connection lost during video processing. The server may still be working — check the KB Browser for new entries.');
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

  const isProcessing = !!progress;
  const uploadPercent = progress?.phase === 'uploading' && progress.total > 0
    ? Math.round((progress.loaded / progress.total) * 100)
    : null;
  const stepProgress = progress?.phase === 'processing' && progress.total > 0;

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

        {progress ? (
          <div style={{ marginTop: 8, width: '100%', maxWidth: 320 }}>
            <p><strong>{progress.message}</strong></p>

            {uploadPercent !== null && (
              <div className="video-progress-bar" style={{ marginTop: 10 }}>
                <div className="video-progress-track">
                  <div
                    className="video-progress-fill"
                    style={{ width: `${uploadPercent}%` }}
                  />
                </div>
                <span className="video-progress-label">
                  {formatBytes(progress.loaded)} / {formatBytes(progress.total)} ({uploadPercent}%)
                </span>
              </div>
            )}

            {stepProgress && (
              <div className="video-progress-bar" style={{ marginTop: 10 }}>
                <div className="video-progress-track">
                  <div
                    className="video-progress-fill"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
                <span className="video-progress-label">
                  {progress.current} / {progress.total}
                </span>
              </div>
            )}

            {progress.phase !== 'uploading' && !stepProgress && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <div className="spinner" />
              </div>
            )}
          </div>
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
