// MODIS ↔ VIIRS hotspot harmonization.
//
// 1. Common unit. Every detection is snapped to a fixed 0.01° grid (~1 km) and a
//    cell counts once per day per sensor: an "active-fire cell-day". This removes
//    most of the count inflation that comes from VIIRS's 375 m pixels.
// 2. Calibration. VIIRS still sees more small fires than MODIS, so over the years
//    both sensors flew together we fit, per calendar month, the ratio
//    Σ VIIRS cell-days / Σ MODIS cell-days. Local ratios are shrunk toward a
//    wider-area prior when the local sample is small.
// 3. Harmonized record, in VIIRS-equivalent cell-days:
//      Terra-only era  → ratioTerra[month] × Terra cell-days
//      Terra+Aqua era  → ratio[month] × MODIS cell-days
//      VIIRS era       → VIIRS cell-days as observed
//      VIIRS outages   → ratio[month] × MODIS cell-days (gap fill)
// 4. Validation. Leave-one-year-out over the overlap years.

import { AQUA_DAY, FIRST_DAY, OVERLAP_START, SEAM_DAY, type Calendar } from './time.ts';

export const CELL_DEG = 0.01;
/** Shrinkage strength, in MODIS cell-days of prior evidence. */
export const KAPPA = 20;
const LON_CELLS = Math.round(360 / CELL_DEG);

export interface Hotspots {
  n: number;
  lat: Float32Array;
  lon: Float32Array;
  frp: Float32Array;
  day: Uint16Array;
  time: Uint16Array;
  flags: Uint8Array;
  conf: Uint8Array;
}

/** [west, south, east, north] in degrees. */
export type BBox = [number, number, number, number];

export interface Filters {
  /** Keep only FIRMS type 0 (presumed vegetation fire). */
  vegOnly: boolean;
  /** Drop low-confidence detections (MODIS < 30 %, VIIRS "low"). */
  dropLowConf: boolean;
  bbox: BBox | null;
}

export const isViirs = (flags: number): boolean => (flags & 1) === 1;
export const isNight = (flags: number): boolean => (flags & 2) === 2;
/** 0 Terra, 1 Aqua, 2 Suomi-NPP */
export const satelliteOf = (flags: number): number => (flags >> 2) & 3;
export const typeOf = (flags: number): number => (flags >> 4) & 3;

export function unpackHotspots(buf: ArrayBuffer, n: number): Hotspots {
  if (buf.byteLength !== 18 * n) throw new Error(`hotspot file is ${buf.byteLength} bytes, expected ${18 * n}`);
  return {
    n,
    lat: new Float32Array(buf, 0, n),
    lon: new Float32Array(buf, 4 * n, n),
    frp: new Float32Array(buf, 8 * n, n),
    day: new Uint16Array(buf, 12 * n, n),
    time: new Uint16Array(buf, 14 * n, n),
    flags: new Uint8Array(buf, 16 * n, n),
    conf: new Uint8Array(buf, 17 * n, n),
  };
}

export function passes(h: Hotspots, i: number, f: Filters): boolean {
  const fl = h.flags[i];
  if (f.vegOnly && typeOf(fl) !== 0) return false;
  if (f.dropLowConf && (isViirs(fl) ? h.conf[i] <= 10 : h.conf[i] < 30)) return false;
  if (f.bbox) {
    const lon = h.lon[i];
    const lat = h.lat[i];
    if (lon < f.bbox[0] || lon > f.bbox[2] || lat < f.bbox[1] || lat > f.bbox[3]) return false;
  }
  return true;
}

export function cellKey(lat: number, lon: number): number {
  return Math.floor((lat + 90) / CELL_DEG) * LON_CELLS + Math.floor((lon + 180) / CELL_DEG);
}

export interface Daily {
  nDays: number;
  /** Raw detection counts (pixels), as published. */
  rawM: Float32Array;
  rawV: Float32Array;
  /** Active-fire cell-days: MODIS (Terra+Aqua), Terra alone, VIIRS. */
  cdM: Float32Array;
  cdT: Float32Array;
  cdV: Float32Array;
}

