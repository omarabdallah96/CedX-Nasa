// /api/v1/orgs: organizations, their sites, the risk board and the tools built
// on it (site report, insurer exposure, claim check, alerts, notifications).
// Everything under /orgs needs a signed-in member; answers are private and
// never cached. Access is by invitation: /org-requests asks for it, and
// /invites/{token} turns a one-time link into a membership.
import { randomUUID } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { normalizeEmail, type AccountStore, type User } from './accounts.ts';
import { BROADCAST_LEVELS, deliver, MAX_HOURS, MAX_MESSAGE, MAX_TITLE, type BroadcastLevel, type BroadcastStore } from './broadcasts.ts';
import { distanceKm, type DeviceStore } from './devices.ts';
import { FORECAST_DAYS, type CountryForecast, type Forecast } from './forecast.ts';
import type { Live, LiveHotspot } from './live.ts';
import {
  MAX_ORG_NAME, MAX_SITE_KM, MAX_SITE_NAME, MAX_SITES, MIN_SITE_KM, ORG_KINDS, ORG_ROLES,
  type Invite, type Org, type OrgKind, type OrgRole, type OrgStore, type Site,
} from './orgs.ts';
import type { Push } from './push.ts';
import { createRateLimit } from './ratelimit.ts';
import type { Report, ReportStore } from './reports.ts';
import { atLeast, circleBox, CLOSE_KM, compass, siteDanger, siteFires, siteReports, siteScore, type SiteDay, type SiteFires } from './risk.ts';
import { selectionVerdict } from '../src/lib/analysis.ts';
import { monthWording, verdictSentence } from '../src/lib/sentence.ts';
import type { Service } from '../src/lib/service.ts';
import { annualTotals } from '../src/lib/stats.ts';
import { isoDate, MONTHS_LONG, parseIsoDate } from '../src/lib/time.ts';

type Status = 400 | 401 | 403 | 404 | 409 | 410 | 413 | 429 | 503;

export interface OrgRouteDeps {
  orgs: OrgStore;
  service: Service;
  accounts?: AccountStore;
  forecast?: Forecast;
  live?: Live;
  reports?: ReportStore;
  broadcasts?: BroadcastStore;
  devices?: DeviceStore;
  push?: Push;
  /** From app.ts: the signed-in user or a 401; a JSON object body or a 400; the sign-in attempt limiter. */
  signedIn(c: Context): User;
  jsonBody(c: Context): Promise<Record<string, unknown>>;
  limitAuth(c: Context): void;
  /** From app.ts: who is asking (rate limits), and the sign-up field checks. */
  clientKey(c: Context): string;
  readPassword(body: Record<string, unknown>, checkLength: boolean): string;
  readName(body: Record<string, unknown>): string;
  /** Turns an account store error into the API's error. */
  accountError(err: unknown): never;
  /** Requests for access per client per hour. */
  requestsPerHour?: number;
  /** Throws the API's error type. */
  fail(status: Status, code: string, message: string): never;
  alertsPerHour?: number;
  now?: () => number;
}

interface CountryState {
  forecast: CountryForecast | null;
  hotspots: LiveHotspot[] | null;
  reports: Report[];
}

export type OrgBoard = Awaited<ReturnType<ReturnType<typeof addOrgRoutes>['board']>>;

const r1 = (x: number) => Math.round(x * 10) / 10;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
// FIRMS codes, spelled out for people reading a claim.
const SATELLITE_NAME: Record<string, string> = { N: 'Suomi NPP', N20: 'NOAA-20' };
const CONFIDENCE_NAME: Record<string, string> = { l: 'low', n: 'nominal', h: 'high' };

