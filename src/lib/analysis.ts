// One call that turns packed hotspots + a selection into everything the UI shows.
// Shared by the browser worker, the pipeline summary script and the tests.

import {
  calibrate, dailyCounts, harmonizeDaily, naiveDaily, outageMask, overlapTable, validate, passes, isViirs,
  type Calibration, type Daily, type Filters, type Harmonized, type Hotspots, type OverlapTable, type Validation,
} from './harmonize.ts';
import {
  climatology, completeYears, monthMatrix, peakSeason, seasonProfile,
  type Climatology, type MonthMatrix, type PeakSeason, type SeasonProfile,
} from './stats.ts';
import { buildCalendar, type Calendar } from './time.ts';

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
}

/** Country-wide quantities reused for every drawn area. */
export interface CountryContext {
  nDays: number;
  cal: Calendar;
  outage: Uint8Array;
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
  const outage = outageMask(index.viirsOutages.map((o) => [o.start, o.end]), nDays);
  const daily = dailyCounts(h, { ...flags, bbox: null }, nDays);
  const table = overlapTable(daily, cal, outage);
  return { nDays, cal, outage, ...flags, table, calibration: calibrate(table) };
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
  /** Detections passing the filters, by sensor. */
  detections: { modis: number; viirs: number };
}

export function analyze(h: Hotspots, f: Filters, ctx: CountryContext): Analysis {
  if (f.vegOnly !== ctx.vegOnly || f.dropLowConf !== ctx.dropLowConf) {
    throw new Error('context was built with different filters');
  }
  const { nDays, cal, outage } = ctx;
  const daily = dailyCounts(h, f, nDays);
  const table = f.bbox ? overlapTable(daily, cal, outage) : ctx.table;
  const calibration = f.bbox ? calibrate(table, { prior: ctx.calibration }) : ctx.calibration;
  const validation = f.bbox ? validate(table, ctx.table) : validate(table);
  const harmonized = harmonizeDaily(daily, calibration, cal, outage);
  const naive = naiveDaily(daily);
  const monthsH = monthMatrix(harmonized.h, cal);
  const climate = climatology(monthsH);

  const detections = { modis: 0, viirs: 0 };
  for (let i = 0; i < h.n; i++) {
    if (h.day[i] >= nDays || !passes(h, i, f)) continue;
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
