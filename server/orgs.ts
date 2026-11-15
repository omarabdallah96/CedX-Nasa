// Organizations: a company, fire station, insurer or NGO that watches many
// places at once. An organization owns a list of sites (a named circle, like
// an alert zone) and has members, who are ordinary accounts. Access is by
// invitation only: an organization asks for access, Firesight approves it and
// hands its owner a one-time link, and the owner invites the team the same way.
// The console ranks the sites by risk; a monitor writes notifications when a
// site needs action, and a daily digest.
//
// Stored in SQLite next to the reports.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const ORG_KINDS = ['fire_station', 'insurer', 'company', 'ngo'] as const;
export type OrgKind = (typeof ORG_KINDS)[number];
export type OrgRole = 'owner' | 'member';
export const ORG_ROLES: readonly OrgRole[] = ['owner', 'member'];

export const MAX_ORG_NAME = 80;
export const MAX_SITE_NAME = 80;
export const MAX_SITES = 200;
export const MIN_SITE_KM = 0.5;
export const MAX_SITE_KM = 50;
export const INVITE_DAYS = 14;

export interface Org {
  id: string;
  name: string;
  kind: OrgKind;
  /** Country the organization is based in. */
  country: string;
  /** Set by an admin: this organization may alert the public inside its sites. */
  verified: boolean;
  createdAt: string;
}

export interface Site {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  /** Country slug the site lies in. */
  country: string;
  /** Insured or asset value, in the organization's own currency. */
  value: number | null;
  /** People living or working there. */
  people: number | null;
  /** Year a project started there (NGOs): history is compared before and after. */
  startedYear: number | null;
}

export type RequestStatus = 'pending' | 'approved' | 'declined';
export interface OrgRequest {
  id: string;
  orgName: string;
  kind: OrgKind;
  country: string;
  contactName: string;
  email: string;
  phone: string;
  sitesEstimate: number | null;
  message: string;
  status: RequestStatus;
  createdAt: string;
  decidedAt: string | null;
  orgId: string | null;
}
export type NewOrgRequest = Omit<OrgRequest, 'id' | 'status' | 'createdAt' | 'decidedAt' | 'orgId'>;

export interface Invite {
  id: string;
  orgId: string;
  email: string;
  role: OrgRole;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export type NotificationKind = 'act' | 'fire' | 'digest' | 'alert';
export interface OrgNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  siteId: string | null;
  createdAt: string;
}

/** What the monitor last saw at a site. */
export interface SiteState {
  status: 'act' | 'watch' | 'ok';
  score: number;
  /** Satellite detections inside the site. */
  inside: number;
}

interface OrgRow { id: string; name: string; kind: string; country: string; verified: number; created_at: string }
interface SiteRow { id: string; name: string; lat: number; lon: number; radius_km: number; country: string; value: number | null; people: number | null; started_year: number | null }
interface RequestRow {
  id: string; org_name: string; kind: string; country: string; contact_name: string; email: string; phone: string;
  sites_estimate: number | null; message: string; status: string; created_at: string; decided_at: string | null; org_id: string | null;
}
interface InviteRow { id: string; org_id: string; email: string; role: string; created_at: string; expires_at: string; used_at: string | null }
interface NotificationRow { id: string; kind: string; title: string; body: string; site_id: string | null; created_at: string }

