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
import { LABELS, type ReportStore } from './reports.ts';

const COOKIE = 'firesight_admin';
const SESSION_MS = 12 * 3_600_000;

export interface AdminOptions {
  /** Empty or missing turns the admin off (the page says so). */
  password?: string;
  reports?: ReportStore;
  /** Who is asking, for the login limiter. */
  clientKey: (c: Context) => string;
  now?: () => number;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest();

function sameSecret(a: string, b: string) {
  return timingSafeEqual(sha256(a), sha256(b));
}

export function createAdmin({ password = '', reports, clientKey, now = Date.now }: AdminOptions) {
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

  const fail = (c: Context, status: 400 | 401 | 403 | 404 | 429 | 503, code: string, message: string) =>
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

  app.get('/admin/api/session', (c) => c.json({ configured, signedIn: signedIn(c), labels: LABELS }));

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
    if (!reports) return fail(c, 503, 'reports_unavailable', 'Reports are not enabled on this server.');
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

  return app;
}
