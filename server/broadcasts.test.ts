// Admin tabs beyond moderation: zone alerts sent to phones, and user plans.
import { describe, expect, it } from 'vitest';
import type { Service } from '../src/lib/service.ts';
import { createAccountStore } from './accounts.ts';
import { createApp } from './app.ts';
import { createBroadcastStore } from './broadcasts.ts';
import { createReportStore } from './reports.ts';

const PASSWORD = 'correct horse battery staple';
const noService = {} as Service;

async function setup() {
  let t = Date.parse('2026-11-15T10:00:00Z');
  const now = () => t;
  const accounts = createAccountStore(':memory:', { now });
  const broadcasts = createBroadcastStore(':memory:', { now });
  const app = createApp({
    service: noService, dataDir: '.', reports: createReportStore(':memory:'),
    adminPassword: PASSWORD, accounts, broadcasts, requestsPer10Min: 0,
  });
  const login = await app.request('https://cedx.test/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin': '1' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const admin = async (method: string, path: string, body?: unknown, withCookie = true) => {
    const res = await app.request(`https://cedx.test${path}`, {
      method,
      headers: {
        'X-Admin': '1',
        ...(withCookie && { Cookie: cookie }),
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };
  const phone = async () => (await (await app.request('https://cedx.test/api/v1/broadcasts')).json()) as any;
  return { app, accounts, admin, phone, advance: (ms: number) => { t += ms; } };
}

const ALERT = {
  title: 'Wildfire near Ehden', message: 'Avoid the area.', titleAr: 'حريق قرب إهدن', messageAr: '',
  level: 'danger', lat: 34.29, lon: 35.96, radiusKm: 8, hours: 6,
};

describe('zone alerts', () => {
  it('sends, shows to phones, and stops when cancelled or expired', async () => {
    const { admin, phone, advance } = await setup();
    const sent = await admin('POST', '/admin/api/broadcasts', ALERT);
    expect(sent.status).toBe(201);
    expect(sent.json.broadcast).toMatchObject({ title: 'Wildfire near Ehden', titleAr: 'حريق قرب إهدن', radiusKm: 8, cancelled: false });

    const second = await admin('POST', '/admin/api/broadcasts', { ...ALERT, title: 'Smoke', level: 'info', hours: 1 });
    expect((await phone()).broadcasts).toHaveLength(2);

    advance(2 * 3_600_000); // the 1-hour one ended
    expect((await phone()).broadcasts.map((b: any) => b.title)).toEqual(['Wildfire near Ehden']);

    await admin('POST', `/admin/api/broadcasts/${sent.json.broadcast.id}/cancel`);
    expect((await phone()).broadcasts).toEqual([]);
    // The admin list keeps both.
    expect((await admin('GET', '/admin/api/broadcasts')).json.broadcasts).toHaveLength(2);
    expect(second.status).toBe(201);
  });

  it('checks the input and needs a session', async () => {
    const { admin } = await setup();
    expect((await admin('POST', '/admin/api/broadcasts', { ...ALERT, title: '' })).json.error.code).toBe('bad_text');
    expect((await admin('POST', '/admin/api/broadcasts', { ...ALERT, level: 'panic' })).json.error.code).toBe('bad_level');
    expect((await admin('POST', '/admin/api/broadcasts', { ...ALERT, lat: 'x' })).json.error.code).toBe('bad_place');
    expect((await admin('POST', '/admin/api/broadcasts', { ...ALERT, radiusKm: 500 })).json.error.code).toBe('bad_radius');
    expect((await admin('POST', '/admin/api/broadcasts', ALERT, false)).status).toBe(401);
  });
});

describe('user plans', () => {
  it('finds accounts by email and switches their plan', async () => {
    const { admin, accounts } = await setup();
    await accounts.register({ email: 'omar@example.com', password: 'password-1', name: 'Omar' });
    await accounts.register({ email: 'rana@example.com', password: 'password-1', name: '' });

    const found = await admin('GET', '/admin/api/users?q=OMAR');
    expect(found.json.total).toBe(1);
    expect(found.json.users[0]).toMatchObject({ email: 'omar@example.com', plan: 'free' });
    expect((await admin('GET', '/admin/api/users?q=%25')).json.total).toBe(0); // % is literal

    const pro = await admin('POST', '/admin/api/users/plan', { email: ' Omar@Example.com', plan: 'pro' });
    expect(pro.json.user.plan).toBe('pro');
    expect((await admin('POST', '/admin/api/users/plan', { email: 'nobody@example.com', plan: 'pro' })).status).toBe(404);
    expect((await admin('POST', '/admin/api/users/plan', { email: 'omar@example.com', plan: 'gold' })).json.error.code).toBe('bad_plan');
  });
});
