// The organization's facts, this person's notifications, language and theme.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';
import { useT } from '../../lib/i18n.ts';
import { prefs, usePrefs } from '../../lib/prefs.ts';
import { useOrg, useSession } from '../../lib/session.tsx';
import { Icon } from '../../ui/icons.tsx';
import { Notice } from '../../ui/parts.tsx';
import { PageHead } from '../../ui/Shell.tsx';

export function Settings() {
  const { t } = useT();
  const { org, user } = useOrg();
  const { reloadOrgs } = useSession();
  const { notify, theme, lang } = usePrefs();
  const supported = 'Notification' in window;
  const [permission, setPermission] = useState(supported ? Notification.permission : 'denied');
  const [country, setCountry] = useState(org.country || '');
  const [savingCountry, setSavingCountry] = useState(false);
  const [countrySaved, setCountrySaved] = useState(false);

  useEffect(() => { setCountry(org.country || ''); }, [org.country]);

  const toggleNotify = async (on: boolean) => {
    if (!on) return prefs.setNotify(false);
    const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    setPermission(p);
    prefs.setNotify(p === 'granted');
  };

  const saveCountry = async () => {
    setSavingCountry(true);
    setCountrySaved(false);
    try {
      await api('PATCH', `/orgs/${org.id}`, { country });
      await reloadOrgs();
      setCountrySaved(true);
    } finally {
      setSavingCountry(false);
    }
  };

  return (
    <div className="settings-page">
      <PageHead title={t.settings.title} />
      <section className="panel" aria-labelledby="org-h">
        <h2 id="org-h">{t.settings.org}</h2>
        <dl className="facts">
          <dt>{t.common.name}</dt><dd>{org.name}</dd>
          <dt>{t.settings.kind}</dt><dd>{t.kind[org.kind]}</dd>
          <dt>{t.settings.country}</dt>
          <dd>
            {org.role === 'owner' ? (
              <div className="country-edit">
                <select value={country} onChange={(e) => { setCountry(e.target.value); setCountrySaved(false); }} aria-label={t.settings.country}>
                  <option value="">{t.request.countryPick}</option>
                  {t.request.countries.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button type="button" className="button small" onClick={() => void saveCountry()} disabled={savingCountry || country === (org.country || '')}>
                  {savingCountry ? t.settings.saving : t.settings.saveCountry}
                </button>
                {countrySaved && <span className="verified">✓</span>}
              </div>
            ) : (
              org.country || t.settings.countryUnset
            )}
          </dd>
          <dt>{t.settings.verified}</dt><dd>{org.verified ? <span className="verified"><Icon name="shield" size={14} />{t.settings.yes}</span> : t.settings.no}</dd>
          <dt>{t.team.role}</dt><dd>{t.role[org.role]}</dd>
        </dl>
      </section>

      <section className="panel" aria-labelledby="you-h">
        <h2 id="you-h">{t.settings.you}</h2>
        <dl className="facts">
          <dt>{t.common.name}</dt><dd>{user?.name || '–'}</dd>
          <dt>{t.common.email}</dt><dd>{user?.email}</dd>
        </dl>
        <label className="switch-row">
          <input type="checkbox" role="switch" checked={notify && permission === 'granted'} disabled={!supported || permission === 'denied'} onChange={(e) => void toggleNotify(e.target.checked)} />
          <span><strong>{t.settings.notifications}</strong><small>{t.settings.notifyOn}</small></span>
        </label>
        {!supported && <Notice tone="info">{t.settings.notifyUnsupported}</Notice>}
        {supported && permission === 'denied' && <Notice tone="warn">{t.settings.notifyDenied}</Notice>}
      </section>

      <section className="panel" aria-labelledby="look-h">
        <h2 id="look-h">{t.settings.appearance}</h2>
        <div className="setting-line">
          <span>{t.common.language}</span>
          <div className="segmented" role="group" aria-label={t.common.language}>
            <button type="button" aria-pressed={lang === 'en'} onClick={() => prefs.setLang('en')} lang="en">English</button>
            <button type="button" aria-pressed={lang === 'ar'} onClick={() => prefs.setLang('ar')} lang="ar">العربية</button>
          </div>
        </div>
        <div className="setting-line">
          <span>{t.common.theme}</span>
          <div className="segmented" role="group" aria-label={t.common.theme}>
            <button type="button" aria-pressed={theme === 'dark'} onClick={() => prefs.setTheme('dark')}><Icon name="moon" size={15} />{t.common.dark}</button>
            <button type="button" aria-pressed={theme === 'light'} onClick={() => prefs.setTheme('light')}><Icon name="sun" size={15} />{t.common.light}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
