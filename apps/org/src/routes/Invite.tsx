// A one-time invitation: a new person sets a password; someone who already has
// an account signs in (or is signed in) and accepts.
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, session, type OrgKind, type Role, type User } from '../lib/api.ts';
import { errorText, useT } from '../lib/i18n.ts';
import { useSession } from '../lib/session.tsx';
import { Icon } from '../ui/icons.tsx';
import { Notice } from '../ui/parts.tsx';
import { SignInForm } from './Login.tsx';
import { PublicFrame } from './PublicFrame.tsx';

interface InviteInfo { org: { name: string; kind: OrgKind; verified: boolean }; email: string; role: Role; expiresAt: string }

export function Invite() {
  const { token = '' } = useParams();
  const { t, f } = useT();
  const { user, signedIn, reloadOrgs, pickOrg, signOut } = useSession();
  const navigate = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'create' | 'signin'>('create');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<InviteInfo>('GET', `/invites/${encodeURIComponent(token)}`, undefined, { auth: false }).then(setInfo, (err) => setError(errorText(t, err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /** Accept with the session in hand, or create the account; then open the organization. */
  const accept = async (body?: object) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User; token: string | null; org: { id: string } }>('POST', `/invites/${encodeURIComponent(token)}/accept`, body ?? {}, { auth: !body });
      if (r.token) await signedIn(r.user, r.token);
      else await reloadOrgs();
      pickOrg(r.org.id);
      navigate('/app', { replace: true });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'email_taken') setMode('signin');
      setError(errorText(t, err));
      setBusy(false);
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    void accept({ name, password });
  };

  return (
    <PublicFrame>
      <div className="form-page narrow">
        {!info && !error && <p className="lede" role="status">{t.invite.checking}</p>}
        {!info && error && (
          <>
            <span className="done-mark" data-tone="warn"><Icon name="link" size={22} /></span>
            <Notice tone="warn">{error}</Notice>
          </>
        )}
        {info && (
          <>
            <h1>{t.invite.title(info.org.name)}</h1>
            <p className="lede">{t.invite.as(t.role[info.role], info.email)} {info.role === 'owner' ? t.invite.ownerNote : t.invite.memberNote}</p>
            <p className="fine"><Icon name="clock" size={14} /> {t.invite.expires(f.date(info.expiresAt))}</p>
            {error && <Notice tone="error">{error}</Notice>}
            {user && session.token ? (
              <div className="auth-form">
                <p>{t.invite.signedInAs(user.email)}</p>
                <button type="button" className="btn btn-big" disabled={busy} onClick={() => void accept()}>{busy ? t.invite.accepting : t.invite.accept(info.org.name)}</button>
                <button type="button" className="link" onClick={() => { signOut(); setMode('create'); }}>{t.invite.otherAccount}</button>
              </div>
            ) : mode === 'create' ? (
              <>
                <form className="auth-form" onSubmit={create}>
                  <h2>{t.invite.createTitle}</h2>
                  <label className="field">{t.common.email}<input type="email" value={info.email} readOnly /></label>
                  <label className="field">{t.common.yourName}<input required maxLength={60} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
                  <label className="field">{t.common.password}<input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /><small>{t.errors.weak_password}</small></label>
                  <button type="submit" className="btn btn-big" disabled={busy}>{busy ? t.invite.creating : t.invite.create}</button>
                </form>
                <p className="fine">{t.invite.haveAccount} <button type="button" className="link" onClick={() => { setMode('signin'); setError(null); }}>{t.invite.signInInstead}</button></p>
              </>
            ) : (
              <SignInForm email={info.email} submitLabel={t.invite.accept(info.org.name)} onDone={async (u, tok) => { session.set(tok); await signedIn(u, tok); await accept(); }} />
            )}
          </>
        )}
      </div>
    </PublicFrame>
  );
}
