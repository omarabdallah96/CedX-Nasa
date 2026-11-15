// Phones that asked for instant alerts: their push token (Firebase Cloud
// Messaging), their alert zones and their last known location. Zone alerts
// from the admin page are pushed to every phone whose zone overlaps the alert
// circle, or whose last location is inside it.
//
// A phone sends this only after the person turns on "Instant alerts" in the
// app; turning it off deletes the row. Stored in SQLite next to the reports.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const MAX_ZONES = 20;
/** A last location older than this is not used to target alerts. */
export const LOCATION_FRESH_DAYS = 14;
/** Phones not heard from for this long are deleted. */
export const KEEP_DAYS = 120;

export interface DeviceZone {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
}

/** A zone saved to an account, so a reinstall or another phone gets it back. */
export interface AccountZone extends DeviceZone {
  createdAt?: string;
}

export interface DeviceInput {
  /** Random id of the app install (not the hardware). */
  installationId: string;
  /** FCM registration token; null when push is not available on the phone. */
  token: string | null;
  platform: 'android' | 'ios' | 'other';
  lang: 'en' | 'ar';
  userId: string | null;
  location: { lat: number; lon: number; at: string } | null;
  zones: DeviceZone[];
}

export interface Device extends DeviceInput {
  createdAt: string;
  updatedAt: string;
}

/** A phone an alert reaches, and why: one of its zones, or its last location. */
export interface Recipient {
  installationId: string;
  token: string;
  lang: 'en' | 'ar';
  zone: DeviceZone | null;
}

interface Row {
  installation_id: string;
  token: string | null;
  platform: string;
  lang: string;
  user_id: string | null;
  lat: number | null;
  lon: number | null;
  located_at: string | null;
  zones: string;
  created_at: string;
  updated_at: string;
}

