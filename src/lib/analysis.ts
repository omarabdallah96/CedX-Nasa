// One call that turns packed hotspots + a selection into everything the UI shows.
// Shared by the browser worker, the pipeline summary script and the tests.

import {
  calibrate, dailyCounts, harmonizeDaily, inRecord, naiveDaily, outageMask, overlapTable, validate, passes, isViirs,
  SRC_N20, SRC_VIIRS,
  type Calibration, type Daily, type Filters, type Harmonized, type Hotspots, type OverlapTable, type Validation,
} from './harmonize.ts';
import {
  climatology, completeYears, monthMatrix, monthVerdict, peakSeason, seasonProfile, windowVerdict,
  type Climatology, type MonthMatrix, type PeakSeason, type SeasonProfile, type Verdict,
} from './stats.ts';
import { buildCalendar, dayIndex, type Calendar } from './time.ts';

export interface Manifest {
  slug: string;
  name: string;
  iso: string;
  n: number;
  counts: Record<string, number>;
  bbox: [number, number, number, number];
  /** Box holding the central 95 % of detections: the mainland, without far-off islands. */
  focus: [number, number, number, number];
  firstDay: number;
  lastDay: number;
  bytes: number;
}

export interface Outage {
  start: number;
  end: number;
  from: string;
  to: string;
  days: number;
  modisDetections: number;
}

export interface DatasetIndex {
  epoch: string;
  coverageEndDay: number;
  coverageEnd: string;
  viirsOutages: Outage[];
  countries: Manifest[];
  /** When the files were built (ISO time). */
  generatedAt?: string;
  /** First day loaded from the FIRMS area API, which is also where NOAA-20 rows start. */
  recentFromDay?: number | null;
  /** Last day Suomi-NPP delivered, when that is before the end of the record. */
  snppEndDay?: number | null;
  /** First day of near-real-time (not yet science-quality) data, by sensor. */
  nrtFromDay?: Record<string, number>;
}

/** Country-wide quantities reused for every drawn area. */
export interface CountryContext {
  nDays: number;
  cal: Calendar;
  outage: Uint8Array;
  /** First day NOAA-20 rows exist for; Infinity when there are none. */
  n20From: number;
  vegOnly: boolean;
  dropLowConf: boolean;
  table: OverlapTable;
  calibration: Calibration;
}

export function buildContext(
  h: Hotspots, flags: { vegOnly: boolean; dropLowConf: boolean }, index: DatasetIndex,
): CountryContext {
  const nDays = index.coverageEndDay + 1;
  const cal = buildCalendar(nDays);
  const gaps: [number, number][] = index.viirsOutages.map((o) => [o.start, o.end]);
  if (index.snppEndDay != null && index.snppEndDay < nDays - 1) gaps.push([index.snppEndDay + 1, nDays - 1]);
  const outage = outageMask(gaps, nDays);
  const n20From = index.recentFromDay ?? Infinity;
  const daily = dailyCounts(h, { ...flags, bbox: null }, nDays);
  const table = overlapTable(daily, cal, outage, n20From);
  return { nDays, cal, outage, n20From, ...flags, table, calibration: calibrate(table) };
}

export interface Analysis {
  filters: Filters;
  nDays: number;
  daily: Daily;
  harmonized: Harmonized;
  /** Raw detection counts with a plain sensor switch in 2012: the unharmonized record. */
  naive: Float32Array;
  calibration: Calibration;
  validation: Validation;
  table: OverlapTable;
  monthsH: MonthMatrix;
  monthsLo: MonthMatrix;
  monthsHi: MonthMatrix;
  monthsNaive: MonthMatrix;
  climate: Climatology;
  season: SeasonProfile;
  peak: PeakSeason | null;
  /** Detections passing the filters, by instrument (NOAA-20 only where it stands in). */
  detections: { modis: number; viirs: number };
}