/** Rows of `h` must be sorted by day (the packed files are). */
export function dailyCounts(h: Hotspots, f: Filters, nDays: number): Daily {
  const out: Daily = {
    nDays,
    rawM: new Float32Array(nDays),
    rawV: new Float32Array(nDays),
    cdM: new Float32Array(nDays),
    cdT: new Float32Array(nDays),
    cdV: new Float32Array(nDays),
  };
  const seenM = new Set<number>();
  const seenT = new Set<number>();
  const seenV = new Set<number>();
  let cur = -1;
  for (let i = 0; i < h.n; i++) {
    const d = h.day[i];
    if (d >= nDays) break;
    if (!passes(h, i, f)) continue;
    if (d !== cur) {
      cur = d;
      seenM.clear();
      seenT.clear();
      seenV.clear();
    }
    const key = cellKey(h.lat[i], h.lon[i]);
    const fl = h.flags[i];
    if (isViirs(fl)) {
      out.rawV[d]++;
      if (!seenV.has(key)) {
        seenV.add(key);
        out.cdV[d]++;
      }
    } else {
      out.rawM[d]++;
      if (!seenM.has(key)) {
        seenM.add(key);
        out.cdM[d]++;
      }
      if (satelliteOf(fl) === 0 && !seenT.has(key)) {
        seenT.add(key);
        out.cdT[d]++;
      }
    }
  }
  return out;
}

/** Marks days inside a known VIIRS outage. `outages` are inclusive [start, end] day pairs. */
export function outageMask(outages: [number, number][], nDays: number): Uint8Array {
  const mask = new Uint8Array(nDays);
  for (const [a, b] of outages) {
    for (let d = Math.max(0, a); d <= b && d < nDays; d++) mask[d] = 1;
  }
  return mask;
}

/** Monthly cell-day sums over the overlap period, one row per overlap year. */
export interface OverlapTable {
  years: number[];
  /** [yearIndex][month 0-11] */
  M: number[][];
  T: number[][];
  V: number[][];
  /** Whether that year-month has any day inside the overlap window. */
  has: boolean[][];
}

export function overlapTable(d: Daily, cal: Calendar, outage: Uint8Array): OverlapTable {
  const years: number[] = [];
  const M: number[][] = [];
  const T: number[][] = [];
  const V: number[][] = [];
  const has: boolean[][] = [];
  const zero = () => new Array<number>(12).fill(0);
  for (let day = OVERLAP_START; day < d.nDays; day++) {
    if (outage[day]) continue;
    const y = cal.year[day];
    if (years[years.length - 1] !== y) {
      years.push(y);
      M.push(zero());
      T.push(zero());
      V.push(zero());
      has.push(new Array<boolean>(12).fill(false));
    }
    const yi = years.length - 1;
    const m = cal.month[day];
    M[yi][m] += d.cdM[day];
    T[yi][m] += d.cdT[day];
    V[yi][m] += d.cdV[day];
    has[yi][m] = true;
  }
  return { years, M, T, V, has };
}

