// The /admin page: sign-in, then a sidebar with pages for report moderation,
// zone alerts sent to phones, user plans and every user's alert zones.
// Plain HTML, CSS and JS served by the API (no build step). User text is only
// ever set with textContent, never as HTML. The page in view lives in the URL
// hash (#reports, #alerts, #users, #zones), so reloading keeps your place.

const icon = (paths: string) =>
  `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICONS = {
  reports: icon('<path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h5"/>'),
  alerts: icon('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  users: icon('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>'),
  zones: icon('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>'),
  orgs: icon('<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 21v-5h6v5M9 10h.01M15 10h.01M9 13h.01M15 13h.01"/>'),
  requests: icon('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
  menu: icon('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  out: icon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
  refresh: icon('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
};

const THEME_ICONS = {
  system: icon('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
  light: icon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  dark: icon('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
};

/** System / Light / Dark. Used in the sidebar and on the sign-in card; app.js keeps them in sync. */
const THEME_SWITCH = `<div class="theme" role="group" aria-label="Theme">${(['system', 'light', 'dark'] as const)
  .map((t) => `<button type="button" data-theme-choice="${t}" aria-pressed="false" title="${t[0].toUpperCase() + t.slice(1)} theme">${THEME_ICONS[t]}<span>${t[0].toUpperCase() + t.slice(1)}</span></button>`)
  .join('')}</div>`;

const nav = (page: keyof typeof ICONS, label: string) =>
  `<a href="#${page}" class="nav" data-page="${page}">${ICONS[page]}<span>${label}</span><span class="count" id="n-${page}"></span></a>`;

export const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Firesight admin</title>
<link rel="icon" href="/favicon.svg">
<link rel="stylesheet" href="/admin/vendor/maplibre-gl.css">
<link rel="stylesheet" href="/admin/app.css">
<script src="/admin/app.js" defer></script>
</head>
<body>
<section id="loading" class="center"><p class="muted">Loading…</p></section>

<section id="login" class="center" hidden>
  <form id="login-form" class="card login" autocomplete="on">
    <div class="brand"><span class="dot"></span>Firesight <span class="muted">admin</span></div>
    <h1>Sign in</h1>
    <p class="muted">Moderate reports, send zone alerts and manage users.</p>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button type="submit" class="primary" id="login-btn">Sign in</button>
    <p id="login-error" class="error" role="alert"></p>
    ${THEME_SWITCH}
  </form>
  <div id="not-configured" class="card login" hidden>
    <h1>Admin is off</h1>
    <p class="muted">Set <code>ADMIN_PASSWORD</code> in the server's environment and redeploy.</p>
  </div>
</section>

<div id="app" class="shell" hidden>
  <aside id="side" class="side" aria-label="Sections">
    <div class="brand side-brand"><span class="dot"></span>Firesight <span class="muted">admin</span></div>
    <nav class="navs">
      ${nav('reports', 'Reports')}
      ${nav('alerts', 'Zone alerts')}
      ${nav('users', 'Users')}
      ${nav('zones', 'Zones')}
      ${nav('requests', 'Access requests')}
      ${nav('orgs', 'Organizations')}
    </nav>
    <div class="side-foot">
      ${THEME_SWITCH}
      <button id="logout" class="nav navbtn">${ICONS.out}<span>Sign out</span></button>
    </div>
  </aside>
  <div id="scrim" class="scrim" hidden></div>

  <div class="content">
    <header class="bar">
      <button id="menu" class="iconbtn" aria-label="Open menu" aria-controls="side" aria-expanded="false">${ICONS.menu}</button>
      <div class="bar-text">
        <h1 id="page-title">Reports</h1>
        <p id="page-sub" class="muted"></p>
      </div>
      <button id="reload" class="iconbtn" title="Reload this page's data" aria-label="Reload">${ICONS.refresh}</button>
    </header>

    <main>
      <div id="page-reports" class="page" hidden>
        <div class="stats" id="stats"></div>
        <div class="filters card">
          <label>Status
            <select id="f-status">
              <option value="all">All</option>
              <option value="visible">Visible</option>
              <option value="hidden">Hidden</option>
            </select>
          </label>
          <label>Label
            <select id="f-label"><option value="">All labels</option></select>
          </label>
          <span id="f-device" class="chip" hidden></span>
        </div>
        <p id="list-empty" class="empty-state" hidden>No reports match these filters.</p>
        <ul id="list" class="list"></ul>
        <div class="center-text"><button id="more" class="ghost" hidden>Load more</button></div>
      </div>

      <div id="page-alerts" class="page" hidden>
        <form id="alert-form" class="card form">
          <h2>Send a zone alert</h2>
          <p class="muted">Pushed right away to every phone whose alert zone overlaps this circle, or whose last location is inside it. Phones without push pick it up at their next check.</p>
          <p id="a-phones" class="phones"></p>
          <div class="where">
            <div class="where-head">
              <h3>Where</h3>
              <label class="grow">Use someone's zone
                <select id="a-zone"><option value="">Pick a zone…</option></select>
              </label>
            </div>
            <div class="map-wrap">
              <div id="a-mapbox" class="mapbox" role="application" aria-label="Alert area map"></div>
              <p id="a-map-hint" class="map-hint">Click the map to place the alert, or click a zone to target it. Drag the pin to move it.</p>
            </div>
            <div class="row">
              <p id="a-target" class="chip" hidden></p>
              <p id="a-reach" class="muted reach"></p>
            </div>
            <label class="radius">Radius <output id="a-radius-out">10 km</output>
              <input id="a-radius-range" type="range" min="0.5" max="100" step="0.5" value="10" aria-label="Radius in km">
            </label>
          </div>
          <div class="grid2">
            <label>Title (English)<input id="a-title" maxlength="80" required placeholder="Wildfire near Qornet es Saouda"></label>
            <label>Title (Arabic, optional)<input id="a-title-ar" maxlength="80" dir="rtl"></label>
            <label>Message (English)<textarea id="a-message" maxlength="500" rows="3" required placeholder="Civil Defence is on site. Avoid the area and keep windows closed."></textarea></label>
            <label>Message (Arabic, optional)<textarea id="a-message-ar" maxlength="500" rows="3" dir="rtl"></textarea></label>
          </div>
          <div class="grid4">
            <label>Latitude<input id="a-lat" inputmode="decimal" required placeholder="33.90"></label>
            <label>Longitude<input id="a-lon" inputmode="decimal" required placeholder="35.80"></label>
            <label>Radius (km)<input id="a-radius" type="number" min="0.5" max="200" step="0.5" value="10" required></label>
            <label>Active for (hours)<input id="a-hours" type="number" min="1" max="336" value="24" required></label>
          </div>
          <div class="row">
            <label>Level
              <select id="a-level">
                <option value="danger">Danger (urgent)</option>
                <option value="warning" selected>Warning</option>
                <option value="info">Info</option>
              </select>
            </label>
            <a id="a-map" target="_blank" rel="noopener noreferrer">Check the place on a map ↗</a>
            <button type="submit" class="primary" id="a-send">Send alert</button>
          </div>
          <p id="a-error" class="error" role="alert"></p>
        </form>
        <h2 class="h2">Recent alerts</h2>
        <p id="alerts-empty" class="empty-state" hidden>No alerts sent yet.</p>
        <ul id="alerts" class="list"></ul>
      </div>

      <div id="page-users" class="page" hidden>
        <div class="filters card">
          <label class="grow">Find by email<input id="u-q" type="search" placeholder="name@example.com"></label>
          <label>Show
            <select id="u-filter">
              <option value="">Everyone</option>
              <option value="zones">With alert zones</option>
              <option value="pro">Pro only</option>
            </select>
          </label>
          <span id="u-total" class="muted"></span>
        </div>
        <p id="users-empty" class="empty-state" hidden>No users match.</p>
        <ul id="users" class="list"></ul>
      </div>

      <div id="page-zones" class="page" hidden>
        <div class="stats" id="z-stats"></div>
        <div class="filters card">
          <label class="grow">Search zones<input id="z-q" type="search" placeholder="Zone name or email"></label>
          <label>Owner
            <select id="z-owner">
              <option value="">Everyone</option>
              <option value="user">Accounts</option>
              <option value="guest">Guest phones</option>
            </select>
          </label>
          <span id="z-total" class="muted"></span>
        </div>
        <p id="zones-empty" class="empty-state" hidden>No zones match.</p>
        <div class="card table-wrap" id="zones-wrap">
          <table class="table" id="zones-table">
            <thead><tr><th>Zone</th><th>Owner</th><th>Center</th><th>Radius</th><th>Updated</th><th></th></tr></thead>
            <tbody id="zones"></tbody>
          </table>
        </div>
      </div>

      <div id="page-orgs" class="page" hidden>
        <p id="orgs-empty" class="empty-state" hidden>No organizations yet. Approve an access request to create one.</p>
        <div class="card table-wrap" id="orgs-wrap">
          <table class="table" id="orgs-table">
            <thead><tr><th>Organization</th><th>Kind</th><th>Owner</th><th>Members</th><th>Sites</th><th>Created</th><th>Public alerts</th><th>Invite</th></tr></thead>
            <tbody id="orgs"></tbody>
          </table>
        </div>
      </div>

      <div id="page-requests" class="page" hidden>
        <p id="requests-empty" class="empty-state" hidden>No requests yet. Organizations ask for access at /org/request-access.</p>
        <div id="requests" class="requests"></div>
      </div>
    </main>
  </div>
</div>

<div id="toast" class="toast" role="status" hidden></div>
<dialog id="link-dialog" class="link-dialog" aria-labelledby="link-title">
  <h2 id="link-title">Invitation link</h2>
  <p id="link-sub" class="muted"></p>
  <label class="link-row"><span class="sr-only">Link</span><input id="link-url" readonly><button id="link-copy" type="button">Copy link</button></label>
  <label for="link-message" class="muted">Ready to send (WhatsApp, email):</label>
  <textarea id="link-message" rows="6" readonly></textarea>
  <div class="link-actions"><button id="link-copy-message" type="button" class="ghost">Copy message</button><form method="dialog"><button>Done</button></form></div>
</dialog>
<dialog id="viewer"><img id="viewer-img" alt="Report photo"><form method="dialog"><button class="ghost">Close</button></form></dialog>
</body>
</html>`;

