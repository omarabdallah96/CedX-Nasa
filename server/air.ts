// Air quality at a point, from Open-Meteo (free, no key). The reading of the
// answer lives in src/lib/air.ts, shared with the website; this file only adds
// a cache, so many phones in one town cost one outside request.
import { AirUnavailableError, airUrl, readAir, type AirReport } from '../src/lib/air.ts';

/** The model updates hourly. */
const FRESH_MS = 20 * 60_000;
/** An older answer is still served when Open-Meteo is down. */
const STALE_MS = 3 * 3_600_000;
const MAX_ENTRIES = 2000;
/** Points this close share an answer: finer than the model's grid. */
const SNAP_DEG = 0.05;

type FetchJson = (url: string) => Promise<unknown>;

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': 'firesight-air/1.0' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export interface AirOptions {
  fetchJson?: FetchJson;
  now?: () => number;
}

export function createAir({ fetchJson = defaultFetchJson, now = Date.now }: AirOptions = {}) {
  const cache = new Map<string, { at: number; answer: Promise<AirReport> }>();

  return {
    async at(lat: number, lon: number): Promise<AirReport> {
      const sLat = Math.round(lat / SNAP_DEG) * SNAP_DEG;
      const sLon = Math.round(lon / SNAP_DEG) * SNAP_DEG;
      const key = `${sLat.toFixed(2)},${sLon.toFixed(2)}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < FRESH_MS) return hit.answer;

      const answer = fetchJson(airUrl(sLat, sLon)).then(readAir);
      // Re-inserting keeps the newest keys last, so the oldest are dropped first.
      cache.delete(key);
      cache.set(key, { at: now(), answer });
      if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
      try {
        return await answer;
      } catch (err) {
        // Put the previous answer back while it is recent enough; ask again on the next request.
        if (hit && now() - hit.at < STALE_MS) {
          cache.set(key, hit);
          return hit.answer;
        }
        cache.delete(key);
        if (err instanceof AirUnavailableError) throw err;
        throw new AirUnavailableError(err instanceof Error ? err.message : String(err));
      }
    },
  };
}

export type Air = ReturnType<typeof createAir>;
