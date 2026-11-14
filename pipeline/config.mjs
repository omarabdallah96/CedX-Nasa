// Shared pipeline configuration.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const RAW_DIR = path.join(ROOT, 'data', 'raw');
export const OUT_DIR = path.join(ROOT, 'public', 'data');

// FIRMS yearly per-country archive (standard-processing science-quality files).
export const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/data/country';

// `firms` is the country name exactly as it appears in FIRMS archive file names;
// `ar` is the Arabic name the API gives the phone app.
export const COUNTRIES = [
  { slug: 'portugal', name: 'Portugal', firms: 'Portugal', iso: 'PRT', ar: 'البرتغال' },
  { slug: 'greece', name: 'Greece', firms: 'Greece', iso: 'GRC', ar: 'اليونان' },
  { slug: 'lebanon', name: 'Lebanon', firms: 'Lebanon', iso: 'LBN', ar: 'لبنان' },
  { slug: 'cyprus', name: 'Cyprus', firms: 'Cyprus', iso: 'CYP', ar: 'قبرص' },
];

export const SENSORS = [
  { id: 'modis', from: 2000, to: 2025 },
  { id: 'viirs-snpp', from: 2012, to: 2025 },
];

// Day 0 of every day index in the packed files.
export const EPOCH_UTC = Date.UTC(2000, 0, 1);

// Recent data comes from the FIRMS area API (needs FIRMS_MAP_KEY). Each sensor
// has a science-quality source (SP) and a near-real-time one (NRT) that covers
// the months SP has not reached yet.
export const API_BASE = 'https://firms.modaps.eosdis.nasa.gov';
export const API_DIR = path.join(RAW_DIR, 'api');
export const API_FROM = '2026-01-01';
export const API_SENSORS = [
  { id: 'modis', sp: 'MODIS_SP', nrt: 'MODIS_NRT' },
  { id: 'viirs-snpp', sp: 'VIIRS_SNPP_SP', nrt: 'VIIRS_SNPP_NRT' },
  { id: 'viirs-noaa20', sp: 'VIIRS_NOAA20_SP', nrt: 'VIIRS_NOAA20_NRT' },
];
/** Tolerance, in degrees, for detections on a shoreline the border outline cuts off. */
export const COAST_TOLERANCE = 0.02;

export function rawPath(sensor, year, firmsName) {
  return path.join(RAW_DIR, sensor, String(year), `${sensor}_${year}_${firmsName}.csv`);
}

export function rawUrl(sensor, year, firmsName) {
  return `${FIRMS_BASE}/${sensor}/${year}/${sensor}_${year}_${firmsName}.csv`;
}
