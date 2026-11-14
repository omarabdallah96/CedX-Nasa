// Calendar statistics on a daily series: monthly matrix, climatology, the
// "is this normal?" verdict, season profile and peak season.

import { dayIndex, FIRST_DAY, type Calendar } from './time.ts';

export interface MonthMatrix {
  years: number[];
  /** [yearIndex][month 0-11]; NaN where the record has no coverage. */
  values: number[][];
  /** The month the record ends in, when it ends before that month does. */
  partial: { year: number; month: number; days: number } | null;
}

export function monthMatrix(series: Float32Array, cal: Calendar, firstDay = FIRST_DAY): MonthMatrix {
  const years: number[] = [];
  const values: number[][] = [];
  for (let day = 0; day < cal.nDays; day++) {
    const y = cal.year[day];
    if (years[years.length - 1] !== y) {
      years.push(y);
      values.push(new Array<number>(12).fill(NaN));
    }
    if (day < firstDay) continue;
    const row = values[values.length - 1];
    const m = cal.month[day];
    row[m] = (Number.isNaN(row[m]) ? 0 : row[m]) + series[day];
  }
  let partial: MonthMatrix['partial'] = null;
  const last = cal.nDays - 1;
  if (last >= firstDay) {
    const year = cal.year[last];
    const month = cal.month[last];
    if (last < dayIndex(year, month + 2, 1) - 1) {
      partial = { year, month, days: last - dayIndex(year, month + 1, 1) + 1 };
    }
  }
  return { years, values, partial };
}

const isComplete = (mm: MonthMatrix, yi: number): boolean =>
  mm.values[yi].every((v) => !Number.isNaN(v)) && mm.partial?.year !== mm.years[yi];

/** Years with all twelve months fully covered. */
export function completeYears(mm: MonthMatrix): number[] {
  return mm.years.filter((_, yi) => isComplete(mm, yi));
}

export function annualTotals(mm: MonthMatrix): { year: number; total: number; complete: boolean }[] {
  return mm.years.map((year, yi) => {
    const row = mm.values[yi];
    const complete = isComplete(mm, yi);
    return { year, total: row.reduce((a, v) => a + (Number.isNaN(v) ? 0 : v), 0), complete };
  });
}

export function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface Climatology {
  /** Baseline years used. */
  years: number[];
  median: number[];
  p10: number[];
  p25: number[];
  p75: number[];
  p90: number[];
  mean: number[];
}

export function climatology(mm: MonthMatrix, years = completeYears(mm)): Climatology {
  const out: Climatology = { years, median: [], p10: [], p25: [], p75: [], p90: [], mean: [] };
  const idx = years.map((y) => mm.years.indexOf(y));
  for (let m = 0; m < 12; m++) {
    const vals = idx.map((yi) => mm.values[yi][m]).sort((a, b) => a - b);
    out.median.push(quantileSorted(vals, 0.5));
    out.p10.push(quantileSorted(vals, 0.1));
    out.p25.push(quantileSorted(vals, 0.25));
    out.p75.push(quantileSorted(vals, 0.75));
    out.p90.push(quantileSorted(vals, 0.9));
    out.mean.push(vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length));
  }
  return out;
}

export type Level = 'record' | 'far-above' | 'above' | 'typical' | 'below' | 'far-below' | 'quiet';

export interface Verdict {
  value: number;
  median: number;
  /** value / median; null when the median is zero. */
  ratio: number | null;
  /** 1 = most active among the compared years (ties share a rank). */
  rank: number;
  nYears: number;
  /** Mid-rank percentile among the compared years, 0-1. */
  percentile: number;
  level: Level;
  firstYear: number;
  lastYear: number;
}

/** Ranks `value` against `others` (which should include the value's own year). */
export function judge(value: number, others: number[], firstYear: number, lastYear: number): Verdict {
  const sorted = [...others].sort((a, b) => a - b);
  const med = quantileSorted(sorted, 0.5);
  let below = 0;
  let equal = 0;
  let above = 0;
  for (const v of others) {
    if (v < value) below++;
    else if (v > value) above++;
    else equal++;
  }
  const n = others.length;
  const percentile = n > 0 ? (below + 0.5 * equal) / n : NaN;
  const rank = above + 1;
  let level: Level;
  if (value === 0 && med === 0) level = 'quiet';
  else if (rank === 1 && equal <= 1 && value > 0) level = 'record';
  else if (percentile >= 0.9) level = 'far-above';
  else if (percentile >= 0.75) level = 'above';
  else if (percentile <= 0.1) level = 'far-below';
  else if (percentile <= 0.25) level = 'below';
  else level = 'typical';
  return {
    value, median: med, ratio: med > 0 ? value / med : null,
    rank, nYears: n, percentile, level, firstYear, lastYear,
  };
}

/** Verdict for one calendar month of one year, against the same month in every complete year. */
export function monthVerdict(mm: MonthMatrix, year: number, month: number): Verdict | null {
  const yi = mm.years.indexOf(year);
  if (yi < 0) return null;
  const value = mm.values[yi][month];
  if (Number.isNaN(value)) return null;
  const years = completeYears(mm);
  if (years.length === 0) return null;
  const compare = years.includes(year) ? years : [...years, year];
  const others = compare.map((y) => mm.values[mm.years.indexOf(y)][month]);
  return judge(value, others, Math.min(...compare), Math.max(...compare));
}

