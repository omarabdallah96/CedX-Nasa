// Decides whether a detection belongs to a country, for rows that come from the
// FIRMS area API (a bounding box) instead of the pre-clipped country archive.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { RAW_DIR } from './config.mjs';

export const WORLD_FILE = path.join(RAW_DIR, 'natural-earth', 'ne_10m_admin_0_countries.geojson');
export const WORLD_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson';

/** Flattens a Polygon / MultiPolygon into rings with their bounding boxes. */
function ringsOf(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const rings = [];
  for (const poly of polys) {
    for (const ring of poly) {
      let w = 180, e = -180, s = 90, n = -90;
      for (const [x, y] of ring) {
        if (x < w) w = x;
        if (x > e) e = x;
        if (y < s) s = y;
        if (y > n) n = y;
      }
      rings.push({ ring, w, e, s, n });
    }
  }
  return rings;
}

/** Even-odd rule over all rings, so holes and islands both work. */
function inside(rings, lon, lat) {
  let hit = false;
  for (const r of rings) {
    if (lon < r.w || lon > r.e || lat < r.s || lat > r.n) continue;
    const p = r.ring;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const yi = p[i][1];
      const yj = p[j][1];
      if ((yi > lat) !== (yj > lat) && lon < ((p[j][0] - p[i][0]) * (lat - yi)) / (yj - yi) + p[i][0]) hit = !hit;
    }
  }
  return hit;
}

/** Distance in degrees (longitude scaled by cos latitude) to the nearest ring edge, capped at `max`. */
function distance(rings, lon, lat, max) {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = max;
  for (const r of rings) {
    if (lon < r.w - max / k || lon > r.e + max / k || lat < r.s - max || lat > r.n + max) continue;
    const p = r.ring;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const ax = (p[j][0] - lon) * k;
      const ay = p[j][1] - lat;
      const bx = (p[i][0] - lon) * k;
      const by = p[i][1] - lat;
      const dx = bx - ax;
      const dy = by - ay;
      const len = dx * dx + dy * dy;
      const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < best) best = d;
    }
  }
  return best;
}

export async function loadWorld() {
  return JSON.parse(await readFile(WORLD_FILE, 'utf8'));
}

/**
 * Returns `accept(lon, lat)` for one country, and its padded bounding box.
 * A point counts when it is inside the border, or within `coast` degrees of it
 * and not inside any other country (fires on a shoreline that the simplified
 * outline cuts off).
 */
export function makeClipper(world, iso, coast = 0.03) {
  const match = (f) => f.properties.ADM0_A3 === iso || f.properties.ISO_A3 === iso;
  const own = world.features.filter(match);
  if (own.length === 0) throw new Error(`no Natural Earth feature for ${iso}`);
  const rings = own.flatMap((f) => ringsOf(f.geometry));
  let w = 180, e = -180, s = 90, n = -90;
  for (const r of rings) {
    if (r.w < w) w = r.w;
    if (r.e > e) e = r.e;
    if (r.s < s) s = r.s;
    if (r.n > n) n = r.n;
  }
  const pad = 0.1;
  const bbox = [w - pad, s - pad, e + pad, n + pad].map((v) => Math.round(v * 100) / 100);
  // Other countries whose box overlaps this one.
  const others = world.features
    .filter((f) => !match(f))
    .map((f) => ringsOf(f.geometry))
    .map((rs) => rs.filter((r) => r.e >= bbox[0] && r.w <= bbox[2] && r.n >= bbox[1] && r.s <= bbox[3]))
    .filter((rs) => rs.length > 0);

  const accept = (lon, lat) => {
    if (inside(rings, lon, lat)) return true;
    if (coast <= 0 || distance(rings, lon, lat, coast) >= coast) return false;
    return !others.some((rs) => inside(rs, lon, lat));
  };
  return { accept, bbox, inside: (lon, lat) => inside(rings, lon, lat), distance: (lon, lat, max = 1) => distance(rings, lon, lat, max) };
}
