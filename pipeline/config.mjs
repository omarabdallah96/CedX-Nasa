// Shared pipeline configuration.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const RAW_DIR = path.join(ROOT, 'data', 'raw');
export const OUT_DIR = path.join(ROOT, 'public', 'data');

// FIRMS yearly per-country archive (standard-processing science-quality files).
export const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/data/country';

// `firms` is the country name exactly as it appears in FIRMS archive file names.
export const COUNTRIES = [
  { slug: 'portugal', name: 'Portugal', firms: 'Portugal', iso: 'PRT' },
  { slug: 'greece', name: 'Greece', firms: 'Greece', iso: 'GRC' },
  { slug: 'lebanon', name: 'Lebanon', firms: 'Lebanon', iso: 'LBN' },
  { slug: 'cyprus', name: 'Cyprus', firms: 'Cyprus', iso: 'CYP' },
];

export const SENSORS = [
  { id: 'modis', from: 2000, to: 2025 },
  { id: 'viirs-snpp', from: 2012, to: 2025 },
];

// Day 0 of every day index in the packed files.
export const EPOCH_UTC = Date.UTC(2000, 0, 1);

export function rawPath(sensor, year, firmsName) {
  return path.join(RAW_DIR, sensor, String(year), `${sensor}_${year}_${firmsName}.csv`);
}

export function rawUrl(sensor, year, firmsName) {
  return `${FIRMS_BASE}/${sensor}/${year}/${sensor}_${year}_${firmsName}.csv`;
}
