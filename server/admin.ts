// Moderation for ground reports: a password-protected page at /admin where
// reports can be looked at, hidden from phones, or deleted.
//
// Auth: one password (ADMIN_PASSWORD). Logging in sets a signed, HttpOnly,
// SameSite=Strict session cookie for 12 hours. Changing the password ends all
// sessions. Every state-changing request must also carry `X-Admin: 1`, which a
// cross-site form cannot send. Lives outside /api/v1, so the API's open CORS
// does not apply here.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { ADMIN_CSS, ADMIN_HTML, ADMIN_JS } from './admin-page.ts';
import { createRateLimit } from './ratelimit.ts';
import { deviceTag, LABELS, type ReportStore } from './reports.ts';
import { normalizeEmail, PLANS, type AccountStore, type Plan } from './accounts.ts';
import type { DeviceStore } from './devices.ts';
import type { Push } from './push.ts';
import { ORG_ROLES, type OrgRole, type OrgStore } from './orgs.ts';
import { BROADCAST_LEVELS, MAX_HOURS, MAX_MESSAGE, MAX_RADIUS_KM, MAX_TITLE, deliver, type BroadcastLevel, type BroadcastStore } from './broadcasts.ts';

const COOKIE = 'firesight_admin';
const SESSION_MS = 12 * 3_600_000;

export interface AdminOptions {
  /** Empty or missing turns the admin off (the page says so). */
  password?: string;
  reports?: ReportStore;
  /** User accounts: the Users tab sets plans. */
  accounts?: AccountStore;
  /** Zone alerts sent to phones. */
  broadcasts?: BroadcastStore;
  /** Phones registered for instant alerts, and the push sender. */
  devices?: DeviceStore;
  push?: Push;
  /** Organizations: the Organizations page verifies them. */
  orgs?: OrgStore;
  /** Who is asking, for the login limiter. */
  clientKey: (c: Context) => string;
  now?: () => number;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest();

function sameSecret(a: string, b: string) {
  return timingSafeEqual(sha256(a), sha256(b));
}

export function createAdmin({ password = '', reports, accounts, broadcasts, devices, push, orgs, clientKey, now = Date.now }: AdminOptions) {
  const app = new Hono();
  const configured = password.length > 0;
  const key = sha256(`firesight-admin-session:${password}`);
  const sign = (exp: number) => createHmac('sha256', key).update(`admin:${exp}`).digest('base64url');
  const loginLimiter = createRateLimit({ limit: 10, windowMs: 15 * 60_000, now });

  function signedIn(c: Context): boolean {
    if (!configured) return false;
    const value = getCookie(c, COOKIE);
    if (!value) return false;
    const [expText, mac] = value.split('.');
    const exp = Number(expText);
    if (!Number.isFinite(exp) || exp < now() || !mac) return false;
    const want = Buffer.from(sign(exp));
    const got = Buffer.from(mac);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  const secure = (c: Context) =>
    c.req.header('x-forwarded-proto') === 'https' || new URL(c.req.url).protocol === 'https:';

  const fail = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 429 | 503, code: string, message: string) =>
    c.json({ error: { code, message } }, status);

  // Security headers for everything under /admin.
  app.use('*', async (c, next) => {
    await next();
    if (c.req.path !== '/admin' && !c.req.path.startsWith('/admin/')) return;
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
    c.header('X-Frame-Options', 'DENY');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Content-Security-Policy',
      "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  });

  app.get('/admin', (c) => c.html(ADMIN_HTML));
  app.get('/admin/', (c) => c.redirect('/admin'));
  app.get('/admin/app.js', (c) => c.body(ADMIN_JS, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }));
  app.get('/admin/app.css', (c) => c.body(ADMIN_CSS, 200, { 'Content-Type': 'text/css; charset=utf-8' }));

  app.get('/admin/api/session', (c) => c.json({
    configured,
    signedIn: signedIn(c),
    labels: LABELS,
    levels: BROADCAST_LEVELS,
    features: { reports: !!reports, accounts: !!accounts, broadcasts: !!broadcasts, zones: !!devices, orgs: !!orgs, push: !!push?.available },
  }));

  // State-changing requests must say they come from the page.
  app.use('/admin/*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('x-admin') !== '1') {
      return fail(c, 403, 'forbidden', 'Missing X-Admin header.');
    }
    await next();
  });