const toDevice = (r: Row): Device => ({
  installationId: r.installation_id,
  token: r.token,
  platform: r.platform as Device['platform'],
  lang: r.lang === 'ar' ? 'ar' : 'en',
  userId: r.user_id,
  location: r.lat === null || r.lon === null || r.located_at === null ? null : { lat: r.lat, lon: r.lon, at: r.located_at },
  zones: JSON.parse(r.zones) as DeviceZone[],
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Great-circle distance in km. */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface DeviceStats {
  devices: number;
  withPush: number;
  withZones: number;
  zones: number;
  withLocation: number;
}

/** The zones of one account, or of one phone used without an account. */
export interface ZoneGroup {
  userId: string | null;
  /** Set for guest phones (no account). */
  installationId: string | null;
  /** 'account': saved to the account. 'phone': read from a phone. */
  source: 'account' | 'phone';
  zones: AccountZone[];
  updatedAt: string;
}

export interface DeviceStore {
  upsert(d: DeviceInput): Device;
  remove(installationId: string): boolean;
  /** Phones with a push token whose zone overlaps the circle, or whose fresh last location is inside it. */
  recipients(circle: { lat: number; lon: number; radiusKm: number }): Recipient[];
  /** FCM said this token is gone (app removed, token rotated). */
  dropToken(token: string): void;
  /** The most recently updated phone of each user, for the admin Users tab. */
  latestByUser(userIds: string[]): Map<string, Device>;
  /** Signs a user's phones out (account deleted or signed out). */
  unlinkUser(userId: string): void;
  /**
   * The zones saved to an account. Until the app first saves them, falls back
   * to the zones of the user's most recently updated phone (updatedAt null).
   */
  accountZones(userId: string): { zones: AccountZone[]; updatedAt: string | null };
  setAccountZones(userId: string, zones: AccountZone[]): { zones: AccountZone[]; updatedAt: string };
  /** Account deleted: forgets its saved zones. */
  removeAccountZones(userId: string): void;
  /**
   * Every zone, grouped by owner, for the admin Zones page: zones saved to an
   * account (or, until saved, its newest phone's), then guest phones' zones.
   */
  allZones(): ZoneGroup[];
  stats(): DeviceStats;
  prune(): number;
  close(): void;
}

/** `dir` holds devices.db; ':memory:' keeps everything in memory (tests). */
export function createDeviceStore(dir: string, { now = Date.now }: { now?: () => number } = {}): DeviceStore {
  const memory = dir === ':memory:';
  if (!memory) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(memory ? ':memory:' : path.join(dir, 'devices.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS devices (
      installation_id TEXT PRIMARY KEY,
      token TEXT UNIQUE,
      platform TEXT NOT NULL,
      lang TEXT NOT NULL,
      user_id TEXT,
      lat REAL,
      lon REAL,
      located_at TEXT,
      zones TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS devices_user ON devices (user_id);
    CREATE TABLE IF NOT EXISTS account_zones (
      user_id TEXT PRIMARY KEY,
      zones TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const iso = (ms: number) => new Date(ms).toISOString();
  const byId = db.prepare('SELECT * FROM devices WHERE installation_id = ?');

  return {
    upsert(d) {
      const t = iso(now());
      // A token belongs to one install: a reinstall gets a new id but may keep the token.
      if (d.token) db.prepare('UPDATE devices SET token = NULL WHERE token = ? AND installation_id != ?').run(d.token, d.installationId);
      db.prepare(`
        INSERT INTO devices (installation_id, token, platform, lang, user_id, lat, lon, located_at, zones, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (installation_id) DO UPDATE SET
          token = excluded.token, platform = excluded.platform, lang = excluded.lang, user_id = excluded.user_id,
          lat = COALESCE(excluded.lat, devices.lat), lon = COALESCE(excluded.lon, devices.lon),
          located_at = COALESCE(excluded.located_at, devices.located_at),
          zones = excluded.zones, updated_at = excluded.updated_at`).run(
        d.installationId, d.token, d.platform, d.lang, d.userId,
        d.location?.lat ?? null, d.location?.lon ?? null, d.location?.at ?? null,
        JSON.stringify(d.zones.slice(0, MAX_ZONES)), t, t,
      );
      return toDevice(byId.get(d.installationId) as unknown as Row);
    },

    remove(installationId) {
      return Number(db.prepare('DELETE FROM devices WHERE installation_id = ?').run(installationId).changes) > 0;
    },

    recipients({ lat, lon, radiusKm }) {
      const fresh = iso(now() - LOCATION_FRESH_DAYS * 86_400_000);
      const out: Recipient[] = [];
      for (const r of db.prepare('SELECT * FROM devices WHERE token IS NOT NULL').all() as unknown as Row[]) {
        const zones = JSON.parse(r.zones) as DeviceZone[];
        const zone = zones.find((z) => distanceKm(z.lat, z.lon, lat, lon) <= z.radiusKm + radiusKm) ?? null;
        const here = r.lat !== null && r.lon !== null && r.located_at !== null && r.located_at >= fresh &&
          distanceKm(r.lat, r.lon, lat, lon) <= radiusKm;
        if (zone || here) out.push({ installationId: r.installation_id, token: r.token!, lang: r.lang === 'ar' ? 'ar' : 'en', zone });
      }
      return out;
    },

    dropToken(token) {
      db.prepare('UPDATE devices SET token = NULL WHERE token = ?').run(token);
    },

    latestByUser(userIds) {
      const out = new Map<string, Device>();
      if (userIds.length === 0) return out;
      const rows = db.prepare(`SELECT * FROM devices WHERE user_id IN (${userIds.map(() => '?').join(',')}) ORDER BY updated_at`)
        .all(...userIds) as unknown as Row[];
      for (const r of rows) out.set(r.user_id!, toDevice(r)); // later rows win
      return out;
    },

    unlinkUser(userId) {
      db.prepare('UPDATE devices SET user_id = NULL WHERE user_id = ?').run(userId);
    },

    accountZones(userId) {
      const saved = db.prepare('SELECT zones, updated_at FROM account_zones WHERE user_id = ?').get(userId) as
        { zones: string; updated_at: string } | undefined;
      if (saved) return { zones: JSON.parse(saved.zones) as AccountZone[], updatedAt: saved.updated_at };
      const phone = db.prepare(`SELECT zones FROM devices WHERE user_id = ? AND zones != '[]' ORDER BY updated_at DESC LIMIT 1`)
        .get(userId) as { zones: string } | undefined;
      return { zones: phone ? (JSON.parse(phone.zones) as AccountZone[]) : [], updatedAt: null };
    },

    setAccountZones(userId, zones) {
      const t = iso(now());
      const kept = zones.slice(0, MAX_ZONES);
      db.prepare(`INSERT INTO account_zones (user_id, zones, updated_at) VALUES (?, ?, ?)
        ON CONFLICT (user_id) DO UPDATE SET zones = excluded.zones, updated_at = excluded.updated_at`)
        .run(userId, JSON.stringify(kept), t);
      return { zones: kept, updatedAt: t };
    },

    removeAccountZones(userId) {
      db.prepare('DELETE FROM account_zones WHERE user_id = ?').run(userId);
    },

    allZones() {
      const out: ZoneGroup[] = [];
      const saved = new Set<string>();
      for (const r of db.prepare('SELECT * FROM account_zones ORDER BY updated_at DESC').all() as unknown as
        { user_id: string; zones: string; updated_at: string }[]) {
        saved.add(r.user_id);
        const zones = JSON.parse(r.zones) as AccountZone[];
        if (zones.length) out.push({ userId: r.user_id, installationId: null, source: 'account', zones, updatedAt: r.updated_at });
      }
      const fromPhone = new Set<string>();
      for (const r of db.prepare(`SELECT * FROM devices WHERE zones != '[]' ORDER BY updated_at DESC`).all() as unknown as Row[]) {
        if (r.user_id) {
          // Same fallback as accountZones: the user's newest phone, until the app saves to the account.
          if (saved.has(r.user_id) || fromPhone.has(r.user_id)) continue;
          fromPhone.add(r.user_id);
        }
        out.push({
          userId: r.user_id, installationId: r.user_id ? null : r.installation_id, source: 'phone',
          zones: JSON.parse(r.zones) as AccountZone[], updatedAt: r.updated_at,
        });
      }
      return out;
    },

    stats() {
      const n = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
      let zones = 0;
      for (const r of db.prepare(`SELECT zones FROM devices WHERE zones != '[]'`).all() as unknown as { zones: string }[]) {
        zones += (JSON.parse(r.zones) as unknown[]).length;
      }
      return {
        devices: n('SELECT COUNT(*) AS n FROM devices'),
        withPush: n('SELECT COUNT(*) AS n FROM devices WHERE token IS NOT NULL'),
        withZones: n(`SELECT COUNT(*) AS n FROM devices WHERE zones != '[]'`),
        zones,
        withLocation: n('SELECT COUNT(*) AS n FROM devices WHERE lat IS NOT NULL'),
      };
    },

    prune() {
      return Number(db.prepare('DELETE FROM devices WHERE updated_at < ?').run(iso(now() - KEEP_DAYS * 86_400_000)).changes);
    },

    close() {
      db.close();
    },
  };
}
