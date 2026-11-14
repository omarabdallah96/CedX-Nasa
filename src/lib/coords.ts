// Parsing and checking of the typed bounding box.
import type { BBox } from './harmonize.ts';

/**
 * Reads one coordinate the way people type them: "-8.6", "8,6 W", "39.6°N".
 * A hemisphere letter sets the sign; a comma is accepted as the decimal mark.
 * Returns NaN when the text is not a single number.
 */
export function parseCoord(input: string): number {
  // Arabic-Indic and Persian digits, and the Arabic decimal mark, are read as their Latin forms.
  const text = input
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace('\u066b', '.');
  const m = /^\s*([+-]?)\s*(\d+(?:[.,]\d*)?|[.,]\d+)\s*°?\s*([NSEW])?\s*$/i.exec(text);
  if (!m) return NaN;
  const value = Number(m[2].replace(',', '.'));
  const letter = m[3]?.toUpperCase();
  const negative = m[1] === '-' || letter === 'W' || letter === 'S';
  // "-8 E" contradicts itself.
  if (m[1] === '-' && (letter === 'E' || letter === 'N')) return NaN;
  return negative ? -value : value;
}

export const EDGES = ['West', 'South', 'East', 'North'] as const;

/** Why a typed box was refused; `message` is the English wording, `code` lets other languages word it themselves. */
export interface BoxFailure {
  ok: false;
  code: 'not-a-number' | 'longitude' | 'latitude' | 'west-east' | 'south-north' | 'outside';
  message: string;
  fields: number[];
}

export type BoxResult = { ok: true; bbox: BBox } | BoxFailure;

/** Validates four typed edges against the country they must fall in. */
export function parseBox(text: string[], country: { name: string; bbox: BBox }): BoxResult {
  const v = text.map(parseCoord);
  const bad = v.flatMap((x, i) => (Number.isFinite(x) ? [] : [i]));
  if (bad.length > 0) {
    return {
      ok: false,
      code: 'not-a-number',
      fields: bad,
      message: `${bad.map((i) => EDGES[i]).join(', ')} ${bad.length === 1 ? 'is' : 'are'} not a number. Use decimal degrees, such as -8.6 or 8.6 W.`,
    };
  }
  const [w, s, e, n] = v;
  if (w < -180 || w > 180 || e < -180 || e > 180) {
    return { ok: false, code: 'longitude', fields: [0, 2], message: 'Longitude runs from -180 to 180.' };
  }
  if (s < -90 || s > 90 || n < -90 || n > 90) {
    return { ok: false, code: 'latitude', fields: [1, 3], message: 'Latitude runs from -90 to 90.' };
  }
  if (w >= e) return { ok: false, code: 'west-east', fields: [0, 2], message: 'West must be smaller than East.' };
  if (s >= n) return { ok: false, code: 'south-north', fields: [1, 3], message: 'South must be smaller than North.' };
  const [cw, cs, ce, cn] = country.bbox;
  if (e < cw || w > ce || n < cs || s > cn) {
    return {
      ok: false,
      code: 'outside',
      fields: [0, 1, 2, 3],
      message: `That box lies outside ${country.name}, which sits between longitudes ${cw} and ${ce} and latitudes ${cs} and ${cn}.`,
    };
  }
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return { ok: true, bbox: [round(w), round(s), round(e), round(n)] };
}
