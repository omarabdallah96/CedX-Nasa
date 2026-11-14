// Ground reports sent from the phone app: what someone saw at a fire, where, and
// (for smoke) the compass bearing they pointed at it. Phones download each
// other's reports so compass lines from different people can be crossed.
//
// Stored in SQLite (node:sqlite, no extra dependency); photos are files next to it.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const LABELS = ['wildfire', 'smoke', 'agriculturalBurn', 'industrial', 'falseAlarm', 'unsure'] as const;
export type Label = (typeof LABELS)[number];

export const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_NOTE = 500;
/** Reports older than this are deleted, photos included. */
export const KEEP_DAYS = 90;

export interface NewReport {
  deviceId: string;
  clientId: string;
  lat: number;
  lon: number;
  createdAt: string;
  label: Label;
  note: string;
  bearing: number | null;
  hotspotSensor: string | null;
  hotspotTime: string | null;
}

export interface Report {
  id: string;
  lat: number;
  lon: number;
  createdAt: string;
  receivedAt: string;
  label: Label;
  note: string;
  bearing: number | null;
  hotspotSensor: string | null;
  hotspotTime: string | null;
  hasPhoto: boolean;
}

/** What moderators see: the report, whether it is hidden, and a short tag of the sending device. */
export interface AdminReport extends Report {
  hidden: boolean;
  /** First characters of a hash of the device id: groups one phone's reports without exposing the id. */
  device: string;
}

export interface ReportStats {
  total: number;
  hidden: number;
  withPhoto: number;
  last24h: number;
  last7d: number;
  devices7d: number;
  byLabel: Record<string, number>;
}

interface Row {
  id: string;
  lat: number;
  lon: number;
  created_at: string;
  received_at: string;
  label: string;
  note: string;
  bearing: number | null;
  hotspot_sensor: string | null;
  hotspot_time: string | null;
  photo: string | null;
  token_hash: string;
  hidden: number;
  device_tag: string;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
export const deviceTag = (deviceId: string) => hash(`device:${deviceId}`).slice(0, 10);

function toReport(r: Row): Report {
  return {
    id: r.id,
    lat: r.lat,
    lon: r.lon,
    createdAt: r.created_at,
    receivedAt: r.received_at,
    label: r.label as Label,
    note: r.note,
    bearing: r.bearing,
    hotspotSensor: r.hotspot_sensor,
    hotspotTime: r.hotspot_time,
    hasPhoto: r.photo !== null,
  };
}

const toAdminReport = (r: Row): AdminReport => ({ ...toReport(r), hidden: r.hidden === 1, device: r.device_tag });

export interface ReportStore {
  /** Saves a report. Sending the same deviceId + clientId again returns the first copy. */
  add(report: NewReport, photo?: { bytes: Uint8Array<ArrayBuffer>; type: string }): Promise<{ report: Report; deleteToken: string | null; created: boolean }>;
  /** Public reads leave hidden reports out. */
  list(query: { bbox?: [number, number, number, number] | null; since: string; limit: number }): Report[];
  get(id: string): Report | null;
  photo(id: string, opts?: { includeHidden?: boolean }): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string } | null>;
  /** Deletes when the token matches the one handed out at creation. */
  remove(id: string, token: string): Promise<'deleted' | 'not_found' | 'forbidden'>;
  prune(now?: number): Promise<number>;

  // ---- Moderation ----
  /** Newest first; `before` is the createdAt of the last report of the previous page. */
  adminList(query: { status: 'all' | 'visible' | 'hidden'; device?: string; label?: string; before?: string; limit: number }): AdminReport[];
  adminGet(id: string): AdminReport | null;
  /** Hides or shows one report, or every report of a device tag. Returns how many changed. */
  setHidden(target: { id: string } | { device: string }, hidden: boolean): number;
  adminRemove(id: string): Promise<boolean>;
  stats(now?: number): ReportStats;
  close(): void;
}