export function analyze(h: Hotspots, f: Filters, ctx: CountryContext): Analysis {
  if (f.vegOnly !== ctx.vegOnly || f.dropLowConf !== ctx.dropLowConf) {
    throw new Error('context was built with different filters');
  }
  const { nDays, cal, outage, n20From } = ctx;
  const daily = dailyCounts(h, f, nDays);
  const table = f.bbox ? overlapTable(daily, cal, outage, n20From) : ctx.table;
  const calibration = f.bbox ? calibrate(table, { prior: ctx.calibration }) : ctx.calibration;
  const validation = f.bbox ? validate(table, ctx.table) : validate(table);
  const harmonized = harmonizeDaily(daily, calibration, cal, outage, n20From);
  const naive = naiveDaily(daily, harmonized.src);
  const monthsH = monthMatrix(harmonized.h, cal);
  const climate = climatology(monthsH);

  const detections = { modis: 0, viirs: 0 };
  for (let i = 0; i < h.n; i++) {
    if (h.day[i] >= nDays || !passes(h, i, f) || !inRecord(h.flags[i], h.day[i], harmonized.src)) continue;
    if (isViirs(h.flags[i])) detections.viirs++;
    else detections.modis++;
  }

  return {
    filters: f,
    nDays,
    daily,
    harmonized,
    naive,
    calibration,
    validation,
    table,
    monthsH,
    monthsLo: monthMatrix(harmonized.lo, cal),
    monthsHi: monthMatrix(harmonized.hi, cal),
    monthsNaive: monthMatrix(naive, cal),
    climate,
    season: seasonProfile(harmonized.h, cal, completeYears(monthsH)),
    peak: peakSeason(climate.mean),
    detections,
  };
}

export interface PeriodVerdict {
  verdict: Verdict;
  /** Days covered so far when the month is still running, otherwise null. */
  partialDays: number | null;
}

/** Verdict for a calendar month; an unfinished month is compared over the same days of the month. */
export function selectionVerdict(a: Analysis, cal: Calendar, year: number, month: number): PeriodVerdict | null {
  const p = a.monthsH.partial;
  if (p && p.year === year && p.month === month) {
    const start = dayIndex(year, month + 1, 1);
    const verdict = windowVerdict(a.harmonized.h, cal, start, cal.nDays - 1, completeYears(a.monthsH));
    return verdict && { verdict, partialDays: p.days };
  }
  const verdict = monthVerdict(a.monthsH, year, month);
  return verdict && { verdict, partialDays: null };
}

export interface RangeSummary {
  /** Inclusive day indices. */
  from: number;
  to: number;
  days: number;
  /** Harmonized active-fire cell-days, with the likely range. */
  harmonized: number;
  lo: number;
  hi: number;
  /** Raw detections in the record, by instrument. */
  detections: { modis: number; viirs: number };
  /** Days by the source of the harmonized value. */
  sourceDays: { modisScaled: number; viirs: number; noaa20: number };
  busiest: { day: number; value: number } | null;
  /** Against the same dates in other years; null for ranges longer than a year. */
  verdict: Verdict | null;
}

export function rangeSummary(a: Analysis, cal: Calendar, from: number, to: number): RangeSummary {
  const out: RangeSummary = {
    from, to, days: to - from + 1, harmonized: 0, lo: 0, hi: 0,
    detections: { modis: 0, viirs: 0 }, sourceDays: { modisScaled: 0, viirs: 0, noaa20: 0 },
    busiest: null, verdict: null,
  };
  const { h, lo, hi, src } = a.harmonized;
  for (let d = Math.max(0, from); d <= to && d < a.nDays; d++) {
    out.harmonized += h[d];
    out.lo += lo[d];
    out.hi += hi[d];
    out.detections.modis += a.daily.rawM[d];
    out.detections.viirs += src[d] === SRC_N20 ? a.daily.rawN[d] : a.daily.rawV[d];
    if (src[d] === SRC_N20) out.sourceDays.noaa20++;
    else if (src[d] === SRC_VIIRS) out.sourceDays.viirs++;
    else if (src[d] !== 0) out.sourceDays.modisScaled++;
    if (h[d] > 0 && (!out.busiest || h[d] > out.busiest.value)) out.busiest = { day: d, value: h[d] };
  }
  out.verdict = windowVerdict(h, cal, from, to, completeYears(a.monthsH));
  return out;
}

/** The last seven complete days of the record. */
export function lastWeek(a: Analysis, cal: Calendar): RangeSummary {
  return rangeSummary(a, cal, cal.nDays - 7, cal.nDays - 1);
}
