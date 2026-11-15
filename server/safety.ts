// Safety around a fire: what is nearby (water, fire stations, hospitals,
// assembly points) and the fastest way out that does not drive into the fire.
//
// Places come from OpenStreetMap through the Overpass API (free, no key).
// The danger area is a teardrop around each fire, stretched downwind with the
// current wind from Open-Meteo (free, no key). Routes come from OSRM (free demo
// server, no key) with alternatives, and the one that crosses the least danger
// wins. With ORS_API_KEY set, OpenRouteService is asked first, because it can
// route around the danger area directly (avoid_polygons).
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ResourceKind = 'water' | 'fire_station' | 'hospital' | 'assembly_point' | 'town';

export interface Resource {
  id: string;
  kind: ResourceKind;
  /** What it is exactly: hydrant, water_tank, suction_point, lake, reservoir, river, canal, city, town, village… */
  detail: string;
  name: string | null;
  nameAr: string | null;
  lat: number;
  lon: number;
  distanceKm: number;
  /** From the centre to the place, degrees clockwise from north. */
  bearingDeg: number;
}

export interface Wind {
  speedKmh: number;
  /** Where the wind comes from, degrees clockwise from north (the weather convention). */
  fromDeg: number;
}

export interface EscapeRoute {
  destination: { name: string | null; nameAr: string | null; kind: ResourceKind | 'direction'; detail: string; lat: number; lon: number };
  distanceKm: number;
  durationMin: number;
  /** General direction of travel, from the start to the destination. */
  headingDeg: number;
  /** Kilometres of the route inside a danger area, after first leaving it. */
  exposureKm: number;
  safe: boolean;
  provider: 'osrm' | 'ors';
  /** [lat, lon] pairs. */
  geometry: [number, number][];
}

export interface EscapePlan {
  from: { lat: number; lon: number };
  generatedAt: string;
  wind: Wind | null;
  /** Danger areas as rings of [lat, lon]. */
  danger: [number, number][][];
  /** True when the start itself is inside a danger area. */
  startInDanger: boolean;
  routes: EscapeRoute[];
}

type LatLon = { lat: number; lon: number };
type FetchInit = { method?: string; body?: string; headers?: Record<string, string>; timeoutMs?: number };
type FetchJson = (url: string, init?: FetchInit) => Promise<unknown>;

export class SafetyUnavailableError extends Error {}

// ---------- geometry ----------

const R_EARTH = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const round = (x: number, n: number) => Math.round(x * 10 ** n) / 10 ** n;

export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function destination(p: LatLon, bearing: number, km: number): LatLon {
  const d = km / R_EARTH;
  const b = rad(bearing);
  const lat1 = rad(p.lat);
  const lon1 = rad(p.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lon: ((deg(lon2) + 540) % 360) - 180 };
}

/** Smallest angle between two bearings, 0–180. */
export function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Ray casting on [lat, lon] rings; fine at the few-kilometre scale of a fire. */
export function insideRing(p: LatLon, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > p.lat !== yj > p.lat && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Radius around a fire that is dangerous whatever the wind. */
export const FIRE_RADIUS_KM = 1.5;

/** How far downwind the danger reaches: longer with more wind. */
export function downwindKm(wind: Wind | null): number {
  if (!wind || wind.speedKmh < 5) return 0;
  return Math.min(10, 1 + wind.speedKmh * 0.2);
}

/**
 * Teardrop around one fire: a circle, pulled out downwind. The radius at angle θ is
 * r0 + L·max(0, cos(θ − downwind))², which is round upwind and pointed downwind.
 */
export function dangerArea(fire: LatLon, wind: Wind | null, steps = 32): [number, number][] {
  const L = downwindKm(wind);
  const r0 = L === 0 ? FIRE_RADIUS_KM + 0.5 : FIRE_RADIUS_KM;
  const down = wind ? (wind.fromDeg + 180) % 360 : 0;
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i * 360) / steps;
    const c = Math.max(0, Math.cos(rad(t - down)));
    const p = destination(fire, t, r0 + L * c * c);
    ring.push([round(p.lat, 5), round(p.lon, 5)]);
  }
  ring.push(ring[0]);
  return ring;
}

