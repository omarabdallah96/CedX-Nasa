// The signed-in frame: navigation rail (a drawer on phones), the top bar with
// the organization, freshness, notifications, language, theme and account.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useT } from '../lib/i18n.ts';
import { prefs, usePrefs } from '../lib/prefs.ts';
import { useOrg } from '../lib/session.tsx';
import { Icon, Mark, type IconName } from './icons.tsx';
import { useToast } from './parts.tsx';

export function PrefsButtons() {
  const { t, lang } = useT();
  const { theme } = usePrefs();
  return (
    <>
      <button type="button" className="icon-btn" onClick={() => prefs.setLang(lang === 'en' ? 'ar' : 'en')} aria-label={t.common.language} title={t.common.language}>
        <span className="lang-chip" lang={lang === 'en' ? 'ar' : 'en'}>{lang === 'en' ? 'ع' : 'EN'}</span>
      </button>
      <button type="button" className="icon-btn" onClick={() => prefs.setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`${t.common.theme}: ${theme === 'dark' ? t.common.light : t.common.dark}`} title={t.common.theme}>
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      </button>
    </>
  );
}

export function Brand({ to = '/' }: { to?: string }) {
  const { t } = useT();
  return (
    <Link to={to} className="brand">
      <Mark size={24} />
      <span className="brand-name">{t.brand}</span>
      <span className="brand-sub">{t.product}</span>
    </Link>
  );
}

function Nav({ onPick }: { onPick?: () => void }) {
  const { t } = useT();
  const items: [string, IconName, string, boolean?][] = [
    ['/app', 'overview', t.nav.overview, true],
    ['/app/sites', 'sites', t.nav.sites],
    ['/app/tools', 'tools', t.nav.tools],
    ['/app/alerts', 'alerts', t.nav.alerts],
    ['/app/team', 'team', t.nav.team],
    ['/app/settings', 'settings', t.nav.settings],
  ];
  return (
    <nav className="rail-nav" aria-label={t.nav.menu}>
      {items.map(([to, icon, label, end]) => (
        <NavLink key={to} to={to} end={end} className="rail-link" onClick={onPick}>
          <Icon name={icon} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function OrgSwitch() {
  const { t } = useT();
  const { orgs, org, pickOrg } = useOrg();
  const navigate = useNavigate();
  return (
    <div className="org-switch">
      <label htmlFor="org-pick" className="eyeless">{t.shell.switchOrg}</label>
      {orgs && orgs.length > 1 ? (
        <select id="org-pick" value={org.id} onChange={(e) => { pickOrg(e.target.value); navigate('/app'); }}>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      ) : (
        <p id="org-pick" className="org-name">{org.name}</p>
      )}
      <p className="org-meta">
        {t.kind[org.kind]}
        {org.verified && <span className="verified"><Icon name="shield" size={13} />{t.common.verified}</span>}
      </p>
    </div>
  );
}

function Notifications() {
  const { t, f } = useT();
  const { notifications, unread, markRead } = useOrg();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const toggle = () => {
    setOpen((o) => !o);
    if (!open && unread > 0) void markRead();
  };
  const icon: Record<string, IconName> = { act: 'warn', fire: 'fire', digest: 'clock', alert: 'alerts' };
  return (
    <div className="notes" ref={box}>
      <button type="button" className="icon-btn" aria-expanded={open} aria-haspopup="dialog" onClick={toggle}
        aria-label={unread > 0 ? `${t.shell.notifications}, ${t.shell.unread(unread)}` : t.shell.notifications}>
        <Icon name="bell" />
        {unread > 0 && <span className="badge num">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="notes-panel" role="dialog" aria-label={t.shell.notifications}>
          <header><h2>{t.shell.notifications}</h2></header>
          {notifications.length === 0 ? <p className="notes-empty">{t.shell.noNotifications}</p> : (
            <ol>
              {notifications.map((n) => (
                <li key={n.id} data-kind={n.kind}>
                  <button type="button" disabled={!n.siteId && n.kind !== 'digest'} onClick={() => { setOpen(false); navigate(n.siteId ? `/app/sites/${n.siteId}` : '/app'); }}>
                    <Icon name={icon[n.kind]} size={16} />
                    <span className="note-body">
                      <strong>{n.title}</strong>
                      <span className="note-text">{n.body}</span>
                      <time dateTime={n.createdAt}>{t.notification[n.kind]} · {f.ago(n.createdAt)}</time>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function Account() {
  const { t } = useT();
  const { user, signOut } = useOrg();
  const navigate = useNavigate();
  if (!user) return null;
  const initial = (user.name || user.email).trim()[0]?.toUpperCase() ?? '?';
  return (
    <details className="account">
      <summary aria-label={t.shell.account}><span className="avatar">{initial}</span></summary>
      <div className="account-menu">
        <p><strong>{user.name || user.email}</strong>{user.name && <span>{user.email}</span>}</p>
        <button type="button" className="menu-item" onClick={() => { signOut(); navigate('/login'); }}><Icon name="out" size={16} />{t.common.signOut}</button>
      </div>
    </details>
  );
}

export function Shell() {
  const { t, f } = useT();
  const { board, boardLoading, reloadBoard, fresh, dismissFresh } = useOrg();
  const [drawer, setDrawer] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => setDrawer(false), [location.pathname]);
  useEffect(() => {
    if (!fresh) return;
    toast({
      text: fresh.title,
      tone: fresh.kind === 'act' || fresh.kind === 'fire' ? 'act' : 'info',
      action: fresh.siteId ? { label: t.shell.openSite, run: () => navigate(`/app/sites/${fresh.siteId}`) } : undefined,
    });
    dismissFresh();
  }, [fresh, toast, dismissFresh, navigate, t]);

  return (
    <div className="shell">
      <aside className="rail" data-open={drawer || undefined}>
        <div className="rail-head">
          <Brand to="/app" />
          <button type="button" className="icon-btn rail-close" onClick={() => setDrawer(false)} aria-label={t.nav.close}><Icon name="x" /></button>
        </div>
        <Nav onPick={() => setDrawer(false)} />
        <OrgSwitch />
      </aside>
      {drawer && <button type="button" className="scrim" aria-label={t.nav.close} onClick={() => setDrawer(false)} />}
      <div className="work">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" onClick={() => setDrawer(true)} aria-label={t.nav.menu}><Icon name="menu" /></button>
          <div className="freshness">
            {board && (
              <button type="button" className="fresh-btn" onClick={() => void reloadBoard()} disabled={boardLoading}>
                <Icon name="clock" size={15} />
                <span>{boardLoading ? t.common.refreshing : t.common.updated(f.time(board.generatedAt))}</span>
              </button>
            )}
          </div>
          <div className="topbar-tools">
            <Notifications />
            <PrefsButtons />
            <Account />
          </div>
        </header>
        <main className="page" id="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** A page's title row: heading, optional supporting line, actions at the end. */
export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}
