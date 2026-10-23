import { type FormEvent, useState } from 'react';

import { useAuth } from '@/auth';
import { Button, Card, ErrorBox } from '@/components/ui';

export default function Login({ onSignup }: { onSignup: () => void }) {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <Card className="login-card">
        <form className="stack" onSubmit={submit}>
          <div className="stack-sm">
            <div className="brand" style={{ padding: 0, fontSize: '1.8rem' }}>
              FireFirst
            </div>
            <p className="muted">Sign in to manage your department.</p>
          </div>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <ErrorBox error={error} />
          <Button variant="primary" type="submit" loading={busy}>
            Sign in
          </Button>
          <Button variant="ghost" onClick={onSignup}>
            New to FireFirst? Create your department
          </Button>
        </form>
      </Card>
    </div>
  );
}
