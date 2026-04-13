import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../lib/api';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await auth.login(password);
      navigate('/admin');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-container">
      <form className="login-card" onSubmit={handleSubmit}>
        <img src="/prism-logo.png" alt="Prism" style={{ width: 56, height: 56, borderRadius: 12, marginBottom: 12 }} />
        <h1>Prism Support</h1>
        <p>Enter the admin password to continue.</p>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Admin password"
            autoFocus
          />
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading || !password}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>
    </div>
  );
}
