// Everything a client can ask of the dataset, independent of where it runs.
// The browser worker hands it a `fetch` loader and the API server a file loader,
// so both give the same numbers by construction.
import { analyze, buildContext, type Analysis, type CountryContext, type DatasetIndex, type Manifest } from './analysis.ts';
import {
  hotspotWeights, inRecord, isN20, isNight, isViirs, passes, satelliteOf, typeOf, unpackHotspots,
  type Filters, type Hotspots,
} from './harmonize.ts';
import { isoDate } from './time.ts';

export interface Loader {
  index(): Promise<DatasetIndex>;
  bin(manifest: Manifest): Promise<ArrayBuffer>;
}

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
export interface HotspotRow {
  latitude: number;
  longitude: number;
  acq_date: string;
  acq_time: string;
  satellite: string;
  instrument: string;
  confidence: string;
  frp: number;
  daynight: string;
  type: number;
  harmonized_weight: number;
}
export interface Prepared {
  index: DatasetIndex;
  manifest: Manifest;
  h: Hotspots;
  ctx: CountryContext;
  analysis: Analysis;
}

export const CSV_HEADER = 'latitude,longitude,acq_date,acq_time,satellite,instrument,confidence,frp,daynight,type,harmonized_weight';
const SATELLITE = ['Terra', 'Aqua', 'N', 'N20'];
const DENSITY_DEG = 0.05;

export class UnknownCountryError extends Error {}

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

export function createService(loader: Loader) {
  let indexPromise: Promise<DatasetIndex> | null = null;
  const hotspots = new Map<string, Promise<Hotspots>>();
  const contexts = new Map<string, CountryContext>();
  const analyses = new Map<string, Analysis>();

  function index(): Promise<DatasetIndex> {
    if (!indexPromise) {
      indexPromise = loader.index();
      indexPromise.catch(() => { indexPromise = null; });
    }
    return indexPromise;
  }

  function load(manifest: Manifest): Promise<Hotspots> {
    let p = hotspots.get(manifest.slug);
    if (!p) {
      p = loader.bin(manifest).then((buf) => unpackHotspots(buf, manifest.n));
      hotspots.set(manifest.slug, p);
      p.catch(() => hotspots.delete(manifest.slug));
    }
    return p;
  }

  async function prepare(slug: string, filters: Filters): Promise<Prepared> {
    const idx = await index();
    const manifest = idx.countries.find((c) => c.slug === slug);
    if (!manifest) throw new UnknownCountryError(`Unknown country "${slug}"`);
    const h = await load(manifest);
    const ctxKey = `${slug}|${filters.vegOnly}|${filters.dropLowConf}`;
    let ctx = contexts.get(ctxKey);
    if (!ctx) {
      ctx = buildContext(h, { vegOnly: filters.vegOnly, dropLowConf: filters.dropLowConf }, idx);
      contexts.set(ctxKey, ctx);
    }
    const key = `${ctxKey}|${filters.bbox?.join(',') ?? 'all'}`;
    let analysis = analyses.get(key);
    if (!analysis) {
      analysis = analyze(h, filters, ctx);
      if (analyses.size > 12) analyses.clear();
      analyses.set(key, analysis);
    }
    return { index: idx, manifest, h, ctx, analysis };
  }

  const weights = (p: Prepared, filters: Filters) =>
    hotspotWeights(p.h, filters, p.analysis.calibration, p.ctx.cal, p.ctx.outage, p.ctx.n20From);

  return {
    index,
    prepare,

    /** Forget everything loaded, after the files behind the loader changed. */
    reset(): void {
      indexPromise = null;
      hotspots.clear();
      contexts.clear();
      analyses.clear();
    },

    async analyze(slug: string, filters: Filters): Promise<AnalyzeResult> {
      const p = await prepare(slug, filters);
      return { analysis: p.analysis, density: density(p.h, weights(p, filters)) };
    },

    /** Detections of the record between two days (inclusive), thinned evenly to `limit`. */
    async points(slug: string, filters: Filters, from: number, to: number, limit: number): Promise<PointsResult> {
      const { h, analysis } = await prepare(slug, filters);
      const src = analysis.harmonized.src;
      const idx: number[] = [];
      for (let i = lowerBound(h.day, from), end = lowerBound(h.day, to + 1); i < end; i++) {
        if (h.day[i] < analysis.nDays && passes(h, i, filters) && inRecord(h.flags[i], h.day[i], src)) idx.push(i);
      }
      const total = idx.length;
      const stride = Math.max(1, Math.ceil(total / limit));
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
      return { lon, lat, sensor, total };
    },

    /** Every detection of the record between two days (inclusive), with its harmonized weight. */
    async rows(slug: string, filters: Filters, from: number, to: number, limit = Infinity): Promise<{ rows: HotspotRow[]; total: number }> {
      const p = await prepare(slug, filters);
      const { h, analysis } = p;
      const src = analysis.harmonized.src;
      const w = weights(p, filters);
      const rows: HotspotRow[] = [];
      let total = 0;
      for (let i = lowerBound(h.day, from), end = lowerBound(h.day, to + 1); i < end; i++) {
        if (h.day[i] >= analysis.nDays || !passes(h, i, filters) || !inRecord(h.flags[i], h.day[i], src)) continue;
        total++;
        if (rows.length >= limit) continue;
        const fl = h.flags[i];
        const viirs = isViirs(fl);
        rows.push({
          latitude: Number(h.lat[i].toFixed(5)),
          longitude: Number(h.lon[i].toFixed(5)),
          acq_date: isoDate(h.day[i]),
          acq_time: String(h.time[i]).padStart(4, '0'),
          satellite: SATELLITE[isN20(fl) ? 3 : satelliteOf(fl)],
          instrument: viirs ? 'VIIRS' : 'MODIS',
          confidence: viirs ? (h.conf[i] <= 10 ? 'l' : h.conf[i] >= 90 ? 'h' : 'n') : String(h.conf[i]),
          frp: Number(h.frp[i].toFixed(2)),
          daynight: isNight(fl) ? 'N' : 'D',
          type: typeOf(fl),
          harmonized_weight: Number(w[i].toFixed(4)),
        });
      }
      return { rows, total };
    },
  };
}

export type Service = ReturnType<typeof createService>;

export function csvLine(r: HotspotRow): string {
  return `${r.latitude.toFixed(5)},${r.longitude.toFixed(5)},${r.acq_date},${r.acq_time},${r.satellite},${r.instrument},` +
    `${r.confidence},${r.frp.toFixed(2)},${r.daynight},${r.type},${r.harmonized_weight.toFixed(4)}`;
}

export function toCsv(rows: HotspotRow[]): string {
  const lines = [CSV_HEADER];
  for (const r of rows) lines.push(csvLine(r));
  return lines.join('\n') + '\n';
}
