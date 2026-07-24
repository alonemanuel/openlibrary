import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';

export function Auth() {
  const { setMe } = useSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { user } =
        mode === 'login'
          ? await api.login(email, password)
          : await api.register({ email, password, handle, displayName });
      setMe(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand" style={{ marginBottom: 14, padding: 0 }}>
          <span className="brand-mark">◎</span>
          <span>Open Library</span>
        </div>
        <p className="pitch">
          Everything you like — books, films, records — kept in a library that is yours. Exported as
          plain CSV to the storage you choose, backed up here as well, and shared with friends only
          when you say so.
        </p>

        {error ? <div className="alert error">{error}</div> : null}

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </div>

          {mode === 'register' ? (
            <>
              <div className="field">
                <label htmlFor="auth-handle">Handle</label>
                <input
                  id="auth-handle"
                  type="text"
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                  placeholder="how friends find you"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="auth-name">Display name (optional)</label>
                <input
                  id="auth-name"
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
            </>
          ) : null}

          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
            {mode === 'register' ? (
              <span className="muted-note">At least 8 characters.</span>
            ) : null}
          </div>

          <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? <span className="spinner" /> : null}
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <button
            className="btn ghost small"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
          >
            {mode === 'login' ? 'No account yet? Create one' : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}