export interface Calibration {
  /** VIIRS-equivalent cell-days per MODIS (Terra+Aqua) cell-day, by calendar month. */
  ratio: number[];
  /** Same, per Terra-only cell-day (used before Aqua launched). */
  ratioTerra: number[];
  annual: number;
  annualTerra: number;
  /** Multiplicative 10th / 90th percentile spread of the yearly ratio around `ratio`. */
  spreadLo: number[];
  spreadHi: number[];
  /** Overlap sums by calendar month. */
  mSum: number[];
  tSum: number[];
  vSum: number[];
  /** Total MODIS cell-days behind the fit. */
  mTotal: number;
  vTotal: number;
  /** False when the area has no overlap data and no prior: ratios fall back to 1. */
  calibrated: boolean;
  usedPrior: boolean;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface CalibrateOptions {
  /** Leave this year out of the fit (for validation). */
  excludeYear?: number;
  /** Wider-area calibration to shrink toward. */
  prior?: Calibration;
  kappa?: number;
}

export function calibrate(t: OverlapTable, opts: CalibrateOptions = {}): Calibration {
  const { excludeYear, prior, kappa = KAPPA } = opts;
  const mSum = new Array<number>(12).fill(0);
  const tSum = new Array<number>(12).fill(0);
  const vSum = new Array<number>(12).fill(0);
  for (let yi = 0; yi < t.years.length; yi++) {
    if (t.years[yi] === excludeYear) continue;
    for (let m = 0; m < 12; m++) {
      mSum[m] += t.M[yi][m];
      tSum[m] += t.T[yi][m];
      vSum[m] += t.V[yi][m];
    }
  }
  const mTotal = mSum.reduce((a, b) => a + b, 0);
  const tTotal = tSum.reduce((a, b) => a + b, 0);
  const vTotal = vSum.reduce((a, b) => a + b, 0);

  let annual: number;
  let annualTerra: number;
  let calibrated = true;
  if (prior) {
    annual = (vTotal + kappa * prior.annual) / (mTotal + kappa);
    annualTerra = (vTotal + kappa * prior.annualTerra) / (tTotal + kappa);
  } else if (mTotal > 0 && tTotal > 0 && vTotal > 0) {
    annual = vTotal / mTotal;
    annualTerra = vTotal / tTotal;
  } else {
    annual = 1;
    annualTerra = 1;
    calibrated = false;
  }

  const ratio: number[] = [];
  const ratioTerra: number[] = [];
  for (let m = 0; m < 12; m++) {
    const base = prior ? prior.ratio[m] : annual;
    const baseT = prior ? prior.ratioTerra[m] : annualTerra;
    ratio.push(calibrated ? (vSum[m] + kappa * base) / (mSum[m] + kappa) : 1);
    ratioTerra.push(calibrated ? (vSum[m] + kappa * baseT) / (tSum[m] + kappa) : 1);
  }

  // Year-to-year spread of the ratio, used as the uncertainty band on scaled values.
  const spreadLo: number[] = [];
  const spreadHi: number[] = [];
  const yearlyAll: number[] = [];
  for (let yi = 0; yi < t.years.length; yi++) {
    if (t.years[yi] === excludeYear) continue;
    const my = t.M[yi].reduce((a, b) => a + b, 0);
    const vy = t.V[yi].reduce((a, b) => a + b, 0);
    if (my >= 5) yearlyAll.push(vy / my / annual);
  }
  yearlyAll.sort((a, b) => a - b);
  for (let m = 0; m < 12; m++) {
    const rel: number[] = [];
    for (let yi = 0; yi < t.years.length; yi++) {
      if (t.years[yi] === excludeYear) continue;
      if (t.M[yi][m] >= 5) rel.push(t.V[yi][m] / t.M[yi][m] / ratio[m]);
    }
    rel.sort((a, b) => a - b);
    let lo: number;
    let hi: number;
    if (rel.length >= 5) {
      lo = quantile(rel, 0.1);
      hi = quantile(rel, 0.9);
    } else if (prior) {
      lo = prior.spreadLo[m];
      hi = prior.spreadHi[m];
    } else if (yearlyAll.length >= 5) {
      lo = quantile(yearlyAll, 0.1);
      hi = quantile(yearlyAll, 0.9);
    } else {
      lo = 0.5;
      hi = 2;
    }
    spreadLo.push(Math.min(1, lo));
    spreadHi.push(Math.max(1, hi));
  }

  return {
    ratio, ratioTerra, annual, annualTerra, spreadLo, spreadHi,
    mSum, tSum, vSum, mTotal, vTotal, calibrated, usedPrior: !!prior,
  };
}

/** Where each day's harmonized value comes from. */
export const SRC_NONE = 0;
export const SRC_TERRA = 1;
export const SRC_MODIS = 2;
export const SRC_VIIRS = 3;
export const SRC_GAPFILL = 4;

export interface Harmonized {
  /** VIIRS-equivalent active-fire cell-days per day. */
  h: Float32Array;
  lo: Float32Array;
  hi: Float32Array;
  src: Uint8Array;
}

export function harmonizeDaily(d: Daily, c: Calibration, cal: Calendar, outage: Uint8Array): Harmonized {
  const h = new Float32Array(d.nDays);
  const lo = new Float32Array(d.nDays);
  const hi = new Float32Array(d.nDays);
  const src = new Uint8Array(d.nDays);
  for (let day = FIRST_DAY; day < d.nDays; day++) {
    const m = cal.month[day];
    let v: number;
    let scaled = true;
    if (day < AQUA_DAY) {
      v = c.ratioTerra[m] * d.cdT[day];
      src[day] = SRC_TERRA;
    } else if (day < SEAM_DAY) {
      v = c.ratio[m] * d.cdM[day];
      src[day] = SRC_MODIS;
    } else if (outage[day]) {
      v = c.ratio[m] * d.cdM[day];
      src[day] = SRC_GAPFILL;
    } else {
      v = d.cdV[day];
      src[day] = SRC_VIIRS;
      scaled = false;
    }
    h[day] = v;
    lo[day] = scaled ? v * c.spreadLo[m] : v;
    hi[day] = scaled ? v * c.spreadHi[m] : v;
  }
  return { h, lo, hi, src };
}

/**
 * The record you get with no harmonization: raw MODIS detection counts until
 * VIIRS arrives, raw VIIRS counts afterwards.
 */
export function naiveDaily(d: Daily): Float32Array {
  const out = new Float32Array(d.nDays);
  for (let day = FIRST_DAY; day < d.nDays; day++) out[day] = day < SEAM_DAY ? d.rawM[day] : d.rawV[day];
  return out;
}

export interface ValidationPair {
  year: number;
  month: number;
  /** VIIRS cell-days observed. */
  obs: number;
  /** Harmonized prediction from MODIS, fitted without this year. */
  pred: number;
  /** MODIS cell-days, unscaled. */
  raw: number;
}

export interface Validation {
  pairs: ValidationPair[];
  /** Median absolute % error over months with at least `MIN_OBS` observed cell-days. */
  mdape: number;
  mdapeRaw: number;
  /** Total predicted / total observed − 1. */
  bias: number;
  biasRaw: number;
  yearlyMdape: number;
  yearlyMdapeRaw: number;
  /** Months that entered the monthly error figures. */
  nMonths: number;
  nYears: number;
  /** True when there are too few busy months to trust the figures. */
  thin: boolean;
}

export const MIN_OBS = 10;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return quantile(s, 0.5);
}

