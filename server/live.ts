// Live hotspots: the last hours of FIRMS near-real-time detections for a country,
// straight from the FIRMS area API, a few minutes old at most. The packed record
// ends on the last complete UTC day, which is too late for "is something burning
// near me now". Needs FIRMS_MAP_KEY; the key stays on the server.
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadWorld, makeClipper, WORLD_FILE, WORLD_URL } from '../pipeline/clip.mjs';
import { API_BASE, COAST_TOLERANCE } from '../pipeline/config.mjs';

/** FIRMS near-real-time sources, with the sensor name the app uses. */
export const LIVE_SOURCES = [
  { source: 'VIIRS_NOAA20_NRT', sensor: 'VIIRS_NOAA20' },
  { source: 'VIIRS_NOAA21_NRT', sensor: 'VIIRS_NOAA21' },
  { source: 'VIIRS_SNPP_NRT', sensor: 'VIIRS_SNPP' },
  { source: 'MODIS_NRT', sensor: 'MODIS' },
] as const;

export const MAX_HOURS = 72;
/** One answer per country is reused this long: FIRMS updates every few minutes at best. */
const CACHE_MS = 10 * 60_000;

export interface LiveHotspot {
  lat: number;
  lon: number;
  acquiredAt: string;
  sensor: string;
  confidence: 'low' | 'nominal' | 'high';
  frp: number;
  daynight: string;
}

export interface LiveAnswer {
  fetchedAt: string;
  hotspots: LiveHotspot[];
  /** Sources that failed this time; their detections are missing. */
  missing: string[];
}

type FetchText = (url: string) => Promise<string>;
type Clipper = { accept(lon: number, lat: number): boolean; bbox: number[] };

export class LiveUnavailableError extends Error {}

/** VIIRS uses l/n/h, MODIS 0–100. */
export function confidence(raw: string): LiveHotspot['confidence'] {
  const n = Number(raw);
  if (raw !== '' && Number.isFinite(n)) return n < 30 ? 'low' : n >= 80 ? 'high' : 'nominal';
  const c = raw.toLowerCase();
  return c.startsWith('l') ? 'low' : c.startsWith('h') ? 'high' : 'nominal';
}

/** Parses one FIRMS area CSV into hotspots inside the country. */
export function parseFirmsCsv(text: string, sensor: string, clip: Clipper): LiveHotspot[] {
  const lines = text.trim().split('\n');
  const header = lines[0].trim().split(',');
  const col = (name: string) => header.indexOf(name);
  const [cLat, cLon, cDate, cTime, cConf, cFrp, cDn] =
    ['latitude', 'longitude', 'acq_date', 'acq_time', 'confidence', 'frp', 'daynight'].map(col);
  const out: LiveHotspot[] = [];
  for (const line of lines.slice(1)) {
    const f = line.trim().split(',');
    if (f.length < header.length) continue;
    const lat = Number(f[cLat]);
    const lon = Number(f[cLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !clip.accept(lon, lat)) continue;
    const t = f[cTime].padStart(4, '0');
    out.push({
      lat,
      lon,
      acquiredAt: `${f[cDate]}T${t.slice(0, 2)}:${t.slice(2, 4)}:00Z`,
      sensor,
      confidence: confidence(f[cConf] ?? ''),
      frp: Number(f[cFrp]) || 0,
      daynight: f[cDn] ?? '',
    });
  }
  return out;
}

async function defaultFetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'firesight-live/1.0' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function defaultClipper(iso: string): Promise<Clipper> {
  try {
    await stat(WORLD_FILE);
  } catch {
    const res = await fetch(WORLD_URL);
    if (!res.ok) throw new Error(`Natural Earth download failed: HTTP ${res.status}`);
    await mkdir(path.dirname(WORLD_FILE), { recursive: true });
    await writeFile(WORLD_FILE, await res.text());
  }
  return makeClipper(await loadWorld(), iso, COAST_TOLERANCE);
}

export interface LiveOptions {
  key?: string;
  fetchText?: FetchText;
  clipper?: (iso: string) => Promise<Clipper>;
  now?: () => number;
}

export function createLive({
  key = process.env.FIRMS_MAP_KEY,
  fetchText = defaultFetchText,
  clipper = defaultClipper,
  now = Date.now,
}: LiveOptions = {}) {
  const clippers = new Map<string, Promise<Clipper>>();
  const cache = new Map<string, { at: number; answer: Promise<LiveAnswer> }>();

  async function fetchCountry(iso: string): Promise<LiveAnswer> {
    if (!clippers.has(iso)) clippers.set(iso, clipper(iso));
    const clip = await clippers.get(iso)!;
    // Day range counts back from today (UTC): 3 days covers the longest window asked for.
    const days = Math.ceil(MAX_HOURS / 24);
    const missing: string[] = [];
    const parts = await Promise.all(
      LIVE_SOURCES.map(async ({ source, sensor }) => {
        try {
          const text = await fetchText(`${API_BASE}/api/area/csv/${key}/${source}/${clip.bbox.join(',')}/${days}`);
          if (!text.startsWith('latitude,longitude')) throw new Error(text.slice(0, 80));
          return parseFirmsCsv(text, sensor, clip);
        } catch {
          missing.push(source);
          return [];
        }
      }),
    );
    if (missing.length === LIVE_SOURCES.length) throw new LiveUnavailableError('FIRMS did not answer.');
    const hotspots = parts.flat().sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt));
    return { fetchedAt: new Date(now()).toISOString(), hotspots, missing };
  }

  return {
    available: Boolean(key),

    /** Detections of the last `hours` hours inside the country with ISO code `iso`. */
    async hotspots(iso: string, hours: number): Promise<LiveAnswer> {
      if (!key) throw new LiveUnavailableError('Live hotspots need FIRMS_MAP_KEY on the server.');
      let hit = cache.get(iso);
      if (!hit || now() - hit.at > CACHE_MS) {
        hit = { at: now(), answer: fetchCountry(iso) };
        cache.set(iso, hit);
        // A failure should not be cached for ten minutes.
        hit.answer.catch(() => cache.delete(iso));
      }
      const answer = await hit.answer;
      const cutoff = new Date(now() - hours * 3_600_000).toISOString();
      return { ...answer, hotspots: answer.hotspots.filter((h) => h.acquiredAt >= cutoff) };
    },
  };
}

export type Live = ReturnType<typeof createLive>;
