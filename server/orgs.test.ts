// Organizations: access by invitation, membership, sites, the risk board,
// alerts, notifications and the claim check.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DatasetIndex } from '../src/lib/analysis.ts';
import { createService, type Service } from '../src/lib/service.ts';
import { createAccountStore } from './accounts.ts';
import { createApp } from './app.ts';
import { createBroadcastStore } from './broadcasts.ts';
import { createDeviceStore } from './devices.ts';
import type { CountryForecast, Forecast } from './forecast.ts';
import { createLive } from './live.ts';
import { createOrgStore } from './orgs.ts';
import type { Push, PushMessage } from './push.ts';

const dataDir = path.resolve(import.meta.dirname, '../public/data');
const hasData = existsSync(path.join(dataDir, 'index.json'));
const BASE = 'https://cedx.test/api/v1';
const NOW = Date.parse('2026-08-10T12:00:00Z');

// Membership, sites, the board and alerts only need to know where the countries are.
const boxesOnly = {
  index: async () => ({ countries: [{ slug: 'lebanon', name: 'Lebanon', iso: 'LBN', bbox: [35.1, 33.05, 36.62, 34.69] }] }),
} as unknown as Service;

function realService() {
  return createService({
    async index() {
      return JSON.parse(readFileSync(path.join(dataDir, 'index.json'), 'utf8')) as DatasetIndex;
    },
    async bin(manifest) {
      const b = readFileSync(path.join(dataDir, `${manifest.slug}.bin`));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
  });
}

// One grid point, low danger today and very high in two days.
const day = (fwi: number, level: 'low' | 'very_high') => ({ ffmc: 0, dmc: 0, dc: 0, isi: 0, bui: 0, fwi, level, weather: { temp: 30, rh: 40, wind: 10, rain: 0 } });
const lebanon: CountryForecast = {
  slug: 'lebanon',
  generatedAt: new Date(NOW).toISOString(),
  dates: ['2026-08-10', '2026-08-11', '2026-08-12'],
  grid: { step: 0.15, cells: [{ lat: 33.9, lon: 35.9 }] },
  days: [[day(8, 'low'), day(8, 'low'), day(42, 'very_high')]],
  stateThrough: '2026-08-09',
};
const forecast = { country: async () => lebanon, grid: async () => lebanon.grid, warm: async () => {} } as unknown as Forecast;

// `now` is the organization store's clock; the routes read the real one.
function setup({ service = boxesOnly, alertsPerHour = 10, now = Date.now }: { service?: Service; alertsPerHour?: number; now?: () => number } = {}) {
  const accounts = createAccountStore(':memory:');
  const devices = createDeviceStore(':memory:');
  const broadcasts = createBroadcastStore(':memory:');
  const orgs = createOrgStore(':memory:', { now });
  const pushed: PushMessage[] = [];
  const push: Push = {
    available: true,
    projectId: 'test',
    async send(messages) {
      pushed.push(...messages);
      return { sent: messages.length, failed: 0, invalidTokens: [] };
    },
  };
  // One fire in Akkar, 40 minutes ago, on every FIRMS source.
  const live = createLive({
    key: 'test',
    now: () => NOW,
    clipper: async () => ({ accept: () => true, bbox: [35, 33, 36.7, 34.7] }),
    fetchText: async () => 'latitude,longitude,acq_date,acq_time,confidence,frp,daynight\n34.46,36.25,2026-08-10,1120,n,8,D\n',
  });
  const app = createApp({
    service, dataDir: '.', accounts, devices, broadcasts, push, orgs, live, forecast,
    authPer15Min: 100, requestsPer10Min: 0, orgAlertsPerHour: alertsPerHour, orgRequestsPerHour: 7,
  });
  const call = async (method: string, url: string, body?: unknown, token?: string) => {
    const res = await app.request(`${BASE}${url}`, {
      method,
      headers: {
        'X-Forwarded-For': '203.0.113.11',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any, res };
  };
  const signUp = async (email: string) => (await call('POST', '/auth/register', { email, password: 'long enough pw', name: email.split('@')[0] })).json.token as string;
  /** The token in an invitation link. */
  const tokenOf = (path: string) => path.split('/').pop()!;
  /** An organization as an admin approves it, with the signed-in user as its owner. */
  const newOrg = async (token: string, kind: 'company' | 'fire_station' | 'insurer' | 'ngo' = 'company') => {
    const org = orgs.create({ name: 'Cedar Farms', kind });
    const invite = orgs.createInvite({ orgId: org.id, email: 'owner@example.com', role: 'owner' });
    return (await call('POST', `/invites/${invite.token}/accept`, {}, token)).json.org;
  };
  /** An owner invites someone, who accepts while signed in. */
  const join = async (ownerToken: string, orgId: string, token: string, email: string, role = 'member') => {
    const made = await call('POST', `/orgs/${orgId}/invites`, { email, role }, ownerToken);
    return call('POST', `/invites/${tokenOf(made.json.path)}/accept`, {}, token);
  };
  return { call, signUp, newOrg, join, tokenOf, orgs, pushed };
}

const akkar = { id: 'akkar', name: 'Akkar orchard', lat: 34.45, lon: 36.24, radiusKm: 10, value: 400_000, people: 12 };
const beirut = { id: 'beirut', name: 'Beirut office', lat: 33.89, lon: 35.5, radiusKm: 3, value: 900_000 };

describe('organizations', () => {
  it('needs a signed-in user and keeps non-members out', async () => {
    const { call, signUp, newOrg } = setup();
    expect((await call('GET', '/orgs')).status).toBe(401);

    const owner = await signUp('owner@example.com');
    const org = await newOrg(owner);
    expect(org).toMatchObject({ name: 'Cedar Farms', kind: 'company', verified: false, role: 'owner' });
    // Nobody starts an organization or joins one by code: access is by invitation.
    expect((await call('POST', '/orgs', { name: 'x', kind: 'ngo' }, owner)).status).toBe(404);
    expect((await call('POST', '/orgs/join', { code: 'ABCDEFGH' }, owner)).status).toBe(404);

    const stranger = await signUp('stranger@example.com');
    for (const url of [`/orgs/${org.id}`, `/orgs/${org.id}/board`, `/orgs/${org.id}/exposure`, `/orgs/${org.id}/alerts`]) {
      const res = await call('GET', url, undefined, stranger);
      expect(res.status).toBe(403);
      expect(res.json.error.code).toBe('not_member');
    }
    expect((await call('GET', '/orgs/nope', undefined, stranger)).status).toBe(404);
    expect((await call('GET', '/orgs', undefined, stranger)).json.orgs).toEqual([]);
  });

  it('turns an invitation into a membership, once', async () => {
    const { call, signUp, newOrg, tokenOf, orgs } = setup();
    const owner = await signUp('owner@example.com');
    const org = await newOrg(owner);
    const staff = await signUp('staff@example.com');
    expect((await call('POST', `/orgs/${org.id}/invites`, { email: 'nope' }, owner)).json.error.code).toBe('bad_email');
    expect((await call('POST', `/orgs/${org.id}/invites`, { email: 'a@b.co', role: 'admin' }, owner)).json.error.code).toBe('bad_role');

    // A new person: the account is made with the invitation's email.
    const made = await call('POST', `/orgs/${org.id}/invites`, { email: 'New.Hire@Example.com' }, owner);
    expect(made.status).toBe(201);
    expect(made.json.path).toMatch(/^\/org\/invite\/[\w-]{32}$/);
    const token = tokenOf(made.json.path);
    const peek = await call('GET', `/invites/${token}`);
    expect(peek.json).toMatchObject({ org: { name: 'Cedar Farms', kind: 'company' }, email: 'new.hire@example.com', role: 'member' });
    expect(peek.json.org.id).toBeUndefined();
    expect((await call('POST', `/invites/${token}/accept`, { name: 'Nour', password: 'short' })).json.error.code).toBe('weak_password');
    const accepted = await call('POST', `/invites/${token}/accept`, { name: 'Nour', password: 'long enough pw', email: 'someone@else.com' });
    expect(accepted.status).toBe(200);
    expect(accepted.json.user).toMatchObject({ email: 'new.hire@example.com', name: 'Nour' });
    expect(accepted.json.org).toMatchObject({ id: org.id, role: 'member' });
    expect((await call('GET', '/orgs', undefined, accepted.json.token)).json.orgs.map((o: any) => o.id)).toEqual([org.id]);
    // Used once.
    expect((await call('GET', `/invites/${token}`)).status).toBe(410);
    expect((await call('POST', `/invites/${token}/accept`, {}, staff)).json.error.code).toBe('invite_used');

    // An email that already has an account signs in first, then accepts.
    const second = tokenOf((await call('POST', `/orgs/${org.id}/invites`, { email: 'staff@example.com' }, owner)).json.path);
    expect((await call('POST', `/invites/${second}/accept`, { name: 'x', password: 'long enough pw' })).json.error.code).toBe('email_taken');
    expect((await call('POST', `/invites/${second}/accept`, {}, staff)).json.org).toMatchObject({ id: org.id, role: 'member' });

    // Withdrawn and unknown links.
    const third = await call('POST', `/orgs/${org.id}/invites`, { email: 'late@example.com' }, owner);
    expect((await call('GET', `/orgs/${org.id}/invites`, undefined, owner)).json.invites.map((i: any) => i.email)).toEqual(['late@example.com']);
    expect((await call('DELETE', `/orgs/${org.id}/invites/${third.json.invite.id}`, undefined, owner)).json).toEqual({ revoked: true });
    expect((await call('GET', `/invites/${tokenOf(third.json.path)}`)).json.error.code).toBe('invite_not_found');
    expect((await call('GET', '/invites/not-a-real-token')).status).toBe(404);

    // Members neither invite nor change sites.
    expect((await call('POST', `/orgs/${org.id}/invites`, { email: 'x@example.com' }, staff)).json.error.code).toBe('owner_only');
    expect((await call('PUT', `/orgs/${org.id}/sites`, { sites: [akkar] }, staff)).json.error.code).toBe('owner_only');
    expect(orgs.members(org.id)).toHaveLength(3);
  });

  it('expires invitations after 14 days', async () => {
    let shift = 0;
    const { call, signUp, newOrg, tokenOf } = setup({ now: () => Date.now() - shift });
    const owner = await signUp('owner@example.com');
    const org = await newOrg(owner);
    // Made 15 days ago.
    shift = 15 * 86_400_000;
    const token = tokenOf((await call('POST', `/orgs/${org.id}/invites`, { email: 'slow@example.com' }, owner)).json.path);
    shift = 0;
    expect((await call('GET', `/invites/${token}`)).json.error.code).toBe('invite_expired');
  });

  it('lets owners remove members, but keeps one owner', async () => {
    const { call, signUp, newOrg, join } = setup();
    const owner = await signUp('owner@example.com');
    const org = await newOrg(owner);
    const staff = await signUp('staff@example.com');
    await join(owner, org.id, staff, 'staff@example.com');
    const detail = (await call('GET', `/orgs/${org.id}`, undefined, staff)).json;
    expect(detail.org.joinCode).toBeUndefined();
    expect(detail.members.map((m: any) => [m.email, m.role])).toEqual([['owner@example.com', 'owner'], ['staff@example.com', 'member']]);
    const [ownerId, staffId] = detail.members.map((m: any) => m.id);

    expect((await call('DELETE', `/orgs/${org.id}/members/${ownerId}`, undefined, staff)).json.error.code).toBe('owner_only');
    expect((await call('DELETE', `/orgs/${org.id}/members/${ownerId}`, undefined, owner)).json.error.code).toBe('last_owner');
    expect((await call('DELETE', `/orgs/${org.id}/members/me`, undefined, owner)).json.error.code).toBe('last_owner');
    expect((await call('DELETE', `/orgs/${org.id}/members/${staffId}`, undefined, owner)).json).toEqual({ removed: true });
    expect((await call('GET', `/orgs/${org.id}`, undefined, staff)).status).toBe(403);
  });

  it('takes requests for access from anyone, once, and not from bots', async () => {
    const { call, orgs } = setup();
    const form = { orgName: 'Akkar Civil Defence', kind: 'fire_station', country: 'Lebanon', contactName: 'Rana', email: 'Rana@Example.com', phone: '+961 1 234 567', sitesEstimate: '12', message: 'Six stations.' };
    expect((await call('POST', '/org-requests', { ...form, kind: 'bank' })).json.error.code).toBe('bad_kind');
    expect((await call('POST', '/org-requests', { ...form, email: 'nope' })).json.error.code).toBe('bad_email');
    expect((await call('POST', '/org-requests', { ...form, orgName: '' })).json.error.code).toBe('bad_parameter');
    const sent = await call('POST', '/org-requests', form);
    expect(sent.status).toBe(201);
    expect(sent.json.request.status).toBe('pending');
    // The same person again: nothing new.
    expect((await call('POST', '/org-requests', form)).status).toBe(200);
    // A filled hidden field looks like success and stores nothing.
    expect((await call('POST', '/org-requests', { ...form, email: 'bot@example.com', website: 'http://spam' })).status).toBe(201);
    expect(orgs.requests(10).map((r) => [r.email, r.sitesEstimate, r.kind])).toEqual([['rana@example.com', 12, 'fire_station']]);
    // Seven tries an hour per client in this setup, rejected ones included: this is the seventh, the next is refused.
    await call('POST', '/org-requests', { ...form, email: 'p1@example.com' });
    expect((await call('POST', '/org-requests', { ...form, email: 'p9@example.com' })).status).toBe(429);
  });

  it('saves sites with their country, and rejects bad ones', async () => {
    const { call, signUp, newOrg } = setup();
    const owner = await signUp('owner@example.com');
    const org = await newOrg(owner);
    const bad = async (site: object) => (await call('PUT', `/orgs/${org.id}/sites`, { sites: [site] }, owner)).json.error?.code;
    expect(await bad({ ...akkar, lat: 48.85, lon: 2.35 })).toBe('outside_coverage');
    expect(await bad({ ...akkar, radiusKm: 500 })).toBe('bad_parameter');
    expect(await bad({ ...akkar, name: '' })).toBe('bad_parameter');
    expect(await bad({ ...akkar, value: -1 })).toBe('bad_parameter');
    const many = Array.from({ length: 201 }, (_, i) => ({ ...akkar, id: `s${i}` }));
    expect((await call('PUT', `/orgs/${org.id}/sites`, { sites: many }, owner)).status).toBe(400);
    expect((await call('PUT', `/orgs/${org.id}/sites`, { sites: [akkar, akkar] }, owner)).status).toBe(400);

    const saved = await call('PUT', `/orgs/${org.id}/sites`, { sites: [akkar, { name: 'No id', lat: 33.9, lon: 35.6, radiusKm: 2 }] }, owner);
    expect(saved.status).toBe(200);
    expect(saved.json.sites[0]).toEqual({ ...akkar, country: 'lebanon', startedYear: null });
    expect(saved.json.sites[1].id).toBeTypeOf('string');

    const mine = await call('GET', '/orgs', undefined, owner);
    expect(mine.res.headers.get('cache-control')).toBe('no-store');
    expect(mine.json.orgs[0].sites.map((s: any) => s.name)).toEqual(['Akkar orchard', 'No id']);
  });

  it('ranks sites: a fire inside outranks danger later in the week', async () => {
    const { call, signUp, newOrg } = setup();
    const owner = await signUp('owner@example.com');
    const org = await newOrg(owner);
    await call('PUT', `/orgs/${org.id}/sites`, { sites: [beirut, akkar] }, owner);
    const board = (await call('GET', `/orgs/${org.id}/board?days=3`, undefined, owner)).json;
    expect(board.unavailable).toEqual([]);
    expect(board.sites.map((s: any) => [s.site.id, s.score, s.status])).toEqual([['akkar', 100, 'act'], ['beirut', 65, 'watch']]);
    expect(board.sites[0].fires.inside).toBeGreaterThan(0);
    expect(board.sites[0].reasons[0]).toContain('inside the site');
    expect(board.sites[1].reasons).toEqual(['Very high fire danger on Wednesday']);
    expect(board.sites[1].danger.map((d: any) => d.work.advice)).toEqual(['go', 'go', 'stop']);
    expect(board.summary).toMatchObject({ sites: 2, act: 1, watch: 1, ok: 0, atRisk: { sites: 2, value: 1_300_000, people: 12 } });
    expect((await call('GET', `/orgs/${org.id}/board?days=99`, undefined, owner)).status).toBe(400);
  });

  it('alerts members always, and the public only when verified', async () => {
    const { call, signUp, newOrg, join, orgs, pushed } = setup({ alertsPerHour: 3 });
    const owner = await signUp('owner@example.com');
    const org = await newOrg(owner, 'fire_station');
    await call('PUT', `/orgs/${org.id}/sites`, { sites: [akkar] }, owner);
    const staff = await signUp('staff@example.com');
    await join(owner, org.id, staff, 'staff@example.com');
    // A member's phone, and a stranger's phone with a zone inside the site.
    await call('PUT', '/devices', { installationId: 'staff-phone', token: 'staff-token-0123456789abcdef', platform: 'android', lang: 'en', zones: [] }, staff);
    await call('PUT', '/devices', {
      installationId: 'public-phone', token: 'public-token-0123456789abcdef', platform: 'ios', lang: 'ar',
      zones: [{ id: 'home', name: 'Home', lat: 34.46, lon: 36.25, radiusKm: 2 }],
    });
    const alert = { siteId: 'akkar', title: 'Smoke near the orchard', message: 'Stay clear of the north road.', level: 'warning' };

    expect((await call('POST', `/orgs/${org.id}/alerts`, alert, staff)).json.error.code).toBe('owner_only');
    expect((await call('POST', `/orgs/${org.id}/alerts`, { ...alert, siteId: 'nope' }, owner)).json.error.code).toBe('bad_site');
    const refused = await call('POST', `/orgs/${org.id}/alerts`, { ...alert, audience: 'public' }, owner);
    expect(refused.status).toBe(403);
    expect(refused.json.error.code).toBe('not_verified');
    expect(pushed).toEqual([]);

    const toMembers = await call('POST', `/orgs/${org.id}/alerts`, alert, owner);
    expect(toMembers.status).toBe(201);
    expect(toMembers.json.alert).toMatchObject({ sender: 'Cedar Farms', audience: 'members', pushed: { recipients: 1, delivered: 1 } });
    expect(pushed.map((m) => [m.token, m.title])).toEqual([['staff-token-0123456789abcdef', 'Cedar Farms: Smoke near the orchard']]);
    // Members-only alerts stay out of the public feed and reach members through their organization list.
    expect((await call('GET', '/broadcasts')).json.broadcasts).toEqual([]);
    expect((await call('GET', '/orgs', undefined, staff)).json.orgs[0].alerts.map((a: any) => a.title)).toEqual(['Smoke near the orchard']);
    // Every alert is also in the team's notifications, unread until opened.
    const inbox = (await call('GET', `/orgs/${org.id}/notifications`, undefined, staff)).json;
    expect(inbox).toMatchObject({ unread: 1, readAt: null });
    expect(inbox.notifications[0]).toMatchObject({ kind: 'alert', title: 'Alert to members: Smoke near the orchard', siteId: 'akkar' });
    await call('POST', `/orgs/${org.id}/notifications/read`, undefined, staff);
    expect((await call('GET', `/orgs/${org.id}/notifications`, undefined, staff)).json.unread).toBe(0);
    expect((await call('GET', `/orgs/${org.id}/notifications`, undefined, owner)).json.unread).toBe(1);

    orgs.setVerified(org.id, true);
    const toPublic = await call('POST', `/orgs/${org.id}/alerts`, { ...alert, audience: 'public', level: 'danger' }, owner);
    expect(toPublic.json.alert).toMatchObject({ audience: 'public', pushed: { recipients: 2, delivered: 2 } });
    expect((await call('GET', '/broadcasts')).json.broadcasts[0]).toMatchObject({ sender: 'Cedar Farms', level: 'danger' });

    // Three an hour in this setup: the refused and invalid ones did not count.
    expect((await call('POST', `/orgs/${org.id}/alerts`, alert, owner)).status).toBe(201);
    const limited = await call('POST', `/orgs/${org.id}/alerts`, alert, owner);
    expect(limited.status).toBe(429);

    const cancelled = await call('POST', `/orgs/${org.id}/alerts/${toPublic.json.alert.id}/cancel`, undefined, owner);
    expect(cancelled.json.alert.cancelled).toBe(true);
    expect((await call('GET', '/broadcasts')).json.broadcasts).toEqual([]);
  });

  it('lets the admin approve a request into an organization and its owner\'s link', async () => {
    const accounts = createAccountStore(':memory:');
    const orgs = createOrgStore(':memory:');
    const app = createApp({ service: boxesOnly, dataDir: '.', accounts, orgs, adminPassword: 'correct horse battery', requestsPer10Min: 0, authPer15Min: 100 });
    const admin = (path: string, init: RequestInit = {}) => app.request(`https://cedx.test${path}`, {
      ...init, headers: { 'Content-Type': 'application/json', 'X-Admin': '1', 'X-Forwarded-For': '203.0.113.12', ...init.headers },
    });
    const json = async (res: Response | Promise<Response>) => (await (await res).json()) as any;
    expect((await admin('/admin/api/org-requests')).status).toBe(401);
    const login = await admin('/admin/login', { method: 'POST', body: JSON.stringify({ password: 'correct horse battery' }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const as = (path: string, body?: unknown) => admin(path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });

    const keep = orgs.addRequest({ orgName: 'Akkar Civil Defence', kind: 'fire_station', country: 'Lebanon', contactName: 'Chief', email: 'chief@example.com', phone: '', sitesEstimate: 6, message: '' });
    const drop = orgs.addRequest({ orgName: 'Spam Ltd', kind: 'company', country: 'Cyprus', contactName: 'X', email: 'x@example.com', phone: '', sitesEstimate: null, message: '' });
    expect((await json(as('/admin/api/org-requests'))).requests.map((r: any) => r.status)).toEqual(['pending', 'pending']);

    expect((await json(as(`/admin/api/org-requests/${drop.id}/decline`, {}))).request.status).toBe('declined');
    const approved = await json(as(`/admin/api/org-requests/${keep.id}/approve`, { verified: true }));
    expect(approved.org).toMatchObject({ name: 'Akkar Civil Defence', kind: 'fire_station', verified: true });
    expect(approved.invite).toMatchObject({ email: 'chief@example.com', role: 'owner' });
    expect(approved.request).toMatchObject({ status: 'approved', orgId: approved.org.id });
    expect((await as(`/admin/api/org-requests/${keep.id}/approve`, {})).status).toBe(409);
    expect((await json(as('/admin/api/org-requests'))).requests.map((r: any) => r.status).sort()).toEqual(['approved', 'declined']);

    // The owner opens the link and sets a password.
    const token = approved.path.split('/').pop();
    const accepted = await app.request(`https://cedx.test/api/v1/invites/${token}/accept`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.13' }, body: JSON.stringify({ name: 'Chief', password: 'long enough pw' }),
    });
    expect((await json(accepted)).org).toMatchObject({ name: 'Akkar Civil Defence', role: 'owner' });

    const list = (await json(as('/admin/api/orgs'))).orgs;
    expect(list).toMatchObject([{ id: approved.org.id, owner: 'chief@example.com', members: 1, sites: 0, verified: true }]);
    expect((await as(`/admin/api/orgs/${approved.org.id}/verified`, { verified: false })).status).toBe(200);
    expect(orgs.get(approved.org.id)!.verified).toBe(false);
    expect((await as('/admin/api/orgs/nope/verified', { verified: true })).status).toBe(404);
    // A fresh link for an organization whose owner lost theirs.
    const again = await json(as(`/admin/api/orgs/${approved.org.id}/invite`, { email: 'deputy@example.com' }));
    expect(again).toMatchObject({ invite: { email: 'deputy@example.com', role: 'owner' }, path: expect.stringMatching(/^\/org\/invite\//) });
  });

  it('forgets a deleted account, and an organization nobody is left in', async () => {
    const { call, signUp, newOrg, orgs } = setup();
    const owner = await signUp('owner@example.com');
    const org = await newOrg(owner);
    await call('DELETE', '/auth/me', { password: 'long enough pw' }, owner);
    expect(orgs.get(org.id)).toBeNull();
  });
});

describe('organization store', () => {
  it('drops the join code of a database from before invitations, keeping members', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'firesight-orgs-'));
    const old = new DatabaseSync(path.join(dir, 'orgs.db'));
    old.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE orgs (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, join_code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
      CREATE TABLE org_members (org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE, user_id TEXT NOT NULL, role TEXT NOT NULL, joined_at TEXT NOT NULL, PRIMARY KEY (org_id, user_id));
      INSERT INTO orgs VALUES ('o1', 'Cedar Farms', 'company', 0, 'ABCDEFGH', '2026-11-15T00:00:00Z');
      INSERT INTO org_members VALUES ('o1', 'u1', 'owner', '2026-11-15T00:00:00Z');`);
    old.close();
    const orgs = createOrgStore(dir);
    expect(orgs.forUser('u1')).toMatchObject([{ id: 'o1', name: 'Cedar Farms', role: 'owner' }]);
    expect(orgs.create({ name: 'New', kind: 'ngo' }).name).toBe('New');
    orgs.close();
  });
});

describe.skipIf(!hasData)('organizations on the real record', () => {
  // Pedrógão Grande, Portugal: the fires of 17 June 2017.
  const pedrogao = { id: 'pg', name: 'Pedrógão Grande', lat: 39.92, lon: -8.15, radiusKm: 10, value: 250_000, startedYear: 2018 };

  it('reports a site\'s history and finds the fire a claim is about', async () => {
    const { call, signUp, newOrg } = setup({ service: realService() });
    const owner = await signUp('owner@example.com');
    const org = await newOrg(owner, 'insurer');
    expect((await call('PUT', `/orgs/${org.id}/sites`, { sites: [pedrogao] }, owner)).json.sites[0].country).toBe('portugal');

    const report = (await call('GET', `/orgs/${org.id}/sites/pg/report`, undefined, owner)).json;
    expect(report.history.worstYear.year).toBe(2017);
    expect(report.history.averagePerYear).toBeGreaterThan(0);
    expect(report.history.years[0].year).toBeLessThanOrEqual(2001);
    expect(report.history.criticalPeriod.name).toMatch(/–/);
    expect(report.history.project).toMatchObject({ startedYear: 2018 });
    expect(report.history.thisMonth.sentence).toContain('Pedrógão Grande');

    const exposure = (await call('GET', `/orgs/${org.id}/exposure`, undefined, owner)).json;
    expect(exposure.totalValue).toBe(250_000);
    expect(exposure.sites[0]).toMatchObject({ worstYear: { year: 2017 }, averagePerYear: report.history.averagePerYear });

    const claim = (await call('GET', `/orgs/${org.id}/sites/pg/evidence?date=2017-06-18&days=2&km=5`, undefined, owner)).json;
    expect(claim.found).toBe(true);
    expect(claim.fireDays).toContain('2017-06-17');
    expect(claim.detections[0].km).toBeLessThanOrEqual(claim.detections.at(-1).km);
    expect(claim.summary).toMatch(/^Satellites detected fire within 5 km of the site/);

    const quiet = (await call('GET', `/orgs/${org.id}/sites/pg/evidence?date=2017-01-15&days=1&km=0`, undefined, owner)).json;
    expect(quiet.found).toBe(false);
    expect(quiet.summary).toMatch(/^No satellite detection inside the site/);
    expect((await call('GET', `/orgs/${org.id}/sites/pg/evidence?date=nope`, undefined, owner)).status).toBe(400);
    expect((await call('GET', `/orgs/${org.id}/sites/nope/report`, undefined, owner)).status).toBe(404);
  });
});
