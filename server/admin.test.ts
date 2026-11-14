// The /admin moderation page: sign-in, sessions and what moderators can do.
import { describe, expect, it } from 'vitest';
import type { Service } from '../src/lib/service.ts';
import { createApp } from './app.ts';
import { createReportStore, type NewReport } from './reports.ts';

const PASSWORD = 'correct horse battery staple';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]);
// The admin routes never touch the fire record.
const noService = {} as Service;

function report(clientId: string, deviceId = 'phone-a'): NewReport {
  return {
    deviceId, clientId, lat: 33.9, lon: 35.7, createdAt: new Date().toISOString(), label: 'smoke',
    note: '<img src=x onerror=alert(1)>', bearing: 40, hotspotSensor: null, hotspotTime: null,
  };
}

async function setup(password = PASSWORD) {
  const reports = createReportStore(':memory:');
  const app = createApp({ service: noService, dataDir: '.', reports, adminPassword: password });
  const a = await reports.add(report('r-0001'), { bytes: JPEG, type: 'image/jpeg' });
  const b = await reports.add(report('r-0002'));
  const c = await reports.add(report('r-0003', 'phone-b'));
  return { app, reports, ids: [a.report.id, b.report.id, c.report.id] };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

async function login(app: App, password = PASSWORD) {
  const res = await app.request('https://cedx.test/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin': '1', 'X-Forwarded-For': '203.0.113.9' },
    body: JSON.stringify({ password }),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
  return { res, cookie };
}

const as = (cookie: string, extra: Record<string, string> = {}) => ({ headers: { Cookie: cookie, 'X-Admin': '1', ...extra } });

describe('admin', () => {
  it('serves the page with strict headers', async () => {
    const { app } = await setup();
    const res = await app.request('/admin');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Sign in');
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect((await app.request('/admin/app.js')).headers.get('content-type')).toContain('javascript');
  });

  it('signs in with the password only, with a secure HttpOnly cookie', async () => {
    const { app } = await setup();
    expect((await login(app, 'wrong')).res.status).toBe(401);
    const { res, cookie } = await login(app);
    expect(res.status).toBe(200);
    const set = res.headers.get('set-cookie')!;
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/Secure/i);
    expect(set).toMatch(/SameSite=Strict/i);
    expect(set).toMatch(/Path=\/admin/i);
    const session = await (await app.request('/admin/api/session', as(cookie))).json();
    expect(session).toMatchObject({ configured: true, signedIn: true });
  });

  it('refuses the moderation API without a valid session', async () => {
    const { app } = await setup();
    expect((await app.request('/admin/api/reports')).status).toBe(401);
    expect((await app.request('/admin/api/reports', as('firesight_admin=9999999999999.forged'))).status).toBe(401);
    // A session signed with another password does not work here.
    const other = await setup('another password');
    const { cookie } = await login(other.app, 'another password');
    expect((await app.request('/admin/api/reports', as(cookie))).status).toBe(401);
  });

  it('needs X-Admin on changes, so other sites cannot post forms', async () => {
    const { app, ids } = await setup();
    const { cookie } = await login(app);
    const res = await app.request(`/admin/api/reports/${ids[0]}`, { method: 'DELETE', headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
    const form = await app.request('/admin/login', { method: 'POST', body: new URLSearchParams({ password: PASSWORD }) });
    expect(form.status).toBe(403);
  });

  it('limits password guesses', async () => {
    const { app } = await setup();
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await login(app, `guess-${i}`)).res.status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('lists, hides, shows and deletes reports', async () => {
    const { app, ids } = await setup();
    const { cookie } = await login(app);

    const stats = await (await app.request('/admin/api/stats', as(cookie))).json();
    expect(stats).toMatchObject({ total: 3, hidden: 0, withPhoto: 1, last24h: 3, devices7d: 2 });

    const list = await (await app.request('/admin/api/reports', as(cookie))).json();
    expect(list.reports).toHaveLength(3);
    expect(list.reports[0].device).toMatch(/^[0-9a-f]{10}$/);
    expect(JSON.stringify(list)).not.toContain('phone-a');

    // Hide one: phones stop receiving it, moderators still see it and its photo.
    const hide = await app.request(`/admin/api/reports/${ids[0]}/hidden`, {
      method: 'POST', ...as(cookie, { 'Content-Type': 'application/json' }), body: JSON.stringify({ hidden: true }),
    });
    expect((await hide.json()).report.hidden).toBe(true);
    const publicList = await (await app.request('/api/v1/reports')).json();
    expect(publicList.reports.map((r: { id: string }) => r.id)).not.toContain(ids[0]);
    expect((await app.request(`/api/v1/reports/${ids[0]}`)).status).toBe(404);
    expect((await app.request(`/api/v1/reports/${ids[0]}/photo`)).status).toBe(404);
    expect((await app.request(`/admin/api/reports/${ids[0]}/photo`, as(cookie))).status).toBe(200);
    const hidden = await (await app.request('/admin/api/reports?status=hidden', as(cookie))).json();
    expect(hidden.reports.map((r: { id: string }) => r.id)).toEqual([ids[0]]);

    // Hide everything from one phone.
    const device = list.reports.find((r: { id: string }) => r.id === ids[2]).device;
    const byDevice = await app.request(`/admin/api/devices/${device}/hidden`, {
      method: 'POST', ...as(cookie, { 'Content-Type': 'application/json' }), body: JSON.stringify({ hidden: true }),
    });
    expect((await byDevice.json()).changed).toBe(1);
    expect((await (await app.request('/api/v1/reports')).json()).count).toBe(1);

    // Delete for good.
    expect((await app.request(`/admin/api/reports/${ids[1]}`, { method: 'DELETE', ...as(cookie) })).status).toBe(200);
    expect((await app.request(`/admin/api/reports/${ids[1]}`, { method: 'DELETE', ...as(cookie) })).status).toBe(404);
    expect((await (await app.request('/admin/api/stats', as(cookie))).json()).total).toBe(2);
  });

  it('signs out', async () => {
    const { app } = await setup();
    const { cookie } = await login(app);
    const out = await app.request('/admin/logout', { method: 'POST', ...as(cookie) });
    expect(out.headers.get('set-cookie')).toMatch(/firesight_admin=;/);
  });

  it('is off without a password', async () => {
    const { app } = await setup('');
    expect(await (await app.request('/admin/api/session')).json()).toMatchObject({ configured: false, signedIn: false });
    expect((await login(app, '')).res.status).toBe(503);
  });
});
