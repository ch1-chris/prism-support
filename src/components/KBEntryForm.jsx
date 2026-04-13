import { useState } from 'react';
import { kb } from '../lib/api';

export default function KBEntryForm({ version, onEntryAdded }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const entry = await kb.processDescription(text, version || 'latest');
      onEntryAdded(entry);
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
        Describe a change, feature, or anything about your app in plain language. Claude will convert it into a structured KB entry.
      </div>
      <div className="field">
        <label htmlFor="describe-input">Describe in plain language</label>
        <textarea
          id="describe-input"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'e.g. "I just moved the trim tool — it used to be in the toolbar but now it\'s in the right-click context menu when you select a clip. There\'s also a new keyboard shortcut, T, that activates it."'}
          disabled={busy}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={busy || !text.trim()}>
          {busy ? 'Processing…' : 'Add to knowledge base'}
        </button>
      </div>
    </div>
  );
}
