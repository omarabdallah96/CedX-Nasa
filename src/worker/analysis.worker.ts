/// <reference lib="webworker" />
// Loads packed hotspot files and runs the analysis off the main thread.
import { analyze, buildContext, type Analysis, type CountryContext, type DatasetIndex } from '../lib/analysis.ts';
import {
  hotspotWeights, isNight, isViirs, passes, satelliteOf, typeOf, unpackHotspots,
  type Filters, type Hotspots,
} from '../lib/harmonize.ts';
import { isoDate } from '../lib/time.ts';

export type Request =
  | { id: number; type: 'analyze'; baseUrl: string; slug: string; filters: Filters }
  | { id: number; type: 'points'; baseUrl: string; slug: string; filters: Filters; from: number; to: number; limit: number }
  | { id: number; type: 'csv'; baseUrl: string; slug: string; filters: Filters; from: number; to: number };

export interface AnalyzeResult {
  analysis: Analysis;
  /** Harmonized cell-days per 0.05° cell over the whole record: lon, lat, value triples. */
  density: Float32Array;
}
export interface PointsResult {
  lon: Float32Array;
  lat: Float32Array;
  /** 0 MODIS, 1 VIIRS */
  sensor: Uint8Array;
  total: number;
}
export interface CsvResult {
  blob: Blob;
  rows: number;
}

let indexPromise: Promise<DatasetIndex> | null = null;
const hotspots = new Map<string, Promise<Hotspots>>();
const contexts = new Map<string, CountryContext>();
const analyses = new Map<string, Analysis>();

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status})`);
  return (await res.json()) as T;
}

function loadIndex(baseUrl: string): Promise<DatasetIndex> {
  indexPromise ??= getJson<DatasetIndex>(`${baseUrl}index.json`);
  return indexPromise;
}

function loadHotspots(baseUrl: string, slug: string, index: DatasetIndex): Promise<Hotspots> {
  let p = hotspots.get(slug);
  if (!p) {
    p = (async () => {
      const man = index.countries.find((c) => c.slug === slug);
      if (!man) throw new Error(`Unknown country "${slug}"`);
      const res = await fetch(`${baseUrl}${slug}.bin`);
      if (!res.ok) throw new Error(`Could not load hotspots for ${man.name} (HTTP ${res.status})`);
      return unpackHotspots(await res.arrayBuffer(), man.n);
    })();
    hotspots.set(slug, p);
    p.catch(() => hotspots.delete(slug));
  }
  return p;
}

async function prepare(baseUrl: string, slug: string, filters: Filters) {
  const index = await loadIndex(baseUrl);
  const h = await loadHotspots(baseUrl, slug, index);
  const ctxKey = `${slug}|${filters.vegOnly}|${filters.dropLowConf}`;
  let ctx = contexts.get(ctxKey);
  if (!ctx) {
    ctx = buildContext(h, { vegOnly: filters.vegOnly, dropLowConf: filters.dropLowConf }, index);
    contexts.set(ctxKey, ctx);
  }
  const key = `${ctxKey}|${filters.bbox?.join(',') ?? 'all'}`;
  let analysis = analyses.get(key);
  if (!analysis) {
    analysis = analyze(h, filters, ctx);
    if (analyses.size > 12) analyses.clear();
    analyses.set(key, analysis);
  }
  return { h, ctx, analysis };
}

const DENSITY_DEG = 0.05;

function density(h: Hotspots, w: Float32Array): Float32Array {
  const cells = new Map<number, number>();
  for (let i = 0; i < h.n; i++) {
    if (w[i] === 0) continue;
    const key = Math.floor((h.lat[i] + 90) / DENSITY_DEG) * 7200 + Math.floor((h.lon[i] + 180) / DENSITY_DEG);
    cells.set(key, (cells.get(key) ?? 0) + w[i]);
  }
  const out = new Float32Array(cells.size * 3);
  let k = 0;
  for (const [key, value] of cells) {
    out[k++] = (key % 7200) * DENSITY_DEG - 180 + DENSITY_DEG / 2;
    out[k++] = Math.floor(key / 7200) * DENSITY_DEG - 90 + DENSITY_DEG / 2;
    out[k++] = value;
  }
  return out;
}

/** First row index with day >= target (rows are sorted by day). */
function lowerBound(day: Uint16Array, target: number): number {
  let lo = 0;
  let hi = day.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (day[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const SATELLITE = ['Terra', 'Aqua', 'N'];

async function handle(req: Request): Promise<{ result: unknown; transfer: Transferable[] }> {
  const { h, ctx, analysis } = await prepare(req.baseUrl, req.slug, req.filters);
  if (req.type === 'analyze') {
    const w = hotspotWeights(h, req.filters, analysis.calibration, ctx.cal, ctx.outage);
    const d = density(h, w);
    const result: AnalyzeResult = { analysis, density: d };
    return { result, transfer: [d.buffer] };
  }

  const start = lowerBound(h.day, req.from);
  const end = lowerBound(h.day, req.to + 1);

  if (req.type === 'points') {
    const idx: number[] = [];
    for (let i = start; i < end; i++) if (passes(h, i, req.filters)) idx.push(i);
    const total = idx.length;
    // Thin evenly when there are more points than the map should draw.
    const stride = Math.max(1, Math.ceil(total / req.limit));
    const n = Math.ceil(total / stride);
    const lon = new Float32Array(n);
    const lat = new Float32Array(n);
    const sensor = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const i = idx[k * stride];
      lon[k] = h.lon[i];
      lat[k] = h.lat[i];
      sensor[k] = h.flags[i] & 1;
    }
    const result: PointsResult = { lon, lat, sensor, total };
    return { result, transfer: [lon.buffer, lat.buffer, sensor.buffer] };
  }

  const w = hotspotWeights(h, req.filters, analysis.calibration, ctx.cal, ctx.outage);
  const lines = ['latitude,longitude,acq_date,acq_time,satellite,instrument,confidence,frp,daynight,type,harmonized_weight'];
  let rows = 0;
  for (let i = start; i < end; i++) {
    if (!passes(h, i, req.filters)) continue;
    const fl = h.flags[i];
    const viirs = isViirs(fl);
    const conf = viirs ? (h.conf[i] <= 10 ? 'l' : h.conf[i] >= 90 ? 'h' : 'n') : String(h.conf[i]);
    lines.push(
      `${h.lat[i].toFixed(5)},${h.lon[i].toFixed(5)},${isoDate(h.day[i])},${String(h.time[i]).padStart(4, '0')},` +
      `${SATELLITE[satelliteOf(fl)]},${viirs ? 'VIIRS' : 'MODIS'},${conf},${h.frp[i].toFixed(2)},` +
      `${isNight(fl) ? 'N' : 'D'},${typeOf(fl)},${w[i].toFixed(4)}`,
    );
    rows++;
  }
  const result: CsvResult = { blob: new Blob([lines.join('\n'), '\n'], { type: 'text/csv' }), rows };
  return { result, transfer: [] };
}

self.onmessage = (ev: MessageEvent<Request>) => {
  const req = ev.data;
  handle(req).then(
    ({ result, transfer }) => (self as DedicatedWorkerGlobalScope).postMessage({ id: req.id, ok: true, result }, transfer),
    (err: unknown) => (self as DedicatedWorkerGlobalScope).postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
};
