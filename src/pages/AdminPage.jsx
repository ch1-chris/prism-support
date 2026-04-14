import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, kb } from '../lib/api';
import AnalyticsDashboard from '../components/AnalyticsDashboard';
import UploadZone from '../components/UploadZone';
import ChangelogForm from '../components/ChangelogForm';
import KBEntryForm from '../components/KBEntryForm';
import KBEntryCard from '../components/KBEntryCard';
import AutoFetchConfig from '../components/AutoFetchConfig';
import KBTestRunner from '../components/KBTestRunner';
import SupportTickets from '../components/SupportTickets';
import AdminChat from '../components/AdminChat';
import MediaBrowser from '../components/MediaBrowser';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '◈', color: '#2ED6E5' },
  { id: 'training', label: 'Training Chat', icon: '◉', color: '#FFB700' },
  { id: 'upload', label: 'Upload', icon: '↑', color: '#1ABEFF' },
  { id: 'changelog', label: 'Changelog', icon: '△', color: '#FFAB1A' },
  { id: 'describe', label: 'Describe', icon: '✎', color: '#7040FF' },
  { id: 'entries', label: 'KB Browser', icon: '☰', color: '#F266FF' },
  { id: 'media', label: 'Media', icon: '◻', color: '#FF6B8A' },
  { id: 'bulk', label: 'Bulk Import', icon: '⤓', color: '#1ABEFF' },
  { id: 'autofetch', label: 'Auto-Fetch', icon: '⟳', color: '#3AE556' },
  { id: 'tests', label: 'Test Runner', icon: '✓', color: '#3AE556' },
  { id: 'tickets', label: 'Tickets', icon: '✉', color: '#E53A3A' },
];

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [entries, setEntries] = useState([]);
  const [entryCount, setEntryCount] = useState(0);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [staleFilter, setStaleFilter] = useState(false);
  const [version, setVersion] = useState('latest');
  const [versions, setVersions] = useState([]);
  const [bulkFiles, setBulkFiles] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditProgress, setAuditProgress] = useState('');
  const [auditResult, setAuditResult] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    auth.status()
      .then((res) => {
        if (!res.authenticated) navigate('/admin/login');
        else setAuthenticated(true);
      })
      .catch(() => navigate('/admin/login'));
  }, [navigate]);

  const loadEntries = useCallback(async () => {
    try {
      const params = {};
      if (search) params.search = search;
      if (sourceFilter) params.source = sourceFilter;
      if (staleFilter) params.stale = 'true';
      const result = await kb.list(params);
      setEntries(result.entries);
      setEntryCount(result.total);
    } catch (err) {
      console.error('Failed to load entries:', err);
    }
  }, [search, sourceFilter, staleFilter]);

  useEffect(() => {
    if (authenticated) {
      loadEntries();
      kb.getVersions().then(setVersions).catch((err) => console.error('Failed to load versions:', err));
      kb.checkStaleness().catch((err) => console.error('Failed to check staleness:', err));
    }
  }, [authenticated, loadEntries]);

  function handleEntryAdded(entry) {
    setEntries((prev) => [entry, ...prev]);
    setEntryCount((c) => c + 1);
    setActiveTab('entries');
  }

  function handleEntriesAdded(newEntries, staleCount) {
    setEntries((prev) => [...newEntries, ...prev]);
    setEntryCount((c) => c + newEntries.length);
    if (staleCount > 0) {
      alert(`${newEntries.length} entries processed, ${staleCount} existing entries flagged as stale.`);
    }
    setActiveTab('entries');
  }

  function handleEntryUpdate(updated) {
    setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  }

  function handleEntryDelete(id) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setEntryCount((c) => c - 1);
  }

  async function runAudit() {
    setAuditRunning(true);
    setAuditProgress('Starting audit...');
    setAuditResult(null);
    try {
      const response = await kb.audit();
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${response.status})`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === 'progress') setAuditProgress(event.message);
          if (event.type === 'done') {
            setAuditResult(event);
            setAuditProgress('');
          }
        }
      }
      if (buffer.startsWith('data: ')) {
        const event = JSON.parse(buffer.slice(6));
        if (event.type === 'done') setAuditResult(event);
      }
      loadEntries();
    } catch (err) {
      setAuditResult({ error: err.message });
    } finally {
      setAuditRunning(false);
    }
  }

  async function handleBulkImport() {
    if (!bulkFiles?.length) return;
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const formData = new FormData();
      for (const file of bulkFiles) {
        formData.append('files', file);
      }
      formData.append('version', version);
      const result = await kb.bulkImport(formData);
      setBulkResult(result);
      loadEntries();
    } catch (err) {
      setBulkResult({ error: err.message });
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleLogout() {
    await auth.logout();
    navigate('/admin/login');
  }

  if (!authenticated) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 10, color: 'var(--text-muted)', fontSize: 14 }}>
        <div className="spinner" /> Checking authentication…
      </div>
    );
  }

  return (
    <div className="layout">
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}
      <div className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <img src="/prism-logo.png" alt="Prism" className="sidebar-brand-logo" />
          Prism Support <span>admin</span>
        </div>
        <div className="sidebar-section">Manage</div>
        {TABS.map((tab) => (
          <div
            key={tab.id}
            role="button"
            tabIndex={0}
            className={`sidebar-link ${activeTab === tab.id ? 'active' : ''}`}
            style={activeTab === tab.id ? { color: tab.color, borderLeftColor: tab.color } : undefined}
            onClick={() => { setActiveTab(tab.id); setSidebarOpen(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTab(tab.id); setSidebarOpen(false); } }}
          >
            <span style={{ width: 16, textAlign: 'center', fontSize: 14, color: tab.color }}>{tab.icon}</span>
            {tab.label}
            {tab.id === 'entries' && <span className="badge badge-default" style={{ marginLeft: 'auto' }}>{entryCount}</span>}
          </div>
        ))}
        <div className="sidebar-section">Navigation</div>
        <a href="/" className="sidebar-link" target="_blank" rel="noreferrer">
          <span style={{ width: 16, textAlign: 'center', fontSize: 14 }}>💬</span>
          Open chatbot
        </a>
        <div
          className="sidebar-link"
          role="button"
          tabIndex={0}
          onClick={handleLogout}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleLogout(); } }}
        >
          <span style={{ width: 16, textAlign: 'center', fontSize: 14 }}>⏻</span>
          Sign out
        </div>
        <div className="sidebar-footer">
          {entryCount} KB {entryCount === 1 ? 'entry' : 'entries'}
        </div>
      </div>

      <div className="main">
        <div className="main-header">
          <button
            className="btn btn-icon sidebar-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle sidebar menu"
          >
            ☰
          </button>
          <h1>{TABS.find((t) => t.id === activeTab)?.label}</h1>
          {['upload', 'changelog', 'describe', 'bulk'].includes(activeTab) && (
            <div className="selectors-row" style={{ marginLeft: 'auto' }}>
              <label style={{ margin: 0, fontSize: 12 }}>Version:</label>
              <select value={version} onChange={(e) => setVersion(e.target.value)} style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}>
                <option value="latest">latest</option>
                {versions.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="main-content">
          {activeTab === 'dashboard' && <AnalyticsDashboard />}

          {activeTab === 'training' && <AdminChat />}

          {activeTab === 'upload' && (
            <UploadZone version={version} onEntryAdded={handleEntryAdded} />
          )}

          {activeTab === 'changelog' && (
            <ChangelogForm version={version} onEntriesAdded={handleEntriesAdded} />
          )}

          {activeTab === 'describe' && (
            <KBEntryForm version={version} onEntryAdded={handleEntryAdded} />
          )}

          {activeTab === 'entries' && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <input
                  type="text"
                  placeholder="Search entries…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ flex: 1 }}
                />
                <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} style={{ width: 'auto' }}>
                  <option value="">All sources</option>
                  <option value="image_upload">Image upload</option>
                  <option value="text_file">Text file</option>
                  <option value="changelog">Changelog</option>
                  <option value="description">Description</option>
                  <option value="voice_note">Voice note</option>
                  <option value="bulk_import">Bulk import</option>
                  <option value="tutorial_video">Tutorial video</option>
                  <option value="training_chat">Training chat</option>
                </select>
                <button
                  className={`btn btn-sm ${staleFilter ? 'btn-primary' : ''}`}
                  onClick={() => setStaleFilter(!staleFilter)}
                >
                  Stale only
                </button>
                <button className="btn btn-sm" onClick={loadEntries}>Refresh</button>
                <button
                  className="btn btn-sm"
                  onClick={runAudit}
                  disabled={auditRunning}
                  style={{ background: '#F266FF', color: '#fff', borderColor: '#F266FF' }}
                >
                  {auditRunning ? 'Auditing…' : 'Audit KB'}
                </button>
              </div>

              {auditRunning && auditProgress && (
                <div className="info-box" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="spinner" style={{ width: 16, height: 16 }}></span>
                  {auditProgress}
                </div>
              )}

              {auditResult && !auditResult.error && (
                <div className="info-box" style={{ marginBottom: 12, borderLeft: `3px solid ${auditResult.clean ? 'var(--green)' : 'var(--prism-orange)'}` }}>
                  <strong>{auditResult.clean ? 'KB is clean!' : 'Issues found'}</strong>
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    Scanned {auditResult.total} entries.
                    {auditResult.duplicates?.length > 0 && <span> {auditResult.duplicates.length} duplicate{auditResult.duplicates.length !== 1 ? 's' : ''} detected.</span>}
                    {auditResult.contradictions?.length > 0 && <span> {auditResult.contradictions.length} contradiction{auditResult.contradictions.length !== 1 ? 's' : ''} flagged as stale.</span>}
                    {auditResult.clean && <span> No duplicates or contradictions found.</span>}
                  </div>
                  {auditResult.duplicates?.length > 0 && (
                    <details style={{ marginTop: 8, fontSize: 13 }}>
                      <summary style={{ cursor: 'pointer' }}>Duplicates ({auditResult.duplicates.length})</summary>
                      <ul style={{ marginTop: 4, paddingLeft: 16 }}>
                        {auditResult.duplicates.map((d, i) => (
                          <li key={i}>Keep #{d.keep_id}, remove #{d.remove_id} — {d.reason}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {auditResult.contradictions?.length > 0 && (
                    <details style={{ marginTop: 8, fontSize: 13 }}>
                      <summary style={{ cursor: 'pointer' }}>Contradictions ({auditResult.contradictions.length})</summary>
                      <ul style={{ marginTop: 4, paddingLeft: 16 }}>
                        {auditResult.contradictions.map((c, i) => (
                          <li key={i}>Keep #{c.keep_id}, stale #{c.stale_id} — {c.conflict}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              {auditResult?.error && (
                <div className="error-banner" style={{ marginBottom: 12 }}>{auditResult.error}</div>
              )}

              {entries.length === 0 ? (
                <div className="empty-state">
                  <p>No entries{search || sourceFilter || staleFilter ? ' match your filters' : ' yet'}.</p>
                  <p style={{ marginTop: 4 }}>Add files, changelogs, or descriptions to build the knowledge base.</p>
                </div>
              ) : (
                entries.map((entry) => (
                  <KBEntryCard
                    key={entry.id}
                    entry={entry}
                    onUpdate={handleEntryUpdate}
                    onDelete={handleEntryDelete}
                  />
                ))
              )}
            </div>
          )}

          {activeTab === 'bulk' && (
            <div>
              <div className="info-box">
                Upload multiple markdown or text files (or a ZIP) to import them all as KB entries at once.
              </div>
              <div className="field">
                <label htmlFor="bulk-import-files">Select files</label>
                <input
                  id="bulk-import-files"
                  type="file"
                  multiple
                  accept=".md,.txt,.zip"
                  onChange={(e) => setBulkFiles(Array.from(e.target.files))}
                />
              </div>
              {bulkFiles?.length > 0 && (
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  {bulkFiles.length} file{bulkFiles.length !== 1 ? 's' : ''} selected
                </p>
              )}
              <button
                className="btn btn-primary"
                onClick={handleBulkImport}
                disabled={bulkBusy || !bulkFiles?.length}
              >
                {bulkBusy ? 'Importing…' : 'Import all'}
              </button>
              {bulkResult && (
                <div style={{ marginTop: 16 }}>
                  {bulkResult.error ? (
                    <div className="warn-box">{bulkResult.error}</div>
                  ) : (
                    <div className="info-box">
                      Imported {bulkResult.imported} entries.
                      {bulkResult.errors?.length > 0 && (
                        <> {bulkResult.errors.length} failed: {bulkResult.errors.map(e => e.file).join(', ')}</>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'media' && <MediaBrowser />}
          {activeTab === 'autofetch' && <AutoFetchConfig />}
          {activeTab === 'tests' && <KBTestRunner />}
          {activeTab === 'tickets' && <SupportTickets />}
        </div>
      </div>
    </div>
  );
}
