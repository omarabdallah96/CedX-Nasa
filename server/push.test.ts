// Instant alerts: phones register their push token, zones and last location;
// a zone alert from the admin page is pushed to the phones it concerns.
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Service } from '../src/lib/service.ts';
import { createAccountStore } from './accounts.ts';
import { createApp } from './app.ts';
import { createBroadcastStore } from './broadcasts.ts';
import { createDeviceStore } from './devices.ts';
import { createPush, parseServiceAccount, type PushMessage } from './push.ts';
import { createReportStore } from './reports.ts';

const PASSWORD = 'correct horse battery staple';
const noService = {} as Service;
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ACCOUNT = {
  project_id: 'firesight-test',
  client_email: 'push@firesight-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};

/** Google OAuth + FCM, faked: records what was sent; tokens starting with "dead" are gone. */
function fakeGoogle() {
  const sent: { token: string; title: string; body: string; data: Record<string, string>; channel: string }[] = [];
  let oauthCalls = 0;
  const fetchImpl = async (url: string, init: { body: string; headers: Record<string, string> }) => {
    const reply = (status: number, body: unknown) => ({
      ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body),
    });
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      oauthCalls++;
      expect(init.body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
      return reply(200, { access_token: 'ya29.test', expires_in: 3600 });
    }
    expect(url).toBe('https://fcm.googleapis.com/v1/projects/firesight-test/messages:send');
    expect(init.headers.Authorization).toBe('Bearer ya29.test');
    const m = JSON.parse(init.body).message;
    if (m.token.startsWith('dead')) return reply(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } });
    sent.push({ token: m.token, title: m.notification.title, body: m.notification.body, data: m.data, channel: m.android.notification.channel_id });
    return reply(200, { name: 'projects/firesight-test/messages/1' });
  };
  return { sent, fetchImpl, oauthCalls: () => oauthCalls };
}

const token = (name: string) => `${name}-${'x'.repeat(40)}`;
const farm = { id: 'z1', name: 'Farm', lat: 33.33, lon: 35.40, radiusKm: 3 };

