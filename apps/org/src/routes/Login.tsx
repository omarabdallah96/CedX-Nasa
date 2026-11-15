// Sign in. There is no sign-up: accounts come from invitations.
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { api, type User } from '../lib/api.ts';
import { errorText, useT } from '../lib/i18n.ts';
import { useSession } from '../lib/session.tsx';
import { Notice } from '../ui/parts.tsx';
import { PublicFrame } from './PublicFrame.tsx';

/** Where to go after signing in: a path inside the app, never another site. */
export const safeNext = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/app');

export function SignInForm({ email: fixedEmail, onDone, submitLabel }: { email?: string; onDone: (user: User, token: string) => Promise<void> | void; submitLabel?: string }) {
  const { t } = useT();
  const [email, setEmail] = useState(fixedEmail ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User; token: string }>('POST', '/auth/login', { email, password }, { auth: false });
      await onDone(r.user, r.token);
    } catch (err) {
      setError(errorText(t, err));
      setBusy(false);
    }
  };
  return (
    <form className="auth-form" onSubmit={submit}>
      <label className="field">{t.common.email}<input type="email" required autoComplete="email" value={email} readOnly={!!fixedEmail} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="field">{t.common.password}<input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {error && <Notice tone="error">{error}</Notice>}
      <button type="submit" className="btn btn-big" disabled={busy}>{busy ? t.login.busy : submitLabel ?? t.login.submit}</button>
    </form>
  );
}

export function Login() {
  const { t } = useT();
  const { user, org, signedIn } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get('next'));
  if (user && org) return <Navigate to={next} replace />;
  return (
    <PublicFrame>
      <div className="form-page narrow">
        <h1>{t.login.title}</h1>
        <p className="lede">{t.login.lede}</p>
        <SignInForm onDone={async (u, token) => { await signedIn(u, token); navigate(next, { replace: true }); }} />
        <p className="fine">{t.login.noAccount} <Link to="/request-access">{t.login.request}</Link></p>
        <p className="fine">{t.login.lost}</p>
      </div>
    </PublicFrame>
  );
}
