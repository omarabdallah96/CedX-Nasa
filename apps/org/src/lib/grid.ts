// The survey grid: lettered columns and numbered rows laid over the
// organization's sites, so every site has a reference ("D4") that is the same
// in the ranked list and on the map. The grid fits the sites, not the screen,
// so a reference stays put while the map pans and zooms.
import type { Feature, FeatureCollection } from 'geojson';

export interface Grid {
  west: number;
  south: number;
  step: number;
  cols: number;
  rows: number;
}

interface Circle { lat: number; lon: number; radiusKm: number }

/** Steps in degrees, smallest first. */
const STEPS = [0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10];
const MAX = 8;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // No I or O: they read as 1 and 0.

export function circleBox({ lat, lon, radiusKm }: Circle): [number, number, number, number] {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

/** The smallest grid of at most 8 × 8 cells that holds every site with a margin. Null without sites. */
export function makeGrid(sites: Circle[]): Grid | null {
  if (sites.length === 0) return null;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const c of sites) {
    const [a, b, c2, d] = circleBox(c);
    w = Math.min(w, a); s = Math.min(s, b); e = Math.max(e, c2); n = Math.max(n, d);
  }
  const padX = Math.max(0.05, (e - w) * 0.12);
  const padY = Math.max(0.05, (n - s) * 0.12);
  w -= padX; e += padX; s -= padY; n += padY;
  for (const step of STEPS) {
    const west = Math.floor(w / step) * step;
    const south = Math.floor(s / step) * step;
    const cols = Math.ceil((e - west) / step - 1e-9);
    const rows = Math.ceil((n - south) / step - 1e-9);
    if (cols <= MAX && rows <= MAX) return { west, south, step, cols: Math.max(1, cols), rows: Math.max(1, rows) };
  }
  const step = STEPS.at(-1)!;
  const west = Math.floor(w / step) * step;
  const south = Math.floor(s / step) * step;
  return { west, south, step, cols: Math.min(LETTERS.length, Math.ceil((e - west) / step)), rows: Math.ceil((n - south) / step) };
}

export const colLetter = (i: number) => LETTERS[i] ?? '?';
/** Rows count from the north, as on a printed map sheet. */
export const north = (g: Grid) => g.south + g.rows * g.step;

export function refOf(g: Grid, lat: number, lon: number): string {
  const col = Math.min(g.cols - 1, Math.max(0, Math.floor((lon - g.west) / g.step)));
  const row = Math.min(g.rows - 1, Math.max(0, Math.floor((north(g) - lat) / g.step)));
  return `${colLetter(col)}${row + 1}`;
}

/** West, south, east, north of one cell. */
export function cellBox(g: Grid, ref: string): [number, number, number, number] | null {
  const col = LETTERS.indexOf(ref[0]);
  const row = Number(ref.slice(1)) - 1;
  if (col < 0 || !(row >= 0)) return null;
  const w = g.west + col * g.step;
  const n = north(g) - row * g.step;
  return [w, n - g.step, w + g.step, n];
}

export function gridLines(g: Grid): FeatureCollection {
  const n = north(g);
  const e = g.west + g.cols * g.step;
  const features: Feature[] = [];
  for (let i = 0; i <= g.cols; i++) {
    const x = g.west + i * g.step;
    features.push({ type: 'Feature', properties: { edge: i === 0 || i === g.cols }, geometry: { type: 'LineString', coordinates: [[x, g.south], [x, n]] } });
  }
  for (let j = 0; j <= g.rows; j++) {
    const y = g.south + j * g.step;
    features.push({ type: 'Feature', properties: { edge: j === 0 || j === g.rows }, geometry: { type: 'LineString', coordinates: [[g.west, y], [e, y]] } });
  }
  return { type: 'FeatureCollection', features };
}

export function cellPolygon(g: Grid, ref: string | null): FeatureCollection {
  const b = ref ? cellBox(g, ref) : null;
  if (!b) return { type: 'FeatureCollection', features: [] };
  const [w, s, e, n] = b;
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } }] };
}

/** Coordinates as a surveyor writes them: 34.450°N 36.240°E. */
export function coords(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`;
}
