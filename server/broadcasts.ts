// Zone alerts sent from the admin page: a message for everyone whose alert
// zone (or current position) overlaps a circle. Phones download the active
// ones during their alert check and decide on the phone whether they match,
// so the server never learns where people's zones are.
//
// Stored in SQLite next to the reports.
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DeviceStore, Recipient } from './devices.ts';
import type { Push } from './push.ts';

export const BROADCAST_LEVELS = ['info', 'warning', 'danger'] as const;
export type BroadcastLevel = (typeof BROADCAST_LEVELS)[number];
export const MAX_TITLE = 80;
export const MAX_MESSAGE = 500;
export const MAX_RADIUS_KM = 200;
export const MAX_HOURS = 24 * 14;

export interface NewBroadcast {
  title: string;
  message: string;
  /** Optional Arabic text; phones in Arabic fall back to the English text. */
  titleAr: string;
  messageAr: string;
  level: BroadcastLevel;
  lat: number;
  lon: number;
  radiusKm: number;
  /** How long it stays active. */
  hours: number;
  /** An organization's alert: its name is shown as the sender. */
  sender?: string;
  orgId?: string;
  /** 'members': only the organization's members receive it. Default 'public'. */
  audience?: BroadcastAudience;
}

export type BroadcastAudience = 'public' | 'members';

export interface Broadcast {
  id: string;
  title: string;
  message: string;
  titleAr: string;
  messageAr: string;
  level: BroadcastLevel;
  lat: number;
  lon: number;
  radiusKm: number;
  createdAt: string;
  expiresAt: string;
  cancelled: boolean;
  /** The organization that sent it; empty for alerts from the admin page. */
  sender: string;
  orgId: string | null;
  audience: BroadcastAudience;
  /** Phones the push went to, and how many FCM accepted. Null before sending. */
  pushed: { recipients: number; delivered: number } | null;
}

interface Row {
  id: string;
  title: string;
  message: string;
  title_ar: string;
  message_ar: string;
  level: string;
  lat: number;
  lon: number;
  radius_km: number;
  created_at: string;
  expires_at: string;
  cancelled: number;
  sender: string;
  org_id: string | null;
  audience: string;
  recipients: number | null;
  delivered: number | null;
}

const toBroadcast = (r: Row): Broadcast => ({
  id: r.id,
  title: r.title,
  message: r.message,
  titleAr: r.title_ar,
  messageAr: r.message_ar,
  level: r.level as BroadcastLevel,
  lat: r.lat,
  lon: r.lon,
  radiusKm: r.radius_km,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  cancelled: r.cancelled === 1,
  sender: r.sender,
  orgId: r.org_id,
  audience: r.audience === 'members' ? 'members' : 'public',
  pushed: r.recipients === null ? null : { recipients: r.recipients, delivered: r.delivered ?? 0 },
});

export interface BroadcastStore {
  add(b: NewBroadcast): Broadcast;
  /** Public, not cancelled and not expired: what every phone receives. */
  active(): Broadcast[];
  /** Active members-only alerts of these organizations. */
  activeForOrgs(orgIds: string[]): Broadcast[];
  /** Newest first: everything one organization sent. */
  recentForOrg(orgId: string, limit: number): Broadcast[];
  get(id: string): Broadcast | null;
  /** Newest first, for the admin page. */
  recent(limit: number): Broadcast[];
  cancel(id: string): Broadcast | null;
  setDelivery(id: string, recipients: number, delivered: number): Broadcast | null;
  /** Deletes alerts that ended more than 30 days ago. */
  prune(): number;
  close(): void;
}