/** Fires closer than `km` become one, so a big fire is one area and not fifty. */
export function clusterFires(fires: LatLon[], km = 1): LatLon[] {
  const groups: { lat: number; lon: number; n: number }[] = [];
  for (const f of fires) {
    const g = groups.find((g) => distanceKm(g, f) <= km);
    if (g) {
      g.lat = (g.lat * g.n + f.lat) / (g.n + 1);
      g.lon = (g.lon * g.n + f.lon) / (g.n + 1);
      g.n++;
    } else groups.push({ ...f, n: 1 });
  }
  return groups.map(({ lat, lon }) => ({ lat, lon }));
}

/** Kilometres of a route inside danger, not counting the stretch spent leaving it from the start. */
export function exposureKm(route: [number, number][], danger: [number, number][][]): number {
  const inside = (lat: number, lon: number) => danger.some((ring) => insideRing({ lat, lon }, ring));
  let leaving = route.length > 0 && inside(route[0][0], route[0][1]);
  let km = 0;
  for (let i = 1; i < route.length; i++) {
    const [aLat, aLon] = route[i - 1];
    const [bLat, bLon] = route[i];
    const midIn = inside((aLat + bLat) / 2, (aLon + bLon) / 2);
    if (leaving) {
      if (!midIn) leaving = false;
      continue;
    }
    if (midIn) km += distanceKm({ lat: aLat, lon: aLon }, { lat: bLat, lon: bLon });
  }
  return km;
}

/** Douglas–Peucker on [lat, lon] points; `toleranceKm` is the largest shift allowed. */
export function simplify(points: [number, number][], toleranceKm = 0.015): [number, number][] {
  if (points.length < 3) return points;
  const kx = 111.32 * Math.cos(rad(points[0][0]));
  const xy = points.map(([lat, lon]) => [lon * kx, lat * 110.57] as const);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const len = Math.hypot(bx - ax, by - ay);
    let far = -1;
    let farD = toleranceKm;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > farD) {
        far = i;
        farD = d;
      }
    }
    if (far > 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Direction pointing away from the fires, weighting near ones most. */
export function awayBearing(from: LatLon, fires: LatLon[]): number {
  let x = 0;
  let y = 0;
  for (const f of fires) {
    const d = Math.max(0.3, distanceKm(from, f));
    const b = rad(bearingDeg(from, f));
    x += Math.sin(b) / (d * d);
    y += Math.cos(b) / (d * d);
  }
  return (deg(Math.atan2(-x, -y)) + 360) % 360;
}

// ---------- Overpass ----------

const WATER_DETAIL: Record<string, string> = {
  fire_hydrant: 'hydrant',
  water_tank: 'water_tank',
  suction_point: 'suction_point',
  fire_water_pond: 'pond',
};

export function overpassQuery(c: LatLon, radiusKm: number): string {
  const r = Math.round(radiusKm * 1000);
  const at = `(around:${r},${c.lat},${c.lon})`;
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.max(0.01, Math.cos(rad(c.lat))));
  const box = [c.lat - dLat, c.lon - dLon, c.lat + dLat, c.lon + dLon].map((v) => v.toFixed(5)).join(',');
  return `[out:json][timeout:25];
(
  node["emergency"~"^(fire_hydrant|water_tank|suction_point|fire_water_pond)$"]${at};
  nwr["natural"="water"]["water"!~"wastewater|sewage"]${at};
  nwr["landuse"="reservoir"]${at};
  nwr["amenity"="fire_station"]${at};
  nwr["amenity"~"^(hospital|clinic)$"]${at};
  nwr["emergency"="assembly_point"]${at};
  node["place"~"^(city|town|village)$"]${at};
);
out center tags;
way["waterway"~"^(river|canal)$"]${at};
out tags geom(${box});`;
}

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: ({ lat: number; lon: number } | null)[];
  tags?: Record<string, string>;
}