export function addOrgRoutes(api: Hono, deps: OrgRouteDeps) {
  const { orgs, service, accounts, forecast, live, reports, broadcasts, devices, push, signedIn, jsonBody, limitAuth, fail } = deps;
  const now = deps.now ?? Date.now;
  const alertLimiter = createRateLimit({ limit: deps.alertsPerHour ?? 10, windowMs: 3_600_000, now });
  const requestLimiter = createRateLimit({ limit: deps.requestsPerHour ?? 5, windowMs: 3_600_000, now });

  const noStore = async (c: Context, next: () => Promise<void>) => {
    await next();
    c.header('Cache-Control', 'no-store');
  };
  for (const p of ['/orgs', '/orgs/*', '/invites/*', '/org-requests']) api.use(p, noStore);

  const orgJson = (org: Org, role: OrgRole) => ({ id: org.id, name: org.name, kind: org.kind, country: org.country, verified: org.verified, createdAt: org.createdAt, role });
  const inviteJson = (i: Invite) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.createdAt, expiresAt: i.expiresAt });
  /** Where the org app opens an invitation; the browser adds its own origin. */
  const invitePath = (token: string) => `/org/invite/${token}`;

  function member(c: Context): { user: User; org: Org; role: OrgRole } {
    const user = signedIn(c);
    const org = orgs.get(c.req.param('id') ?? '');
    if (!org) return fail(404, 'not_found', 'No such organization.');
    const role = orgs.role(org.id, user.id);
    if (!role) return fail(403, 'not_member', 'You are not a member of this organization.');
    return { user, org, role };
  }
  function owner(c: Context) {
    const m = member(c);
    if (m.role !== 'owner') return fail(403, 'owner_only', 'Only an owner of the organization can do this.');
    return m;
  }
  function siteOf(c: Context, org: Org): Site {
    const site = orgs.sites(org.id).find((s) => s.id === c.req.param('siteId'));
    return site ?? fail(404, 'not_found', 'No such site.');
  }

  /**
   * The packaged country a point lies in, by its box.
   * ponytail: boxes, not borders, so a point just across a land border passes.
   * Clip with the Natural Earth polygons (as live.ts does) if that matters.
   */
  async function countryAt(lat: number, lon: number): Promise<string | null> {
    const index = await service.index();
    let best: { slug: string; d: number } | null = null;
    for (const m of index.countries) {
      const [w, s, e, n] = m.bbox;
      if (lon < w || lon > e || lat < s || lat > n) continue;
      const d = Math.hypot(lat - (s + n) / 2, lon - (w + e) / 2);
      if (!best || d < best.d) best = { slug: m.slug, d };
    }
    return best?.slug ?? null;
  }

  async function readSites(list: unknown): Promise<Site[]> {
    if (!Array.isArray(list) || list.length > MAX_SITES) return fail(400, 'bad_parameter', `sites must be a list of at most ${MAX_SITES}.`);
    const index = await service.index();
    const names = index.countries.map((m) => m.name).join(', ');
    const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
    const optional = (v: unknown, min: number, max: number, whole: boolean, name: string): number | null => {
      if (v === null || v === undefined || v === '') return null;
      if (!num(v, min, max) || (whole && !Number.isInteger(v))) return fail(400, 'bad_parameter', `${name} must be a number from ${min} to ${max}.`);
      return v as number;
    };
    const seen = new Set<string>();
    const out: Site[] = [];
    for (const [i, raw] of list.entries()) {
      const z = (raw ?? {}) as Record<string, unknown>;
      const name = typeof z.name === 'string' ? z.name.trim() : '';
      const label = name || `Site ${i + 1}`;
      if (!name || name.length > MAX_SITE_NAME) fail(400, 'bad_parameter', `${label}: a name of at most ${MAX_SITE_NAME} characters is required.`);
      if (!num(z.lat, -90, 90) || !num(z.lon, -180, 180)) fail(400, 'bad_parameter', `${label}: lat and lon must be decimal degrees.`);
      if (!num(z.radiusKm, MIN_SITE_KM, MAX_SITE_KM)) fail(400, 'bad_parameter', `${label}: radiusKm must be ${MIN_SITE_KM} to ${MAX_SITE_KM}.`);
      const id = typeof z.id === 'string' && SAFE_ID.test(z.id) ? z.id : randomUUID();
      if (seen.has(id)) fail(400, 'bad_parameter', `${label}: two sites share the id "${id}".`);
      seen.add(id);
      const country = await countryAt(z.lat as number, z.lon as number);
      if (!country) fail(400, 'outside_coverage', `${label} is outside the countries Firesight covers (${names}).`);
      out.push({
        id,
        name,
        lat: z.lat as number,
        lon: z.lon as number,
        radiusKm: z.radiusKm as number,
        country: country!,
        value: optional(z.value, 0, 1e13, false, `${label}: value`),
        people: optional(z.people, 0, 1e7, true, `${label}: people`),
        startedYear: optional(z.startedYear, 2000, new Date(now()).getUTCFullYear(), true, `${label}: startedYear`),
      });
    }
    return out;
  }

  /** What is known right now about each country that holds a site. A source that is down is null, not an error. */
  async function countryStates(sites: Site[]): Promise<{ states: Map<string, CountryState>; unavailable: string[] }> {
    const index = await service.index();
    const states = new Map<string, CountryState>();
    const down = new Set<string>();
    const since = new Date(now() - 48 * 3_600_000).toISOString();
    await Promise.all([...new Set(sites.map((s) => s.country))].map(async (slug) => {
      const manifest = index.countries.find((m) => m.slug === slug);
      if (!manifest) return;
      const [f, h] = await Promise.all([
        forecast ? forecast.country(slug).catch(() => null) : null,
        live?.available ? live.hotspots(manifest.iso, 48).then((a) => a.hotspots, () => null) : null,
      ]);
      if (!f) down.add('forecast');
      if (!h) down.add('live');
      states.set(slug, { forecast: f, hotspots: h, reports: reports ? reports.list({ bbox: manifest.bbox, since, limit: 1000 }) : [] });
    }));
    return { states, unavailable: [...down] };
  }

  function assess(site: Site, state: CountryState | undefined, days: number) {
    const danger: SiteDay[] | null = state?.forecast ? siteDanger(site, state.forecast, days) : null;
    const fires: SiteFires | null = state?.hotspots ? siteFires(site, state.hotspots) : null;
    const seen = state ? siteReports(site, state.reports) : [];
    return { site, ...siteScore({ danger, fires, reports: seen.length }, now()), danger, fires, reports: seen.length };
  }

  /** Fire close by, or a day at high danger or above this week. */
  const atRisk = (a: ReturnType<typeof assess>) =>
    (a.fires?.nearest != null && a.fires.nearest.edgeKm <= CLOSE_KM) || a.reports > 0 ||
    (a.danger ?? []).slice(0, 7).some((d) => atLeast(d.level, 'high'));

  // The harmonized record of a site's box: its size is fixed until the data is refreshed.
  const histories = new Map<string, ReturnType<typeof summarize>>();
  function summarize(p: Awaited<ReturnType<Service['prepare']>>, site: Site, place: string) {
    const a = p.analysis;
    const cal = p.ctx.cal;
    const totals = annualTotals(a.monthsH);
    const complete = totals.filter((t) => t.complete);
    const worst = complete.reduce<{ year: number; total: number } | null>((m, t) => (!m || t.total > m.total ? t : m), null);
    const last = cal.nDays - 1;
    const year = cal.year[last];
    const month = cal.month[last];
    const mv = selectionVerdict(a, cal, year, month);
    const wording = mv && monthWording(mv, year, month);
    const before = site.startedYear ? complete.filter((t) => t.year < site.startedYear!) : [];
    const after = site.startedYear ? complete.filter((t) => t.year >= site.startedYear!) : [];
    return {
      unit: 'active-fire cell-days per year, VIIRS-equivalent',
      coverageEnd: p.index.coverageEnd,
      years: totals.map((t) => ({ year: t.year, value: r1(t.total), complete: t.complete })),
      averagePerYear: r1(mean(complete.map((t) => t.total))),
      worstYear: worst && { year: worst.year, value: r1(worst.total) },
      yearsWithFire: complete.filter((t) => t.total >= 0.5).length,
      yearsOnRecord: complete.length,
      /** Shortest run of months holding two thirds of a usual year's fire. */
      criticalPeriod: a.peak && {
        startMonth: a.peak.start + 1,
        months: a.peak.length,
        name: a.peak.length === 1 ? MONTHS_LONG[a.peak.start] : `${MONTHS_LONG[a.peak.start]}–${MONTHS_LONG[(a.peak.start + a.peak.length - 1) % 12]}`,
        share: Math.round(a.peak.share * 100) / 100,
        ...untilPeak(a.peak.start, a.peak.length),
      },
      thisMonth: mv && wording && {
        level: mv.verdict.level,
        sentence: verdictSentence(mv.verdict, wording.what, wording.usual, place),
      },
      /** Project impact: the years before the project started against the years since. */
      project: site.startedYear && before.length > 0 && after.length > 0
        ? {
            startedYear: site.startedYear,
            before: { years: before.length, averagePerYear: r1(mean(before.map((t) => t.total))) },
            after: { years: after.length, averagePerYear: r1(mean(after.map((t) => t.total))) },
            change: mean(before.map((t) => t.total)) > 0
              ? Math.round((mean(after.map((t) => t.total)) / mean(before.map((t) => t.total)) - 1) * 100) / 100
              : null,
          }
        : null,
    };
  }

  /** Whether today is inside the critical period, and how many days until it next starts. */
  function untilPeak(start: number, length: number) {
    const t = new Date(now());
    const month = t.getUTCMonth();
    const inPeriod = (month - start + 12) % 12 < length;
    const year = t.getUTCFullYear() + (month >= start ? 1 : 0);
    const startsInDays = Math.ceil((Date.UTC(year, start, 1) - t.getTime()) / 86_400_000);
    return { inPeriod, startsInDays: inPeriod ? 0 : startsInDays };
  }

  async function history(site: Site) {
    const box = circleBox(site);
    const index = await service.index();
    const key = `${site.country}|${box.map((x) => x.toFixed(4)).join(',')}|${site.startedYear}|${index.coverageEnd}|${new Date(now()).toISOString().slice(0, 10)}`;
    let h = histories.get(key);
    if (!h) {
      h = summarize(await service.prepare(site.country, { vegOnly: true, dropLowConf: true, bbox: box }), site, site.name);
      if (histories.size > 2000) histories.clear();
      histories.set(key, h);
    }
    return h;
  }

  // ---- Asking for access (public) ----
  api.post('/org-requests', async (c) => {
    const wait = requestLimiter.take(deps.clientKey(c));
    if (wait > 0) {
      c.header('Retry-After', String(wait));
      return fail(429, 'rate_limited', `Too many requests. Try again in ${Math.ceil(wait / 60)} minutes.`);
    }
    const b = await jsonBody(c);
    // Bots fill every field; people never see this one.
    if (typeof b.website === 'string' && b.website !== '') return c.json({ request: { status: 'pending' } }, 201);
    const text = (k: string, max: number, required: boolean, label: string) => {
      const v = typeof b[k] === 'string' ? (b[k] as string).trim() : '';
      if ((required && !v) || v.length > max) return fail(400, 'bad_parameter', `${label}${required ? ' is required and' : ''} must be at most ${max} characters.`);
      return v;
    };
    const orgName = text('orgName', MAX_ORG_NAME, true, 'The organization name');
    if (!(ORG_KINDS as readonly unknown[]).includes(b.kind)) fail(400, 'bad_kind', `kind must be one of ${ORG_KINDS.join(', ')}.`);
    const country = text('country', 60, true, 'The country');
    const contactName = text('contactName', 80, true, 'Your name');
    const email = typeof b.email === 'string' ? normalizeEmail(b.email) : null;
    if (!email) return fail(400, 'bad_email', 'Enter a valid work email address.');
    const phone = text('phone', 40, false, 'The phone number');
    const message = text('message', 1000, false, 'The message');
    const n = b.sitesEstimate === undefined || b.sitesEstimate === null || b.sitesEstimate === '' ? null : Number(b.sitesEstimate);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 100_000)) fail(400, 'bad_parameter', 'The number of sites must be a whole number.');
    // A second submit from the same person updates nothing and adds nothing.
    const pending = orgs.pendingRequestFrom(email);
    if (pending) return c.json({ request: { status: pending.status, createdAt: pending.createdAt } }, 200);
    const r = orgs.addRequest({ orgName, kind: b.kind as OrgKind, country, contactName, email, phone, sitesEstimate: n, message });
    return c.json({ request: { status: r.status, createdAt: r.createdAt } }, 201);
  });

  // ---- Invitations (public: the link is the secret) ----
  function openInvite(c: Context) {
    const invite = orgs.inviteByToken(c.req.param('token') ?? '');
    const org = invite && orgs.get(invite.orgId);
    if (!invite || !org) return fail(404, 'invite_not_found', 'This invitation does not exist or was withdrawn. Ask for a new one.');
    if (invite.usedAt) return fail(410, 'invite_used', 'This invitation was already used. Sign in instead.');
    if (invite.expiresAt <= new Date(now()).toISOString()) return fail(410, 'invite_expired', 'This invitation has expired. Ask for a new one.');
    return { invite, org };
  }

  api.get('/invites/:token', (c) => {
    const { invite, org } = openInvite(c);
    return c.json({ org: { name: org.name, kind: org.kind, verified: org.verified }, email: invite.email, role: invite.role, expiresAt: invite.expiresAt });
  });

  /**
   * Signed in: joins with that account. Otherwise creates the account with the
   * invitation's email ({name, password}) and joins. An email that already has
   * an account answers 409 email_taken: sign in, then accept.
   */
  api.post('/invites/:token/accept', async (c) => {
    limitAuth(c);
    const { invite, org } = openInvite(c);
    let user: User;
    let token: string | null = null;
    if (c.req.header('Authorization')) {
      user = signedIn(c);
    } else {
      if (!accounts) return fail(503, 'accounts_unavailable', 'Accounts are not enabled on this server.');
      const body = await jsonBody(c);
      const created = await accounts.register({ email: invite.email, password: deps.readPassword(body, true), name: deps.readName(body) }).catch(deps.accountError);
      user = created.user;
      token = created.token;
    }
    if (!orgs.acceptInvite(invite.id, user.id)) return fail(410, 'invite_used', 'This invitation was already used. Sign in instead.');
    return c.json({ user, token, org: orgJson(org, orgs.role(org.id, user.id)!) });
  });

  // ---- My organizations ----
  // Each with its sites and its members-only alerts.
  api.get('/orgs', (c) => {
    const user = signedIn(c);
    const mine = orgs.forUser(user.id);
    const alerts = broadcasts?.activeForOrgs(mine.map((o) => o.id)) ?? [];
    return c.json({
      orgs: mine.map((o) => ({
        ...orgJson(o, o.role),
        sites: orgs.sites(o.id),
        alerts: alerts.filter((a) => a.orgId === o.id),
      })),
    });
  });

  api.get('/orgs/:id', (c) => {
    const { org, role } = member(c);
    const list = orgs.members(org.id);
    const users = accounts?.byIds(list.map((m) => m.userId)) ?? new Map<string, User>();
    return c.json({
      org: orgJson(org, role),
      members: list.map((m) => ({ id: m.userId, role: m.role, joinedAt: m.joinedAt, name: users.get(m.userId)?.name ?? '', email: users.get(m.userId)?.email ?? null })),
      sites: orgs.sites(org.id),
    });
  });

  api.patch('/orgs/:id', async (c) => {
    const { org } = owner(c);
    const b = await jsonBody(c);
    const raw = b.country;
    if (raw !== undefined && typeof raw !== 'string') return fail(400, 'invalid', 'The country must be text.');
    const country = (raw ?? '').trim().slice(0, 60);
    const updated = orgs.setCountry(org.id, country);
    if (!updated) return fail(404, 'not_found', 'No such organization.');
    return c.json({ org: orgJson(updated, 'owner') });
  });

  api.delete('/orgs/:id', (c) => {
    const { org } = owner(c);
    orgs.remove(org.id);
    return c.json({ deleted: true });
  });

  api.delete('/orgs/:id/members/me', (c) => {
    const { user, org } = member(c);
    if (!orgs.leave(org.id, user.id)) return fail(409, 'last_owner', 'You are the only owner. Delete the organization instead.');
    return c.json({ left: true });
  });

  api.delete('/orgs/:id/members/:userId', (c) => {
    const { org } = owner(c);
    const userId = c.req.param('userId') ?? '';
    if (!orgs.role(org.id, userId)) return fail(404, 'not_found', 'No such member.');
    if (!orgs.leave(org.id, userId)) return fail(409, 'last_owner', 'An organization keeps at least one owner.');
    return c.json({ removed: true });
  });

  // ---- Inviting the team ----
  api.get('/orgs/:id/invites', (c) => {
    const { org } = owner(c);
    return c.json({ invites: orgs.invites(org.id).map(inviteJson) });
  });

  api.post('/orgs/:id/invites', async (c) => {
    const { org } = owner(c);
    const b = await jsonBody(c);
    const email = typeof b.email === 'string' ? normalizeEmail(b.email) : null;
    if (!email) return fail(400, 'bad_email', 'Enter a valid email address.');
    const role = (b.role ?? 'member') as OrgRole;
    if (!ORG_ROLES.includes(role)) fail(400, 'bad_role', 'role must be owner or member.');
    if (orgs.invites(org.id).length >= 100) fail(429, 'too_many', 'Withdraw some pending invitations first.');
    const { invite, token } = orgs.createInvite({ orgId: org.id, email, role });
    return c.json({ invite: inviteJson(invite), path: invitePath(token) }, 201);
  });

  api.delete('/orgs/:id/invites/:inviteId', (c) => {
    const { org } = owner(c);
    if (!orgs.revokeInvite(org.id, c.req.param('inviteId') ?? '')) return fail(404, 'not_found', 'No such pending invitation.');
    return c.json({ revoked: true });
  });

  // ---- Notifications: sites that need action, the daily digest, alerts sent ----
  api.get('/orgs/:id/notifications', (c) => {
    const { user, org } = member(c);
    const list = orgs.notifications(org.id, 50);
    const readAt = orgs.readAt(org.id, user.id);
    return c.json({ notifications: list, readAt, unread: list.filter((n) => !readAt || n.createdAt > readAt).length });
  });

  api.post('/orgs/:id/notifications/read', (c) => {
    const { user, org } = member(c);
    return c.json({ readAt: orgs.markRead(org.id, user.id) });
  });

  api.put('/orgs/:id/sites', bodyLimit({
    maxSize: 256 * 1024,
    onError: () => fail(413, 'too_large', 'Too much data.'),
  }), async (c) => {
    const { org } = owner(c);
    const sites = await readSites((await jsonBody(c)).sites);
    return c.json({ sites: orgs.setSites(org.id, sites) });
  });

  // ---- The risk board: the route, and the monitor that writes notifications ----
  async function board(org: Org, days: number) {
    const sites = orgs.sites(org.id);
    const { states, unavailable } = await countryStates(sites);
    const board = sites.map((s) => assess(s, states.get(s.country), days)).sort((a, b) => b.score - a.score || a.site.name.localeCompare(b.site.name));
    const risky = board.filter(atRisk);
    const sum = (list: typeof board, k: 'value' | 'people') => list.reduce((t, a) => t + (a.site[k] ?? 0), 0);
    return {
      generatedAt: new Date(now()).toISOString(),
      /** Sources that did not answer: scores are computed without them. */
      unavailable,
      summary: {
        sites: board.length,
        act: board.filter((a) => a.status === 'act').length,
        watch: board.filter((a) => a.status === 'watch').length,
        ok: board.filter((a) => a.status === 'ok').length,
        /** Sites with fire close by or a day at high danger or above this week. */
        atRisk: { sites: risky.length, value: sum(risky, 'value'), people: sum(risky, 'people') },
        total: { value: sum(board, 'value'), people: sum(board, 'people') },
      },
      note: 'The score is a plain rule table: fires seen now outrank weather. Fire danger says how easily fires start and spread, not where one will start.',
      sites: board,
    };
  }

  api.get('/orgs/:id/board', async (c) => {
    const { org, role } = member(c);
    const days = Number(c.req.query('days') ?? 7);
    if (!Number.isInteger(days) || days < 1 || days > FORECAST_DAYS) fail(400, 'bad_parameter', `days must be a whole number from 1 to ${FORECAST_DAYS}.`);
    return c.json({ org: orgJson(org, role), ...(await board(org, days)) });
  });

  // ---- One site: history, danger, fires and ground reports ----
  api.get('/orgs/:id/sites/:siteId/report', async (c) => {
    const { org } = member(c);
    const site = siteOf(c, org);
    const { states, unavailable } = await countryStates([site]);
    const state = states.get(site.country);
    const a = assess(site, state, FORECAST_DAYS);
    const near = (state?.hotspots ?? [])
      .filter((h) => h.confidence !== 'low')
      .map((h) => ({ ...h, km: r1(distanceKm(site.lat, site.lon, h.lat, h.lon)) }))
      .filter((h) => h.km <= site.radiusKm + 25)
      .map((h) => ({ ...h, inside: h.km <= site.radiusKm, compass: compass(site.lat, site.lon, h.lat, h.lon) }))
      .sort((x, y) => x.km - y.km)
      .slice(0, 200);
    return c.json({
      ...a,
      unavailable,
      history: await history(site),
      hotspots: near,
      // Photos are at /api/v1/reports/{id}/photo.
      groundReports: state ? siteReports(site, state.reports) : [],
    });
  });

  // ---- Insurers: what the record says about every site, and what is exposed this week ----
  api.get('/orgs/:id/exposure', async (c) => {
    const { org } = member(c);
    const sites = orgs.sites(org.id);
    const { states, unavailable } = await countryStates(sites);
    const rows = [];
    for (const s of sites) {
      const a = assess(s, states.get(s.country), 7);
      const h = await history(s);
      const peak = (a.danger ?? []).reduce<SiteDay | null>((m, d) => (!m || d.fwi > m.fwi ? d : m), null);
      rows.push({
        site: s,
        score: a.score,
        status: a.status,
        atRisk: atRisk(a),
        peakDanger: peak && { date: peak.date, level: peak.level, fwi: peak.fwi },
        averagePerYear: h.averagePerYear,
        worstYear: h.worstYear,
        yearsWithFire: h.yearsWithFire,
        yearsOnRecord: h.yearsOnRecord,
        criticalPeriod: h.criticalPeriod?.name ?? null,
        history: h,
      });
    }
    const risky = rows.filter((r) => r.atRisk);
    return c.json({
      unavailable,
      unit: 'active-fire cell-days per year, VIIRS-equivalent, inside the box around each site',
      totalValue: rows.reduce((t, r) => t + (r.site.value ?? 0), 0),
      valueAtRisk: risky.reduce((t, r) => t + (r.site.value ?? 0), 0),
      sitesAtRisk: risky.length,
      sites: rows,
    });
  });

  // ---- Claim check: did a satellite see fire at this site around this date? ----
  api.get('/orgs/:id/sites/:siteId/evidence', async (c) => {
    const { org } = member(c);
    const site = siteOf(c, org);
    const q = c.req.query();
    const whole = (v: string | undefined, def: number, min: number, max: number, name: string) => {
      const n = v === undefined ? def : Number(v);
      if (!Number.isInteger(n) || n < min || n > max) return fail(400, 'bad_parameter', `${name} must be a whole number from ${min} to ${max}.`);
      return n;
    };
    const day = parseIsoDate(q.date ?? '');
    if (Number.isNaN(day)) fail(400, 'bad_date', 'date is required, as YYYY-MM-DD.');
    const days = whole(q.days, 3, 0, 30, 'days');
    const km = whole(q.km, 5, 0, 50, 'km');
    const reach = site.radiusKm + km;
    // Everything the satellites saw: a claim is about any fire, not only vegetation fires.
    const filters = { vegOnly: false, dropLowConf: false, bbox: circleBox({ ...site, radiusKm: reach }) };
    const p = await service.prepare(site.country, filters);
    const first = p.manifest.firstDay;
    const last = p.index.coverageEndDay;
    const from = Math.max(first, day - days);
    const to = Math.min(last, day + days);
    const detections = from > to ? [] : (await service.rows(site.country, filters, from, to, 20_000)).rows
      .map((r) => {
        const d = distanceKm(site.lat, site.lon, r.latitude, r.longitude);
        return {
          date: r.acq_date,
          timeUtc: `${r.acq_time.slice(0, 2)}:${r.acq_time.slice(2)}`,
          lat: r.latitude,
          lon: r.longitude,
          km: r1(d),
          inside: d <= site.radiusKm,
          compass: compass(site.lat, site.lon, r.latitude, r.longitude),
          instrument: r.instrument,
          satellite: SATELLITE_NAME[r.satellite] ?? r.satellite,
          confidence: CONFIDENCE_NAME[r.confidence] ?? `${r.confidence}%`,
          frp: r.frp,
        };
      })
      .filter((r) => r.km <= reach)
      .sort((a, b) => a.km - b.km);
    const fireDays = [...new Set(detections.map((d) => d.date))].sort();
    const closest = detections[0];
    const inside = detections.filter((d) => d.inside).length;
    const fromIso = new Date(Date.UTC(2000, 0, 1) + (day - days) * 86_400_000).toISOString();
    const toIso = new Date(Date.UTC(2000, 0, 1) + (day + days + 1) * 86_400_000).toISOString();
    const ground = reports
      ? reports.list({ bbox: circleBox({ ...site, radiusKm: reach }), since: fromIso, limit: 1000 })
        .filter((r) => r.createdAt < toIso && distanceKm(site.lat, site.lon, r.lat, r.lon) <= reach)
      : [];
    const window = `${isoDate(from)} to ${isoDate(to)}`;
    const where = km === 0 ? 'inside the site' : `within ${km} km of the site`;
    return c.json({
      site,
      date: isoDate(day),
      window: { from: isoDate(day - days), to: isoDate(day + days), searched: from > to ? null : { from: isoDate(from), to: isoDate(to) } },
      withinKm: km,
      found: detections.length > 0,
      summary: from > to
        ? `The record runs from ${isoDate(first)} to ${isoDate(last)}; this window is outside it.`
        : closest
          ? `Satellites detected fire ${where} on ${fireDays.length} day${fireDays.length === 1 ? '' : 's'} (${window}): ${detections.length} detection${detections.length === 1 ? '' : 's'}, ${inside} inside the site. The closest was ${closest.km} km ${closest.compass} of its centre on ${closest.date} (${closest.instrument}, ${closest.satellite}).`
          : `No satellite detection ${where} from ${window}.`,
      caveat: 'A detection is evidence of fire at that place and time. No detection is not proof of no fire: cloud and smoke hide fires, satellites pass only a few times a day, and small or short fires are missed. Each detection marks a pixel of about 375 m (VIIRS) or 1 km (MODIS).',
      fireDays,
      detections: detections.slice(0, 500),
      detectionsTotal: detections.length,
      groundReports: ground,
    });
  });

  // ---- Alerts: to members always, to the public inside the site when verified ----
  api.get('/orgs/:id/alerts', (c) => {
    const { org } = member(c);
    return c.json({ alerts: broadcasts?.recentForOrg(org.id, 50) ?? [], canAlertPublic: org.verified, push: !!push?.available });
  });

  api.post('/orgs/:id/alerts', async (c) => {
    const { org } = owner(c);
    if (!broadcasts) return fail(503, 'broadcasts_unavailable', 'Alerts are not enabled on this server.');
    const b = await jsonBody(c);
    const text = (k: string, max: number, required: boolean) => {
      const v = typeof b[k] === 'string' ? (b[k] as string).trim() : '';
      if ((required && !v) || v.length > max) return fail(400, 'bad_text', `A title (up to ${MAX_TITLE} characters) and a message (up to ${MAX_MESSAGE}) are required.`);
      return v;
    };
    const title = text('title', MAX_TITLE, true);
    const message = text('message', MAX_MESSAGE, true);
    const titleAr = text('titleAr', MAX_TITLE, false);
    const messageAr = text('messageAr', MAX_MESSAGE, false);
    const level = b.level as BroadcastLevel;
    if (!BROADCAST_LEVELS.includes(level)) fail(400, 'bad_level', `level must be ${BROADCAST_LEVELS.join(', ')}.`);
    const hours = b.hours === undefined ? 24 : Number(b.hours);
    if (!Number.isFinite(hours) || hours < 1 || hours > MAX_HOURS) fail(400, 'bad_hours', `It can stay active 1 to ${MAX_HOURS} hours.`);
    const site = orgs.sites(org.id).find((s) => s.id === b.siteId);
    if (!site) return fail(400, 'bad_site', 'siteId must be one of the organization\'s sites: an alert is about a place.');
    const audience = b.audience === 'public' ? 'public' : 'members';
    if (audience === 'public' && !org.verified) {
      return fail(403, 'not_verified', 'Only verified organizations (fire stations, civil defence, municipalities) can alert the public. Ask Firesight to verify yours.');
    }
    const wait = alertLimiter.take(org.id);
    if (wait > 0) {
      c.header('Retry-After', String(wait));
      return fail(429, 'rate_limited', `Too many alerts. Try again in ${Math.ceil(wait / 60)} minutes.`);
    }
    const sent = broadcasts.add({
      title, message, titleAr, messageAr, level, hours,
      lat: site.lat, lon: site.lon, radiusKm: site.radiusKm,
      sender: org.name, orgId: org.id, audience,
    });
    orgs.addNotification(org.id, {
      kind: 'alert',
      title: `${audience === 'public' ? 'Public alert' : 'Alert to members'}: ${title}`,
      body: `${site.name}. ${message}`,
      siteId: site.id,
    });
    const to = devices
      ? [
          ...devices.tokensForUsers(orgs.members(org.id).map((m) => m.userId)),
          ...(audience === 'public' ? devices.recipients(site) : []),
        ]
      : [];
    return c.json({ alert: await deliver(sent, to, { broadcasts, devices, push }) }, 201);
  });

  api.post('/orgs/:id/alerts/:alertId/cancel', (c) => {
    const { org } = owner(c);
    const alert = broadcasts?.get(c.req.param('alertId') ?? '');
    if (!alert || alert.orgId !== org.id) return fail(404, 'not_found', 'No such alert.');
    return c.json({ alert: broadcasts!.cancel(alert.id) });
  });

  return { board };
}
