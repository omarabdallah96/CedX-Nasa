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
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

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

export interface ReportStore {
  /** Saves a report. Sending the same deviceId + clientId again returns the first copy. */
  add(report: NewReport, photo?: { bytes: Uint8Array<ArrayBuffer>; type: string }): Promise<{ report: Report; deleteToken: string | null; created: boolean }>;
  list(query: { bbox?: [number, number, number, number] | null; since: string; limit: number }): Report[];
  get(id: string): Report | null;
  photo(id: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string } | null>;
  /** Deletes when the token matches the one handed out at creation. */
  remove(id: string, token: string): Promise<'deleted' | 'not_found' | 'forbidden'>;
  prune(now?: number): Promise<number>;
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

  const byClient = db.prepare('SELECT * FROM reports WHERE device_id = ? AND client_id = ?');
  const byId = db.prepare('SELECT * FROM reports WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO reports (id, device_id, client_id, lat, lon, created_at, received_at, label, note, bearing, hotspot_sensor, hotspot_time, photo, token_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
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
        r.bearing, r.hotspotSensor, r.hotspotTime, photoName, hash(token),
      );
      return { report: toReport(byId.get(id) as unknown as Row), deleteToken: token, created: true };
    },

    list({ bbox, since, limit }) {
      const args: (string | number)[] = [since];
      let where = 'created_at >= ?';
      if (bbox) {
        where += ' AND lon >= ? AND lat >= ? AND lon <= ? AND lat <= ?';
        args.push(...bbox);
      }
      const rows = db.prepare(`SELECT * FROM reports WHERE ${where} ORDER BY created_at DESC LIMIT ?`).all(...args, limit);
      return (rows as unknown as Row[]).map(toReport);
    },

    get(id) {
      const row = byId.get(id) as Row | undefined;
      return row ? toReport(row) : null;
    },

    async photo(id) {
      const row = byId.get(id) as Row | undefined;
      if (!row?.photo) return null;
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

    close() {
      db.close();
    },
  };
}