export const ADMIN_CSS = `
/* Light by default; dark follows the system unless the theme switch says otherwise. */
:root {
  --bg: #f6f3ee; --surface: #ffffff; --ink: #1d1a16; --muted: #6b645a; --line: #e4ddd2;
  --accent: #c2410c; --accent-ink: #ffffff; --danger: #b91c1c; --ok: #15803d; --hidden-bg: #fbf4e9;
  --side: #fcfaf7; --side-ink: #1d1a16; --side-muted: #6b645a; --side-hover: #f1ece4; --side-on: #ebe3d6;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #14110e; --surface: #1e1a16; --ink: #f1ebe2; --muted: #a39a8d; --line: #332c25;
    --accent: #f97316; --accent-ink: #1a0d03; --danger: #f87171; --ok: #4ade80; --hidden-bg: #2a2118;
    --side: #0f0d0b; --side-ink: #f1ebe2; --side-muted: #8f877b; --side-hover: #1e1a16; --side-on: #2a241e;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #14110e; --surface: #1e1a16; --ink: #f1ebe2; --muted: #a39a8d; --line: #332c25;
  --accent: #f97316; --accent-ink: #1a0d03; --danger: #f87171; --ok: #4ade80; --hidden-bg: #2a2118;
  --side: #0f0d0b; --side-ink: #f1ebe2; --side-muted: #8f877b; --side-hover: #1e1a16; --side-on: #2a241e;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Arabic", sans-serif; }
[hidden] { display: none !important; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .9em; }
.muted { color: var(--muted); }
.center { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
.center-text { text-align: center; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; }
.ico { width: 20px; height: 20px; flex: none; }

/* Sign-in */
.login { width: min(380px, 100%); padding: 28px; display: grid; gap: 10px; }
.login h1 { margin: 6px 0 0; font-size: 22px; }
.login p { margin: 0 0 8px; }
.brand { font-weight: 650; letter-spacing: .2px; display: flex; align-items: center; gap: 8px; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 20%, transparent); }

/* Shell: sidebar + content */
.shell { display: grid; grid-template-columns: 232px 1fr; min-height: 100vh; }
.side { background: var(--side); color: var(--side-ink); border-right: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px;
  padding: 18px 12px; position: sticky; top: 0; height: 100vh; }
.side-brand { padding: 4px 10px 18px; font-size: 16px; }
.side-brand .muted { color: var(--side-muted); }
.navs { display: grid; gap: 2px; }
.nav { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 8px;
  color: var(--side-muted); text-decoration: none; font-weight: 550; min-height: 42px; }
.nav:hover { background: var(--side-hover); color: var(--side-ink); }
.nav.on { background: var(--side-on); color: var(--side-ink); }
.nav.on .ico { color: var(--accent); }
.nav:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.count { margin-left: auto; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--side-muted);
  background: var(--side-hover); border-radius: 999px; padding: 1px 8px; }
.count:empty { display: none; }
.side-foot { margin-top: auto; border-top: 1px solid var(--side-on); padding-top: 10px; display: grid; gap: 8px; }
.theme { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; padding: 3px; border-radius: 10px; background: var(--side-hover); }
.theme button { min-height: 32px; padding: 4px 6px; border: 0; border-radius: 7px; background: none; color: var(--side-muted);
  font-size: 13px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
.theme button .ico { width: 15px; height: 15px; }
.theme button:hover { color: var(--side-ink); }
.theme button[aria-pressed="true"] { background: var(--side); color: var(--side-ink); box-shadow: 0 1px 2px rgb(0 0 0 / .12); }
.login .theme { background: var(--bg); justify-self: start; margin-top: 4px; }
.login .theme button[aria-pressed="true"] { background: var(--surface); color: var(--ink); }
.navbtn { width: 100%; border: 0; background: none; font: inherit; cursor: pointer; text-align: left; }
.scrim { position: fixed; inset: 0; background: rgb(0 0 0 / .45); z-index: 9; }

.content { min-width: 0; display: flex; flex-direction: column; }
.bar { display: flex; align-items: center; gap: 12px; padding: 14px 24px; background: var(--surface);
  border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 5; }
.bar-text { min-width: 0; flex: 1; }
.bar h1 { margin: 0; font-size: 19px; }
.bar p { margin: 0; font-size: 13.5px; }
.iconbtn { display: inline-grid; place-items: center; width: 40px; height: 40px; padding: 0; border-radius: 8px; }
#menu { display: none; }
main { width: 100%; max-width: 1080px; padding: 20px 24px 60px; }

/* Controls */
label { font-size: 13px; color: var(--muted); display: grid; gap: 4px; }
input, select, textarea { font: inherit; color: var(--ink); background: var(--bg); border: 1px solid var(--line);
  border-radius: 8px; padding: 9px 11px; min-height: 40px; }
textarea { resize: vertical; }
input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button { font: inherit; border-radius: 8px; padding: 8px 14px; min-height: 38px; cursor: pointer; border: 1px solid var(--line); background: var(--surface); color: var(--ink); }
button:hover:not(:disabled) { border-color: color-mix(in srgb, var(--ink) 30%, var(--line)); }
button:disabled { opacity: .55; cursor: default; }
.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 600; }
.primary:hover:not(:disabled) { border-color: var(--accent); filter: brightness(1.06); }
.ghost { background: transparent; }
.small { min-height: 32px; padding: 4px 10px; font-size: 13.5px; }
.danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, var(--line)); }
.error { color: var(--danger); min-height: 1.2em; margin: 0; font-size: 14px; }
a { color: var(--accent); }
.linkish { border: 0; background: none; padding: 0; min-height: 0; color: var(--accent); text-decoration: underline; font-size: inherit; }

/* Blocks */
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 14px; }
.stat { padding: 12px 14px; }
.stat b { display: block; font-size: 24px; font-variant-numeric: tabular-nums; }
.stat span { font-size: 12.5px; color: var(--muted); }
.filters { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; padding: 12px 14px; margin-bottom: 14px; }
.filters .grow { flex: 1 1 220px; }
.filters > .muted { margin-left: auto; font-size: 13.5px; padding-bottom: 10px; }
.chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px;
  background: var(--hidden-bg); border: 1px solid var(--line); font-size: 13px; margin: 0; width: fit-content; }
.chip button { min-height: 0; padding: 0 4px; border: 0; background: none; color: var(--muted); }
.empty-state { text-align: center; color: var(--muted); padding: 32px 16px; border: 1px dashed var(--line); border-radius: 12px; }
.list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.row { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font-size: 13.5px; }
.badge { font-size: 12px; font-weight: 650; padding: 2px 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); white-space: nowrap; }
.badge.wildfire, .badge.smoke, .badge.warning { color: var(--accent); }
.badge.hidden, .badge.danger { color: var(--danger); }
.badge.pro { color: var(--ok); }
.note { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.note.empty { color: var(--muted); font-style: italic; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }

/* Reports */
.item { display: grid; grid-template-columns: 112px 1fr; gap: 14px; padding: 12px; }
.item.is-hidden { background: var(--hidden-bg); }
.thumb { width: 112px; height: 112px; border-radius: 8px; object-fit: cover; background: var(--bg);
  border: 1px solid var(--line); display: grid; place-items: center; color: var(--muted); font-size: 12px; cursor: zoom-in; padding: 0; }
.thumb.empty { cursor: default; }
.thumb img { width: 100%; height: 100%; object-fit: cover; border-radius: 7px; }
.meta { min-width: 0; display: grid; gap: 6px; align-content: start; }

/* Alerts */
.form { padding: 18px; display: grid; gap: 12px; margin-bottom: 18px; }
.form h2, .h2 { margin: 0; font-size: 17px; }
.h2 { margin: 6px 0 10px; }
.form p { margin: 0; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.grid2 > label, .grid4 > label { min-width: 0; }
.grid2 input, .grid4 input { width: 100%; min-width: 0; }
.form .row #a-send { margin-left: auto; }
/* Alert map */
.where { display: grid; gap: 10px; border-top: 1px solid var(--line); padding-top: 12px; min-width: 0; }
.form > * { min-width: 0; }
.where-head { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; }
.where-head h3 { margin: 0 auto 8px 0; font-size: 15px; }
.where-head .grow { flex: 0 1 340px; min-width: 0; }
.where-head select { width: 100%; max-width: 100%; text-overflow: ellipsis; }
.map-wrap { position: relative; }
.mapbox { height: 420px; border-radius: 10px; border: 1px solid var(--line); overflow: hidden; background: var(--bg); }
.map-hint { position: absolute; left: 10px; top: 10px; right: 54px; width: fit-content; margin: 0 !important; pointer-events: none;
  background: color-mix(in srgb, var(--surface) 90%, transparent); border: 1px solid var(--line); border-radius: 8px;
  padding: 6px 10px; font-size: 13px; color: var(--ink); }
.map-hint.error { color: var(--danger); }
.pin { width: 22px; height: 22px; border-radius: 50%; background: var(--pin, var(--accent)); border: 3px solid #fff;
  box-shadow: 0 1px 6px rgb(0 0 0 / .45); cursor: grab; }
.pin:active { cursor: grabbing; }
.reach { font-size: 13.5px; }
.reach b { color: var(--ink); }
.radius { grid-template-columns: auto 1fr; align-items: center; gap: 4px 12px; }
.radius output { font-variant-numeric: tabular-nums; color: var(--ink); font-weight: 600; min-width: 64px; }
.radius input { grid-column: 1 / -1; min-height: 0; padding: 0; accent-color: var(--accent); background: none; border: 0; }
.maplibregl-popup-content { background: var(--surface); color: var(--ink); font: 13px/1.4 system-ui, sans-serif; padding: 8px 10px; border-radius: 8px; }
.maplibregl-popup-tip { border-top-color: var(--surface) !important; border-bottom-color: var(--surface) !important; }
.alert-item { padding: 12px 14px; display: grid; gap: 6px; }
.alert-item.over { opacity: .6; }
.phones { font-size: 13.5px; }
.phones .off { color: var(--danger); }

/* Users */
.user-item { padding: 14px; display: grid; gap: 10px; }
.user-head { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.avatar { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; flex: none;
  background: color-mix(in srgb, var(--accent) 16%, var(--surface)); color: var(--accent); font-weight: 700; }
.who { min-width: 0; flex: 1; display: grid; }
.who b { overflow-wrap: anywhere; }
.who span { font-size: 13px; }
.user-head > button { margin-left: auto; }
.facts { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13.5px; color: var(--muted); }
details.zones { border-top: 1px solid var(--line); padding-top: 8px; }
details.zones summary { cursor: pointer; font-weight: 600; font-size: 14px; padding: 4px 0; }
details.zones summary .muted { font-weight: 400; }
.zone-list { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 6px; }
.zone { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; padding: 8px 10px; border-radius: 8px;
  background: var(--bg); font-size: 13.5px; }
.zone b { min-width: 120px; }
.zone button { margin-left: auto; }
.ring { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--accent); flex: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }

/* Zones table */
.table-wrap { overflow: hidden; }
.requests { display: grid; gap: 12px; }
.request { display: grid; gap: 10px; padding: 16px 18px; }
.request header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; }
.request h3 { margin: 0; font-size: 16px; }
.request dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px 16px; margin: 0; font-size: 14px; }
.request dt { font-size: 12px; color: var(--muted); }
.request dd { margin: 0; overflow-wrap: anywhere; }
.request blockquote { margin: 0; padding: 10px 12px; border-radius: 8px; background: var(--bg); font-size: 14px; white-space: pre-wrap; }
.request .row-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.request .row-actions label { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; margin-inline-end: auto; }
.badge.pending { color: var(--accent); }
.badge.approved { color: var(--ok); }
.link-dialog { width: min(560px, calc(100vw - 32px)); padding: 20px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); color: var(--ink); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.link-dialog::backdrop { background: rgb(0 0 0 / .45); }
.link-dialog h2 { margin: 0 0 4px; font-size: 18px; }
.link-dialog p { margin: 0 0 14px; }
.link-row { display: flex; gap: 8px; margin-bottom: 14px; }
.link-row input { flex: 1; min-width: 0; font-family: ui-monospace, monospace; font-size: 13px; }
.link-dialog textarea { width: 100%; margin-top: 6px; font: inherit; font-size: 14px; resize: vertical; }
.link-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.link-actions form { margin: 0; }
.table { width: 100%; border-collapse: collapse; font-size: 14px; }
.table th { text-align: left; font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em;
  padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--bg); }
.table td { padding: 10px 14px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.table tr:last-child td { border-bottom: 0; }
.table tbody tr:hover { background: color-mix(in srgb, var(--bg) 60%, transparent); }
.table td:last-child { text-align: right; white-space: nowrap; }
.zname { display: flex; align-items: center; gap: 10px; font-weight: 600; }
.owner { display: grid; }
.owner span { font-size: 12.5px; }
.num { font-variant-numeric: tabular-nums; white-space: nowrap; }

.toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); background: var(--ink); color: var(--bg);
  padding: 10px 16px; border-radius: 8px; font-size: 14px; max-width: calc(100% - 32px); z-index: 20; }
dialog { border: 0; border-radius: 12px; padding: 12px; background: var(--surface); color: var(--ink); max-width: min(92vw, 1100px); }
dialog::backdrop { background: rgb(0 0 0 / .7); }
dialog img { display: block; max-width: 100%; max-height: 80vh; border-radius: 8px; }
dialog form { text-align: right; margin-top: 8px; }

/* Narrow screens: the sidebar slides in from the menu button. */
@media (max-width: 900px) {
  .shell { grid-template-columns: 1fr; }
  .side { position: fixed; left: 0; top: 0; bottom: 0; width: 260px; z-index: 10; transform: translateX(-100%);
    transition: transform .2s ease; }
  .side.open { transform: none; box-shadow: 0 0 40px rgb(0 0 0 / .35); }
  #menu { display: inline-grid; }
  .bar { padding: 10px 16px; }
  main { padding: 16px 16px 60px; }
  .grid4 { grid-template-columns: 1fr 1fr; }
  .mapbox { height: 340px; }
  .where-head .grow { flex: 1 1 100%; }
  .map-wrap.placed .map-hint { display: none; }
}
@media (max-width: 720px) {
  .grid2 { grid-template-columns: 1fr; }
  /* The zones table turns into cards. */
  .table thead { display: none; }
  .table, .table tbody, .table tr, .table td { display: block; }
  .table tr { padding: 10px 14px; border-bottom: 1px solid var(--line); }
  .table tr:last-child { border-bottom: 0; }
  .table td { padding: 3px 0; border: 0; display: flex; gap: 10px; }
  .table td[data-label]::before { content: attr(data-label); color: var(--muted); font-size: 12.5px; min-width: 70px; }
  .table td:last-child { text-align: left; padding-top: 8px; }
}
@media (max-width: 560px) {
  .item { grid-template-columns: 76px 1fr; gap: 10px; }
  .thumb { width: 76px; height: 76px; }
  .user-head > button { margin-left: 50px; }
}
@media (prefers-reduced-motion: reduce) { .side { transition: none; } }
`;

