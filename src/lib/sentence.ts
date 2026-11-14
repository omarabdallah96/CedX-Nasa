// The plain-language answer. Shared by the website and the API, so a phone app
// shows the same words as the site.
import type { Analysis, PeriodVerdict } from './analysis.ts';
import { SRC_GAPFILL, SRC_N20, SRC_VIIRS } from './harmonize.ts';
import { fmtCount, fmtRatio, ordinal } from './format.ts';
import type { Level, Verdict } from './stats.ts';
import { dayIndex, MONTHS_LONG, spanName, type Calendar } from './time.ts';

export const ANSWER: Record<Level, string> = {
  record: 'No. This is a record.',
  'far-above': 'No. Far above normal.',
  above: 'Above normal.',
  typical: 'Yes, this is normal.',
  below: 'Below normal.',
  'far-below': 'Unusually quiet.',
  quiet: 'Yes. Quiet, as usual.',
};

/**
 * `what` is the period judged ("August 2017"); `usual` names what it is compared
 * with ("August", "1–13 November").
 */
export function verdictSentence(v: Verdict, what: string, usual: string, place: string): string {
  const amount = `${what} saw ${fmtCount(v.value)} active-fire cell-days in ${place}`;
  const span = `${v.firstYear}–${v.lastYear}`;
  if (v.level === 'quiet') return `${amount}, and the usual ${usual} sees none either.`;
  const versus = v.ratio === null
    ? `the usual ${usual} sees none`
    : v.ratio >= 1.05
      ? `${fmtRatio(v.ratio)} the usual ${usual}`
      : v.ratio <= 0.95
        ? `${Math.round(v.ratio * 100)}% of the usual ${usual}`
        : `right at the usual ${usual}`;
  const rank = v.rank === 1
    ? `the most active ${usual} of the ${v.nYears} on record (${span})`
    : v.rank === v.nYears
      ? `the quietest ${usual} of the ${v.nYears} on record (${span})`
      : `the ${ordinal(v.rank)} most active ${usual} of ${v.nYears} (${span})`;
  return `${amount}: ${versus}, and ${rank}.`;
}

/** Names for a calendar month's verdict; an unfinished month is named by the days it has so far. */
export function monthWording(p: PeriodVerdict, year: number, month: number): { what: string; usual: string } {
  if (p.partialDays === null) return { what: `${MONTHS_LONG[month]} ${year}`, usual: MONTHS_LONG[month] };
  const from = dayIndex(year, month + 1, 1);
  const days = spanName(from, from + p.partialDays - 1);
  return { what: `${MONTHS_LONG[month]} ${year} so far (${days})`, usual: days };
}

/** Where the harmonized value of a month comes from, judged at mid-month (or its last covered day). */
export function sourceText(a: Analysis, cal: Calendar, year: number, month: number): { key: 'viirs' | 'modis'; text: string } {
  const src = a.harmonized.src[Math.min(cal.nDays - 1, dayIndex(year, month + 1, 15))];
  if (src === SRC_VIIRS) return { key: 'viirs', text: 'VIIRS (Suomi-NPP), as observed' };
  if (src === SRC_N20) return { key: 'viirs', text: `VIIRS on NOAA-20, ÷${a.calibration.ratioN20.toFixed(2)} to match Suomi-NPP` };
  if (src === SRC_GAPFILL) return { key: 'modis', text: 'VIIRS outage: filled from MODIS' };
  return { key: 'modis', text: `MODIS, scaled ×${a.calibration.ratio[month].toFixed(1)}` };
}
