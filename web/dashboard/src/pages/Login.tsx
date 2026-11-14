import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Brand, type Me } from '../session';

export function LoginPage({ me, onLogin }: { me: Me | null; onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPw, setShowPw] = useState(!me?.portalLogin);
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
      <div className="card stack login-card">
        <Brand />
        {me?.portalLogin && (
          <>
            <p className="small muted" style={{ margin: 0 }}>Die Anmeldung läuft über das Portal von FrankenFinals Broadcast. Dort siehst du die Overlay Engine als Kachel, sofern sie für dich freigegeben ist.</p>
            <button type="button" className="primary login-portal" onClick={() => { location.href = me.portalLogin!; }}>Über das Portal anmelden</button>
          </>
        )}
        {me?.portalLogin && me.passwordLogin && !showPw && (
          <button type="button" className="ghost small" onClick={() => setShowPw(true)}>Notfall-Zugang mit Passwort</button>
        )}
        {me?.passwordLogin !== false && showPw && (
          <form className="stack" onSubmit={submit}>
            <label className="field">
              {me?.portalLogin ? 'Notfall-Passwort' : 'Passwort'}
              <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </label>
            {error && <div className="small" style={{ color: 'var(--err)' }}>{error}</div>}
            <button className={me?.portalLogin ? '' : 'primary'} type="submit">Anmelden</button>
          </form>
        )}
      </div>
    </div>
  );
}
