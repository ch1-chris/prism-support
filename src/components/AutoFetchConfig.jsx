import { useState, useEffect } from 'react';
import { kb, analytics } from '../lib/api';

export default function AutoFetchConfig() {
  const [url, setUrl] = useState('');
  const [savedUrl, setSavedUrl] = useState('');
  const [lastFetch, setLastFetch] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const settings = await analytics.getSettings();
        if (settings.github_releases_url) {
          setUrl(settings.github_releases_url);
          setSavedUrl(settings.github_releases_url);
        }
        if (settings.last_github_fetch_id) {
          setLastFetch(settings.last_github_fetch_id);
        }
      } catch (err) {
        console.error('Failed to load auto-fetch settings:', err);
      }
    }
    load();
  }, []);

  async function handleSaveUrl() {
    try {
      await analytics.updateSettings({ github_releases_url: url });
      setSavedUrl(url);
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleFetch() {
    setBusy(true);
    setResult(null);
    try {
      const res = await kb.fetchChangelog(url || savedUrl);
      setResult(res);
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="info-box">
        Configure a GitHub releases URL. The system will fetch new releases and ingest them as KB entries automatically.
      </div>

      <div className="field">
        <label htmlFor="github-url-input">GitHub Releases URL</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="github-url-input"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
          />
          <button className="btn" onClick={handleSaveUrl} disabled={!url || url === savedUrl}>
            Save
          </button>
        </div>
      </div>

      {savedUrl && (
        <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
          Configured: <strong>{savedUrl}</strong>
          {lastFetch && <span> &middot; Last fetch ID: {lastFetch}</span>}
        </div>
      )}

      <button className="btn btn-primary" onClick={handleFetch} disabled={busy || (!url && !savedUrl)}>
        {busy ? 'Fetching…' : 'Fetch now'}
      </button>

      {result && (
        <div style={{ marginTop: 16 }}>
          {result.error ? (
            <div className="warn-box">{result.error}</div>
          ) : (
            <div className="info-box">
              Fetched {result.fetched} new release{result.fetched !== 1 ? 's' : ''}.
              {result.message && ` ${result.message}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