function classify(tags: Record<string, string>): { kind: ResourceKind; detail: string } | null {
  if (tags.emergency && WATER_DETAIL[tags.emergency]) return { kind: 'water', detail: WATER_DETAIL[tags.emergency] };
  if (tags.amenity === 'fire_station') return { kind: 'fire_station', detail: 'fire_station' };
  if (tags.amenity === 'hospital' || tags.amenity === 'clinic') return { kind: 'hospital', detail: tags.amenity };
  if (tags.emergency === 'assembly_point') return { kind: 'assembly_point', detail: 'assembly_point' };
  if (tags.place) return { kind: 'town', detail: tags.place };
  if (tags.waterway) return { kind: 'water', detail: tags.waterway };
  if (tags.landuse === 'reservoir' || tags.water === 'reservoir') return { kind: 'water', detail: 'reservoir' };
  if (tags.natural === 'water') return { kind: 'water', detail: tags.water === 'river' ? 'river' : tags.water || 'lake' };
  return null;
}

/** Most of each kind kept, nearest first. */
const KEEP: Record<ResourceKind, number> = { water: 15, fire_station: 6, hospital: 6, assembly_point: 6, town: 25 };

export function parseOverpass(json: unknown, c: LatLon, radiusKm: number): Resource[] {
  const elements = ((json as { elements?: OsmElement[] })?.elements ?? []) as OsmElement[];
  const out: Resource[] = [];
  const seenRiver = new Map<string, Resource>();
  for (const e of elements) {
    const tags = e.tags ?? {};
    const what = classify(tags);
    if (!what) continue;
    let p: LatLon | null = null;
    if (e.geometry?.length) {
      // Rivers and canals: the nearest point of the line, not its middle.
      let best = Infinity;
      for (const g of e.geometry) {
        if (!g) continue;
        const d = distanceKm(c, g);
        if (d < best) {
          best = d;
          p = g;
        }
      }
    } else if (e.lat !== undefined && e.lon !== undefined) p = { lat: e.lat, lon: e.lon };
    else if (e.center) p = e.center;
    if (!p) continue;
    const d = distanceKm(c, p);
    if (d > radiusKm) continue;
    const r: Resource = {
      id: `${e.type}/${e.id}`,
      kind: what.kind,
      detail: what.detail,
      name: tags['name:en'] ?? tags.name ?? null,
      nameAr: tags['name:ar'] ?? null,
      lat: round(p.lat, 6),
      lon: round(p.lon, 6),
      distanceKm: round(d, 2),
      bearingDeg: Math.round(bearingDeg(c, p)),
    };
    // A river is many ways; keep its nearest piece only.
    if (e.geometry?.length && r.name) {
      const key = `${r.detail}:${r.name}`;
      const had = seenRiver.get(key);
      if (had && had.distanceKm <= r.distanceKm) continue;
      if (had) out.splice(out.indexOf(had), 1);
      seenRiver.set(key, r);
    }
    out.push(r);
  }
  out.sort((a, b) => a.distanceKm - b.distanceKm);
  const count: Partial<Record<ResourceKind, number>> = {};
  return out.filter((r) => (count[r.kind] = (count[r.kind] ?? 0) + 1) <= KEEP[r.kind]);
}

// ---------- routing ----------

interface RawRoute {
  distanceKm: number;
  durationMin: number;
  geometry: [number, number][];
  provider: 'osrm' | 'ors';
}

export function parseOsrm(json: unknown): RawRoute[] {
  const routes = (json as { code?: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] })?.routes;
  if (!routes) return [];
  return routes.map((r) => ({
    distanceKm: round(r.distance / 1000, 2),
    durationMin: Math.max(1, Math.round(r.duration / 60)),
    geometry: r.geometry.coordinates.map(([lon, lat]) => [round(lat, 5), round(lon, 5)] as [number, number]),
    provider: 'osrm' as const,
  }));
}

