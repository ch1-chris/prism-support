import { useState, useEffect } from 'react';
import { analytics } from '../lib/api';

export default function AnalyticsDashboard() {
  const [summary, setSummary] = useState(null);
  const [unanswered, setUnanswered] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [sum, unans] = await Promise.all([
          analytics.summary(),
          analytics.unanswered(),
        ]);
        setSummary(sum);
        setUnanswered(unans);
      } catch (err) {
        console.error('Failed to load analytics:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className="empty-state"><div className="spinner" /></div>;
  if (!summary) return <div className="empty-state">Failed to load analytics.</div>;

  const satisfactionRate = summary.feedback.thumbsUp + summary.feedback.thumbsDown > 0
    ? Math.round((summary.feedback.thumbsUp / (summary.feedback.thumbsUp + summary.feedback.thumbsDown)) * 100)
    : null;

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{summary.totalEntries}</div>
          <div className="stat-label">KB entries</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: summary.staleEntries > 0 ? 'var(--amber)' : undefined }}>
            {summary.staleEntries}
          </div>
          <div className="stat-label">Stale entries</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{summary.totalQuestions}</div>
          <div className="stat-label">Questions asked</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: summary.openTickets > 0 ? 'var(--red)' : undefined }}>
            {summary.openTickets}
          </div>
          <div className="stat-label">Open tickets</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--green)' }}>
            {satisfactionRate !== null ? `${satisfactionRate}%` : '—'}
          </div>
          <div className="stat-label">Satisfaction</div>
        </div>
      </div>

      {Object.keys(summary.bySource).length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><strong>Entries by source</strong></div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {Object.entries(summary.bySource).map(([source, count]) => (
                <div key={source} style={{ fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>{count}</span>{' '}
                  <span style={{ color: 'var(--text-secondary)' }}>{source.replaceAll('_', ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {Object.keys(summary.questionsPerDay).length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><strong>Questions per day (14d)</strong></div>
          <div className="card-body">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
              {Object.entries(summary.questionsPerDay).map(([day, count]) => {
                const max = Math.max(...Object.values(summary.questionsPerDay));
                const height = max > 0 ? (count / max) * 100 : 0;
                return (
                  <div key={day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div
                      style={{ width: '100%', maxWidth: 32, height: `${height}%`, minHeight: 2, background: 'var(--accent)', borderRadius: 3 }}
                      title={`${day}: ${count}`}
                    />
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', transform: 'rotate(-45deg)', whiteSpace: 'nowrap' }}>
                      {day.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {unanswered.length > 0 && (
        <div className="card">
          <div className="card-header">
            <strong>Top unanswered questions</strong>
            <span className="badge badge-red">{unanswered.length}</span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {unanswered.map((q, i) => (
              <div key={i} style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                {q.question}
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                  {new Date(q.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