/** `dir` holds reports.db and photos/; ':memory:' keeps everything in memory (tests). */
export function createReportStore(dir: string): ReportStore {
  const memory = dir === ':memory:';
  const photoDir = memory ? '' : path.join(dir, 'photos');
  const photosInMemory = new Map<string, Uint8Array<ArrayBuffer>>();
  if (!memory) mkdirSync(photoDir, { recursive: true });

  const db = new DatabaseSync(memory ? ':memory:' : path.join(dir, 'reports.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      created_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      label TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      bearing REAL,
      hotspot_sensor TEXT,
      hotspot_time TEXT,
      photo TEXT,
      token_hash TEXT NOT NULL,
      UNIQUE (device_id, client_id)
    );
    CREATE INDEX IF NOT EXISTS reports_created ON reports (created_at);
  `);
  // Columns added after the first release.
  const columns = new Set((db.prepare('PRAGMA table_info(reports)').all() as unknown as { name: string }[]).map((c) => c.name));
  if (!columns.has('hidden')) db.exec('ALTER TABLE reports ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
  if (!columns.has('device_tag')) {
    db.exec(`ALTER TABLE reports ADD COLUMN device_tag TEXT NOT NULL DEFAULT ''`);
    const fill = db.prepare('UPDATE reports SET device_tag = ? WHERE id = ?');
    for (const r of db.prepare('SELECT id, device_id FROM reports').all() as unknown as { id: string; device_id: string }[]) {
      fill.run(deviceTag(r.device_id), r.id);
    }
  }
  db.exec('CREATE INDEX IF NOT EXISTS reports_device ON reports (device_tag)');

  const byClient = db.prepare('SELECT * FROM reports WHERE device_id = ? AND client_id = ?');
  const byId = db.prepare('SELECT * FROM reports WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO reports (id, device_id, client_id, lat, lon, created_at, received_at, label, note, bearing, hotspot_sensor, hotspot_time, photo, token_hash, device_tag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const del = db.prepare('DELETE FROM reports WHERE id = ?');

  const photoFile = (name: string) => path.join(photoDir, name);
  async function dropPhoto(name: string | null) {
    if (!name) return;
    if (memory) photosInMemory.delete(name);
    else await rm(photoFile(name), { force: true });
  }

  return {
    async add(r, photo) {
      const existing = byClient.get(r.deviceId, r.clientId) as Row | undefined;
      if (existing) return { report: toReport(existing), deleteToken: null, created: false };
      const id = randomUUID();
      const token = randomBytes(24).toString('base64url');
      let photoName: string | null = null;
      if (photo) {
        photoName = `${id}.${PHOTO_TYPES[photo.type]}`;
        if (memory) photosInMemory.set(photoName, photo.bytes);
        else await writeFile(photoFile(photoName), photo.bytes);
      }
      insert.run(
        id, r.deviceId, r.clientId, r.lat, r.lon, r.createdAt, new Date().toISOString(), r.label, r.note,
        r.bearing, r.hotspotSensor, r.hotspotTime, photoName, hash(token), deviceTag(r.deviceId),
      );
      return { report: toReport(byId.get(id) as unknown as Row), deleteToken: token, created: true };
    },

    list({ bbox, since, limit }) {
      const args: (string | number)[] = [since];
      let where = 'hidden = 0 AND created_at >= ?';
      if (bbox) {
        where += ' AND lon >= ? AND lat >= ? AND lon <= ? AND lat <= ?';
        args.push(...bbox);
      }
      const rows = db.prepare(`SELECT * FROM reports WHERE ${where} ORDER BY created_at DESC LIMIT ?`).all(...args, limit);
      return (rows as unknown as Row[]).map(toReport);
    },

    get(id) {
      const row = byId.get(id) as Row | undefined;
      return row && !row.hidden ? toReport(row) : null;
    },

    async photo(id, { includeHidden = false } = {}) {
      const row = byId.get(id) as Row | undefined;
      if (!row?.photo || (row.hidden && !includeHidden)) return null;
      const ext = row.photo.split('.').pop()!;
      const type = Object.keys(PHOTO_TYPES).find((t) => PHOTO_TYPES[t] === ext)!;
      if (memory) {
        const bytes = photosInMemory.get(row.photo);
        return bytes ? { bytes, type } : null;
      }
      try {
        return { bytes: new Uint8Array(await readFile(photoFile(row.photo))), type };
      } catch {
        return null;
      }
    },

    async remove(id, token) {
      const row = byId.get(id) as Row | undefined;
      if (!row) return 'not_found';
      if (row.token_hash !== hash(token)) return 'forbidden';
      del.run(id);
      await dropPhoto(row.photo);
      return 'deleted';
    },

    async prune(now = Date.now()) {
      const cutoff = new Date(now - KEEP_DAYS * 86_400_000).toISOString();
      const old = db.prepare('SELECT id, photo FROM reports WHERE created_at < ?').all(cutoff) as unknown as Row[];
      for (const row of old) {
        del.run(row.id);
        await dropPhoto(row.photo);
      }
      return old.length;
    },

    adminList({ status, device, label, before, limit }) {
      const where: string[] = [];
      const args: (string | number)[] = [];
      if (status === 'visible') where.push('hidden = 0');
      if (status === 'hidden') where.push('hidden = 1');
      if (device) {
        where.push('device_tag = ?');
        args.push(device);
      }
      if (label) {
        where.push('label = ?');
        args.push(label);
      }
      if (before) {
        where.push('created_at < ?');
        args.push(before);
      }
      const sql = `SELECT * FROM reports ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`;
      return (db.prepare(sql).all(...args, limit) as unknown as Row[]).map(toAdminReport);
    },

    adminGet(id) {
      const row = byId.get(id) as Row | undefined;
      return row ? toAdminReport(row) : null;
    },

    setHidden(target, hidden) {
      const flag = hidden ? 1 : 0;
      const res = 'id' in target
        ? db.prepare('UPDATE reports SET hidden = ? WHERE id = ?').run(flag, target.id)
        : db.prepare('UPDATE reports SET hidden = ? WHERE device_tag = ?').run(flag, target.device);
      return Number(res.changes);
    },

    async adminRemove(id) {
      const row = byId.get(id) as Row | undefined;
      if (!row) return false;
      del.run(id);
      await dropPhoto(row.photo);
      return true;
    },

    stats(now = Date.now()) {
      const iso = (ms: number) => new Date(ms).toISOString();
      const one = (sql: string, ...args: string[]) => Number((db.prepare(sql).get(...args) as { n: number }).n);
      const day = iso(now - 86_400_000);
      const week = iso(now - 7 * 86_400_000);
      const byLabel: Record<string, number> = {};
      for (const r of db.prepare('SELECT label, COUNT(*) AS n FROM reports GROUP BY label').all() as unknown as { label: string; n: number }[]) {
        byLabel[r.label] = Number(r.n);
      }
      return {
        total: one('SELECT COUNT(*) AS n FROM reports'),
        hidden: one('SELECT COUNT(*) AS n FROM reports WHERE hidden = 1'),
        withPhoto: one('SELECT COUNT(*) AS n FROM reports WHERE photo IS NOT NULL'),
        last24h: one('SELECT COUNT(*) AS n FROM reports WHERE received_at >= ?', day),
        last7d: one('SELECT COUNT(*) AS n FROM reports WHERE received_at >= ?', week),
        devices7d: one('SELECT COUNT(DISTINCT device_tag) AS n FROM reports WHERE received_at >= ?', week),
        byLabel,
      };
    },

    close() {
      db.close();
    },
  };
}