export function parseOrs(json: unknown): RawRoute[] {
  const features = (json as { features?: { geometry: { coordinates: [number, number][] }; properties: { summary: { distance?: number; duration?: number } } }[] })?.features;
  if (!features) return [];
  return features.map((f) => ({
    distanceKm: round((f.properties.summary.distance ?? 0) / 1000, 2),
    durationMin: Math.max(1, Math.round((f.properties.summary.duration ?? 0) / 60)),
    geometry: f.geometry.coordinates.map(([lon, lat]) => [round(lat, 5), round(lon, 5)] as [number, number]),
    provider: 'ors' as const,
  }));
}

// ---------- the service ----------


/** Public Overpass servers, tried in turn: any one of them is often busy. */
const OVERPASS_URLS = (process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);
const OSRM_URL = process.env.OSRM_URL || 'https://router.project-osrm.org';
const ORS_URL = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson';
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';

/** Places barely move: one Overpass answer per area is good for a day in memory… */
const RESOURCES_MS = 24 * 3_600_000;
/** …and for a week on disk. An older copy is still used when Overpass is down. */
const DISK_FRESH_MS = 7 * 24 * 3_600_000;
/** Public Overpass servers can take half a minute under load. */
const OVERPASS_TIMEOUT_MS = 60_000;
const WIND_MS = 30 * 60_000;
const PLAN_MS = 10 * 60_000;
const MAX_CACHE = 400;
/** Escape destinations are searched this far from the start. */
export const ESCAPE_SEARCH_KM = 20;
export const MAX_RESOURCE_KM = 25;
export const MAX_FIRES = 200;