export const ADMIN_JS = `
'use strict';
const $ = (id) => document.getElementById(id);
const LABEL_NAMES = { wildfire: 'Wildfire', smoke: 'Smoke', agriculturalBurn: 'Agricultural burn', industrial: 'Industrial', falseAlarm: 'False alarm', unsure: 'Unsure' };
const PAGES = {
  reports: { title: 'Reports', sub: 'Ground reports sent from the phone app. Hide or delete anything that should not be shown.' },
  alerts: { title: 'Zone alerts', sub: 'Send a message to every phone in an area.' },
  users: { title: 'Users', sub: 'Accounts, their plan, phone and alert zones.' },
  zones: { title: 'Zones', sub: 'Every alert zone people are watching, and who it belongs to.' },
  orgs: { title: 'Organizations', sub: 'Companies, fire stations, insurers and NGOs. Verify one to let it alert the public inside its sites.' },
  requests: { title: 'Access requests', sub: "Organizations asking to use Firesight. Approve one to create it and get its owner's one-time link." },
};
const ORG_KINDS = { fire_station: 'Fire station / civil defence', insurer: 'Insurer', company: 'Company', ngo: 'NGO / municipality' };
const state = { status: 'all', label: '', device: '', before: null, photoUrls: [], page: 'reports', users: [], zones: [] };
/** The alert form's map, loaded on first use. */
const amap = { map: null, loading: null, ready: false, pin: null, popup: null, fitPending: false, fittedZones: false };

// ---- Theme: 'system' follows the device; 'light' or 'dark' is remembered in this browser. ----
function savedTheme() {
  try { const t = localStorage.getItem('firesight-admin-theme'); return t === 'light' || t === 'dark' ? t : 'system'; }
  catch { return 'system'; }
}
function applyTheme(t) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  for (const b of document.querySelectorAll('[data-theme-choice]')) b.setAttribute('aria-pressed', String(b.dataset.themeChoice === t));
  if (typeof setBasemap === 'function') setBasemap();
}
function setTheme(t) {
  try { if (t === 'system') localStorage.removeItem('firesight-admin-theme'); else localStorage.setItem('firesight-admin-theme', t); } catch {}
  applyTheme(t);
}
applyTheme(savedTheme());

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? { 'X-Admin': '1' } : { 'X-Admin': '1', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && !url.endsWith('/login')) { show('login'); throw new Error('Signed out'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || ('HTTP ' + res.status));
  return data;
}

const quiet = (e) => { if (e.message !== 'Signed out') toast(e.message); };

function show(which) {
  $('loading').hidden = which !== 'loading';
  $('login').hidden = which !== 'login';
  $('app').hidden = which !== 'app';
  if (which === 'login') setTimeout(() => $('password').focus(), 0);
}

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

function el(tag, attrs, children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children || []) if (c) e.append(c);
  return e;
}

const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
const osm = (lat, lon, zoom) => 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon + '#map=' + zoom + '/' + lat + '/' + lon;
const mapLink = (lat, lon, zoom, digits, extra) => el('a', { href: osm(lat, lon, zoom), target: '_blank', rel: 'noopener noreferrer',
  title: 'Open on OpenStreetMap', text: lat.toFixed(digits) + ', ' + lon.toFixed(digits) + (extra || '') });
const setCount = (page, n) => { $('n-' + page).textContent = n == null ? '' : String(n); };

// ---- Navigation ----
function openSide(open) {
  $('side').classList.toggle('open', open);
  $('scrim').hidden = !open;
  $('menu').setAttribute('aria-expanded', String(open));
}

function route() {
  const name = location.hash.slice(1);
  const page = PAGES[name] ? name : 'reports';
  state.page = page;
  for (const a of document.querySelectorAll('.nav[data-page]')) {
    const on = a.dataset.page === page;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  for (const p of Object.keys(PAGES)) $('page-' + p).hidden = p !== page;
  $('page-title').textContent = PAGES[page].title;
  $('page-sub').textContent = PAGES[page].sub;
  document.title = PAGES[page].title + ' · Firesight admin';
  openSide(false);
  load(page);
}

function go(page) {
  if (location.hash === '#' + page) route(); else location.hash = page;
}

function load(page) {
  if (page === 'reports') refreshReports();
  if (page === 'alerts') { loadAlerts(); loadAlertZones(); ensureMap(); }
  if (page === 'users') loadUsers();
  if (page === 'zones') loadZones();
  if (page === 'orgs') loadOrgs();
  if (page === 'requests') loadRequests();
}

/** Sidebar counts, fetched once after sign-in; each page updates its own count when it loads. */
function loadCounts() {
  call('GET', '/admin/api/stats').then((s) => setCount('reports', s.last24h || null)).catch(() => {});
  call('GET', '/admin/api/broadcasts').then((d) => setCount('alerts', activeCount(d) || null)).catch(() => {});
  call('GET', '/admin/api/users?q=').then((d) => setCount('users', d.total)).catch(() => {});
  call('GET', '/admin/api/zones').then((d) => setCount('zones', d.zones.length)).catch(() => {});
  call('GET', '/admin/api/orgs').then((d) => setCount('orgs', d.orgs.length || null)).catch(() => {});
  call('GET', '/admin/api/org-requests').then((d) => setCount('requests', d.requests.filter((r) => r.status === 'pending').length || null)).catch(() => {});
}

// ---- Organizations ----
async function loadOrgs() {
  try {
    const { orgs } = await call('GET', '/admin/api/orgs');
    setCount('orgs', orgs.length || null);
    $('orgs').replaceChildren(...orgs.map((o) => el('tr', null, [
      el('td', { 'data-label': 'Organization', text: o.name }),
      el('td', { 'data-label': 'Kind', class: 'muted', text: ORG_KINDS[o.kind] || o.kind }),
      el('td', { 'data-label': 'Owner', class: 'muted', text: o.owner || 'Unknown' }),
      el('td', { 'data-label': 'Members', class: 'num', text: String(o.members) }),
      el('td', { 'data-label': 'Sites', class: 'num', text: String(o.sites) }),
      el('td', { 'data-label': 'Created', class: 'muted', text: day(o.createdAt) }),
      el('td', { 'data-label': 'Public alerts' }, [el('button', {
        class: 'small', text: o.verified ? 'Verified: remove' : 'Verify',
        title: o.verified ? 'Stop this organization alerting the public' : 'Let this organization alert the public inside its sites',
        onclick: () => call('POST', '/admin/api/orgs/' + encodeURIComponent(o.id) + '/verified', { verified: !o.verified })
          .then(() => { toast(o.verified ? o.name + ' can no longer alert the public.' : o.name + ' can now alert the public.'); return loadOrgs(); })
          .catch(quiet),
      })]),
      el('td', { 'data-label': 'Invite' }, [el('button', {
        class: 'small', text: 'Owner link',
        title: 'A new one-time link for an owner of this organization',
        onclick: () => {
          const email = prompt('Email of the person who will own ' + o.name + ':', o.owner || '');
          if (!email) return;
          call('POST', '/admin/api/orgs/' + encodeURIComponent(o.id) + '/invite', { email, role: 'owner' })
            .then((d) => showLink(o.name, d.invite.email, d.path, d.invite.expiresAt)).catch(quiet);
        },
      })]),
    ])));
    $('orgs-wrap').hidden = orgs.length === 0;
    $('orgs-empty').hidden = orgs.length > 0;
  } catch (e) { quiet(e); }
}
// ---- Access requests ----
const KIND_LONG = ORG_KINDS;
async function loadRequests() {
  try {
    const { requests } = await call('GET', '/admin/api/org-requests');
    setCount('requests', requests.filter((r) => r.status === 'pending').length || null);
    $('requests-empty').hidden = requests.length > 0;
    $('requests').replaceChildren(...requests.map((r) => {
      const verify = el('input', { type: 'checkbox' });
      const decide = (action) => call('POST', '/admin/api/org-requests/' + encodeURIComponent(r.id) + '/' + action, action === 'approve' ? { verified: verify.checked } : undefined);
      return el('article', { class: 'card request' }, [
        el('header', null, [
          el('h3', { text: r.orgName }),
          el('span', { class: 'badge ' + r.status, text: r.status }),
          el('span', { class: 'muted', text: (KIND_LONG[r.kind] || r.kind) + ' · ' + r.country + ' · ' + when(r.createdAt) }),
        ]),
        el('dl', null, [
          el('div', null, [el('dt', { text: 'Contact' }), el('dd', { text: r.contactName })]),
          el('div', null, [el('dt', { text: 'Email' }), el('dd', null, [el('a', { href: 'mailto:' + r.email, text: r.email })])]),
          r.phone ? el('div', null, [el('dt', { text: 'Phone' }), el('dd', null, [el('a', { href: 'tel:' + r.phone, text: r.phone })])]) : null,
          r.sitesEstimate ? el('div', null, [el('dt', { text: 'Sites' }), el('dd', { text: String(r.sitesEstimate) })]) : null,
        ]),
        r.message ? el('blockquote', { text: r.message }) : null,
        r.status === 'pending'
          ? el('div', { class: 'row-actions' }, [
              el('label', { title: 'Verified organizations (fire stations, civil defence, municipalities) can alert the public' }, [verify, el('span', { text: 'Verified: may alert the public' })]),
              el('button', { class: 'ghost danger small', text: 'Decline', onclick: () => { if (confirm('Decline ' + r.orgName + '?')) decide('decline').then(loadRequests).catch(quiet); } }),
              el('button', { class: 'small', text: 'Approve and get link', onclick: () => decide('approve').then((d) => { showLink(d.org.name, d.invite.email, d.path, d.invite.expiresAt); loadRequests(); }).catch(quiet) }),
            ])
          : el('p', { class: 'muted', text: (r.status === 'approved' ? 'Approved ' : 'Declined ') + (r.decidedAt ? when(r.decidedAt) : '') + (r.status === 'approved' ? '. Lost the link? Use “Owner link” on the Organizations page.' : '') }),
      ]);
    }));
  } catch (e) { quiet(e); }
}

/** The one-time link, shown once: the server keeps only its hash. */
function showLink(orgName, email, path, expiresAt) {
  const url = location.origin + path;
  $('link-sub').textContent = 'For ' + email + ' · ' + orgName + ' · works once, until ' + day(expiresAt) + '. It is shown only now: copy it before closing.';
  $('link-url').value = url;
  $('link-message').value = 'Hello,\\n\\n' + orgName + ' now has access to Firesight for Organizations. Open this link to set your password and start adding your sites:\\n\\n' + url + '\\n\\nThe link works once and expires on ' + day(expiresAt) + '.\\n\\nThe Firesight team';
  $('link-dialog').showModal();
  $('link-url').select();
}
const copy = (text, what) => navigator.clipboard.writeText(text).then(() => toast(what + ' copied.'), () => toast('Select it and copy by hand.'));

const activeCount = (d) => d.broadcasts.filter((b) => !b.cancelled && b.expiresAt > d.now).length;

// ---- Reports ----
async function loadStats() {
  const s = await call('GET', '/admin/api/stats');
  setCount('reports', s.last24h || null);
  const tiles = [
    [s.last24h, 'reports, last 24 h'],
    [s.last7d, 'reports, last 7 days'],
    [s.devices7d, 'phones, last 7 days'],
    [s.total, 'stored in total'],
    [s.withPhoto, 'with a photo'],
    [s.hidden, 'hidden'],
  ];
  $('stats').replaceChildren(...tiles.map(([n, label]) =>
    el('div', { class: 'card stat' }, [el('b', { text: String(n) }), el('span', { text: label })])));
}

function renderItem(r) {
  const thumb = r.hasPhoto
    ? el('button', { class: 'thumb', title: 'Open photo', 'aria-label': 'Open photo', onclick: () => openPhoto(r.id) })
    : el('div', { class: 'thumb empty', text: 'No photo' });
  if (r.hasPhoto) loadThumb(thumb, r.id);

  const li = el('li', { class: 'card item' + (r.hidden ? ' is-hidden' : '') }, [
    thumb,
    el('div', { class: 'meta' }, [
      el('div', { class: 'row' }, [
        el('span', { class: 'badge ' + r.label, text: LABEL_NAMES[r.label] || r.label }),
        r.hidden ? el('span', { class: 'badge hidden', text: 'Hidden' }) : null,
        el('span', { class: 'muted', text: when(r.createdAt) }),
      ]),
      el('p', { class: 'note' + (r.note ? '' : ' empty'), text: r.note || 'No note' }),
      el('div', { class: 'row' }, [
        mapLink(r.lat, r.lon, 13, 4),
        r.bearing != null ? el('span', { class: 'muted', text: 'pointing ' + Math.round(r.bearing) + '°' }) : null,
        r.hotspotSensor ? el('span', { class: 'muted', text: 'at hotspot ' + r.hotspotSensor }) : null,
        el('button', { class: 'linkish', title: 'Show only this phone', text: 'phone ' + r.device, onclick: () => filterDevice(r.device) }),
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'small', text: r.hidden ? 'Show to phones' : 'Hide', onclick: (e) => setHidden(r, !r.hidden, e.target) }),
        el('button', { class: 'small danger', text: 'Delete', onclick: (e) => remove(r, e.target) }),
        el('button', { class: 'small', text: 'Send zone alert here', onclick: () => alertAt({ lat: r.lat, lon: r.lon, title: (LABEL_NAMES[r.label] || 'Fire') + ' reported nearby' }) }),
      ]),
    ]),
  ]);
  li.dataset.id = r.id;
  return li;
}

/** Photos need the session cookie, so they are fetched and shown as blob URLs. */
async function photoUrl(id) {
  const res = await fetch('/admin/api/reports/' + encodeURIComponent(id) + '/photo', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Photo missing');
  const url = URL.createObjectURL(await res.blob());
  state.photoUrls.push(url);
  return url;
}

async function loadThumb(node, id) {
  try {
    const img = el('img', { src: await photoUrl(id), alt: '', onerror: () => { node.textContent = 'Photo can\\'t be shown'; } });
    node.replaceChildren(img);
  }
  catch { node.textContent = 'Photo missing'; }
}

async function openPhoto(id) {
  const img = $('viewer-img');
  img.removeAttribute('src');
  $('viewer').showModal();
  try { img.src = await photoUrl(id); } catch (e) { $('viewer').close(); toast(e.message); }
}

async function loadList(reset) {
  if (reset) {
    state.before = null;
    for (const u of state.photoUrls) URL.revokeObjectURL(u);
    state.photoUrls = [];
    $('list').replaceChildren();
  }
  const q = new URLSearchParams({ status: state.status, limit: '30' });
  if (state.label) q.set('label', state.label);
  if (state.device) q.set('device', state.device);
  if (state.before) q.set('before', state.before);
  const data = await call('GET', '/admin/api/reports?' + q);
  $('list').append(...data.reports.map(renderItem));
  if (data.reports.length) state.before = data.reports[data.reports.length - 1].createdAt;
  $('more').hidden = !data.more;
  $('list-empty').hidden = $('list').children.length > 0;
}

async function refreshReports() {
  try { await Promise.all([loadStats(), loadList(true)]); } catch (e) { quiet(e); }
}

function filterDevice(device) {
  state.device = device;
  const chip = $('f-device');
  chip.replaceChildren(
    el('span', { text: 'Phone ' + device }),
    el('button', { class: 'linkish', text: 'Hide all its reports', onclick: () => hideDevice(device, true) }),
    el('button', { 'aria-label': 'Clear phone filter', text: '✕', onclick: () => { state.device = ''; chip.hidden = true; refreshReports(); } }),
  );
  chip.hidden = false;
  go('reports');
}

async function setHidden(r, hidden, btn) {
  btn.disabled = true;
  try {
    const { report } = await call('POST', '/admin/api/reports/' + encodeURIComponent(r.id) + '/hidden', { hidden });
    document.querySelector('[data-id="' + CSS.escape(r.id) + '"]').replaceWith(renderItem(report));
    toast(hidden ? 'Hidden: phones no longer receive it.' : 'Visible to phones again.');
    loadStats();
  } catch (e) { btn.disabled = false; toast(e.message); }
}

async function hideDevice(device, hidden) {
  if (!confirm('Hide every report from phone ' + device + '?')) return;
  try {
    const { changed } = await call('POST', '/admin/api/devices/' + encodeURIComponent(device) + '/hidden', { hidden });
    toast(changed + ' report(s) hidden.');
    refreshReports();
  } catch (e) { toast(e.message); }
}

async function remove(r, btn) {
  if (!confirm('Delete this report and its photo for good?')) return;
  btn.disabled = true;
  try {
    await call('DELETE', '/admin/api/reports/' + encodeURIComponent(r.id));
    document.querySelector('[data-id="' + CSS.escape(r.id) + '"]').remove();
    $('list-empty').hidden = $('list').children.length > 0;
    toast('Deleted.');
    loadStats();
  } catch (e) { btn.disabled = false; toast(e.message); }
}

// ---- Zone alerts ----
const LEVEL_NAMES = { danger: 'Danger', warning: 'Warning', info: 'Info' };

/** Fills in the place: from a report, from someone's zone, or from the map. */
function setPlace(p, fit) {
  $('a-lat').value = p.lat.toFixed(4);
  $('a-lon').value = p.lon.toFixed(4);
  if (p.radiusKm) { $('a-radius').value = String(Math.min(200, Math.max(0.5, p.radiusKm))); syncRadius($('a-radius')); }
  if (p.title && !$('a-title').value) $('a-title').value = p.title;
  const target = $('a-target');
  if (p.zone) {
    target.replaceChildren(
      el('span', { class: 'ring' }),
      el('span', { text: 'Targeting zone “' + p.zone + '”' + (p.owner ? ' of ' + p.owner : '') + ' · ' + p.radiusKm + ' km' }),
      el('button', { type: 'button', 'aria-label': 'Clear', text: '✕', onclick: () => { target.hidden = true; $('a-zone').value = ''; } }),
    );
    target.hidden = false;
  } else { target.hidden = true; $('a-zone').value = ''; }
  updateMapLink();
  syncMap(fit !== false);
}

/** Opens the alert form with the place filled in, from another page. */
function alertAt(p) {
  setPlace(p, true);
  go('alerts');
  setTimeout(() => ($('a-title').value ? $('a-message') : $('a-title')).focus(), 0);
}

function updateMapLink() {
  const lat = Number($('a-lat').value), lon = Number($('a-lon').value);
  const ok = $('a-lat').value !== '' && $('a-lon').value !== '' && Number.isFinite(lat) && Number.isFinite(lon);
  $('a-map').hidden = !ok;
  if (ok) $('a-map').href = osm(lat, lon, 11);
}

function renderAlert(b, now) {
  const over = b.cancelled || b.expiresAt <= now;
  const status = b.cancelled ? 'Cancelled' : over ? 'Ended' : 'Active until ' + when(b.expiresAt);
  return el('li', { class: 'card alert-item' + (over ? ' over' : '') }, [
    el('div', { class: 'row' }, [
      el('span', { class: 'badge ' + b.level, text: LEVEL_NAMES[b.level] || b.level }),
      el('b', { text: b.title }),
      el('span', { class: 'muted', text: status }),
    ]),
    el('p', { class: 'note', text: b.message }),
    b.titleAr || b.messageAr ? el('p', { class: 'note', dir: 'rtl', text: [b.titleAr, b.messageAr].filter(Boolean).join(' · ') }) : null,
    el('div', { class: 'row' }, [
      mapLink(b.lat, b.lon, 11, 4, ' · ' + b.radiusKm + ' km'),
      el('span', { class: 'muted', text: 'sent ' + when(b.createdAt) }),
      b.pushed ? el('span', { class: 'muted', text: 'pushed to ' + b.pushed.delivered + ' of ' + b.pushed.recipients + ' phone(s)' }) : null,
      over ? null : el('button', { class: 'small danger', text: 'Cancel', onclick: (e) => cancelAlert(b, e.target) }),
    ]),
  ]);
}

async function loadAlerts() {
  try {
    const data = await call('GET', '/admin/api/broadcasts');
    const { broadcasts, now, phones, push } = data;
    setCount('alerts', activeCount(data) || null);
    $('a-phones').replaceChildren(
      push ? el('span', { text: 'Push is on. ' }) : el('span', { class: 'off', text: 'Push is off (FIREBASE_SERVICE_ACCOUNT not set). ' }),
      phones ? el('span', { class: 'muted', text: phones.withPush + ' phone(s) can receive push · ' + phones.zones + ' zone(s) on ' +
        phones.withZones + ' phone(s) · ' + phones.withLocation + ' with a last location' }) : null,
    );
    $('alerts').replaceChildren(...broadcasts.map((b) => renderAlert(b, now)));
    $('alerts-empty').hidden = broadcasts.length > 0;
  } catch (e) { quiet(e); }
}

async function sendAlert(e) {
  e.preventDefault();
  $('a-error').textContent = '';
  const body = {
    title: $('a-title').value, titleAr: $('a-title-ar').value,
    message: $('a-message').value, messageAr: $('a-message-ar').value,
    level: $('a-level').value,
    lat: Number($('a-lat').value), lon: Number($('a-lon').value),
    radiusKm: Number($('a-radius').value), hours: Number($('a-hours').value),
  };
  if (!confirm('Send "' + body.title + '" to phones within ' + body.radiusKm + ' km of ' + body.lat + ', ' + body.lon + '?')) return;
  $('a-send').disabled = true;
  try {
    const { broadcast } = await call('POST', '/admin/api/broadcasts', body);
    for (const id of ['a-title', 'a-title-ar', 'a-message', 'a-message-ar']) $(id).value = '';
    $('a-target').hidden = true;
    toast(broadcast.pushed ? 'Alert sent. Pushed to ' + broadcast.pushed.delivered + ' of ' + broadcast.pushed.recipients + ' phone(s).' : 'Alert sent. Phones pick it up at their next check.');
    loadAlerts();
  } catch (err) { $('a-error').textContent = err.message; }
  finally { $('a-send').disabled = false; }
}

// ---- Alert map: click to place, drag the pin, or pick someone's zone ----
const LEVEL_COLORS = { danger: '#dc2626', warning: '#ea580c', info: '#2563eb' };
const ZONE_COLOR = '#6d28d9';
const DEFAULT_VIEW = { center: [35.8, 33.9], zoom: 7 };

function isDark() {
  const t = document.documentElement.getAttribute('data-theme');
  return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** A circle on the globe as a GeoJSON polygon ring. */
function circleRing(lat, lon, km) {
  const r = Math.PI / 180, d = km / 6371, la = lat * r, lo = lon * r, ring = [];
  for (let i = 0; i <= 72; i++) {
    const b = 2 * Math.PI * i / 72;
    const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    ring.push([lo2 / r, la2 / r]);
  }
  return ring;
}

function ringBounds(rings) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const ring of rings) for (const [x, y] of ring) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [[w, s], [e, n]];
}

/** The circle typed in the form, or null while it is incomplete. */
function formCircle() {
  const lat = Number($('a-lat').value), lon = Number($('a-lon').value), radiusKm = Number($('a-radius').value);
  if ($('a-lat').value === '' || $('a-lon').value === '' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, radiusKm: Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : 0.5 };
}

const ownerName = (z) => z.owner.email || (z.owner.kind === 'guest' ? 'a guest phone' : 'a deleted account');
const hits = (c, z) => !!c && distanceKm(c.lat, c.lon, z.lat, z.lon) <= c.radiusKm + z.radiusKm;
const bySize = (a, b) => (state.zones[a.properties.i] || {}).radiusKm - (state.zones[b.properties.i] || {}).radiusKm;

/** "Overlaps 3 zones of 2 people": what the circle reaches, before sending. */
function updateReach(c) {
  const out = $('a-reach');
  if (!c) { out.textContent = 'Place the alert on the map or enter its coordinates.'; return; }
  const hit = state.zones.filter((z) => hits(c, z));
  const people = new Set(hit.map((z) => z.owner.kind === 'user' ? 'u:' + z.owner.email : 'g:' + z.owner.device));
  out.replaceChildren(
    document.createTextNode('Overlaps '),
    el('b', { text: hit.length + ' zone' + (hit.length === 1 ? '' : 's') }),
    document.createTextNode(' of '),
    el('b', { text: people.size + (people.size === 1 ? ' person' : ' people') }),
    document.createTextNode(', plus phones whose last location is inside.'),
  );
}

function syncRadius(from) {
  const v = Number(from.value);
  if (from.id === 'a-radius-range') $('a-radius').value = String(v);
  else if (Number.isFinite(v)) $('a-radius-range').value = String(Math.min(100, Math.max(0.5, v)));
  $('a-radius-out').textContent = (Number.isFinite(v) ? v : 0) + ' km';
}

/** Redraws the circle, pin and zone highlights from the form. */
function syncMap(fit) {
  const c = formCircle();
  updateReach(c);
  $('a-mapbox').parentElement.classList.toggle('placed', !!c);
  const m = amap.map;
  if (!m || !amap.ready) { if (fit) amap.fitPending = true; return; }
  const color = LEVEL_COLORS[$('a-level').value] || LEVEL_COLORS.warning;
  m.setPaintProperty('alert-fill', 'fill-color', color);
  m.setPaintProperty('alert-line', 'line-color', color);
  m.setPaintProperty('zones-hit', 'line-color', color);
  amap.pin.getElement().style.setProperty('--pin', color);
  const ring = c ? circleRing(c.lat, c.lon, c.radiusKm) : null;
  m.getSource('alert').setData({ type: 'FeatureCollection', features: ring ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] : [] });
  drawZones(c);
  if (c) amap.pin.setLngLat([c.lon, c.lat]).addTo(m); else amap.pin.remove();
  if (fit && c && !$('page-alerts').hidden) {
    m.fitBounds(ringBounds([ring]), { padding: 48, maxZoom: 13, duration: 600 });
    amap.fitPending = false;
  } else if (fit) amap.fitPending = true;
}

function drawZones(c) {
  const m = amap.map;
  if (!m || !amap.ready) return;
  m.getSource('zones').setData({ type: 'FeatureCollection', features: state.zones.map((z, i) => ({
    type: 'Feature', id: i, properties: { i, hit: hits(c, z) },
    geometry: { type: 'Polygon', coordinates: [circleRing(z.lat, z.lon, z.radiusKm)] },
  })) });
  // Zones show up with nothing placed yet: show where people are watching.
  if (!c && state.zones.length && !amap.fittedZones && !$('page-alerts').hidden) {
    amap.fittedZones = true;
    m.fitBounds(ringBounds(state.zones.map((z) => circleRing(z.lat, z.lon, z.radiusKm))), { padding: 40, maxZoom: 10, duration: 0 });
  }
}

/** The pin was put somewhere by hand: no longer aimed at one zone. */
function placeAt(lat, lon) {
  $('a-lat').value = lat.toFixed(4);
  $('a-lon').value = lon.toFixed(4);
  $('a-target').hidden = true;
  $('a-zone').value = '';
  updateMapLink();
  syncMap(false);
}

function useZone(z, fit) {
  setPlace({ lat: z.lat, lon: z.lon, radiusKm: z.radiusKm, zone: z.name || 'Unnamed zone', owner: ownerName(z) }, fit);
  const i = state.zones.indexOf(z);
  $('a-zone').value = i >= 0 ? String(i) : '';
}

function fillZoneSelect() {
  const sel = $('a-zone');
  const keep = sel.value;
  sel.replaceChildren(el('option', { value: '', text: state.zones.length ? 'Pick a zone… (' + state.zones.length + ')' : 'No zones yet' }),
    ...state.zones.map((z, i) => el('option', { value: String(i), text: (z.name || 'Unnamed zone') + ' · ' + ownerName(z) + ' · ' + z.radiusKm + ' km' })));
  sel.value = keep && state.zones[Number(keep)] ? keep : '';
  sel.disabled = state.zones.length === 0;
}

async function loadAlertZones() {
  try {
    const { zones } = await call('GET', '/admin/api/zones');
    state.zones = zones;
    setCount('zones', zones.length);
  } catch { /* zones are off on this server: the map still works */ }
  fillZoneSelect();
  syncMap(false);
}

function setBasemap() {
  const m = amap.map;
  if (!m || !amap.ready) return;
  const dark = isDark();
  // OSM has no dark tiles: dim them so the map sits quietly in the dark theme.
  m.setPaintProperty('base', 'raster-brightness-max', dark ? 0.62 : 1);
  m.setPaintProperty('base', 'raster-saturation', dark ? -0.35 : 0);
  m.setPaintProperty('base', 'raster-contrast', dark ? 0.1 : 0);
  m.setPaintProperty('zones-line', 'line-color', dark ? '#c4b5fd' : ZONE_COLOR);
  m.setPaintProperty('zones-fill', 'fill-color', dark ? '#a78bfa' : ZONE_COLOR);
}

function mapHint(text, error) {
  const h = $('a-map-hint');
  h.textContent = text;
  h.classList.toggle('error', !!error);
}

/** MapLibre loads the first time the alerts page opens. */
function ensureMap() {
  if (amap.map) {
    amap.map.resize();
    if (amap.fitPending) syncMap(true); else drawZones(formCircle());
    return;
  }
  if (amap.loading) return;
  amap.loading = import('/admin/vendor/maplibre-gl.mjs').then((lib) => {
    lib.setWorkerUrl('/admin/vendor/maplibre-gl-worker.mjs');
    const osmTiles = { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' };
    const empty = { type: 'FeatureCollection', features: [] };
    const c = formCircle();
    const m = new lib.Map({
      container: 'a-mapbox',
      style: {
        version: 8,
        sources: {
          osm: osmTiles,
          zones: { type: 'geojson', data: empty },
          alert: { type: 'geojson', data: empty },
        },
        layers: [
          { id: 'base', type: 'raster', source: 'osm' },
          { id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': ZONE_COLOR,
            'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.32, ['get', 'hit'], 0.2, 0.12] } },
          { id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': ZONE_COLOR, 'line-width': 1.8, 'line-dasharray': [3, 2] } },
          { id: 'zones-hit', type: 'line', source: 'zones', filter: ['==', ['get', 'hit'], true], paint: { 'line-color': LEVEL_COLORS.warning, 'line-width': 2 } },
          { id: 'alert-fill', type: 'fill', source: 'alert', paint: { 'fill-color': LEVEL_COLORS.warning, 'fill-opacity': 0.14 } },
          { id: 'alert-line', type: 'line', source: 'alert', paint: { 'line-color': LEVEL_COLORS.warning, 'line-width': 2.5 } },
        ],
      },
      center: c ? [c.lon, c.lat] : DEFAULT_VIEW.center,
      zoom: c ? 9 : DEFAULT_VIEW.zoom,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
    amap.map = m;
    amap.pin = new lib.Marker({ element: el('div', { class: 'pin', title: 'Drag to move the alert' }), draggable: true });
    amap.pin.on('drag', () => { const p = amap.pin.getLngLat(); placeAt(p.lat, p.lng); });
    amap.popup = new lib.Popup({ closeButton: false, closeOnClick: false, offset: 8 });

    let hovered = null;
    const unhover = () => { if (hovered !== null) m.setFeatureState({ source: 'zones', id: hovered }, { hover: false }); hovered = null; };
    m.on('mousemove', 'zones-fill', (e) => {
      // The smallest zone under the pointer is the one you'd expect to pick.
      const f = e.features.slice().sort(bySize)[0];
      const z = f && state.zones[f.properties.i];
      if (!z) return;
      m.getCanvas().style.cursor = 'pointer';
      if (hovered !== f.id) { unhover(); hovered = f.id; m.setFeatureState({ source: 'zones', id: hovered }, { hover: true }); }
      amap.popup.setLngLat(e.lngLat).setDOMContent(el('div', null, [
        el('b', { text: z.name || 'Unnamed zone' }), el('br'),
        el('span', { text: ownerName(z) + ' · ' + z.radiusKm + ' km' }), el('br'),
        el('span', { class: 'muted', text: 'Click to target this zone' }),
      ])).addTo(m);
    });
    m.on('mouseleave', 'zones-fill', () => { m.getCanvas().style.cursor = ''; unhover(); amap.popup.remove(); });
    m.on('click', (e) => {
      const f = m.queryRenderedFeatures(e.point, { layers: ['zones-fill'] }).sort(bySize)[0];
      if (f && state.zones[f.properties.i]) useZone(state.zones[f.properties.i], false);
      else placeAt(e.lngLat.lat, e.lngLat.lng);
    });
    m.on('load', () => {
      amap.ready = true;
      setBasemap();
      syncMap(amap.fitPending);
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', setBasemap);
  }).catch(() => {
    amap.loading = null;
    mapHint('The map could not load. Enter the coordinates below instead.', true);
  });
}

async function cancelAlert(b, btn) {
  if (!confirm('Cancel "' + b.title + '"? Phones stop showing it at their next check.')) return;
  btn.disabled = true;
  try { await call('POST', '/admin/api/broadcasts/' + encodeURIComponent(b.id) + '/cancel'); toast('Cancelled.'); loadAlerts(); }
  catch (e) { btn.disabled = false; toast(e.message); }
}

// ---- Users ----
function zoneRow(z, owner) {
  return el('li', { class: 'zone' }, [
    el('span', { class: 'ring' }),
    el('b', { text: z.name || 'Unnamed zone' }),
    mapLink(z.lat, z.lon, 11, 3),
    el('span', { class: 'muted num', text: z.radiusKm + ' km' }),
    z.createdAt ? el('span', { class: 'muted', text: 'added ' + day(z.createdAt) }) : null,
    el('button', { class: 'small', text: 'Alert this zone', onclick: () => alertAt({ lat: z.lat, lon: z.lon, radiusKm: z.radiusKm, zone: z.name, owner }) }),
  ]);
}

function renderUser(u) {
  const pro = u.plan === 'pro';
  const ph = u.phone;
  const loc = ph && ph.lastLocation;
  const zones = u.zones || [];
  const initial = (u.name || u.email || '?').trim().charAt(0).toUpperCase();
  return el('li', { class: 'card user-item' }, [
    el('div', { class: 'user-head' }, [
      el('div', { class: 'avatar', text: initial, 'aria-hidden': 'true' }),
      el('div', { class: 'who' }, [
        el('b', { text: u.email }),
        el('span', { class: 'muted', text: (u.name ? u.name + ' · ' : '') + 'joined ' + day(u.createdAt) }),
      ]),
      el('span', { class: 'badge ' + (pro ? 'pro' : ''), text: pro ? 'Pro' : 'Free' }),
      el('button', { class: 'small', text: pro ? 'Set to Free' : 'Give Pro', onclick: (e) => setPlan(u, pro ? 'free' : 'pro', e.target) }),
    ]),
    el('div', { class: 'facts' }, ph ? [
      loc ? el('span', null, [document.createTextNode('Last location '), mapLink(loc.lat, loc.lon, 12, 3, ' (' + when(loc.at) + ')')])
        : el('span', { text: 'No location shared' }),
      el('span', { text: 'Push ' + (ph.push ? 'on' : 'off') }),
      el('span', { text: 'Phone seen ' + when(ph.seenAt) }),
    ] : [el('span', { text: 'Instant alerts not turned on' })]),
    zones.length
      ? el('details', { class: 'zones', open: '' }, [
          el('summary', null, [
            document.createTextNode('Alert zones (' + zones.length + ')'),
            u.zonesSaved ? null : el('span', { class: 'muted', text: ' · from their phone' }),
          ]),
          el('ul', { class: 'zone-list' }, zones.map((z) => zoneRow(z, u.email))),
        ])
      : el('div', { class: 'facts' }, [el('span', { text: 'No alert zones' })]),
  ]);
}

function renderUsers() {
  const f = $('u-filter').value;
  const shown = state.users.filter((u) => !f || (f === 'zones' ? (u.zones || []).length > 0 : u.plan === 'pro'));
  $('users').replaceChildren(...shown.map(renderUser));
  $('users-empty').hidden = shown.length > 0;
  return shown.length;
}

let userTimer;
async function loadUsers() {
  try {
    const { users, total } = await call('GET', '/admin/api/users?q=' + encodeURIComponent($('u-q').value));
    state.users = users;
    const shown = renderUsers();
    if (!$('u-q').value) setCount('users', total);
    $('u-total').textContent = total + ' account(s)' + (total > users.length || shown < users.length ? ', showing ' + shown : '');
  } catch (e) { quiet(e); }
}

async function setPlan(u, plan, btn) {
  btn.disabled = true;
  try {
    const { user } = await call('POST', '/admin/api/users/plan', { email: u.email, plan });
    toast(user.email + ' is now ' + (user.plan === 'pro' ? 'Pro' : 'Free') + '.');
    loadUsers();
  } catch (e) { btn.disabled = false; toast(e.message); }
}

function showUser(email) {
  $('u-q').value = email;
  $('u-filter').value = '';
  go('users');
}

// ---- Zones ----
function ownerCell(z) {
  const o = z.owner;
  if (o.kind === 'guest') {
    return el('div', { class: 'owner' }, [
      el('span', { class: 'muted', text: 'Guest phone' }),
      el('button', { class: 'linkish', title: 'Reports from this phone', text: o.device, onclick: () => filterDevice(o.device) }),
    ]);
  }
  if (!o.email) return el('div', { class: 'owner' }, [el('span', { class: 'muted', text: 'Deleted account' })]);
  return el('div', { class: 'owner' }, [
    el('button', { class: 'linkish', title: 'Open this user', text: o.email, onclick: () => showUser(o.email) }),
    el('span', { class: 'muted', text: (o.plan === 'pro' ? 'Pro' : 'Free') + (z.source === 'phone' ? ' · from their phone' : '') }),
  ]);
}

function renderZones() {
  const q = $('z-q').value.trim().toLowerCase();
  const kind = $('z-owner').value;
  const shown = state.zones.filter((z) => (!kind || z.owner.kind === kind) &&
    (!q || (z.name || '').toLowerCase().includes(q) || (z.owner.email || '').toLowerCase().includes(q)));
  $('zones').replaceChildren(...shown.map((z) => el('tr', null, [
    el('td', { 'data-label': 'Zone' }, [el('span', { class: 'zname' }, [el('span', { class: 'ring' }), el('span', { text: z.name || 'Unnamed zone' })])]),
    el('td', { 'data-label': 'Owner' }, [ownerCell(z)]),
    el('td', { 'data-label': 'Center', class: 'num' }, [mapLink(z.lat, z.lon, 11, 3)]),
    el('td', { 'data-label': 'Radius', class: 'num', text: z.radiusKm + ' km' }),
    el('td', { 'data-label': 'Updated', class: 'muted', text: day(z.createdAt || z.updatedAt) }),
    el('td', null, [el('button', { class: 'small', text: 'Alert this zone',
      onclick: () => alertAt({ lat: z.lat, lon: z.lon, radiusKm: z.radiusKm, zone: z.name, owner: z.owner.email || (z.owner.kind === 'guest' ? 'a guest phone' : '') }) })]),
  ])));
  $('zones-wrap').hidden = shown.length === 0;
  $('zones-empty').hidden = shown.length > 0;
  $('z-total').textContent = shown.length === state.zones.length ? state.zones.length + ' zone(s)' : shown.length + ' of ' + state.zones.length + ' zone(s)';
}

async function loadZones() {
  try {
    const { zones, phones } = await call('GET', '/admin/api/zones');
    state.zones = zones;
    setCount('zones', zones.length);
    const owners = new Set(zones.map((z) => z.owner.kind === 'user' ? 'u:' + z.owner.email : 'g:' + z.owner.device));
    const tiles = [
      [zones.length, 'alert zones'],
      [zones.filter((z) => z.owner.kind === 'user').length, 'on accounts'],
      [zones.filter((z) => z.owner.kind === 'guest').length, 'on guest phones'],
      [owners.size, 'people watching'],
      [phones.withPush, 'phones with push'],
    ];
    $('z-stats').replaceChildren(...tiles.map(([n, label]) =>
      el('div', { class: 'card stat' }, [el('b', { text: String(n) }), el('span', { text: label })])));
    renderZones();
  } catch (e) { quiet(e); }
}

// ---- Start ----
async function start() {
  let session;
  try { session = await call('GET', '/admin/api/session'); } catch (e) { toast(e.message); return; }
  for (const l of session.labels) $('f-label').append(el('option', { value: l, text: LABEL_NAMES[l] || l }));
  if (!session.configured) {
    $('login-form').hidden = true;
    $('not-configured').hidden = false;
    show('login');
    return;
  }
  if (session.signedIn) enter(); else show('login');
}

function enter() {
  show('app');
  route();
  loadCounts();
}

document.addEventListener('DOMContentLoaded', () => {
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('login-error').textContent = '';
    $('login-btn').disabled = true;
    try {
      await call('POST', '/admin/login', { password: $('password').value });
      $('password').value = '';
      enter();
    } catch (err) {
      $('login-error').textContent = err.message;
    } finally {
      $('login-btn').disabled = false;
    }
  });
  $('logout').addEventListener('click', async () => {
    try { await call('POST', '/admin/logout'); } catch {}
    show('login');
  });
  for (const b of document.querySelectorAll('[data-theme-choice]')) b.addEventListener('click', () => setTheme(b.dataset.themeChoice));
  applyTheme(savedTheme());
  window.addEventListener('hashchange', route);
  $('menu').addEventListener('click', () => openSide(!$('side').classList.contains('open')));
  $('scrim').addEventListener('click', () => openSide(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openSide(false); });
  $('reload').addEventListener('click', () => load(state.page));
  $('link-copy').addEventListener('click', () => copy($('link-url').value, 'Link'));
  $('link-copy-message').addEventListener('click', () => copy($('link-message').value, 'Message'));
  $('f-status').addEventListener('change', (e) => { state.status = e.target.value; refreshReports(); });
  $('f-label').addEventListener('change', (e) => { state.label = e.target.value; refreshReports(); });
  $('more').addEventListener('click', () => loadList(false).catch(quiet));
  $('alert-form').addEventListener('submit', sendAlert);
  for (const id of ['a-lat', 'a-lon']) {
    $(id).addEventListener('input', () => { $('a-target').hidden = true; $('a-zone').value = ''; updateMapLink(); syncMap(false); });
    $(id).addEventListener('change', () => syncMap(true));
  }
  for (const id of ['a-radius', 'a-radius-range']) $(id).addEventListener('input', (e) => { syncRadius(e.target); syncMap(false); });
  $('a-level').addEventListener('change', () => syncMap(false));
  $('a-zone').addEventListener('change', (e) => { const z = state.zones[Number(e.target.value)]; if (e.target.value !== '' && z) useZone(z, true); });
  $('u-q').addEventListener('input', () => { clearTimeout(userTimer); userTimer = setTimeout(loadUsers, 250); });
  $('u-filter').addEventListener('change', loadUsers);
  $('z-q').addEventListener('input', renderZones);
  $('z-owner').addEventListener('change', renderZones);
  updateMapLink();
  start();
});
`;
