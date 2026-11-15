// Alert zones saved to an account: GET/PUT /me/zones.
import { describe, expect, it } from 'vitest';
import type { Service } from '../src/lib/service.ts';
import { createAccountStore } from './accounts.ts';
import { createApp } from './app.ts';
import { createDeviceStore } from './devices.ts';

const noService = {} as Service;
const BASE = 'https://cedx.test/api/v1';

function setup() {
  const accounts = createAccountStore(':memory:');
  const devices = createDeviceStore(':memory:');
  const app = createApp({ service: noService, dataDir: '.', accounts, devices, authPer15Min: 100, requestsPer10Min: 0 });
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await app.request(`${BASE}${path}`, {
      method,
      headers: {
        'X-Forwarded-For': '203.0.113.9',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };
  const signUp = async (email = 'zones@example.com') =>
    (await call('POST', '/auth/register', { email, password: 'long enough pw' })).json.token as string;
  return { call, signUp, devices };
}

const akkar = { id: 'z1', name: 'Akkar', lat: 34.45, lon: 36.24, radiusKm: 10, createdAt: '2026-11-15T11:00:00.000Z' };

describe('account zones', () => {
  it('needs a signed-in user', async () => {
    const { call } = setup();
    expect((await call('GET', '/me/zones')).status).toBe(401);
    expect((await call('PUT', '/me/zones', { zones: [] })).status).toBe(401);
  });

  it('saves zones and gives them back, with createdAt', async () => {
    const { call, signUp } = setup();
    const token = await signUp();
    expect((await call('GET', '/me/zones', undefined, token)).json).toEqual({ zones: [], updatedAt: null });
    const put = await call('PUT', '/me/zones', { zones: [akkar] }, token);
    expect(put.status).toBe(200);
    const got = (await call('GET', '/me/zones', undefined, token)).json;
    expect(got.zones).toEqual([akkar]);
    expect(got.updatedAt).toBeTypeOf('string');
    // An empty list is a real answer (every zone deleted), not a fallback.
    await call('PUT', '/me/zones', { zones: [] }, token);
    expect((await call('GET', '/me/zones', undefined, token)).json.zones).toEqual([]);
  });

  it('falls back to the zones of the newest linked phone until the app saves them', async () => {
    const { call, signUp } = setup();
    const token = await signUp();
    const { createdAt: _, ...zone } = akkar;
    await call('PUT', '/devices', { installationId: 'phone-1', platform: 'android', lang: 'en', zones: [zone] }, token);
    await call('PUT', '/devices', { installationId: 'phone-2', platform: 'android', lang: 'en', zones: [] }, token);
    expect((await call('GET', '/me/zones', undefined, token)).json).toEqual({ zones: [zone], updatedAt: null });
  });

  it('rejects bad zones and keeps each account separate', async () => {
    const { call, signUp } = setup();
    const a = await signUp('a@example.com');
    const b = await signUp('b@example.com');
    expect((await call('PUT', '/me/zones', { zones: [{ id: 'x', name: 'x', lat: 100, lon: 0, radiusKm: 5 }] }, a)).status).toBe(400);
    expect((await call('PUT', '/me/zones', { zones: 'nope' }, a)).status).toBe(400);
    await call('PUT', '/me/zones', { zones: [akkar] }, a);
    expect((await call('GET', '/me/zones', undefined, b)).json.zones).toEqual([]);
  });

  it('forgets the zones when the account is deleted', async () => {
    const { call, signUp, devices } = setup();
    const token = await signUp();
    const me = (await call('GET', '/auth/me', undefined, token)).json.user;
    await call('PUT', '/me/zones', { zones: [akkar] }, token);
    await call('DELETE', '/auth/me', { password: 'long enough pw' }, token);
    expect(devices.accountZones(me.id)).toEqual({ zones: [], updatedAt: null });
  });
});
