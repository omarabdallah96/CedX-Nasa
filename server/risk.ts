// How much attention a site needs today, and why. Pure functions over what
// the server already knows: the fire danger forecast, live satellite fires and
// ground reports. No I/O here, so every rule can be tested.
import { distanceKm } from './devices.ts';
import type { CountryForecast } from './forecast.ts';
import type { DangerLevel } from './fwi.ts';
import type { LiveHotspot } from './live.ts';
import type { Report } from './reports.ts';

export interface Circle {
  lat: number;
  lon: number;
  radiusKm: number;
}

export interface SiteDay {
  date: string;
  level: DangerLevel;
  fwi: number;
  tempC: number;
  humidity: number;
  windKmh: number;
  rainMm: number;
  work: WorkAdvice;
}

export type Advice = 'go' | 'caution' | 'stop';
export interface WorkAdvice {
  advice: Advice;
  why: string;
  /** The same reason as data, for apps that word it in their own language. */
  cause: 'danger' | 'wind' | 'humidity';
  /** The danger class, wind in km/h or humidity in %, whichever is the cause. */
  value: number | DangerLevel;
}

export interface SiteFires {
  /** Detections inside the circle (low confidence left out). */
  inside: number;
  /** The closest detection within NEAR_KM of the edge; edgeKm is 0 when it is inside. */
  nearest: { edgeKm: number; compass: string; acquiredAt: string; sensor: string; lat: number; lon: number } | null;
}

export type Status = 'act' | 'watch' | 'ok';
/** One reason behind a score, as data: `reasons` holds the same in English. */
export type Why =
  | { code: 'fire_inside'; count: number; at: string }
  | { code: 'fire_near'; km: number; compass: string; at: string }
  | { code: 'reports'; count: number }
  | { code: 'danger_today'; level: DangerLevel }
  | { code: 'danger_peak'; level: DangerLevel; date: string }
  | { code: 'quiet'; forecast: boolean };
export interface SiteScore {
  score: number;
  status: Status;
  reasons: string[];
  why: Why[];
}

/** Fires farther than this from a site's edge do not count against it. */
export const NEAR_KM = 25;
/** A fire this close to the edge is treated as an immediate threat. */
export const CLOSE_KM = 5;

