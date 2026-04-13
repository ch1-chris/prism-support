import { useState, useEffect } from 'react';
import { analytics } from '../lib/api';

export default function KBTestRunner() {
  const [tests, setTests] = useState([]);
  const [question, setQuestion] = useState('');
  const [expected, setExpected] = useState('');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    analytics.getTests()
      .then(setTests)
      .catch((err) => {
        console.error('Failed to load test cases:', err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, []);

  async function addTest() {
    if (!question.trim() || !expected.trim()) return;
    try {
      const test = await analytics.createTest(question, expected);
      setTests((prev) => [...prev, test]);
      setQuestion('');
      setExpected('');
    } catch (err) {
      alert(err.message);
    }
  }

  async function deleteTest(id) {
    try {
      await analytics.deleteTest(id);
      setTests((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      alert(err.message);
    }
  }

  async function runAll() {
    setRunning(true);
    setResults(null);
    try {
      const res = await analytics.runTests();
      setResults(res);
    } catch (err) {
      alert(err.message);
    } finally {
      setRunning(false);
    }
  }

  if (loading) return <div className="empty-state"><div className="spinner" /></div>;
  if (error) return <div className="empty-state">Failed to load test cases: {error}</div>;

  return (
    <div>
      <div className="info-box">
        Define test questions with expected key facts. Run the suite to verify the KB produces correct answers.
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Test question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          style={{ flex: 2 }}
          aria-label="Test question"
        />
        <input
          type="text"
          placeholder="Expected key facts"
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          style={{ flex: 2 }}
          aria-label="Expected key facts"
        />
        <button className="btn" onClick={addTest} disabled={!question.trim() || !expected.trim()}>Add</button>
      </div>

      {tests.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <strong style={{ fontSize: 13 }}>{tests.length} test case{tests.length !== 1 ? 's' : ''}</strong>
            <button className="btn btn-primary" onClick={runAll} disabled={running}>
              {running ? 'Running…' : 'Run all tests'}
            </button>
          </div>
          {tests.map((t) => (
            <div key={t.id} className={`test-result ${t.last_result === 'pass' ? 'test-pass' : t.last_result === 'fail' ? 'test-fail' : ''}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{t.question}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Expected: {t.expected_answer}</div>
                  {t.last_result && (
                    <div style={{ fontSize: 11, marginTop: 4 }}>
                      <span className={`badge ${t.last_result === 'pass' ? 'badge-green' : 'badge-red'}`}>
                        {t.last_result}
                      </span>
                      {t.last_run_at && (
                        <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>
                          {new Date(t.last_run_at).toLocaleString()}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <button className="btn btn-sm btn-danger" onClick={() => deleteTest(t.id)}>Del</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {results && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <strong>Results</strong>
            <span className="badge badge-green">{results.passed} passed</span>
            {results.failed > 0 && <span className="badge badge-red">{results.failed} failed</span>}
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {results.results.map((r) => (
              <div key={r.id} style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                  <span className={`badge ${r.result === 'pass' ? 'badge-green' : 'badge-red'}`} style={{ marginRight: 8 }}>
                    {r.result}
                  </span>
                  {r.question}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  <strong>Expected:</strong> {r.expected}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  <strong>Actual:</strong> {r.actual?.slice(0, 200)}{r.actual?.length > 200 ? '…' : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