  app.post('/admin/login', async (c) => {
    if (!configured) return fail(c, 503, 'not_configured', 'Set ADMIN_PASSWORD on the server to use the admin page.');
    const wait = loginLimiter.take(clientKey(c));
    if (wait > 0) {
      c.header('Retry-After', String(wait));
      return fail(c, 429, 'rate_limited', `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.`);
    }
    let body: { password?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return fail(c, 400, 'bad_body', 'Send JSON with a password.');
    }
    if (typeof body.password !== 'string' || !sameSecret(body.password, password)) {
      await new Promise((r) => setTimeout(r, 400));
      return fail(c, 401, 'wrong_password', 'Wrong password.');
    }
    const exp = now() + SESSION_MS;
    setCookie(c, COOKIE, `${exp}.${sign(exp)}`, {
      httpOnly: true,
      secure: secure(c),
      sameSite: 'Strict',
      path: '/admin',
      maxAge: SESSION_MS / 1000,
    });
    return c.json({ signedIn: true, expiresAt: new Date(exp).toISOString() });
  });

  app.post('/admin/logout', (c) => {
    deleteCookie(c, COOKIE, { path: '/admin', secure: secure(c) });
    return c.json({ signedIn: false });
  });

  // Everything below needs a session.
  app.use('/admin/api/*', async (c, next) => {
    if (!signedIn(c)) return fail(c, 401, 'signed_out', 'Sign in first.');
    const p = c.req.path;
    if (!reports && /^\/admin\/api\/(stats|reports|devices)/.test(p)) {
      return fail(c, 503, 'reports_unavailable', 'Reports are not enabled on this server.');
    }
    if (!accounts && p.startsWith('/admin/api/users')) return fail(c, 503, 'accounts_unavailable', 'Accounts are not enabled.');
    if (!broadcasts && p.startsWith('/admin/api/broadcasts')) return fail(c, 503, 'broadcasts_unavailable', 'Zone alerts are not enabled.');
    await next();
  });

  app.get('/admin/api/stats', (c) => c.json(reports!.stats(now())));

  app.get('/admin/api/reports', (c) => {
    const q = c.req.query();
    const status = q.status === 'visible' || q.status === 'hidden' ? q.status : 'all';
    const device = q.device && /^[0-9a-f]{4,64}$/.test(q.device) ? q.device : undefined;
    const label = q.label && (LABELS as readonly string[]).includes(q.label) ? q.label : undefined;
    const before = q.before && !Number.isNaN(Date.parse(q.before)) ? new Date(q.before).toISOString() : undefined;
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const list = reports!.adminList({ status, device, label, before, limit });
    return c.json({ reports: list, more: list.length === limit });
  });

  app.get('/admin/api/reports/:id/photo', async (c) => {
    const photo = await reports!.photo(c.req.param('id'), { includeHidden: true });
    if (!photo) return fail(c, 404, 'not_found', 'No photo.');
    return c.body(photo.bytes, 200, { 'Content-Type': photo.type, 'Cache-Control': 'private, max-age=3600' });
  });

  async function hiddenFlag(c: Context): Promise<boolean | null> {
    try {
      const body = await c.req.json();
      return typeof body.hidden === 'boolean' ? body.hidden : null;
    } catch {
      return null;
    }
  }

  app.post('/admin/api/reports/:id/hidden', async (c) => {
    const hidden = await hiddenFlag(c);
    if (hidden === null) return fail(c, 400, 'bad_body', 'Send {"hidden": true|false}.');
    const id = c.req.param('id');
    if (reports!.setHidden({ id }, hidden) === 0) return fail(c, 404, 'not_found', 'No such report.');
    return c.json({ report: reports!.adminGet(id) });
  });

  app.post('/admin/api/devices/:device/hidden', async (c) => {
    const hidden = await hiddenFlag(c);
    const device = c.req.param('device');
    if (hidden === null || !/^[0-9a-f]{4,64}$/.test(device)) return fail(c, 400, 'bad_body', 'Send {"hidden": true|false}.');
    return c.json({ changed: reports!.setHidden({ device }, hidden) });
  });

  app.delete('/admin/api/reports/:id', async (c) => {
    if (!(await reports!.adminRemove(c.req.param('id')))) return fail(c, 404, 'not_found', 'No such report.');
    return c.json({ deleted: true });
  });

