// The /admin page: sign-in, then tabs for report moderation, zone alerts
// sent to phones, and user plans. Plain HTML, CSS
// and JS served by the API (no build step). User text is only ever set with
// textContent, never as HTML.

export const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Firesight admin</title>
<link rel="icon" href="/favicon.svg">
<link rel="stylesheet" href="/admin/app.css">
<script src="/admin/app.js" defer></script>
</head>
<body>
<header class="top">
  <div class="brand"><span class="dot"></span>Firesight <span class="muted">admin</span></div>
  <nav id="tabs" class="tabs" hidden>
    <button data-tab="reports" class="tab on">Reports</button>
    <button data-tab="alerts" class="tab">Zone alerts</button>
    <button data-tab="users" class="tab">Users</button>
  </nav>
  <button id="logout" class="ghost" hidden>Sign out</button>
</header>

<main>
  <section id="loading" class="center"><p class="muted">Loading…</p></section>

  <section id="login" class="center" hidden>
    <form id="login-form" class="card login" autocomplete="on">
      <h1>Sign in</h1>
      <p class="muted">Moderate ground reports sent from the phone app.</p>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
      <button type="submit" class="primary" id="login-btn">Sign in</button>
      <p id="login-error" class="error" role="alert"></p>
    </form>
    <div id="not-configured" class="card login" hidden>
      <h1>Admin is off</h1>
      <p class="muted">Set <code>ADMIN_PASSWORD</code> in the server's environment and redeploy.</p>
    </div>
  </section>

  <section id="dash" hidden>
   <div id="tab-reports">
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
      <button id="refresh" class="ghost">Refresh</button>
    </div>

    <p id="list-empty" class="muted center-text" hidden>No reports match.</p>
    <ul id="list" class="list"></ul>
    <div class="center-text"><button id="more" class="ghost" hidden>Load more</button></div>
   </div>

   <div id="tab-alerts" hidden>
    <form id="alert-form" class="card form">
      <h2>Send a zone alert</h2>
      <p class="muted">Phones whose alert zone overlaps this circle, or that are inside it, get a notification at their next check (within minutes when the app is open, up to 3 hours in the background).</p>
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
        <a id="a-map" target="_blank" rel="noopener noreferrer" class="muted">Check the place on a map</a>
        <button type="submit" class="primary" id="a-send">Send alert</button>
      </div>
      <p id="a-error" class="error" role="alert"></p>
    </form>
    <h2 class="h2">Recent alerts</h2>
    <p id="alerts-empty" class="muted" hidden>No alerts sent yet.</p>
    <ul id="alerts" class="list"></ul>
   </div>

   <div id="tab-users" hidden>
    <div class="filters card">
      <label>Find by email<input id="u-q" type="search" placeholder="name@example.com"></label>
      <span id="u-total" class="muted"></span>
    </div>
    <ul id="users" class="list"></ul>
   </div>
  </section>
</main>

<div id="toast" class="toast" role="status" hidden></div>
<dialog id="viewer"><img id="viewer-img" alt="Report photo"><form method="dialog"><button class="ghost">Close</button></form></dialog>
</body>
</html>`;

export const ADMIN_CSS = `
:root {
  --bg: #f6f3ee; --surface: #ffffff; --ink: #1d1a16; --muted: #6b645a; --line: #e4ddd2;
  --accent: #c2410c; --accent-ink: #ffffff; --danger: #b91c1c; --ok: #15803d; --hidden-bg: #fbf4e9;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14110e; --surface: #1e1a16; --ink: #f1ebe2; --muted: #a39a8d; --line: #332c25;
    --accent: #f97316; --accent-ink: #1a0d03; --danger: #f87171; --ok: #4ade80; --hidden-bg: #2a2118;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Arabic", sans-serif; }
[hidden] { display: none !important; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .9em; }
.muted { color: var(--muted); }
.top { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px;
  border-bottom: 1px solid var(--line); background: var(--surface); position: sticky; top: 0; z-index: 2; }
.brand { font-weight: 650; letter-spacing: .2px; display: flex; align-items: center; gap: 8px; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 20%, transparent); }
main { max-width: 980px; margin: 0 auto; padding: 20px 16px 60px; }
.center { min-height: 60vh; display: grid; place-items: center; }
.center-text { text-align: center; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; }
.login { width: min(380px, 100%); padding: 28px; display: grid; gap: 10px; }
.login h1 { margin: 0; font-size: 22px; }
.login p { margin: 0 0 8px; }
label { font-size: 13px; color: var(--muted); display: grid; gap: 4px; }
input, select { font: inherit; color: var(--ink); background: var(--bg); border: 1px solid var(--line);
  border-radius: 8px; padding: 9px 11px; min-height: 40px; }