async function defaultFetchJson(url: string, init?: FetchInit): Promise<unknown> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    body: init?.body,
    headers: { 'User-Agent': 'firesight-safety/1.0', Accept: 'application/json', ...init?.headers },
    signal: AbortSignal.timeout(init?.timeoutMs ?? 20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

function cached<T>(map: Map<string, { at: number; value: Promise<T> }>, key: string, ttl: number, now: () => number, make: () => Promise<T>): Promise<T> {
  const hit = map.get(key);
  if (hit && now() - hit.at < ttl) return hit.value;
  if (map.size >= MAX_CACHE) map.delete(map.keys().next().value!);
  const value = make();
  map.set(key, { at: now(), value });
  // A failure must not stick for the whole cache time.
  value.catch(() => map.delete(key));
  return value;
}

export interface SafetyOptions {
  fetchJson?: FetchJson;
  /** Keeps Overpass answers across restarts and Overpass outages. */
  cacheDir?: string;
  orsKey?: string;
  now?: () => number;
}

export function createSafety({ fetchJson = defaultFetchJson, cacheDir, orsKey = process.env.ORS_API_KEY, now = Date.now }: SafetyOptions = {}) {
  const placeCache = new Map<string, { at: number; value: Promise<Resource[]> }>();
  const windCache = new Map<string, { at: number; value: Promise<Wind | null> }>();
  const planCache = new Map<string, { at: number; value: Promise<EscapePlan> }>();

  /** Everything within radiusKm, towns included. Cached per ~1 km cell. */
  function places(c: LatLon, radiusKm: number): Promise<Resource[]> {
    const q = { lat: round(c.lat, 2), lon: round(c.lon, 2) };
    const key = `${q.lat},${q.lon},${radiusKm}`;
    return cached(placeCache, key, RESOURCES_MS, now, async () => {
      const file = cacheDir ? path.join(cacheDir, `${key.replaceAll(',', '_')}.json`) : null;
      const saved = file ? await readSaved(file) : null;
      if (saved && now() - saved.at < DISK_FRESH_MS) return saved.places;
      const body = `data=${encodeURIComponent(overpassQuery(q, radiusKm))}`;
      const errors: string[] = [];
      for (const url of OVERPASS_URLS) {
        try {
          const json = await fetchJson(url, {
            method: 'POST',
            body,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeoutMs: OVERPASS_TIMEOUT_MS,
          });
          const found = parseOverpass(json, q, radiusKm);
          if (file) await save(file, found).catch((err) => console.error('safety: could not save places', err));
          return found;
        } catch (err) {
          errors.push((err as Error).message);
        }
      }
      if (saved) return saved.places;
      throw new SafetyUnavailableError(`OpenStreetMap (Overpass) did not answer (${errors.join('; ')}).`);
    });
  }

  async function readSaved(file: string): Promise<{ at: number; places: Resource[] } | null> {
    try {
      const [text, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
      return { at: info.mtimeMs, places: JSON.parse(text) as Resource[] };
    } catch {
      return null;
    }
  }

  async function save(file: string, found: Resource[]) {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(found));
    await rename(tmp, file);
  }

  /** Distances measured again from the exact point asked about. */
  function around(c: LatLon, all: Resource[], radiusKm: number): Resource[] {
    return all
      .map((r) => ({ ...r, distanceKm: round(distanceKm(c, r), 2), bearingDeg: Math.round(bearingDeg(c, r)) }))
      .filter((r) => r.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  function wind(c: LatLon): Promise<Wind | null> {
    const key = `${round(c.lat, 1)},${round(c.lon, 1)}`;
    return cached(windCache, key, WIND_MS, now, async () => {
      try {
        const json = (await fetchJson(`${WEATHER_URL}?latitude=${c.lat}&longitude=${c.lon}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh`)) as {
          current?: { wind_speed_10m?: number; wind_direction_10m?: number };
        };
        const s = json.current?.wind_speed_10m;
        const d = json.current?.wind_direction_10m;
        if (typeof s !== 'number' || typeof d !== 'number') return null;
        return { speedKmh: round(s, 1), fromDeg: Math.round(d) };
      } catch {
        // Without wind the danger areas are plain circles.
        return null;
      }
    });
  }

  async function route(from: LatLon, to: LatLon, danger: [number, number][][]): Promise<RawRoute[]> {
    if (orsKey) {
      // ORS refuses an avoid area that holds the start or the end.
      const avoid = danger.filter((ring) => !insideRing(from, ring) && !insideRing(to, ring));
      try {
        const body: Record<string, unknown> = { coordinates: [[from.lon, from.lat], [to.lon, to.lat]] };
        if (avoid.length) body.options = { avoid_polygons: { type: 'MultiPolygon', coordinates: avoid.map((ring) => [ring.map(([lat, lon]) => [lon, lat])]) } };
        const got = parseOrs(await fetchJson(ORS_URL, {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { Authorization: orsKey, 'Content-Type': 'application/json' },
        }));
        if (got.length) return got;
      } catch {
        // Fall through to OSRM.
      }
    }
    const url = `${OSRM_URL}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?alternatives=3&overview=full&geometries=geojson`;
    try {
      return parseOsrm(await fetchJson(url));
    } catch {
      return [];
    }
  }

  /** Up to three destinations to drive to, spread over different directions. */
  function chooseDestinations(from: LatLon, fires: LatLon[], all: Resource[], danger: [number, number][][]): EscapeRoute['destination'][] {
    const nearestFire = fires.length ? Math.min(...fires.map((f) => distanceKm(from, f))) : Infinity;
    const away = fires.length ? awayBearing(from, fires) : null;
    const usable = all.filter((r) => {
      if (r.kind === 'water') return false;
      const minKm = r.kind === 'town' ? 2 : 1.5;
      if (r.distanceKm < minKm || r.distanceKm > ESCAPE_SEARCH_KM) return false;
      if (danger.some((ring) => insideRing(r, ring))) return false;
      if (away === null) return r.kind === 'town';
      if (angleBetween(r.bearingDeg, away) > 100) return false;
      // It has to end up farther from every fire than we are now.
      return fires.every((f) => distanceKm(r, f) > Math.max(nearestFire, FIRE_RADIUS_KM + 1));
    });
    const score = (r: Resource) =>
      r.distanceKm + (away === null ? 0 : (angleBetween(r.bearingDeg, away) / 100) * 5) + (r.kind === 'town' ? 0 : 1.5);
    usable.sort((a, b) => score(a) - score(b));
    const picked: Resource[] = [];
    const spread = away === null ? 60 : 30;
    for (const r of usable) {
      if (picked.every((p) => angleBetween(p.bearingDeg, r.bearingDeg) >= spread)) picked.push(r);
      if (picked.length === 3) break;
    }
    const out: EscapeRoute['destination'][] = picked.map((r) => ({ name: r.name, nameAr: r.nameAr, kind: r.kind, detail: r.detail, lat: r.lat, lon: r.lon }));
    if (!out.length && away !== null) {
      // No named place that way: drive about 8 km straight away from the fire.
      const p = destination(from, away, 8);
      out.push({ name: null, nameAr: null, kind: 'direction', detail: 'away', lat: round(p.lat, 5), lon: round(p.lon, 5) });
    }
    return out;
  }

  async function plan(from: LatLon, firesIn: LatLon[]): Promise<EscapePlan> {
    // Only fires that can matter for this trip.
    const fires = clusterFires(
      firesIn.filter((f) => distanceKm(from, f) <= ESCAPE_SEARCH_KM + 20).sort((a, b) => distanceKm(from, a) - distanceKm(from, b)).slice(0, MAX_FIRES),
    ).slice(0, 30);
    const [w, all] = await Promise.all([
      fires.length ? wind(fires[0]) : Promise.resolve(null),
      places(from, ESCAPE_SEARCH_KM).then((p) => around(from, p, ESCAPE_SEARCH_KM)).catch(() => [] as Resource[]),
    ]);
    const danger = fires.map((f) => dangerArea(f, w));
    const startInDanger = danger.some((ring) => insideRing(from, ring));
    const targets = chooseDestinations(from, fires, all, danger);
    const found = await Promise.all(
      targets.map(async (dest) => {
        const options = await route(from, dest, danger);
        const scored = options.map((r) => ({ r, exposure: round(exposureKm(r.geometry, danger), 2) }));
        scored.sort((a, b) => a.exposure - b.exposure || a.r.durationMin - b.r.durationMin);
        const best = scored[0];
        if (!best) return null;
        const way: EscapeRoute = {
          destination: dest,
          distanceKm: best.r.distanceKm,
          durationMin: best.r.durationMin,
          headingDeg: Math.round(bearingDeg(from, dest)),
          exposureKm: best.exposure,
          safe: best.exposure < 0.2,
          provider: best.r.provider,
          geometry: simplify(best.r.geometry),
        };
        return way;
      }),
    );
    let routes = found.filter((r): r is EscapeRoute => r !== null);
    if (targets.length && !routes.length) throw new SafetyUnavailableError('The routing service did not answer.');
    routes.sort((a, b) => Number(b.safe) - Number(a.safe) || a.exposureKm - b.exposureKm || a.durationMin - b.durationMin);
    // A route through the fire is shown only when nothing better exists, and then only the least bad one.
    routes = routes.some((r) => r.safe) ? routes.filter((r) => r.safe) : routes.slice(0, 1);
    return {
      from: { lat: round(from.lat, 5), lon: round(from.lon, 5) },
      generatedAt: new Date(now()).toISOString(),
      wind: w,
      danger,
      startInDanger,
      routes,
    };
  }

  return {
    routingProvider: orsKey ? 'OpenRouteService (avoid areas), OSRM fallback' : 'OSRM',

    /** Water, fire stations, hospitals and assembly points around a point. */
    async resources(c: LatLon, radiusKm: number): Promise<Resource[]> {
      // One wider query per area serves every smaller radius from the cache.
      const fetchKm = radiusKm <= 10 ? 10 : MAX_RESOURCE_KM;
      const all = await places(c, fetchKm);
      return around(c, all, radiusKm).filter((r) => r.kind !== 'town');
    },

    /** Routes from `from` that lead away from `fires`; with no fires, exits in different directions. */
    escape(from: LatLon, fires: LatLon[]): Promise<EscapePlan> {
      const key = [`${round(from.lat, 3)},${round(from.lon, 3)}`, ...fires.map((f) => `${round(f.lat, 2)},${round(f.lon, 2)}`).sort()].join(';');
      return cached(planCache, key, PLAN_MS, now, () => plan(from, fires));
    },
  };
}

export type Safety = ReturnType<typeof createSafety>;
