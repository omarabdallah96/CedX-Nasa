// Members, invitations by one-time link, and leaving or deleting the organization.
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, type Invite, type Member, type Role } from '../../lib/api.ts';
import { errorText, useT } from '../../lib/i18n.ts';
import { useOrg } from '../../lib/session.tsx';
import { Icon } from '../../ui/icons.tsx';
import { Dialog, Notice, SkeletonRows, useCopy, useToast } from '../../ui/parts.tsx';
import { PageHead } from '../../ui/Shell.tsx';

export function Team() {
  const { t, f } = useT();
  const { org, user, reloadOrgs } = useOrg();
  const owner = org.role === 'owner';
  const navigate = useNavigate();
  const toast = useToast();
  const copy = useCopy();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ email: string; url: string; expiresAt: string } | null>(null);

  const load = async () => {
    try {
      setMembers((await api<{ members: Member[] }>('GET', `/orgs/${org.id}`)).members);
      if (owner) setInvites((await api<{ invites: Invite[] }>('GET', `/orgs/${org.id}/invites`)).invites);
    } catch (err) {
      setError(errorText(t, err));
    }
  };
  useEffect(() => {
    setMembers(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id]);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ invite: Invite; path: string }>('POST', `/orgs/${org.id}/invites`, { email, role });
      setLink({ email: r.invite.email, url: `${window.location.origin}${r.path}`, expiresAt: r.invite.expiresAt });
      setEmail('');
      await load();
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };
  const run = async (method: string, path: string, after?: () => Promise<void> | void) => {
    try {
      await api(method, path);
      await (after ? after() : load());
    } catch (err) {
      setError(errorText(t, err));
    }
  };
  const leaveOrDelete = () => {
    if (!window.confirm(owner ? t.team.deleteConfirm(org.name) : t.team.leaveConfirm(org.name))) return;
    void run('DELETE', owner ? `/orgs/${org.id}` : `/orgs/${org.id}/members/me`, async () => {
      await reloadOrgs();
      navigate('/app');
    });
  };
  const message = link ? t.team.message(org.name, link.url, f.date(link.expiresAt)) : '';

  return (
    <div className="team-page">
      <PageHead title={t.team.title} sub={org.name} />
      {error && <Notice tone="error">{error}</Notice>}

      <div className="team-grid">
        <section className="panel" aria-labelledby="members-h">
          <h2 id="members-h">{t.team.members}{members && <span className="count-chip num">{members.length}</span>}</h2>
          {!members ? <SkeletonRows rows={3} /> : (
            <ul className="people">
              {members.map((m) => {
                const me = m.id === user?.id;
                const label = m.name || m.email || '—';
                return (
                  <li key={m.id}>
                    <span className="avatar">{label.trim()[0]?.toUpperCase()}</span>
                    <span className="person">
                      <strong>{label}{me && <span className="muted"> ({t.team.you})</span>}</strong>
                      {m.name && m.email && <span className="muted">{m.email}</span>}
                    </span>
                    <span className="role" data-role={m.role}>{t.role[m.role]}</span>
                    {owner && !me && (
                      <button type="button" className="icon-btn danger" aria-label={`${t.common.remove} ${label}`}
                        onClick={() => { if (window.confirm(t.team.removeConfirm(label))) void run('DELETE', `/orgs/${org.id}/members/${m.id}`); }}>
                        <Icon name="trash" size={16} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel" aria-labelledby="invite-h">
          <h2 id="invite-h">{t.team.invite}</h2>
          {owner ? (
            <>
              <p className="fine">{t.team.inviteLede}</p>
              <form className="inline-form" onSubmit={invite}>
                <label className="field grow">{t.common.email}<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
                <label className="field">{t.team.role}
                  <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                    <option value="member">{t.role.member}</option>
                    <option value="owner">{t.role.owner}</option>
                  </select>
                </label>
                <button type="submit" className="btn" disabled={busy}><Icon name="link" size={16} />{busy ? t.team.creating : t.team.create}</button>
              </form>
              <h3 className="subhead">{t.team.pending}</h3>
              {invites.length === 0 ? <p className="fine">{t.team.noPending}</p> : (
                <ul className="people">
                  {invites.map((i) => (
                    <li key={i.id}>
                      <span className="avatar" data-pending="">{i.email[0]?.toUpperCase()}</span>
                      <span className="person"><strong>{i.email}</strong><span className="muted">{t.role[i.role]} · {t.team.expires(f.date(i.expiresAt))}</span></span>
                      <button type="button" className="btn btn-quiet btn-small" onClick={() => void run('DELETE', `/orgs/${org.id}/invites/${i.id}`, async () => { await load(); toast({ text: t.team.withdraw, tone: 'done' }); })}>{t.team.withdraw}</button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : <p className="fine">{t.team.ownerOnly}</p>}
        </section>
      </div>

      <div className="danger-zone">
        <button type="button" className="btn btn-quiet danger" onClick={leaveOrDelete}><Icon name={owner ? 'trash' : 'out'} size={16} />{owner ? t.team.delete : t.team.leave}</button>
      </div>

      <Dialog open={!!link} onClose={() => setLink(null)} title={t.team.linkTitle}>
        {link && (
          <div className="link-dialog">
            <p className="fine">{t.team.linkFor(link.email, f.date(link.expiresAt))}</p>
            <div className="link-row">
              <input readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label={t.team.linkTitle} />
              <button type="button" className="btn" onClick={() => void copy(link.url)}><Icon name="copy" size={16} />{t.team.copyLink}</button>
            </div>
            <label className="field">{t.team.readyToSend}<textarea readOnly rows={7} value={message} /></label>
            <div className="form-actions">
              <button type="button" className="btn btn-quiet" onClick={() => void copy(message)}><Icon name="copy" size={16} />{t.team.copyMessage}</button>
              <button type="button" className="btn" onClick={() => setLink(null)}>{t.team.done}</button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
