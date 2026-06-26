import { useState, useEffect, useCallback } from 'react';
import { analytics, tutorials as tutorialsApi } from '../lib/api';

const VIEWS = [
  { id: 'questions', label: 'Chat questions' },
  { id: 'plays', label: 'Video plays' },
];

function formatWhen(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function brandLabel(view) {
  if (view.brand_name) return view.brand_name;
  if (view.is_admin) return 'Admin preview';
  return 'General / anonymous';
}

export default function ActivityLog() {
  const [tab, setTab] = useState('questions');
  const [questions, setQuestions] = useState([]);
  const [plays, setPlays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [q, v] = await Promise.all([
        analytics.questions(200),
        tutorialsApi.views(200),
      ]);
      setQuestions(q || []);
      setPlays(v.views || []);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={`btn btn-sm ${tab === v.id ? 'btn-primary' : ''}`}
            onClick={() => setTab(v.id)}
          >
            {v.label}
            <span className="badge badge-default" style={{ marginLeft: 8 }}>
              {v.id === 'questions' ? questions.length : plays.length}
            </span>
          </button>
        ))}
        <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <div className="empty-state"><div className="spinner" /></div>
      ) : tab === 'questions' ? (
        <div className="card">
          <div className="card-header">
            <strong>Questions asked of Prism chat</strong>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {questions.length === 0 ? (
              <div className="empty-state"><p>No questions logged yet.</p></div>
            ) : (
              questions.map((q) => (
                <div
                  key={q.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: '10px 20px',
                    borderBottom: '1px solid var(--border)',
                    fontSize: 13,
                  }}
                >
                  <span style={{ flex: 1 }}>{q.question}</span>
                  <span
                    className={`badge ${q.had_answer ? 'badge-default' : 'badge-red'}`}
                    style={{ flexShrink: 0 }}
                  >
                    {q.had_answer ? 'answered' : 'no match'}
                  </span>
                  <span style={{ flexShrink: 0, color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {formatWhen(q.created_at)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-header">
            <strong>Tutorial video plays</strong>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {plays.length === 0 ? (
              <div className="empty-state"><p>No video plays logged yet.</p></div>
            ) : (
              plays.map((v) => (
                <div
                  key={v.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: '10px 20px',
                    borderBottom: '1px solid var(--border)',
                    fontSize: 13,
                  }}
                >
                  <span style={{ flex: 1 }}>{v.tutorial_title || `Tutorial #${v.tutorial_id ?? '—'}`}</span>
                  <span className="badge badge-default" style={{ flexShrink: 0 }}>
                    {brandLabel(v)}
                  </span>
                  <span style={{ flexShrink: 0, color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {formatWhen(v.created_at)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