input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button { font: inherit; border-radius: 8px; padding: 8px 14px; min-height: 38px; cursor: pointer; border: 1px solid var(--line); background: var(--surface); color: var(--ink); }
button:disabled { opacity: .55; cursor: default; }
.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 600; }
.ghost { background: transparent; }
.danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, var(--line)); }
.error { color: var(--danger); min-height: 1.2em; margin: 0; font-size: 14px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 14px; }
.stat { padding: 12px 14px; }
.stat b { display: block; font-size: 24px; font-variant-numeric: tabular-nums; }
.stat span { font-size: 12.5px; color: var(--muted); }
.filters { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; padding: 12px 14px; margin-bottom: 14px; }
.filters #refresh { margin-left: auto; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px;
  background: var(--hidden-bg); border: 1px solid var(--line); font-size: 13px; }
.chip button { min-height: 0; padding: 0 4px; border: 0; background: none; color: var(--muted); }
.list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.item { display: grid; grid-template-columns: 112px 1fr; gap: 14px; padding: 12px; }
.item.is-hidden { background: var(--hidden-bg); }
.thumb { width: 112px; height: 112px; border-radius: 8px; object-fit: cover; background: var(--bg);
  border: 1px solid var(--line); display: grid; place-items: center; color: var(--muted); font-size: 12px; cursor: zoom-in; padding: 0; }
.thumb.empty { cursor: default; }
.thumb img { width: 100%; height: 100%; object-fit: cover; border-radius: 7px; }
.meta { min-width: 0; display: grid; gap: 6px; align-content: start; }
.row { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font-size: 13.5px; }
.badge { font-size: 12px; font-weight: 650; padding: 2px 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); }
.badge.wildfire, .badge.smoke { color: var(--accent); }
.badge.hidden { color: var(--danger); }
.note { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.note.empty { color: var(--muted); font-style: italic; }
a { color: var(--accent); }
.linkish { border: 0; background: none; padding: 0; min-height: 0; color: var(--accent); text-decoration: underline; font-size: 13.5px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); background: var(--ink); color: var(--bg);
  padding: 10px 16px; border-radius: 8px; font-size: 14px; max-width: calc(100% - 32px); }
dialog { border: 0; border-radius: 12px; padding: 12px; background: var(--surface); color: var(--ink); max-width: min(92vw, 1100px); }
dialog::backdrop { background: rgb(0 0 0 / .7); }
dialog img { display: block; max-width: 100%; max-height: 80vh; border-radius: 8px; }
dialog form { text-align: right; margin-top: 8px; }
.tabs { display: flex; gap: 4px; margin: 0 auto 0 24px; }
.tab { border: 0; background: none; color: var(--muted); font-weight: 600; }
.tab.on { color: var(--ink); background: var(--bg); }
.form { padding: 18px; display: grid; gap: 12px; margin-bottom: 18px; }
.form h2, .h2 { margin: 0; font-size: 18px; }
.h2 { margin: 6px 0 10px; }
.form p { margin: 0; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
textarea { font: inherit; color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 9px 11px; resize: vertical; }
.form .row #a-send { margin-left: auto; }
.alert-item, .user-item { padding: 12px 14px; display: grid; gap: 6px; }
.alert-item.over { opacity: .6; }
.badge.danger { color: var(--danger); }
.badge.warning { color: var(--accent); }
.badge.pro { color: var(--ok); }
@media (max-width: 720px) {
  .grid2, .grid4 { grid-template-columns: 1fr 1fr; }
  .tabs { margin-left: 8px; }
}
@media (max-width: 560px) {
  .item { grid-template-columns: 76px 1fr; gap: 10px; }
  .thumb { width: 76px; height: 76px; }
  .filters #refresh { margin-left: 0; }
}
`;

export const ADMIN_JS = `
'use strict';
const $ = (id) => document.getElementById(id);
const LABEL_NAMES = { wildfire: 'Wildfire', smoke: 'Smoke', agriculturalBurn: 'Agricultural burn', industrial: 'Industrial', falseAlarm: 'False alarm', unsure: 'Unsure' };
const state = { status: 'all', label: '', device: '', before: null, photoUrls: [] };

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

function show(which) {
  $('loading').hidden = which !== 'loading';
  $('login').hidden = which !== 'login';
  $('dash').hidden = which !== 'dash';
  $('logout').hidden = which !== 'dash';
  $('tabs').hidden = which !== 'dash';
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
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children || []) if (c) e.append(c);
  return e;
}