  // ---- Users: find an account, change its plan ----
  app.get('/admin/api/users', (c) => {
    const q = (c.req.query('q') ?? '').slice(0, 100);
    const found = accounts!.search(q, 50);
    // Each user's most recent phone: its last location and zones.
    const phones = devices?.latestByUser(found.users.map((u) => u.id)) ?? new Map();
    return c.json({
      total: found.total,
      users: found.users.map((u) => {
        const d = phones.get(u.id);
        // The zones saved to the account (or, until the app saves them, its newest phone's).
        const z = devices?.accountZones(u.id) ?? { zones: [], updatedAt: null };
        return {
          ...u,
          zones: z.zones,
          zonesSaved: z.updatedAt !== null,
          phone: d ? { lastLocation: d.location, zones: d.zones.length, push: d.token !== null, seenAt: d.updatedAt } : null,
        };
      }),
    });
  });

  // ---- Zones: every alert zone, with who it belongs to ----
  app.get('/admin/api/zones', (c) => {
    if (!devices) return fail(c, 503, 'devices_unavailable', 'Instant alerts are not enabled on this server.');
    const groups = devices.allZones();
    const users = accounts?.byIds(groups.flatMap((g) => (g.userId ? [g.userId] : []))) ?? new Map();
    const zones = groups.flatMap((g) => {
      const u = g.userId ? users.get(g.userId) : undefined;
      const owner = u
        ? { kind: 'user' as const, email: u.email, name: u.name, plan: u.plan }
        : g.userId
          ? { kind: 'user' as const, email: null, name: '', plan: 'free' as const }
          : { kind: 'guest' as const, device: deviceTag(g.installationId!) };
      return g.zones.map((z) => ({ ...z, owner, source: g.source, updatedAt: g.updatedAt }));
    });
    return c.json({ zones, phones: devices.stats() });
  });

  app.post('/admin/api/users/plan', async (c) => {
    let body: { email?: unknown; plan?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return fail(c, 400, 'bad_body', 'Send {"email", "plan"}.');
    }
    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : null;
    if (!email) return fail(c, 400, 'bad_email', 'Enter a valid email address.');
    if (!(PLANS as readonly unknown[]).includes(body.plan)) return fail(c, 400, 'bad_plan', `plan must be ${PLANS.join(' or ')}.`);
    const user = accounts!.setPlan(email, body.plan as Plan);
    if (!user) return fail(c, 404, 'not_found', 'No account with this email. The person must sign up in the app first.');
    return c.json({ user });
  });

  // ---- Zone alerts: a message for phones whose zone overlaps a circle ----
  app.get('/admin/api/broadcasts', (c) => c.json({
    broadcasts: broadcasts!.recent(50),
    now: new Date(now()).toISOString(),
    phones: devices?.stats() ?? null,
    push: !!push?.available,
  }));

  app.post('/admin/api/broadcasts', async (c) => {
    let b: Record<string, unknown>;
    try {
      b = await c.req.json();
    } catch {
      return fail(c, 400, 'bad_body', 'Send JSON.');
    }
    const text = (k: string, max: number, required: boolean) => {
      const v = typeof b[k] === 'string' ? (b[k] as string).trim() : '';
      if ((required && !v) || v.length > max) return null;
      return v;
    };
    const num = (k: string, min: number, max: number) => {
      const v = Number(b[k]);
      return Number.isFinite(v) && v >= min && v <= max ? v : null;
    };
    const title = text('title', MAX_TITLE, true);
    const message = text('message', MAX_MESSAGE, true);
    const titleAr = text('titleAr', MAX_TITLE, false);
    const messageAr = text('messageAr', MAX_MESSAGE, false);
    if (title === null || message === null || titleAr === null || messageAr === null) {
      return fail(c, 400, 'bad_text', `A title (up to ${MAX_TITLE} characters) and a message (up to ${MAX_MESSAGE}) are required.`);
    }
    const level = b.level as BroadcastLevel;
    if (!BROADCAST_LEVELS.includes(level)) return fail(c, 400, 'bad_level', `level must be ${BROADCAST_LEVELS.join(', ')}.`);
    const lat = num('lat', -90, 90);
    const lon = num('lon', -180, 180);
    const radiusKm = num('radiusKm', 0.5, MAX_RADIUS_KM);
    const hours = num('hours', 1, MAX_HOURS);
    if (lat === null || lon === null) return fail(c, 400, 'bad_place', 'Latitude and longitude must be decimal degrees.');
    if (radiusKm === null) return fail(c, 400, 'bad_radius', `The radius must be 0.5 to ${MAX_RADIUS_KM} km.`);
    if (hours === null) return fail(c, 400, 'bad_hours', `It can stay active 1 to ${MAX_HOURS} hours.`);
    let sent = broadcasts!.add({ title, message, titleAr, messageAr, level, lat, lon, radiusKm, hours });
    // Instant: push to every phone whose zone overlaps the circle or whose last location is inside.
    if (devices) sent = await deliver(sent, devices.recipients({ lat, lon, radiusKm }), { broadcasts: broadcasts!, devices, push });
    return c.json({ broadcast: sent }, 201);
  });