const kindOf = (k: string): OrgKind => ((ORG_KINDS as readonly string[]).includes(k) ? (k as OrgKind) : 'company');
const roleOf = (r: string): OrgRole => (r === 'owner' ? 'owner' : 'member');
const toOrg = (r: OrgRow): Org => ({ id: r.id, name: r.name, kind: kindOf(r.kind), country: r.country ?? '', verified: r.verified === 1, createdAt: r.created_at });
const toSite = (r: SiteRow): Site => ({
  id: r.id, name: r.name, lat: r.lat, lon: r.lon, radiusKm: r.radius_km, country: r.country,
  value: r.value, people: r.people, startedYear: r.started_year,
});
const toRequest = (r: RequestRow): OrgRequest => ({
  id: r.id, orgName: r.org_name, kind: kindOf(r.kind), country: r.country, contactName: r.contact_name, email: r.email, phone: r.phone,
  sitesEstimate: r.sites_estimate, message: r.message, status: r.status as RequestStatus, createdAt: r.created_at, decidedAt: r.decided_at, orgId: r.org_id,
});
const toInvite = (r: InviteRow): Invite => ({
  id: r.id, orgId: r.org_id, email: r.email, role: roleOf(r.role), createdAt: r.created_at, expiresAt: r.expires_at, usedAt: r.used_at,
});
const toNotification = (r: NotificationRow): OrgNotification => ({
  id: r.id, kind: r.kind as NotificationKind, title: r.title, body: r.body, siteId: r.site_id, createdAt: r.created_at,
});

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface OrgStore {
  /** Created by an admin, from an approved request. Its owner joins through an invite. */
  create(input: { name: string; kind: OrgKind; country?: string; verified?: boolean }): Org;
  get(id: string): Org | null;
  /** The organizations an account belongs to, oldest first. */
  forUser(userId: string): (Org & { role: OrgRole })[];
  role(orgId: string, userId: string): OrgRole | null;
  /** False when the member is the last owner: delete the organization instead. */
  leave(orgId: string, userId: string): boolean;
  members(orgId: string): { userId: string; role: OrgRole; joinedAt: string }[];
  sites(orgId: string): Site[];
  /** Replaces the site list. */
  setSites(orgId: string, sites: Site[]): Site[];
  setVerified(orgId: string, verified: boolean): Org | null;
  setCountry(orgId: string, country: string): Org | null;
  remove(orgId: string): boolean;
  /** Account deleted: leaves every organization; ones left with nobody are deleted. */
  removeUser(userId: string): void;
  /** Newest first, with counts, for the admin page and the monitor. */
  all(limit: number): (Org & { members: number; sites: number; ownerId: string | null })[];

  // ---- Requests for access ----
  addRequest(r: NewOrgRequest): OrgRequest;
  /** A pending request from this email, so a second submit does not pile up. */
  pendingRequestFrom(email: string): OrgRequest | null;
  /** Pending first, then newest. */
  requests(limit: number): OrgRequest[];
  getRequest(id: string): OrgRequest | null;
  decideRequest(id: string, status: 'approved' | 'declined', orgId?: string): OrgRequest | null;

  // ---- One-time invitations ----
  /** The token is returned once; only its hash is stored. */
  createInvite(input: { orgId: string; email: string; role: OrgRole }): { invite: Invite; token: string };
  inviteByToken(token: string): Invite | null;
  /** Pending (not used, not expired), newest first. */
  invites(orgId: string): Invite[];
  revokeInvite(orgId: string, inviteId: string): boolean;
  /** Marks the invite used and adds the member. False when it was used meanwhile. */
  acceptInvite(inviteId: string, userId: string): boolean;

  // ---- The monitor and its notifications ----
  siteStates(orgId: string): Map<string, SiteState>;
  setSiteStates(orgId: string, states: Map<string, SiteState>): void;
  addNotification(orgId: string, n: { kind: NotificationKind; title: string; body: string; siteId?: string | null }): OrgNotification;
  notifications(orgId: string, limit: number): OrgNotification[];
  lastNotificationAt(orgId: string, kind: NotificationKind): string | null;
  readAt(orgId: string, userId: string): string | null;
  markRead(orgId: string, userId: string): string;
  close(): void;
}