const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

async function loadStats() {
  const s = await call('GET', '/admin/api/stats');
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

  const map = 'https://www.openstreetmap.org/?mlat=' + r.lat + '&mlon=' + r.lon + '#map=13/' + r.lat + '/' + r.lon;
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
        el('a', { href: map, target: '_blank', rel: 'noopener noreferrer', text: r.lat.toFixed(4) + ', ' + r.lon.toFixed(4) }),
        r.bearing != null ? el('span', { class: 'muted', text: 'pointing ' + Math.round(r.bearing) + '°' }) : null,
        r.hotspotSensor ? el('span', { class: 'muted', text: 'at hotspot ' + r.hotspotSensor }) : null,
        el('button', { class: 'linkish', title: 'Show only this phone', text: 'phone ' + r.device, onclick: () => filterDevice(r.device) }),
      ]),
      el('div', { class: 'actions' }, [
        el('button', { text: r.hidden ? 'Show to phones' : 'Hide', onclick: (e) => setHidden(r, !r.hidden, e.target) }),
        el('button', { class: 'danger', text: 'Delete', onclick: (e) => remove(r, e.target) }),
        el('button', { text: 'Send zone alert here', onclick: () => alertAt(r) }),
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

async function refresh() {
  try { await Promise.all([loadStats(), loadList(true)]); } catch (e) { if (e.message !== 'Signed out') toast(e.message); }
}

function filterDevice(device) {
  state.device = device;
  const chip = $('f-device');
  chip.replaceChildren(
    el('span', { text: 'Phone ' + device }),
    el('button', { class: 'linkish', text: 'Hide all its reports', onclick: () => hideDevice(device, true) }),
    el('button', { 'aria-label': 'Clear phone filter', text: '✕', onclick: () => { state.device = ''; chip.hidden = true; refresh(); } }),
  );
  chip.hidden = false;
  refresh();
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
    refresh();
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

// ---- Tabs ----
function openTab(name) {
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('on', b.dataset.tab === name);
  for (const t of ['reports', 'alerts', 'users']) $('tab-' + t).hidden = t !== name;
  if (name === 'alerts') loadAlerts();
  if (name === 'users') loadUsers();
}

// ---- Zone alerts ----
const LEVEL_NAMES = { danger: 'Danger', warning: 'Warning', info: 'Info' };

function alertAt(r) {
  $('a-lat').value = r.lat.toFixed(4);
  $('a-lon').value = r.lon.toFixed(4);
  if (!$('a-title').value) $('a-title').value = (LABEL_NAMES[r.label] || 'Fire') + ' reported nearby';
  updateMapLink();
  openTab('alerts');
  $('a-message').focus();
}

function updateMapLink() {
  const lat = Number($('a-lat').value), lon = Number($('a-lon').value);
  const ok = $('a-lat').value !== '' && $('a-lon').value !== '' && Number.isFinite(lat) && Number.isFinite(lon);
  $('a-map').hidden = !ok;
  if (ok) $('a-map').href = 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon + '#map=11/' + lat + '/' + lon;
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
      el('a', { href: 'https://www.openstreetmap.org/?mlat=' + b.lat + '&mlon=' + b.lon + '#map=11/' + b.lat + '/' + b.lon,
        target: '_blank', rel: 'noopener noreferrer', text: b.lat.toFixed(4) + ', ' + b.lon.toFixed(4) + ' · ' + b.radiusKm + ' km' }),
      el('span', { class: 'muted', text: 'sent ' + when(b.createdAt) }),
      over ? null : el('button', { class: 'danger', text: 'Cancel', onclick: (e) => cancelAlert(b, e.target) }),
    ]),
  ]);
}