/** `dir` holds broadcasts.db; ':memory:' keeps everything in memory (tests). */
export function createBroadcastStore(dir: string, { now = Date.now }: { now?: () => number } = {}): BroadcastStore {
  const memory = dir === ':memory:';
  if (!memory) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(memory ? ':memory:' : path.join(dir, 'broadcasts.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS broadcasts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      title_ar TEXT NOT NULL DEFAULT '',
      message_ar TEXT NOT NULL DEFAULT '',
      level TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      radius_km REAL NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      cancelled INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS broadcasts_expires ON broadcasts (expires_at);
  `);
  // Columns added after the first release.
  const columns = new Set((db.prepare('PRAGMA table_info(broadcasts)').all() as unknown as { name: string }[]).map((c) => c.name));
  if (!columns.has('recipients')) db.exec('ALTER TABLE broadcasts ADD COLUMN recipients INTEGER');
  if (!columns.has('delivered')) db.exec('ALTER TABLE broadcasts ADD COLUMN delivered INTEGER');
  if (!columns.has('sender')) db.exec(`ALTER TABLE broadcasts ADD COLUMN sender TEXT NOT NULL DEFAULT ''`);
  if (!columns.has('org_id')) db.exec('ALTER TABLE broadcasts ADD COLUMN org_id TEXT');
  if (!columns.has('audience')) db.exec(`ALTER TABLE broadcasts ADD COLUMN audience TEXT NOT NULL DEFAULT 'public'`);
  const iso = (ms: number) => new Date(ms).toISOString();
  const byId = db.prepare('SELECT * FROM broadcasts WHERE id = ?');

  return {
    add(b) {
      const id = randomUUID();
      db.prepare(`INSERT INTO broadcasts (id, title, message, title_ar, message_ar, level, lat, lon, radius_km, created_at, expires_at, sender, org_id, audience)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, b.title, b.message, b.titleAr, b.messageAr, b.level, b.lat, b.lon, b.radiusKm,
        iso(now()), iso(now() + b.hours * 3_600_000), b.sender ?? '', b.orgId ?? null, b.audience ?? 'public',
      );
      return toBroadcast(byId.get(id) as unknown as Row);
    },

    active() {
      const rows = db.prepare(`SELECT * FROM broadcasts WHERE cancelled = 0 AND audience = 'public' AND expires_at > ? ORDER BY created_at DESC`).all(iso(now()));
      return (rows as unknown as Row[]).map(toBroadcast);
    },

    activeForOrgs(orgIds) {
      if (orgIds.length === 0) return [];
      const rows = db.prepare(`SELECT * FROM broadcasts WHERE cancelled = 0 AND audience = 'members' AND expires_at > ?
        AND org_id IN (${orgIds.map(() => '?').join(',')}) ORDER BY created_at DESC`).all(iso(now()), ...orgIds);
      return (rows as unknown as Row[]).map(toBroadcast);
    },

    recentForOrg(orgId, limit) {
      return (db.prepare('SELECT * FROM broadcasts WHERE org_id = ? ORDER BY created_at DESC LIMIT ?').all(orgId, limit) as unknown as Row[]).map(toBroadcast);
    },

    get(id) {
      const row = byId.get(id) as Row | undefined;
      return row ? toBroadcast(row) : null;
    },

    recent(limit) {
      return (db.prepare('SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT ?').all(limit) as unknown as Row[]).map(toBroadcast);
    },

    cancel(id) {
      db.prepare('UPDATE broadcasts SET cancelled = 1 WHERE id = ?').run(id);
      const row = byId.get(id) as Row | undefined;
      return row ? toBroadcast(row) : null;
    },

    setDelivery(id, recipients, delivered) {
      db.prepare('UPDATE broadcasts SET recipients = ?, delivered = ? WHERE id = ?').run(recipients, delivered, id);
      const row = byId.get(id) as Row | undefined;
      return row ? toBroadcast(row) : null;
    },

    prune() {
      return Number(db.prepare('DELETE FROM broadcasts WHERE expires_at < ?').run(iso(now() - 30 * 86_400_000)).changes);
    },

    close() {
      db.close();
    },
  };
}

/**
 * Pushes an alert to phones and records how many it reached. Used by the
 * admin page and by organizations. Without push configured it does nothing:
 * phones still pick the alert up at their next check.
 */
export async function deliver(
  b: Broadcast, to: Recipient[],
  { broadcasts, devices, push }: { broadcasts: BroadcastStore; devices?: DeviceStore; push?: Push },
): Promise<Broadcast> {
  if (!devices || !push?.available) return b;
  // A phone that is both a member's and inside the circle gets one push.
  const unique = [...new Map(to.map((r) => [r.token, r])).values()];
  const result = await push.send(unique.map((r) => {
    const ar = r.lang === 'ar';
    const where = r.zone ? (ar ? `منطقتك «${r.zone.name}»` : `Your zone "${r.zone.name}"`) : b.orgId ? '' : (ar ? 'موقعك الأخير' : 'Near your last location');
    const title = ar && b.titleAr ? b.titleAr : b.title;
    return {
      token: r.token,
      title: b.sender ? `${b.sender}: ${title}` : title,
      body: [ar && b.messageAr ? b.messageAr : b.message, where].filter(Boolean).join('\n'),
      data: { kind: 'broadcast', broadcastId: b.id, level: b.level, ...(r.zone && { zoneId: r.zone.id }) },
      urgent: b.level === 'danger',
    };
  }));
  for (const t of result.invalidTokens) devices.dropToken(t);
  return broadcasts.setDelivery(b.id, unique.length, result.sent) ?? b;
}
