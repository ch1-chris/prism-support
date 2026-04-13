import { useState } from 'react';
import { kb } from '../lib/api';

export default function ChangelogForm({ version, onEntriesAdded }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const result = await kb.processChangelog(text, version || 'latest');
      onEntriesAdded(result.entries, result.stale_count);
      setText('');
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="info-box">
        Paste your release notes or changelog. Claude will extract all changes into structured KB entries and flag any existing entries that are now stale.
      </div>
      <div className="field">
        <label htmlFor="changelog-input">Release notes / changelog</label>
        <textarea
          id="changelog-input"
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"v2.4.0 — April 2026\n\n- Moved Export button from top toolbar to File menu\n- Added Quick Export option (uses last export settings)\n- New Speed Ramp tool in the Effects panel"}
          disabled={busy}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={busy || !text.trim()}>
          {busy ? 'Processing…' : 'Ingest changelog'}
        </button>
      </div>
    </div>
  );
}