/**
 * Leave-one-year-out validation. When `priorTable` is given (a drawn area inside
 * a country), the prior is refitted without the held-out year too, so nothing
 * from that year leaks into its own prediction.
 */
export function validate(t: OverlapTable, priorTable?: OverlapTable, kappa = KAPPA): Validation {
  const pairs: ValidationPair[] = [];
  const ape: number[] = [];
  const apeRaw: number[] = [];
  const yearErr: number[] = [];
  const yearErrRaw: number[] = [];
  let sumPred = 0;
  let sumObs = 0;
  let sumRaw = 0;
  for (let yi = 0; yi < t.years.length; yi++) {
    const year = t.years[yi];
    const prior = priorTable ? calibrate(priorTable, { excludeYear: year, kappa }) : undefined;
    const c = calibrate(t, { excludeYear: year, prior, kappa });
    let yPred = 0;
    let yObs = 0;
    let yRaw = 0;
    for (let m = 0; m < 12; m++) {
      if (!t.has[yi][m]) continue;
      const raw = t.M[yi][m];
      const obs = t.V[yi][m];
      const pred = c.ratio[m] * raw;
      pairs.push({ year, month: m, obs, pred, raw });
      yPred += pred;
      yObs += obs;
      yRaw += raw;
      if (obs >= MIN_OBS) {
        ape.push(Math.abs(pred - obs) / obs);
        apeRaw.push(Math.abs(raw - obs) / obs);
      }
    }
    sumPred += yPred;
    sumObs += yObs;
    sumRaw += yRaw;
    if (yObs >= MIN_OBS) {
      yearErr.push(Math.abs(yPred - yObs) / yObs);
      yearErrRaw.push(Math.abs(yRaw - yObs) / yObs);
    }
  }
  return {
    pairs,
    mdape: median(ape),
    mdapeRaw: median(apeRaw),
    bias: sumObs > 0 ? sumPred / sumObs - 1 : NaN,
    biasRaw: sumObs > 0 ? sumRaw / sumObs - 1 : NaN,
    yearlyMdape: median(yearErr),
    yearlyMdapeRaw: median(yearErrRaw),
    nMonths: ape.length,
    nYears: yearErr.length,
    thin: ape.length < 24,
  };
}

/**
 * Per-detection harmonized weight, so that weights over any set of days sum to
 * the harmonized cell-days of those days. A detection gets 0 when it is filtered
 * out or when the harmonized record does not use its sensor on that day (MODIS
 * once VIIRS is observing, Aqua never before its launch, VIIRS never in an outage).
 */
export function hotspotWeights(
  h: Hotspots, f: Filters, c: Calibration, cal: Calendar, outage: Uint8Array,
): Float32Array {
  const w = new Float32Array(h.n);
  const nDays = cal.nDays;
  let start = 0;
  const counts = new Map<number, number>();
  const used = new Uint8Array(h.n);
  while (start < h.n) {
    const day = h.day[start];
    let end = start;
    while (end < h.n && h.day[end] === day) end++;
    if (day < nDays && day >= FIRST_DAY) {
      const m = cal.month[day];
      // Which rows feed the harmonized value on this day, and at what scale.
      let scale: number;
      let want: (fl: number) => boolean;
      if (day < AQUA_DAY) {
        scale = c.ratioTerra[m];
        want = (fl) => !isViirs(fl) && satelliteOf(fl) === 0;
      } else if (day < SEAM_DAY || outage[day]) {
        scale = c.ratio[m];
        want = (fl) => !isViirs(fl);
      } else {
        scale = 1;
        want = (fl) => isViirs(fl);
      }
      counts.clear();
      for (let i = start; i < end; i++) {
        if (!want(h.flags[i]) || !passes(h, i, f)) continue;
        used[i] = 1;
        const key = cellKey(h.lat[i], h.lon[i]);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (let i = start; i < end; i++) {
        if (!used[i]) continue;
        w[i] = scale / counts.get(cellKey(h.lat[i], h.lon[i]))!;
      }
    }
    start = end;
  }
  return w;
}