  // ---- Organizations: who they are, and whether they may alert the public ----
  app.get('/admin/api/orgs', (c) => {
    if (!orgs) return fail(c, 503, 'orgs_unavailable', 'Organizations are not enabled on this server.');
    const list = orgs.all(500);
    const owners = accounts?.byIds(list.flatMap((o) => (o.ownerId ? [o.ownerId] : []))) ?? new Map();
    return c.json({
      orgs: list.map(({ ownerId, ...o }) => ({ ...o, owner: ownerId ? owners.get(ownerId)?.email ?? null : null })),
    });
  });

  app.post('/admin/api/orgs/:id/verified', async (c) => {
    if (!orgs) return fail(c, 503, 'orgs_unavailable', 'Organizations are not enabled on this server.');
    let body: { verified?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return fail(c, 400, 'bad_body', 'Send {"verified": true|false}.');
    }
    if (typeof body.verified !== 'boolean') return fail(c, 400, 'bad_body', 'Send {"verified": true|false}.');
    const org = orgs.setVerified(c.req.param('id'), body.verified);
    if (!org) return fail(c, 404, 'not_found', 'No such organization.');
    return c.json({ org });
  });

  /** A JSON object body, or null. */
  const objectBody = async (c: Context): Promise<Record<string, unknown> | null> => {
    try {
      const b = await c.req.json();
      return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  // A one-time link for an existing organization: a lost link, a new owner, a new member.
  app.post('/admin/api/orgs/:id/invite', async (c) => {
    if (!orgs) return fail(c, 503, 'orgs_unavailable', 'Organizations are not enabled on this server.');
    const org = orgs.get(c.req.param('id'));
    if (!org) return fail(c, 404, 'not_found', 'No such organization.');
    const b = await objectBody(c);
    const email = typeof b?.email === 'string' ? normalizeEmail(b.email) : null;
    if (!email) return fail(c, 400, 'bad_email', 'Enter a valid email address.');
    const role = (b?.role ?? 'owner') as OrgRole;
    if (!ORG_ROLES.includes(role)) return fail(c, 400, 'bad_role', 'role must be owner or member.');
    const { invite, token } = orgs.createInvite({ orgId: org.id, email, role });
    return c.json({ invite, path: `/org/invite/${token}` }, 201);
  });

  // ---- Requests for access: approve one to create the organization and its owner's link ----
  app.get('/admin/api/org-requests', (c) => {
    if (!orgs) return fail(c, 503, 'orgs_unavailable', 'Organizations are not enabled on this server.');
    return c.json({ requests: orgs.requests(500) });
  });

  app.post('/admin/api/org-requests/:id/approve', async (c) => {
    if (!orgs) return fail(c, 503, 'orgs_unavailable', 'Organizations are not enabled on this server.');
    const request = orgs.getRequest(c.req.param('id'));
    if (!request) return fail(c, 404, 'not_found', 'No such request.');
    if (request.status !== 'pending') return fail(c, 409, 'already_decided', `This request was already ${request.status}.`);
    const b = await objectBody(c);
    const org = orgs.create({ name: request.orgName, kind: request.kind, country: request.country, verified: b?.verified === true });
    const { invite, token } = orgs.createInvite({ orgId: org.id, email: request.email, role: 'owner' });
    return c.json({ request: orgs.decideRequest(request.id, 'approved', org.id), org, invite, path: `/org/invite/${token}` }, 201);
  });

  app.post('/admin/api/org-requests/:id/decline', (c) => {
    if (!orgs) return fail(c, 503, 'orgs_unavailable', 'Organizations are not enabled on this server.');
    const request = orgs.getRequest(c.req.param('id'));
    if (!request) return fail(c, 404, 'not_found', 'No such request.');
    if (request.status !== 'pending') return fail(c, 409, 'already_decided', `This request was already ${request.status}.`);
    return c.json({ request: orgs.decideRequest(request.id, 'declined') });
  });

  app.post('/admin/api/broadcasts/:id/cancel', (c) => {
    const b = broadcasts!.cancel(c.req.param('id'));
    if (!b) return fail(c, 404, 'not_found', 'No such alert.');
    return c.json({ broadcast: b });
  });

  return app;
}
