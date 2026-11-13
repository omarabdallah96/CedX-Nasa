// Day-index helpers. Every date in the app is a whole number of days since
// 2000-01-01 UTC, matching the packed data files.

export const EPOCH_MS = Date.UTC(2000, 0, 1);
export const DAY_MS = 86_400_000;

/** month is 1-12. */
export function dayIndex(year: number, month: number, day: number): number {
  return Math.round((Date.UTC(year, month - 1, day) - EPOCH_MS) / DAY_MS);
}

export function isoDate(day: number): string {
  return new Date(EPOCH_MS + day * DAY_MS).toISOString().slice(0, 10);
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Lookup tables from day index to calendar parts. */
export interface Calendar {
  nDays: number;
  year: Uint16Array;
  /** 0-11 */
  month: Uint8Array;
  /** day of year, 0-based (0-365) */
  doy: Uint16Array;
}

export function buildCalendar(nDays: number): Calendar {
  const year = new Uint16Array(nDays);
  const month = new Uint8Array(nDays);
  const doy = new Uint16Array(nDays);
  const d = new Date(EPOCH_MS);
  let curYear = d.getUTCFullYear();
  let n = 0;
  for (let i = 0; i < nDays; i++) {
    const y = d.getUTCFullYear();
    if (y !== curYear) {
      curYear = y;
      n = 0;
    }
    year[i] = y;
    month[i] = d.getUTCMonth();
    doy[i] = n++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { nDays, year, month, doy };
}

/** First Terra MODIS detections in the FIRMS archive. */
export const FIRST_DAY = dayIndex(2000, 11, 1);
/** First Aqua MODIS detections (verified in the packed data). */
export const AQUA_DAY = dayIndex(2002, 7, 4);
/** First VIIRS Suomi-NPP detections in the FIRMS archive: the seam. */
export const SEAM_DAY = dayIndex(2012, 1, 20);
/** Calibration uses whole months only, so the overlap starts in February 2012. */
export const OVERLAP_START = dayIndex(2012, 2, 1);
