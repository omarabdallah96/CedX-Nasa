// Asking for access: organizations cannot sign themselves up.
import { useState, type FormEvent } from 'react';
import { API, ORG_KINDS, type OrgKind } from '../lib/api.ts';
import { errorText, useT } from '../lib/i18n.ts';
import { Icon } from '../ui/icons.tsx';
import { Notice } from '../ui/parts.tsx';
import { PublicFrame } from './PublicFrame.tsx';

export function RequestAccess() {
  const { t } = useT();
  const [form, setForm] = useState({ orgName: '', kind: 'fire_station' as OrgKind, country: '', contactName: '', email: '', phone: '', sitesEstimate: '', message: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'new' | 'again' | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // fetch rather than api(): a second request from the same email answers 200, not 201.
      const res = await fetch(`${API}/org-requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw Object.assign(new Error(json?.error?.message ?? ''), { code: json?.error?.code });
      setDone(res.status === 200 ? 'again' : 'new');
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <PublicFrame>
        <div className="form-page">
          <span className="done-mark"><Icon name="check" size={22} /></span>
          <h1>{t.request.doneTitle}</h1>
          <p className="lede">{done === 'again' ? t.request.already : t.request.done(form.email)}</p>
        </div>
      </PublicFrame>
    );
  }

  return (
    <PublicFrame>
      <form className="form-page" onSubmit={submit} noValidate={false}>
        <h1>{t.request.title}</h1>
        <p className="lede">{t.request.lede}</p>
        <div className="fields">
          <label className="field span-2">{t.request.orgName}<input required maxLength={80} autoComplete="organization" value={form.orgName} onChange={set('orgName')} /></label>
          <fieldset className="field span-2 choice">
            <legend>{t.request.kind}</legend>
            {ORG_KINDS.map((k) => (
              <label key={k} className="choice-item">
                <input type="radio" name="kind" checked={form.kind === k} onChange={() => setForm((f) => ({ ...f, kind: k }))} />
                <span><strong>{t.kind[k]}</strong><small>{t.kindHint[k]}</small></span>
              </label>
            ))}
          </fieldset>
          <label className="field">{t.request.country}
            <select required value={form.country} onChange={set('country')}>
              <option value="" disabled>{t.request.countryPick}</option>
              {t.request.countries.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="field">{t.request.sites}<input type="number" min={1} max={100000} inputMode="numeric" value={form.sitesEstimate} onChange={set('sitesEstimate')} /><small>{t.request.sitesHint}</small></label>
          <label className="field">{t.request.contactName}<input required maxLength={80} autoComplete="name" value={form.contactName} onChange={set('contactName')} /></label>
          <label className="field">{t.request.email}<input required type="email" autoComplete="email" value={form.email} onChange={set('email')} /></label>
          <label className="field">{t.request.phone}<input type="tel" maxLength={40} autoComplete="tel" value={form.phone} onChange={set('phone')} /></label>
          <label className="field span-2">{t.request.message}<textarea rows={4} maxLength={1000} value={form.message} onChange={set('message')} /></label>
          {/* People never see this field; bots fill it. */}
          <label className="trap" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="form-actions">
          <button type="submit" className="btn btn-big" disabled={busy}>{busy ? t.request.sending : t.request.submit}</button>
          <p className="fine">{t.request.privacy}</p>
        </div>
      </form>
    </PublicFrame>
  );
}
