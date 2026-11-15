// Alerts about one site: to members always, to the public when verified.
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api, type Alert } from '../../lib/api.ts';
import { errorText, useT } from '../../lib/i18n.ts';
import { useOrg } from '../../lib/session.tsx';
import { Icon } from '../../ui/icons.tsx';
import { Notice, SkeletonRows } from '../../ui/parts.tsx';
import { PageHead } from '../../ui/Shell.tsx';

export function Alerts() {
  const { t, f } = useT();
  const { org, refs } = useOrg();
  const owner = org.role === 'owner';
  const [params] = useSearchParams();
  const sites = [...org.sites].sort((a, b) => a.name.localeCompare(b.name));
  const [list, setList] = useState<Alert[] | null>(null);
  const [push, setPush] = useState(true);
  const [siteId, setSiteId] = useState(params.get('site') ?? sites[0]?.id ?? '');
  const [audience, setAudience] = useState<'members' | 'public'>('members');
  const [level, setLevel] = useState<Alert['level']>('warning');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [textAr, setTextAr] = useState('');
  const [hours, setHours] = useState(24);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const site = sites.find((s) => s.id === siteId) ?? sites[0];

  const load = () => api<{ alerts: Alert[]; push: boolean }>('GET', `/orgs/${org.id}/alerts`).then((d) => { setList(d.alerts); setPush(d.push); }, (err) => setError(errorText(t, err)));
  useEffect(() => {
    setList(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id]);

  const send = async () => {
    if (!site) return;
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const { alert } = await api<{ alert: Alert }>('POST', `/orgs/${org.id}/alerts`, { siteId: site.id, audience, level, title, message: text, titleAr, messageAr: textAr, hours });
      setSent(alert.pushed ? t.alerts.sent(alert.pushed.delivered, alert.pushed.recipients) : audience === 'public' ? t.alerts.sentPublic : t.alerts.sentMembers);
      setTitle(''); setText(''); setTitleAr(''); setTextAr('');
      await load();
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // A public alert is confirmed once more; one to the team goes straight out.
    if (audience === 'public' && !confirming) return setConfirming(true);
    void send();
  };
  const cancel = async (id: string) => {
    try {
      await api('POST', `/orgs/${org.id}/alerts/${id}/cancel`);
      await load();
    } catch (err) {
      setError(errorText(t, err));
    }
  };

  return (
    <div className="alerts-page">
      <PageHead title={t.alerts.title} sub={t.alerts.lede(org.verified)} />
      {owner && sites.length > 0 && (
        <form className="panel alert-form" onSubmit={submit}>
          <div className="fields">
            <label className="field">{t.alerts.site}
              <select value={site?.id ?? ''} onChange={(e) => setSiteId(e.target.value)}>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name} · {refs.get(s.id)}</option>)}
              </select>
            </label>
            <label className="field">{t.alerts.level}
              <select value={level} onChange={(e) => setLevel(e.target.value as Alert['level'])}>
                {(['info', 'warning', 'danger'] as const).map((l) => <option key={l} value={l}>{t.alerts.levels[l]}</option>)}
              </select>
            </label>
            <label className="field">{t.alerts.hours}<input type="number" min={1} max={336} required value={hours} onChange={(e) => setHours(Number(e.target.value))} /></label>
            <fieldset className="field span-3 choice choice-row">
              <legend>{t.alerts.who}</legend>
              <label className="choice-item"><input type="radio" name="audience" checked={audience === 'members'} onChange={() => { setAudience('members'); setConfirming(false); }} /><span><strong>{t.alerts.members(org.name)}</strong></span></label>
              <label className="choice-item" data-disabled={!org.verified || undefined}>
                <input type="radio" name="audience" disabled={!org.verified} checked={audience === 'public'} onChange={() => setAudience('public')} />
                <span><strong>{t.alerts.public}</strong>{!org.verified && <small>{t.alerts.verifiedOnly}</small>}</span>
              </label>
            </fieldset>
            <label className="field span-3">{t.alerts.titleField}<input required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.alerts.titlePh} /></label>
            <label className="field span-3">{t.alerts.message}<textarea required maxLength={500} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.alerts.messagePh} /></label>
            <details className="span-3">
              <summary>{t.alerts.arabic}</summary>
              <div className="fields">
                <label className="field span-3">{t.alerts.titleAr}<input dir="rtl" lang="ar" maxLength={80} value={titleAr} onChange={(e) => setTitleAr(e.target.value)} /></label>
                <label className="field span-3">{t.alerts.messageAr}<textarea dir="rtl" lang="ar" maxLength={500} rows={3} value={textAr} onChange={(e) => setTextAr(e.target.value)} /></label>
              </div>
            </details>
          </div>
          {!push && <Notice tone="info">{t.alerts.noPush}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          {sent && <Notice tone="done" role="status">{sent}</Notice>}
          <div className="form-actions">
            {confirming ? (
              <>
                <Notice tone="warn">{t.alerts.confirm(site?.name ?? '', org.name)}</Notice>
                <button type="submit" className="btn btn-danger" disabled={busy}>{busy ? t.alerts.sending : t.alerts.sendPublic}</button>
                <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>{t.alerts.goBack}</button>
              </>
            ) : (
              <button type="submit" className="btn" disabled={busy}><Icon name="alerts" size={16} />{busy ? t.alerts.sending : audience === 'public' ? t.alerts.review : t.alerts.send}</button>
            )}
          </div>
        </form>
      )}
      {owner && sites.length === 0 && <Notice tone="info">{t.alerts.addSite}</Notice>}
      {!owner && <Notice tone="info">{t.alerts.ownerOnly}</Notice>}

      <section aria-labelledby="sent-h">
        <h2 id="sent-h" className="section-title">{t.alerts.history}</h2>
        {!list ? <SkeletonRows rows={3} /> : list.length === 0 ? <p className="fine">{t.alerts.none}</p> : (
          <ul className="alert-list">
            {list.map((a) => {
              const active = !a.cancelled && Date.parse(a.expiresAt) > Date.now();
              return (
                <li key={a.id} data-level={a.level} data-active={active || undefined}>
                  <div>
                    <strong>{a.title}</strong>
                    <p>{a.message}</p>
                    <span className="muted">{t.alerts.levels[a.level]} · {t.alerts.audience[a.audience]} · {f.dateTime(a.createdAt)}{a.pushed ? ` · ${t.alerts.phones(a.pushed.delivered, a.pushed.recipients)}` : ''}</span>
                  </div>
                  <div className="alert-state">
                    {a.cancelled ? <span className="muted">{t.alerts.cancelled}</span> : active
                      ? (owner ? <button type="button" className="btn btn-quiet btn-small" onClick={() => void cancel(a.id)}>{t.alerts.cancel}</button> : <span className="live">{t.alerts.active}</span>)
                      : <span className="muted">{t.alerts.ended}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
