// Fire danger forecast: the Canadian Fire Weather Index (see fwi.ts) on a grid of
// points inside each country, from Open-Meteo weather (free, no key).
//
// The FWI moisture codes remember weeks to months of weather, so they need a long
// run-up. The first time a country is asked for, the codes are run from 1 January
// on Open-Meteo's ERA5 archive, and the state is saved on disk. After that each
// refresh only moves the saved state forward through the days that have passed,
// using the forecast API's recent past days, then runs the next 16 days of forecast.
// Weather is read at noon local time, the FWI convention.
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadWorld, makeClipper, WORLD_FILE, WORLD_URL } from '../pipeline/clip.mjs';
import { COUNTRIES, COAST_TOLERANCE } from '../pipeline/config.mjs';
import { dangerLevel, START, step, type Codes, type DangerLevel, type FwiDay, type Weather } from './fwi.ts';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const VARS = 'temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation';
/** Open-Meteo forecasts this many days, today included. */
export const FORECAST_DAYS = 16;
/** The forecast API keeps this many past days; older saved state needs the archive again. */
const MAX_PAST_DAYS = 92;
/** The ERA5 archive runs about five days behind. */
const ARCHIVE_LAG_DAYS = 6;
/** At most this many grid points per country, so the archive run-up stays within free limits. */
const MAX_CELLS = 48;
/** Locations per Open-Meteo request. */
const BATCH = 50;
/** Forecasts are recomputed after this long. Open-Meteo models update every few hours. */
const FRESH_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

export interface Cell {
  lat: number;
  lon: number;
}

export interface Grid {
  step: number;
  cells: Cell[];
}

export interface CellDay extends FwiDay {
  level: DangerLevel;
  weather: Weather;
}

export interface CountryForecast {
  slug: string;
  generatedAt: string;
  /** Forecast dates, today first, as YYYY-MM-DD (local dates of the country). */
  dates: string[];
  grid: Grid;
  /** cells[i][d]: grid cell i on dates[d]. */
  days: CellDay[][];
  /** Last day the saved moisture codes cover. */
  stateThrough: string;
}

interface SavedState {
  version: 1;
  /** Grid the codes belong to; a different grid starts over. */
  cells: Cell[];
  /** Last local date the codes include. */
  through: string;
  codes: Codes[];
}

interface Hourly {
  time: string[];
  temperature_2m: (number | null)[];
  relative_humidity_2m: (number | null)[];
  wind_speed_10m: (number | null)[];
  precipitation: (number | null)[];
}

type FetchJson = (url: string) => Promise<unknown>;
type Clipper = { accept(lon: number, lat: number): boolean; bbox: number[] };

export class ForecastUnavailableError extends Error {}

const round = (x: number, k = 1000) => Math.round(x * k) / k;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** Evenly spaced points inside the country, coarse enough to stay under MAX_CELLS. */
export function makeGrid(clip: Clipper): Grid {
  const [w, s, e, n] = clip.bbox;
  for (let stepDeg = 0.1; ; stepDeg = round(stepDeg + 0.05)) {
    const cells: Cell[] = [];
    for (let lat = s + stepDeg / 2; lat < n; lat += stepDeg) {
      for (let lon = w + stepDeg / 2; lon < e; lon += stepDeg) {
        if (clip.accept(lon, lat)) cells.push({ lat: round(lat), lon: round(lon) });
      }
    }
    if (cells.length <= MAX_CELLS || stepDeg >= 2) {
      // A country smaller than one cell still gets its middle.
      if (cells.length === 0) cells.push({ lat: round((s + n) / 2), lon: round((w + e) / 2) });
      return { step: stepDeg, cells };
    }
  }
}

/** Noon weather per local date, with rain summed over the 24 hours ending at noon. */
export function noonWeather(h: Hourly): Map<string, Weather> {
  const out = new Map<string, Weather>();
  const v = (a: (number | null)[], i: number) => a[i] ?? NaN;
  for (let i = 0; i < h.time.length; i++) {
    if (!h.time[i].endsWith('T12:00')) continue;
    // Hourly precipitation is the total of the hour before each time stamp.
    // A day without the full 24 hours before noon (the first day of a request) is left out.
    if (i < 23) continue;
    let rain = 0;
    for (let k = i - 23; k <= i; k++) rain += h.precipitation[k] ?? 0;
    const weather = { temp: v(h.temperature_2m, i), rh: v(h.relative_humidity_2m, i), wind: v(h.wind_speed_10m, i), rain };
    if ([weather.temp, weather.rh, weather.wind].every(Number.isFinite)) out.set(h.time[i].slice(0, 10), weather);
  }
  return out;
}

