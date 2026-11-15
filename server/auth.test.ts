// Optional user accounts for the phone app: sign-up, sign-in, sessions, deletion.
import { describe, expect, it } from 'vitest';
import type { Service } from '../src/lib/service.ts';
import { createAccountStore } from './accounts.ts';
import { createApp } from './app.ts';

// The auth routes never touch the fire record.
const noService = {} as Service;
const BASE = 'https://cedx.test/api/v1';

function setup({ authPer15Min = 100, now }: { authPer15Min?: number; now?: () => number } = {}) {
  const accounts = createAccountStore(':memory:', { now });
  const app = createApp({ service: noService, dataDir: '.', accounts, authPer15Min, requestsPer10Min: 0 });
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await app.request(`${BASE}${path}`, {
      method,
      headers: {
        'X-Forwarded-For': '203.0.113.7',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any, res };
  };
  return { accounts, call };
}

describe('accounts', () => {
  it('signs up, reads the user back and signs out', async () => {
    const { call } = setup();
    const reg = await call('POST', '/auth/register', { email: ' Rana@Example.com ', password: 'long enough pw', name: 'Rana' });
    expect(reg.status).toBe(201);
    expect(reg.json.user).toMatchObject({ email: 'rana@example.com', name: 'Rana' });
    expect(reg.json.user.passwordHash).toBeUndefined();
    expect(reg.res.headers.get('cache-control')).toBe('no-store');
    const token = reg.json.token as string;

    const me = await call('GET', '/auth/me', undefined, token);
    expect(me.status).toBe(200);
    expect(me.json.user.id).toBe(reg.json.user.id);

    expect((await call('POST', '/auth/logout', undefined, token)).status).toBe(200);
    expect((await call('GET', '/auth/me', undefined, token)).status).toBe(401);
  });

  it('signs in with the right password only, and refuses a second account for one email', async () => {
    const { call } = setup();
    await call('POST', '/auth/register', { email: 'a@b.co', password: 'password-1' });
    expect((await call('POST', '/auth/register', { email: 'A@B.CO', password: 'password-2' })).json.error.code).toBe('email_taken');

    const wrong = await call('POST', '/auth/login', { email: 'a@b.co', password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(wrong.json.error.code).toBe('wrong_credentials');
    const unknown = await call('POST', '/auth/login', { email: 'x@b.co', password: 'password-1' });
    expect(unknown.json.error.code).toBe('wrong_credentials');

    const ok = await call('POST', '/auth/login', { email: 'a@b.co', password: 'password-1' });
    expect(ok.status).toBe(200);
    expect((await call('GET', '/auth/me', undefined, ok.json.token)).status).toBe(200);
  });

  it('checks the input', async () => {
    const { call } = setup();
    expect((await call('POST', '/auth/register', { email: 'not-an-email', password: 'password-1' })).json.error.code).toBe('bad_email');
    expect((await call('POST', '/auth/register', { email: 'a@b.co', password: 'short' })).json.error.code).toBe('weak_password');
    expect((await call('POST', '/auth/register', { email: 'a@b.co', password: 'password-1', name: 'x'.repeat(61) })).json.error.code).toBe('bad_name');
    expect((await call('POST', '/auth/login', [1, 2])).json.error.code).toBe('bad_body');
    expect((await call('GET', '/auth/me')).status).toBe(401);
    expect((await call('GET', '/auth/me', undefined, 'made-up-token-made-up-token')).status).toBe(401);
  });

  it('renames, and deletes the account only with the password', async () => {
    const { call, accounts } = setup();
    const { json } = await call('POST', '/auth/register', { email: 'a@b.co', password: 'password-1' });
    const renamed = await call('PATCH', '/auth/me', { name: 'Omar' }, json.token);
    expect(renamed.json.user.name).toBe('Omar');

    expect((await call('DELETE', '/auth/me', { password: 'wrong-one' }, json.token)).status).toBe(401);
    expect(accounts.count()).toBe(1);
    expect((await call('DELETE', '/auth/me', { password: 'password-1' }, json.token)).json).toEqual({ deleted: true });
    expect(accounts.count()).toBe(0);
    expect((await call('GET', '/auth/me', undefined, json.token)).status).toBe(401);
  });

  it('expires unused sessions', async () => {
    let t = Date.parse('2026-11-15T00:00:00Z');
    const { call, accounts } = setup({ now: () => t });
    const { json } = await call('POST', '/auth/register', { email: 'a@b.co', password: 'password-1' });
    t += 100 * 86_400_000;
    expect((await call('GET', '/auth/me', undefined, json.token)).status).toBe(200); // used: extended
    t += 179 * 86_400_000;
    expect((await call('GET', '/auth/me', undefined, json.token)).status).toBe(200);
    t += 181 * 86_400_000;
    expect((await call('GET', '/auth/me', undefined, json.token)).status).toBe(401);
    expect(accounts.prune()).toBe(1);
  });

  it('limits sign-in attempts per client', async () => {
    const { call } = setup({ authPer15Min: 3 });
    for (let i = 0; i < 3; i++) await call('POST', '/auth/login', { email: 'a@b.co', password: 'password-1' });
    const res = await call('POST', '/auth/login', { email: 'a@b.co', password: 'password-1' });
    expect(res.status).toBe(429);
    expect(res.res.headers.get('retry-after')).toBeTruthy();
  });

  it('answers 503 when accounts are off', async () => {
    const app = createApp({ service: noService, dataDir: '.' });
    const res = await app.request(`${BASE}/auth/me`);
    expect(res.status).toBe(503);
  });
});