async function setup() {
  const google = fakeGoogle();
  const accounts = createAccountStore(':memory:');
  const devices = createDeviceStore(':memory:');
  const push = createPush({ account: ACCOUNT, fetchImpl: google.fetchImpl as never });
  const app = createApp({
    service: noService, dataDir: '.', reports: createReportStore(':memory:'), adminPassword: PASSWORD,
    accounts, broadcasts: createBroadcastStore(':memory:'), devices, push, requestsPer10Min: 0,
  });
  const login = await app.request('https://cedx.test/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': '1' }, body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const req = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(`https://cedx.test${path}`, {
      method,
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };
  const admin = (method: string, path: string, body?: unknown) => req(method, path, body, { Cookie: cookie, 'X-Admin': '1' });
  return { google, accounts, devices, req, admin };
}

describe('instant zone alerts', () => {
  it('pushes to phones whose zone overlaps or whose last location is inside, in their language', async () => {
    const { google, devices, req, admin } = await setup();
    const now = new Date().toISOString();
    // A: zone near the alert. B: Arabic, standing inside it. C: far away. D: no push token. E: dead token.
    expect((await req('PUT', '/api/v1/devices', { installationId: 'phone-a', token: token('a'), platform: 'android', lang: 'en', zones: [farm] })).status).toBe(200);
    await req('PUT', '/api/v1/devices', { installationId: 'phone-b', token: token('b'), platform: 'ios', lang: 'ar', location: { lat: 33.36, lon: 35.42, at: now }, zones: [] });
    await req('PUT', '/api/v1/devices', { installationId: 'phone-c', token: token('c'), platform: 'android', lang: 'en', location: { lat: 34.4, lon: 36.0, at: now }, zones: [] });
    await req('PUT', '/api/v1/devices', { installationId: 'phone-d', token: null, platform: 'android', lang: 'en', zones: [farm] });
    await req('PUT', '/api/v1/devices', { installationId: 'phone-e', token: token('dead'), platform: 'android', lang: 'en', zones: [farm] });

    const sent = await admin('POST', '/admin/api/broadcasts', {
      title: 'Fire near Jezzine', message: 'Avoid the road.', titleAr: 'حريق قرب جزين', messageAr: 'تجنّبوا الطريق.',
      level: 'danger', lat: 33.37, lon: 35.43, radiusKm: 4, hours: 6,
    });
    expect(sent.status).toBe(201);
    expect(sent.json.broadcast.pushed).toEqual({ recipients: 3, delivered: 2 });

    const byToken = Object.fromEntries(google.sent.map((m) => [m.token.split('-')[0], m]));
    expect(Object.keys(byToken).sort()).toEqual(['a', 'b']);
    expect(byToken.a).toMatchObject({ title: 'Fire near Jezzine', channel: 'fire_urgent' });
    expect(byToken.a.body).toBe('Avoid the road.\nYour zone "Farm"');
    expect(byToken.a.data).toMatchObject({ kind: 'broadcast', zoneId: 'z1', level: 'danger' });
    expect(byToken.b).toMatchObject({ title: 'حريق قرب جزين', body: 'تجنّبوا الطريق.\nموقعك الأخير' });
    // The dead token is forgotten.
    expect(devices.recipients({ lat: 33.37, lon: 35.43, radiusKm: 4 }).map((r) => r.installationId).sort()).toEqual(['phone-a', 'phone-b']);
    expect((await admin('GET', '/admin/api/broadcasts')).json.phones).toMatchObject({ devices: 5, withPush: 3, withZones: 3 });

    // One OAuth token serves every send.
    await admin('POST', '/admin/api/broadcasts', { title: 'Again', message: 'x', level: 'info', lat: 33.37, lon: 35.43, radiusKm: 4, hours: 1 });
    expect(google.oauthCalls()).toBe(1);
  });

  it('keeps the last location when a phone updates without one, and forgets the phone when asked', async () => {
    const { devices, req } = await setup();
    await req('PUT', '/api/v1/devices', { installationId: 'phone-a', token: token('a'), platform: 'android', lang: 'en', location: { lat: 33.36, lon: 35.42, at: new Date().toISOString() }, zones: [] });
    await req('PUT', '/api/v1/devices', { installationId: 'phone-a', token: token('a2'), platform: 'android', lang: 'en', zones: [farm] });
    const [r] = devices.recipients({ lat: 33.36, lon: 35.42, radiusKm: 1 });
    expect(r.token).toBe(token('a2'));
    await req('DELETE', '/api/v1/devices/phone-a');
    expect(devices.stats().devices).toBe(0);
  });

  it('links a signed-in phone to its account; the admin sees its last location', async () => {
    const { accounts, req, admin } = await setup();
    const { token: auth } = await accounts.register({ email: 'omar@example.com', password: 'password-1', name: 'Omar' });
    await req('PUT', '/api/v1/devices',
      { installationId: 'phone-a', token: token('a'), platform: 'android', lang: 'en', location: { lat: 33.9, lon: 35.5, at: new Date().toISOString() }, zones: [farm] },
      { Authorization: `Bearer ${auth}` });
    const { json } = await admin('GET', '/admin/api/users?q=omar');
    expect(json.users[0].phone).toMatchObject({ lastLocation: { lat: 33.9, lon: 35.5 }, zones: 1, push: true });
  });

  it('rejects bad registrations', async () => {
    const { req } = await setup();
    const base = { installationId: 'phone-a', token: token('a'), platform: 'android', lang: 'en', zones: [] };
    expect((await req('PUT', '/api/v1/devices', { ...base, installationId: 'a b' })).status).toBe(400);
    expect((await req('PUT', '/api/v1/devices', { ...base, token: 'short' })).status).toBe(400);
    expect((await req('PUT', '/api/v1/devices', { ...base, location: { lat: 200, lon: 0 } })).status).toBe(400);
    expect((await req('PUT', '/api/v1/devices', { ...base, zones: [{ ...farm, radiusKm: -1 }] })).status).toBe(400);
  });
});

describe('push sender', () => {
  it('reads the service account as JSON or base64', () => {
    const json = JSON.stringify(ACCOUNT);
    expect(parseServiceAccount(json)?.project_id).toBe('firesight-test');
    expect(parseServiceAccount(Buffer.from(json).toString('base64'))?.client_email).toBe(ACCOUNT.client_email);
    expect(parseServiceAccount('')).toBeNull();
  });

  it('is off without an account', async () => {
    const push = createPush({ account: null });
    expect(push.available).toBe(false);
    const m: PushMessage = { token: token('a'), title: 't', body: 'b', data: {}, urgent: false };
    expect(await push.send([m])).toEqual({ sent: 0, failed: 1, invalidTokens: [] });
  });
});