/** Open-Meteo's free tier limits calls per minute; the run-up of a country uses many. */
export class RateLimitedError extends Error {}

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': 'firesight-forecast/1.0' }, signal: AbortSignal.timeout(60_000) });
  if (res.status === 429) throw new RateLimitedError(`Open-Meteo HTTP 429: ${(await res.text()).slice(0, 200)}`);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
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

export interface ForecastOptions {
  /** Folder for the saved moisture codes; nothing is saved without it. */
  stateDir?: string;
  fetchJson?: FetchJson;
  clipper?: (iso: string) => Promise<Clipper>;
  now?: () => number;
  log?: (line: string) => void;
  /** Waits before retrying after a rate limit. */
  sleep?: (ms: number) => Promise<void>;
}

export function createForecast({
  stateDir,
  fetchJson = defaultFetchJson,
  clipper = defaultClipper,
  now = Date.now,
  log = console.log,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: ForecastOptions = {}) {
  const grids = new Map<string, Promise<Grid>>();
  const cache = new Map<string, { at: number; answer: Promise<CountryForecast> }>();
  const memoryState = new Map<string, SavedState>();

  const country = (slug: string) => {
    const c = COUNTRIES.find((x: { slug: string }) => x.slug === slug);
    if (!c) throw new ForecastUnavailableError(`No country "${slug}".`);
    return c as { slug: string; iso: string };
  };

  function grid(slug: string): Promise<Grid> {
    if (!grids.has(slug)) {
      const g = clipper(country(slug).iso).then(makeGrid);
      g.catch(() => grids.delete(slug));
      grids.set(slug, g);
    }
    return grids.get(slug)!;
  }

  /** Hourly weather for every cell, in local time. */
  async function hourly(base: string, cells: Cell[], params: Record<string, string>): Promise<Hourly[]> {
    const out: Hourly[] = [];
    for (let i = 0; i < cells.length; i += BATCH) {
      const part = cells.slice(i, i + BATCH);
      const q = new URLSearchParams({
        latitude: part.map((c) => c.lat).join(','),
        longitude: part.map((c) => c.lon).join(','),
        hourly: VARS,
        timezone: 'auto',
        wind_speed_unit: 'kmh',
        ...params,
      });
      let body: unknown;
      for (let attempt = 1; ; attempt++) {
        try {
          body = await fetchJson(`${base}?${q}`);
          break;
        } catch (err) {
          if (!(err instanceof RateLimitedError) || attempt === 3) throw err;
          log('forecast: Open-Meteo rate limit, waiting a minute');
          await sleep(65_000);
        }
      }
      const list = (Array.isArray(body) ? body : [body]) as { hourly?: Hourly }[];
      if (list.length !== part.length || list.some((x) => !x.hourly)) throw new Error('Open-Meteo answered an unexpected shape.');
      out.push(...list.map((x) => x.hourly!));
    }
    return out;
  }

  const statePath = (slug: string) => stateDir && path.join(stateDir, `fwi-state-${slug}.json`);

  async function loadState(slug: string, cells: Cell[]): Promise<SavedState | null> {
    let s = memoryState.get(slug) ?? null;
    const file = statePath(slug);
    if (!s && file) {
      try {
        s = JSON.parse(await readFile(file, 'utf8')) as SavedState;
      } catch {
        s = null;
      }
    }
    const sameGrid = s && s.version === 1 && s.cells.length === cells.length
      && s.cells.every((c, i) => c.lat === cells[i].lat && c.lon === cells[i].lon);
    return sameGrid ? s : null;
  }

  async function saveState(slug: string, s: SavedState) {
    memoryState.set(slug, s);
    const file = statePath(slug);
    if (!file) return;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(s));
    await rename(`${file}.tmp`, file);
  }

  /** Runs every cell's codes forward over consecutive dates. Missing weather keeps yesterday's codes. */
  function run(codes: Codes[], weather: Map<string, Weather>[], from: string, to: string, onDay?: (date: string, days: CellDay[]) => void) {
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const month = Number(date.slice(5, 7)) - 1;
      const today: CellDay[] = [];
      for (let i = 0; i < codes.length; i++) {
        const w = weather[i].get(date);
        if (!w) continue;
        const d = step(codes[i], w, month);
        codes[i] = { ffmc: d.ffmc, dmc: d.dmc, dc: d.dc };
        today.push({ ...d, level: dangerLevel(d.fwi), weather: w });
      }
      if (onDay && today.length === codes.length) onDay(date, today);
    }
  }

  /** Codes through `through`, started with the ERA5 archive. */
  async function spinUp(slug: string, cells: Cell[], through: string): Promise<SavedState> {
    const year = Number(through.slice(0, 4));
    // Start-up values assume a wet winter: begin on 1 January, or 1 December when that is too close.
    let start = `${year}-01-01`;
    if (daysBetween(start, through) < 30) start = `${year - 1}-12-01`;
    log(`forecast: starting ${slug} fire weather codes from ${start} (${cells.length} points)`);
    // One day earlier so the first day has its 24 hours of rain.
    const hours = await hourly(ARCHIVE_URL, cells, { start_date: addDays(start, -1), end_date: through });
    const weather = hours.map(noonWeather);
    const codes = cells.map(() => ({ ...START }));
    run(codes, weather, start, through);
    return { version: 1, cells, through, codes };
  }

  async function compute(slug: string): Promise<CountryForecast> {
    const g = await grid(slug);
    // Today in UTC; the local date in these countries is the same or one day later.
    const todayUtc = new Date(now()).toISOString().slice(0, 10);
    let state = await loadState(slug, g.cells);
    if (!state || daysBetween(state.through, todayUtc) > MAX_PAST_DAYS - 2) {
      state = await spinUp(slug, g.cells, addDays(todayUtc, -ARCHIVE_LAG_DAYS));
      await saveState(slug, state);
    }
    // One extra day for the first day's rain.
    const pastDays = Math.min(MAX_PAST_DAYS, daysBetween(state.through, todayUtc) + 1);
    const hours = await hourly(FORECAST_URL, g.cells, { past_days: String(pastDays), forecast_days: String(FORECAST_DAYS) });
    const weather = hours.map(noonWeather);
    // The local "today" is the date of the first hourly value of the forecast part.
    const localToday = addDays(hours[0].time[0].slice(0, 10), pastDays);

    const codes = state.codes.map((c) => ({ ...c }));
    const yesterday = addDays(localToday, -1);
    if (state.through < yesterday) {
      run(codes, weather, addDays(state.through, 1), yesterday);
      await saveState(slug, { ...state, through: yesterday, codes: codes.map((c) => ({ ...c })) });
    }

    const dates: string[] = [];
    const byDate: CellDay[][] = [];
    run(codes, weather, localToday, addDays(localToday, FORECAST_DAYS - 1), (date, days) => {
      dates.push(date);
      byDate.push(days);
    });
    if (dates.length === 0) throw new Error('Open-Meteo returned no forecast days.');
    const days = g.cells.map((_, i) => byDate.map((d) => d[i]));
    return {
      slug,
      generatedAt: new Date(now()).toISOString(),
      dates,
      grid: g,
      days,
      stateThrough: state.through < yesterday ? yesterday : state.through,
    };
  }

  /** The forecast for a country, recomputed every few hours. */
  function countryForecast(slug: string): Promise<CountryForecast> {
    country(slug);
    let hit = cache.get(slug);
    if (!hit || now() - hit.at > FRESH_MS) {
      const answer = compute(slug);
      // Keep serving the previous forecast while a new one is computed or when it fails.
      const previous = hit?.answer;
      hit = { at: now(), answer };
      cache.set(slug, hit);
      answer.catch((err) => {
        log(`forecast: ${slug} failed: ${err instanceof Error ? err.message : String(err)}`);
        if (previous) cache.set(slug, { at: now() - FRESH_MS + 10 * 60_000, answer: previous });
        else cache.delete(slug);
      });
      if (previous) return answer.catch(() => previous);
    }
    return hit.answer.catch((err) => {
      throw new ForecastUnavailableError(err instanceof Error ? err.message : String(err));
    });
  }

  return {
    country: countryForecast,
    grid,

    /** Computes every country in turn, so the first visitors do not wait for the run-up. */
    async warm(slugs: string[] = COUNTRIES.map((c: { slug: string }) => c.slug)) {
      for (const slug of slugs) {
        try {
          await countryForecast(slug);
        } catch {
          // Logged above; the next request tries again.
        }
      }
    },
  };
}

export type Forecast = ReturnType<typeof createForecast>;

/** Nearest grid cell, with its distance in km. */
export function nearestCell(grid: Grid, lat: number, lon: number): { index: number; km: number } {
  let best = { index: -1, km: Infinity };
  grid.cells.forEach((c, index) => {
    const dLat = ((c.lat - lat) * Math.PI) / 180;
    const dLon = ((c.lon - lon) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat * Math.PI) / 180) * Math.cos((c.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    const km = 2 * 6371 * Math.asin(Math.sqrt(a));
    if (km < best.km) best = { index, km };
  });
  return best;
}
