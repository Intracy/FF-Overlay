import { useState, type FormEvent } from 'react';
import { api } from '../api';

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/api/auth/login', { password });
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login fehlgeschlagen');
    }
  };
  return (
    <div className="login">
      <form className="card stack" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}><span className="logo">F</span>FF-Overlay</div>
        <label className="field">
          Passwort
          <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <div className="small" style={{ color: 'var(--err)' }}>{error}</div>}
        <button className="primary" type="submit">Anmelden</button>
      </form>
    </div>
  );
}