async function loadAlerts() {
  try {
    const { broadcasts, now } = await call('GET', '/admin/api/broadcasts');
    $('alerts').replaceChildren(...broadcasts.map((b) => renderAlert(b, now)));
    $('alerts-empty').hidden = broadcasts.length > 0;
  } catch (e) { if (e.message !== 'Signed out') toast(e.message); }
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
    await call('POST', '/admin/api/broadcasts', body);
    for (const id of ['a-title', 'a-title-ar', 'a-message', 'a-message-ar']) $(id).value = '';
    toast('Alert sent.');
    loadAlerts();
  } catch (err) { $('a-error').textContent = err.message; }
  finally { $('a-send').disabled = false; }
}

async function cancelAlert(b, btn) {
  if (!confirm('Cancel "' + b.title + '"? Phones stop showing it at their next check.')) return;
  btn.disabled = true;
  try { await call('POST', '/admin/api/broadcasts/' + encodeURIComponent(b.id) + '/cancel'); toast('Cancelled.'); loadAlerts(); }
  catch (e) { btn.disabled = false; toast(e.message); }
}

// ---- Users ----
function renderUser(u) {
  const pro = u.plan === 'pro';
  return el('li', { class: 'card user-item' }, [
    el('div', { class: 'row' }, [
      el('b', { text: u.email }),
      u.name ? el('span', { class: 'muted', text: u.name }) : null,
      el('span', { class: 'badge ' + (pro ? 'pro' : ''), text: pro ? 'Pro' : 'Free' }),
      el('span', { class: 'muted', text: 'joined ' + when(u.createdAt) }),
      el('button', { text: pro ? 'Set to Free' : 'Give Pro', onclick: (e) => setPlan(u, pro ? 'free' : 'pro', e.target) }),
    ]),
  ]);
}

let userTimer;
async function loadUsers() {
  try {
    const { users, total } = await call('GET', '/admin/api/users?q=' + encodeURIComponent($('u-q').value));
    $('users').replaceChildren(...users.map(renderUser));
    $('u-total').textContent = total + ' account(s)' + (total > users.length ? ', showing ' + users.length : '');
  } catch (e) { if (e.message !== 'Signed out') toast(e.message); }
}

async function setPlan(u, plan, btn) {
  btn.disabled = true;
  try {
    const { user } = await call('POST', '/admin/api/users/plan', { email: u.email, plan });
    toast(user.email + ' is now ' + (user.plan === 'pro' ? 'Pro' : 'Free') + '.');
    loadUsers();
  } catch (e) { btn.disabled = false; toast(e.message); }
}

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
  if (session.signedIn) { show('dash'); refresh(); } else show('login');
}

document.addEventListener('DOMContentLoaded', () => {
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('login-error').textContent = '';
    $('login-btn').disabled = true;
    try {
      await call('POST', '/admin/login', { password: $('password').value });
      $('password').value = '';
      show('dash');
      refresh();
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
  $('f-status').addEventListener('change', (e) => { state.status = e.target.value; refresh(); });
  $('f-label').addEventListener('change', (e) => { state.label = e.target.value; refresh(); });
  $('refresh').addEventListener('click', refresh);
  $('more').addEventListener('click', () => loadList(false).catch((e) => toast(e.message)));
  for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => openTab(b.dataset.tab));
  $('alert-form').addEventListener('submit', sendAlert);
  $('a-lat').addEventListener('input', updateMapLink);
  $('a-lon').addEventListener('input', updateMapLink);
  $('u-q').addEventListener('input', () => { clearTimeout(userTimer); userTimer = setTimeout(loadUsers, 250); });
  updateMapLink();
  start();
});
`;