const CLASS_SCORE: Record<DangerLevel, number> = { very_low: 5, low: 15, moderate: 35, high: 60, very_high: 80, extreme: 95 };
const CLASS_NAME: Record<DangerLevel, string> = { very_low: 'very low', low: 'low', moderate: 'moderate', high: 'high', very_high: 'very high', extreme: 'extreme' };
const ORDER: DangerLevel[] = ['very_low', 'low', 'moderate', 'high', 'very_high', 'extreme'];
export const atLeast = (level: DangerLevel, floor: DangerLevel) => ORDER.indexOf(level) >= ORDER.indexOf(floor);

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** Direction from a to b as one of eight compass names. */
export function compass(aLat: number, aLon: number, bLat: number, bLon: number): string {
  const rad = Math.PI / 180;
  const y = Math.sin((bLon - aLon) * rad) * Math.cos(bLat * rad);
  const x = Math.cos(aLat * rad) * Math.sin(bLat * rad) - Math.sin(aLat * rad) * Math.cos(bLat * rad) * Math.cos((bLon - aLon) * rad);
  const deg = (Math.atan2(y, x) / rad + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

/** The box around a circle, as west, south, east, north. */
export function circleBox({ lat, lon, radiusKm }: Circle): [number, number, number, number] {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

/** Go, caution or stop for hot work, burning and machinery on one day. */
export function workAdvice(day: { level: DangerLevel; windKmh: number; humidity: number }): WorkAdvice {
  const danger = (advice: Advice): WorkAdvice => ({ advice, why: `${CLASS_NAME[day.level]} fire danger`, cause: 'danger', value: day.level });
  const wind = (advice: Advice): WorkAdvice => ({ advice, why: `wind ${Math.round(day.windKmh)} km/h`, cause: 'wind', value: Math.round(day.windKmh) });
  if (atLeast(day.level, 'high')) return danger('stop');
  if (day.windKmh >= 40) return wind('stop');
  if (day.level === 'moderate') return danger('caution');
  if (day.windKmh >= 25) return wind('caution');
  if (day.humidity <= 25) return { advice: 'caution', why: `dry air (${Math.round(day.humidity)}% humidity)`, cause: 'humidity', value: Math.round(day.humidity) };
  return danger('go');
}

/**
 * Fire danger at a site for the first `n` forecast days: per day, the worst
 * grid point inside the circle, or the nearest grid point when none is inside.
 */
export function siteDanger(site: Circle, f: CountryForecast, n: number): SiteDay[] {
  const km = f.grid.cells.map((c) => distanceKm(site.lat, site.lon, c.lat, c.lon));
  let cells = km.flatMap((d, i) => (d <= site.radiusKm ? [i] : []));
  if (cells.length === 0 && km.length > 0) cells = [km.indexOf(Math.min(...km))];
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return f.dates.slice(0, n).flatMap((date, d) => {
    const worst = cells.map((i) => f.days[i][d]).reduce<(typeof f.days)[number][number] | null>((a, b) => (!a || b.fwi > a.fwi ? b : a), null);
    if (!worst) return [];
    const day = {
      date,
      level: worst.level,
      fwi: r1(worst.fwi),
      tempC: r1(worst.weather.temp),
      humidity: Math.round(worst.weather.rh),
      windKmh: r1(worst.weather.wind),
      rainMm: r1(worst.weather.rain),
    };
    return [{ ...day, work: workAdvice(day) }];
  });
}

/** Live detections in and around a site. */
export function siteFires(site: Circle, hotspots: LiveHotspot[]): SiteFires {
  let inside = 0;
  let nearest: SiteFires['nearest'] = null;
  for (const h of hotspots) {
    if (h.confidence === 'low') continue;
    const edgeKm = Math.max(0, distanceKm(site.lat, site.lon, h.lat, h.lon) - site.radiusKm);
    if (edgeKm === 0) inside++;
    if (edgeKm > NEAR_KM) continue;
    // Closest first; among equally close ones (all inside), the newest.
    if (!nearest || edgeKm < nearest.edgeKm || (edgeKm === nearest.edgeKm && h.acquiredAt > nearest.acquiredAt)) {
      nearest = {
        edgeKm: Math.round(edgeKm * 10) / 10,
        compass: compass(site.lat, site.lon, h.lat, h.lon),
        acquiredAt: h.acquiredAt,
        sensor: h.sensor,
        lat: h.lat,
        lon: h.lon,
      };
    }
  }
  return { inside, nearest };
}

/** Ground reports of fire or smoke inside a site. */
export function siteReports(site: Circle, reports: Report[]): Report[] {
  return reports.filter((r) => (r.label === 'wildfire' || r.label === 'smoke') && distanceKm(site.lat, site.lon, r.lat, r.lon) <= site.radiusKm);
}

function ago(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 90) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

const weekday = (date: string) =>
  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${date}T00:00:00Z`).getUTCDay()];

/**
 * One number, 0–100, and the reasons behind it.
 *
 * ponytail: a plain rule table, not a model. Fires seen now outrank weather;
 * the thresholds are judgment. Calibrate against real events (did sites
 * scored "act" burn?) before anyone prices or staffs on it.
 */
export function siteScore(
  { danger, fires, reports }: { danger: SiteDay[] | null; fires: SiteFires | null; reports: number },
  now: number = Date.now(),
): SiteScore {
  let score = 0;
  const reasons: string[] = [];
  const why: Why[] = [];
  const near = fires?.nearest;
  const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;
  if (fires && fires.inside > 0 && near) {
    score = 100;
    reasons.push(`${fires.inside} satellite fire detection${fires.inside === 1 ? '' : 's'} inside the site, the latest ${ago(near.acquiredAt, now)}`);
    why.push({ code: 'fire_inside', count: fires.inside, at: near.acquiredAt });
  } else if (near) {
    score = near.edgeKm <= CLOSE_KM ? 85 : 60;
    reasons.push(`Satellite fire ${near.edgeKm} km ${near.compass} of the site, seen ${ago(near.acquiredAt, now)}`);
    why.push({ code: 'fire_near', km: near.edgeKm, compass: near.compass, at: near.acquiredAt });
  }
  if (reports > 0) {
    score = Math.max(score, 70);
    reasons.push(`${reports} ground report${reports === 1 ? '' : 's'} of fire or smoke inside the site in the last 48 hours`);
    why.push({ code: 'reports', count: reports });
  }
  if (danger && danger.length > 0) {
    const today = danger[0];
    const peak = danger.slice(0, 7).reduce((a, b) => (b.fwi > a.fwi ? b : a));
    score = Math.max(score, CLASS_SCORE[today.level]);
    if (atLeast(today.level, 'moderate')) {
      reasons.push(`${cap(CLASS_NAME[today.level])} fire danger today`);
      why.push({ code: 'danger_today', level: today.level });
    }
    // A bad day later this week counts one step less than the same day today.
    if (peak !== today && ORDER.indexOf(peak.level) > ORDER.indexOf(today.level) && atLeast(peak.level, 'high')) {
      score = Math.max(score, CLASS_SCORE[peak.level] - 15);
      reasons.push(`${cap(CLASS_NAME[peak.level])} fire danger on ${weekday(peak.date)}`);
      why.push({ code: 'danger_peak', level: peak.level, date: peak.date });
    }
  }
  if (reasons.length === 0) {
    reasons.push(danger ? 'No fire nearby and low fire danger this week' : 'No fire nearby');
    why.push({ code: 'quiet', forecast: !!danger });
  }
  return { score, status: score >= 80 ? 'act' : score >= 50 ? 'watch' : 'ok', reasons, why };
}
