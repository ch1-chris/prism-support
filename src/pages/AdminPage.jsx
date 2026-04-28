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
import TutorialsManager from '../components/TutorialsManager';
import FaqManager from '../components/FaqManager';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '◈', color: '#2ED6E5' },
  { id: 'training', label: 'Training Chat', icon: '◉', color: '#FFB700' },
  { id: 'upload', label: 'Upload', icon: '↑', color: '#1ABEFF' },
  { id: 'changelog', label: 'Changelog', icon: '△', color: '#FFAB1A' },
  { id: 'describe', label: 'Describe', icon: '✎', color: '#7040FF' },
  { id: 'entries', label: 'KB Browser', icon: '☰', color: '#F266FF' },
  { id: 'media', label: 'Media', icon: '◻', color: '#FF6B8A' },
  { id: 'gallery', label: 'Gallery', icon: '▶', color: '#FF6B8A' },
  { id: 'faq', label: 'FAQ', icon: '?', color: '#7040FF' },
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
  const [auditLive, setAuditLive] = useState({ applied: [], skipped: [] });
  const [auditRuns, setAuditRuns] = useState([]);
  const [revertingId, setRevertingId] = useState(null);
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

  const loadAuditRuns = useCallback(async () => {
    try {
      const result = await kb.listAuditRuns(5);
      setAuditRuns(result.runs || []);
    } catch (err) {
      console.error('Failed to load audit runs:', err);
    }
  }, []);

  useEffect(() => {
    if (authenticated) {
      loadEntries();
      loadAuditRuns();
      kb.getVersions().then(setVersions).catch((err) => console.error('Failed to load versions:', err));
    }
  }, [authenticated, loadEntries, loadAuditRuns]);

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
    setAuditLive({ applied: [], skipped: [] });
    try {
      const response = await kb.audit();
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${response.status})`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const handleEvent = (event) => {
        if (event.type === 'progress') setAuditProgress(event.message);
        else if (event.type === 'applied') {
          setAuditLive((prev) => ({ ...prev, applied: [...prev.applied, event] }));
        } else if (event.type === 'skipped') {
          setAuditLive((prev) => ({ ...prev, skipped: [...prev.skipped, event] }));
        } else if (event.type === 'error') {
          setAuditResult({ error: event.error, runId: event.runId });
          setAuditProgress('');
        } else if (event.type === 'done') {
          setAuditResult(event);
          setAuditProgress('');
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          handleEvent(JSON.parse(line.slice(6)));
        }
      }
      if (buffer.startsWith('data: ')) {
        handleEvent(JSON.parse(buffer.slice(6)));
      }
      loadEntries();
      loadAuditRuns();
    } catch (err) {
      setAuditResult({ error: err.message });
    } finally {
      setAuditRunning(false);
    }
  }

  async function handleRevertRevision(revisionId) {
    if (!confirm('Revert this audit change? The pre-merge entry will be restored.')) return;
    setRevertingId(`rev-${revisionId}`);
    try {
      await kb.revertRevision(revisionId, true);
      loadEntries();
      loadAuditRuns();
    } catch (err) {
      alert(`Revert failed: ${err.message}`);
    } finally {
      setRevertingId(null);
    }
  }

  async function handleRevertRun(runId) {
    if (!confirm('Undo every change from this audit run? All merged entries will be restored and deleted entries will be reinserted.')) return;
    setRevertingId(`run-${runId}`);
    try {
      const result = await kb.revertAuditRun(runId);
      if (result.failed?.length) {
        alert(`Reverted ${result.reverted.length} revisions; ${result.failed.length} failed:\n${result.failed.map(f => `#${f.revisionId}: ${f.error}`).join('\n')}`);
      }
      loadEntries();
      loadAuditRuns();
    } catch (err) {
      alert(`Revert failed: ${err.message}`);
    } finally {
      setRevertingId(null);
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
        <a
          href="/prism-thumbnail-template.html"
          className="sidebar-link"
          target="_blank"
          rel="noreferrer"
        >
          <span style={{ width: 16, textAlign: 'center', fontSize: 14 }}>🖼️</span>
          Thumbnail generator
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

              {auditRunning && (
                <div className="info-box" style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="spinner" style={{ width: 16, height: 16 }}></span>
                    {auditProgress || 'Auditing…'}
                  </div>
                  {(auditLive.applied.length > 0 || auditLive.skipped.length > 0) && (
                    <div style={{ fontSize: 12, marginTop: 6, color: 'var(--text-secondary)' }}>
                      Applied {auditLive.applied.length} · Skipped {auditLive.skipped.length}
                    </div>
                  )}
                </div>
              )}

              {auditResult && !auditResult.error && (
                <div
                  className="info-box"
                  style={{
                    marginBottom: 12,
                    borderLeft: `3px solid ${auditResult.clean ? 'var(--green)' : 'var(--prism-orange)'}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <strong>{auditResult.clean ? 'KB is clean!' : 'Audit complete'}</strong>
                    {auditResult.runId && auditResult.applied?.length > 0 && (
                      <button
                        className="btn btn-sm"
                        onClick={() => handleRevertRun(auditResult.runId)}
                        disabled={revertingId === `run-${auditResult.runId}`}
                      >
                        {revertingId === `run-${auditResult.runId}` ? 'Undoing…' : 'Undo entire run'}
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    Scanned {auditResult.total} entries.
                    {auditResult.totals && (
                      <span> {auditResult.totals.merged} merged, {auditResult.totals.deleted} deleted, {auditResult.totals.skipped} skipped.</span>
                    )}
                    {auditResult.clean && <span> No duplicates or contradictions found.</span>}
                  </div>
                  {auditResult.applied?.length > 0 && (
                    <details style={{ marginTop: 8, fontSize: 13 }} open>
                      <summary style={{ cursor: 'pointer' }}>
                        Changes applied ({auditResult.applied.length})
                      </summary>
                      <ul style={{ marginTop: 4, paddingLeft: 16, listStyle: 'none' }}>
                        {auditResult.applied.map((a, i) => (
                          <li key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                            <span>
                              <span className="badge badge-default" style={{ marginRight: 6 }}>{a.pair?.kind || 'pair'}</span>
                              {a.noop ? 'Deleted #' : 'Merged #'}
                              {a.pair?.redundantId} {a.noop ? '' : `→ #${a.pair?.keepId}`} — {a.summary}
                            </span>
                            <button
                              className="btn btn-sm"
                              onClick={() => handleRevertRevision(a.updateRevisionId || a.deleteRevisionId)}
                              disabled={revertingId === `rev-${a.updateRevisionId || a.deleteRevisionId}`}
                            >
                              {revertingId === `rev-${a.updateRevisionId || a.deleteRevisionId}` ? 'Reverting…' : 'Revert'}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {auditResult.skipped?.length > 0 && (
                    <details style={{ marginTop: 8, fontSize: 13 }}>
                      <summary style={{ cursor: 'pointer' }}>Skipped ({auditResult.skipped.length})</summary>
                      <ul style={{ marginTop: 4, paddingLeft: 16 }}>
                        {auditResult.skipped.map((s, i) => (
                          <li key={i}>
                            #{s.pair?.keepId} & #{s.pair?.redundantId} ({s.pair?.kind}) — {s.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              {auditResult?.error && (
                <div className="error-banner" style={{ marginBottom: 12 }}>{auditResult.error}</div>
              )}

              {auditRuns.length > 0 && !auditRunning && (
                <details className="info-box" style={{ marginBottom: 12, fontSize: 13 }}>
                  <summary style={{ cursor: 'pointer' }}>Recent audit runs ({auditRuns.length})</summary>
                  <ul style={{ marginTop: 6, paddingLeft: 0, listStyle: 'none' }}>
                    {auditRuns.map((r) => {
                      const started = new Date(r.started_at).toLocaleString();
                      const inflight = !r.finished_at;
                      return (
                        <li
                          key={r.id}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border)' }}
                        >
                          <span>
                            {started} —{' '}
                            {inflight
                              ? <em>in progress</em>
                              : <>{r.total_merged} merged, {r.total_deleted} deleted, {r.total_skipped} skipped</>}
                            {r.error && <span style={{ color: 'var(--prism-orange)', marginLeft: 6 }}>(error: {r.error})</span>}
                          </span>
                          {!inflight && r.total_deleted > 0 && (
                            <button
                              className="btn btn-sm"
                              onClick={() => handleRevertRun(r.id)}
                              disabled={revertingId === `run-${r.id}`}
                            >
                              {revertingId === `run-${r.id}` ? 'Undoing…' : 'Undo run'}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </details>
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
          {activeTab === 'gallery' && <TutorialsManager />}
          {activeTab === 'faq' && <FaqManager />}
          {activeTab === 'autofetch' && <AutoFetchConfig />}
          {activeTab === 'tests' && <KBTestRunner />}
          {activeTab === 'tickets' && <SupportTickets />}
        </div>
      </div>
    </div>
  );
}