/**
 * Verdict for a run of days (inclusive day indices) against the same calendar
 * dates in every baseline year. Used for the unfinished current month, for the
 * last seven days and for a chosen date range.
 */
export function windowVerdict(
  series: Float32Array, cal: Calendar, start: number, end: number, baseline: number[],
): Verdict | null {
  const length = end - start + 1;
  if (length < 1 || length > 366 || start < FIRST_DAY || end >= cal.nDays) return null;
  const sum = (from: number) => {
    let total = 0;
    for (let d = from; d < from + length; d++) total += series[d];
    return total;
  };
  const value = sum(start);
  const ownYear = cal.year[start];
  // 29 February has no counterpart in most years; start those windows on the 28th.
  const month = cal.month[start] + 1;
  const first = dayIndex(ownYear, month, 1);
  const dom = start - first + 1;
  const years: number[] = [];
  const others: number[] = [];
  for (const y of baseline) {
    if (y === ownYear) continue;
    const monthLength = dayIndex(y, month + 1, 1) - dayIndex(y, month, 1);
    const from = dayIndex(y, month, Math.min(dom, monthLength));
    if (from < FIRST_DAY || from + length > cal.nDays) continue;
    years.push(y);
    others.push(sum(from));
  }
  if (years.length === 0) return null;
  years.push(ownYear);
  others.push(value);
  return judge(value, others, Math.min(...years), Math.max(...years));
}

export interface Records {
  /** Complete years, most active first. */
  years: { year: number; total: number }[];
  /** Fully covered months, most active first. */
  months: { year: number; month: number; value: number }[];
}

export function records(mm: MonthMatrix, top = 5): Records {
  const years = annualTotals(mm)
    .filter((t) => t.complete)
    .map(({ year, total }) => ({ year, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, top);
  const months: Records['months'] = [];
  mm.values.forEach((row, yi) => row.forEach((value, month) => {
    const year = mm.years[yi];
    if (Number.isNaN(value) || (mm.partial?.year === year && mm.partial.month === month)) return;
    months.push({ year, month, value });
  }));
  months.sort((a, b) => b.value - a.value);
  return { years, months: months.slice(0, top) };
}

/** Verdict for a whole year against every complete year. */
export function yearVerdict(mm: MonthMatrix, year: number): Verdict | null {
  const totals = annualTotals(mm).filter((t) => t.complete);
  const mine = totals.find((t) => t.year === year);
  if (!mine) return null;
  return judge(mine.total, totals.map((t) => t.total), totals[0].year, totals[totals.length - 1].year);
}

export const PENTADS = 73;

export interface SeasonProfile {
  /** 73 five-day bins; the last one also holds day 366 of leap years. */
  median: number[];
  p10: number[];
  p90: number[];
  byYear: Map<number, number[]>;
}

export function seasonProfile(series: Float32Array, cal: Calendar, baseline: number[]): SeasonProfile {
  const byYear = new Map<number, number[]>();
  for (let day = FIRST_DAY; day < cal.nDays; day++) {
    const y = cal.year[day];
    let row = byYear.get(y);
    if (!row) {
      row = new Array<number>(PENTADS).fill(0);
      byYear.set(y, row);
    }
    row[Math.min(PENTADS - 1, Math.floor(cal.doy[day] / 5))] += series[day];
  }
  const median: number[] = [];
  const p10: number[] = [];
  const p90: number[] = [];
  for (let b = 0; b < PENTADS; b++) {
    const vals = baseline.map((y) => byYear.get(y)?.[b] ?? 0).sort((a, c) => a - c);
    median.push(quantileSorted(vals, 0.5));
    p10.push(quantileSorted(vals, 0.1));
    p90.push(quantileSorted(vals, 0.9));
  }
  return { median, p10, p90, byYear };
}

export interface PeakSeason {
  /** First month of the window, 0-11. */
  start: number;
  /** Number of consecutive months (wraps around December). */
  length: number;
  /** Share of a typical year's activity inside the window, 0-1. */
  share: number;
}

/** Shortest run of consecutive months that holds at least `target` of the mean annual activity. */
export function peakSeason(meanByMonth: number[], target = 2 / 3): PeakSeason | null {
  const total = meanByMonth.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  for (let length = 1; length <= 12; length++) {
    let best: PeakSeason | null = null;
    for (let start = 0; start < 12; start++) {
      let sum = 0;
      for (let k = 0; k < length; k++) sum += meanByMonth[(start + k) % 12];
      const share = sum / total;
      if (share >= target && (!best || share > best.share)) best = { start, length, share };
    }
    if (best) return best;
  }
  return null;
}

/**
 * Typical (median) complete year from `seamYear` on, divided by the typical
 * complete year before it. Near 1 means no step at the sensor switch.
 */
export function seamStep(mm: MonthMatrix, seamYear: number): number {
  const totals = annualTotals(mm).filter((t) => t.complete);
  const med = (v: number[]) => quantileSorted([...v].sort((a, b) => a - b), 0.5);
  const before = med(totals.filter((t) => t.year < seamYear).map((t) => t.total));
  const after = med(totals.filter((t) => t.year >= seamYear).map((t) => t.total));
  return after / before;
}