/** `dir` holds orgs.db; ':memory:' keeps everything in memory (tests). */
export function createOrgStore(dir: string, { now = Date.now }: { now?: () => number } = {}): OrgStore {
  const memory = dir === ':memory:';
  if (!memory) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(memory ? ':memory:' : path.join(dir, 'orgs.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS org_members (
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (org_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS org_members_user ON org_members (user_id);
    CREATE TABLE IF NOT EXISTS org_sites (
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      position INTEGER NOT NULL,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      radius_km REAL NOT NULL,
      country TEXT NOT NULL,
      value REAL,
      people INTEGER,
      started_year INTEGER,
      PRIMARY KEY (org_id, id)
    );
    CREATE TABLE IF NOT EXISTS org_requests (
      id TEXT PRIMARY KEY,
      org_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      country TEXT NOT NULL,
      contact_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      sites_estimate INTEGER,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      decided_at TEXT,
      org_id TEXT
    );
    CREATE TABLE IF NOT EXISTS org_invites (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      used_by TEXT
    );
    CREATE TABLE IF NOT EXISTS org_site_state (
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      site_id TEXT NOT NULL,
      status TEXT NOT NULL,
      score INTEGER NOT NULL,
      inside INTEGER NOT NULL,
      PRIMARY KEY (org_id, site_id)
    );
    CREATE TABLE IF NOT EXISTS org_notifications (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      site_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS org_notifications_org ON org_notifications (org_id, created_at);
    CREATE TABLE IF NOT EXISTS org_reads (
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      read_at TEXT NOT NULL,
      PRIMARY KEY (org_id, user_id)
    );
  `);
  // Databases from before invitations kept a join code per organization: drop it.
  // SQLite cannot drop a UNIQUE column, so the table is rebuilt, with foreign keys
  // off so the swap does not cascade into members and sites.
  const orgColumns = (db.prepare('PRAGMA table_info(orgs)').all() as unknown as { name: string }[]).map((c) => c.name);
  if (!orgColumns.includes('country')) {
    db.exec("ALTER TABLE orgs ADD COLUMN country TEXT NOT NULL DEFAULT ''");
  }
  if (orgColumns.includes('join_code')) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`BEGIN;
      CREATE TABLE orgs_new (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, country TEXT NOT NULL DEFAULT '', verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      INSERT INTO orgs_new (id, name, kind, country, verified, created_at) SELECT id, name, kind, COALESCE(country, ''), verified, created_at FROM orgs;
      DROP TABLE orgs;
      ALTER TABLE orgs_new RENAME TO orgs;
      COMMIT;`);
    db.exec('PRAGMA foreign_keys = ON');
  }
  const iso = (ms: number) => new Date(ms).toISOString();
  const byId = db.prepare('SELECT * FROM orgs WHERE id = ?');
  const roleRow = db.prepare('SELECT role FROM org_members WHERE org_id = ? AND user_id = ?');
  const ownerCount = db.prepare(`SELECT COUNT(*) AS n FROM org_members WHERE org_id = ? AND role = 'owner'`);
  const get = (id: string) => {
    const row = byId.get(id) as OrgRow | undefined;
    return row ? toOrg(row) : null;
  };
  const getRequest = (id: string) => {
    const row = db.prepare('SELECT * FROM org_requests WHERE id = ?').get(id) as RequestRow | undefined;
    return row ? toRequest(row) : null;
  };
  /** Runs `f` in one transaction. */
  const tx = <T>(f: () => T): T => {
    db.exec('BEGIN');
    try {
      const out = f();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };

  return {
    create({ name, kind, country = '', verified = false }) {
      const id = randomUUID();
      db.prepare('INSERT INTO orgs (id, name, kind, country, verified, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, kind, country, verified ? 1 : 0, iso(now()));
      return get(id)!;
    },

    get,

    forUser(userId) {
      const rows = db.prepare(`
        SELECT orgs.*, org_members.role AS role FROM org_members JOIN orgs ON orgs.id = org_members.org_id
        WHERE org_members.user_id = ? ORDER BY org_members.joined_at`).all(userId) as unknown as (OrgRow & { role: string })[];
      return rows.map((r) => ({ ...toOrg(r), role: roleOf(r.role) }));
    },

    role(orgId, userId) {
      const row = roleRow.get(orgId, userId) as { role: string } | undefined;
      return row ? roleOf(row.role) : null;
    },

    leave(orgId, userId) {
      const role = (roleRow.get(orgId, userId) as { role: string } | undefined)?.role;
      if (!role) return true;
      if (role === 'owner' && Number((ownerCount.get(orgId) as { n: number }).n) <= 1) return false;
      db.prepare('DELETE FROM org_members WHERE org_id = ? AND user_id = ?').run(orgId, userId);
      return true;
    },

    members(orgId) {
      const rows = db.prepare('SELECT user_id, role, joined_at FROM org_members WHERE org_id = ? ORDER BY joined_at').all(orgId) as unknown as
        { user_id: string; role: string; joined_at: string }[];
      return rows.map((r) => ({ userId: r.user_id, role: roleOf(r.role), joinedAt: r.joined_at }));
    },

    sites(orgId) {
      return (db.prepare('SELECT * FROM org_sites WHERE org_id = ? ORDER BY position').all(orgId) as unknown as SiteRow[]).map(toSite);
    },

    setSites(orgId, sites) {
      const kept = sites.slice(0, MAX_SITES);
      const insert = db.prepare(`INSERT INTO org_sites (org_id, id, position, name, lat, lon, radius_km, country, value, people, started_year)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      tx(() => {
        db.prepare('DELETE FROM org_sites WHERE org_id = ?').run(orgId);
        kept.forEach((s, i) => insert.run(orgId, s.id, i, s.name, s.lat, s.lon, s.radiusKm, s.country, s.value, s.people, s.startedYear));
        // Sites that are gone take what the monitor knew about them along.
        db.prepare(`DELETE FROM org_site_state WHERE org_id = ? AND site_id NOT IN (SELECT id FROM org_sites WHERE org_id = ?)`).run(orgId, orgId);
      });
      return kept;
    },

    setVerified(orgId, verified) {
      db.prepare('UPDATE orgs SET verified = ? WHERE id = ?').run(verified ? 1 : 0, orgId);
      return get(orgId);
    },

    setCountry(orgId, country) {
      db.prepare('UPDATE orgs SET country = ? WHERE id = ?').run(country, orgId);
      return get(orgId);
    },

    remove(orgId) {
      return Number(db.prepare('DELETE FROM orgs WHERE id = ?').run(orgId).changes) > 0;
    },

    removeUser(userId) {
      db.prepare('DELETE FROM org_members WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM org_reads WHERE user_id = ?').run(userId);
      // An organization nobody is left in, and nobody can still join, goes too.
      db.prepare(`DELETE FROM orgs WHERE id NOT IN (SELECT org_id FROM org_members)
        AND id NOT IN (SELECT org_id FROM org_invites WHERE used_at IS NULL AND expires_at > ?)`).run(iso(now()));
    },

    all(limit) {
      const rows = db.prepare(`
        SELECT orgs.*,
          (SELECT COUNT(*) FROM org_members m WHERE m.org_id = orgs.id) AS members,
          (SELECT COUNT(*) FROM org_sites s WHERE s.org_id = orgs.id) AS sites,
          (SELECT user_id FROM org_members m WHERE m.org_id = orgs.id AND m.role = 'owner' ORDER BY joined_at LIMIT 1) AS owner_id
        FROM orgs ORDER BY created_at DESC LIMIT ?`).all(limit) as unknown as (OrgRow & { members: number; sites: number; owner_id: string | null })[];
      return rows.map((r) => ({ ...toOrg(r), members: Number(r.members), sites: Number(r.sites), ownerId: r.owner_id }));
    },

    // ---- Requests ----
    addRequest(r) {
      const id = randomUUID();
      db.prepare(`INSERT INTO org_requests (id, org_name, kind, country, contact_name, email, phone, sites_estimate, message, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(
        id, r.orgName, r.kind, r.country, r.contactName, r.email, r.phone, r.sitesEstimate, r.message, iso(now()),
      );
      return getRequest(id)!;
    },

    pendingRequestFrom(email) {
      const row = db.prepare(`SELECT * FROM org_requests WHERE email = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`).get(email) as RequestRow | undefined;
      return row ? toRequest(row) : null;
    },

    requests(limit) {
      return (db.prepare(`SELECT * FROM org_requests ORDER BY status = 'pending' DESC, created_at DESC LIMIT ?`).all(limit) as unknown as RequestRow[]).map(toRequest);
    },

    getRequest,

    decideRequest(id, status, orgId) {
      db.prepare('UPDATE org_requests SET status = ?, decided_at = ?, org_id = ? WHERE id = ?').run(status, iso(now()), orgId ?? null, id);
      return getRequest(id);
    },

    // ---- Invites ----
    createInvite({ orgId, email, role }) {
      const id = randomUUID();
      const token = randomBytes(24).toString('base64url');
      db.prepare('INSERT INTO org_invites (id, org_id, token_hash, email, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        id, orgId, sha256(token), email, role, iso(now()), iso(now() + INVITE_DAYS * 86_400_000),
      );
      return { invite: toInvite(db.prepare('SELECT * FROM org_invites WHERE id = ?').get(id) as unknown as InviteRow), token };
    },

    inviteByToken(token) {
      const row = db.prepare('SELECT * FROM org_invites WHERE token_hash = ?').get(sha256(token)) as InviteRow | undefined;
      return row ? toInvite(row) : null;
    },

    invites(orgId) {
      return (db.prepare('SELECT * FROM org_invites WHERE org_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC')
        .all(orgId, iso(now())) as unknown as InviteRow[]).map(toInvite);
    },

    revokeInvite(orgId, inviteId) {
      return Number(db.prepare('DELETE FROM org_invites WHERE id = ? AND org_id = ? AND used_at IS NULL').run(inviteId, orgId).changes) > 0;
    },

    acceptInvite(inviteId, userId) {
      return tx(() => {
        const row = db.prepare('SELECT * FROM org_invites WHERE id = ?').get(inviteId) as InviteRow | undefined;
        if (!row || row.used_at || row.expires_at <= iso(now())) return false;
        db.prepare('UPDATE org_invites SET used_at = ?, used_by = ? WHERE id = ?').run(iso(now()), userId, inviteId);
        // Already a member: an owner invite promotes, a member invite never demotes.
        db.prepare(`INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)
          ON CONFLICT (org_id, user_id) DO UPDATE SET role = CASE WHEN excluded.role = 'owner' THEN 'owner' ELSE org_members.role END`)
          .run(row.org_id, userId, row.role, iso(now()));
        return true;
      });
    },

    // ---- Monitor ----
    siteStates(orgId) {
      const rows = db.prepare('SELECT site_id, status, score, inside FROM org_site_state WHERE org_id = ?').all(orgId) as unknown as
        { site_id: string; status: SiteState['status']; score: number; inside: number }[];
      return new Map(rows.map((r) => [r.site_id, { status: r.status, score: r.score, inside: r.inside }]));
    },

    setSiteStates(orgId, states) {
      const insert = db.prepare('INSERT INTO org_site_state (org_id, site_id, status, score, inside) VALUES (?, ?, ?, ?, ?)');
      tx(() => {
        db.prepare('DELETE FROM org_site_state WHERE org_id = ?').run(orgId);
        for (const [siteId, s] of states) insert.run(orgId, siteId, s.status, s.score, s.inside);
      });
    },

    addNotification(orgId, n) {
      const id = randomUUID();
      db.prepare('INSERT INTO org_notifications (id, org_id, kind, title, body, site_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        id, orgId, n.kind, n.title, n.body, n.siteId ?? null, iso(now()),
      );
      return toNotification(db.prepare('SELECT * FROM org_notifications WHERE id = ?').get(id) as unknown as NotificationRow);
    },

    notifications(orgId, limit) {
      return (db.prepare('SELECT * FROM org_notifications WHERE org_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
        .all(orgId, limit) as unknown as NotificationRow[]).map(toNotification);
    },

    lastNotificationAt(orgId, kind) {
      const row = db.prepare('SELECT created_at FROM org_notifications WHERE org_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1').get(orgId, kind) as
        { created_at: string } | undefined;
      return row?.created_at ?? null;
    },

    readAt(orgId, userId) {
      return (db.prepare('SELECT read_at FROM org_reads WHERE org_id = ? AND user_id = ?').get(orgId, userId) as { read_at: string } | undefined)?.read_at ?? null;
    },

    markRead(orgId, userId) {
      const at = iso(now());
      db.prepare(`INSERT INTO org_reads (org_id, user_id, read_at) VALUES (?, ?, ?)
        ON CONFLICT (org_id, user_id) DO UPDATE SET read_at = excluded.read_at`).run(orgId, userId, at);
      return at;
    },

    close() {
      db.close();
    },
  };
}
