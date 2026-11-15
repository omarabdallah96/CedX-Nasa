// The risk rules behind the organization board.
import { describe, expect, it } from 'vitest';
import type { CountryForecast } from './forecast.ts';
import type { DangerLevel } from './fwi.ts';
import type { LiveHotspot } from './live.ts';
import { circleBox, compass, siteDanger, siteFires, siteScore, workAdvice, type SiteDay } from './risk.ts';

const site = { lat: 34.0, lon: 36.0, radiusKm: 10 };
const NOW = Date.parse('2026-08-10T12:00:00Z');

const spot = (lat: number, lon: number, over: Partial<LiveHotspot> = {}): LiveHotspot =>
  ({ lat, lon, acquiredAt: '2026-08-10T11:20:00Z', sensor: 'VIIRS_NOAA20', confidence: 'nominal', frp: 5, daynight: 'D', ...over });

const cellDay = (fwi: number, level: DangerLevel, wind = 10) =>
  ({ ffmc: 0, dmc: 0, dc: 0, isi: 0, bui: 0, fwi, level, weather: { temp: 30, rh: 40, wind, rain: 0 } });

const forecast = (cells: { lat: number; lon: number; days: ReturnType<typeof cellDay>[] }[]): CountryForecast => ({
  slug: 'lebanon',
  generatedAt: '2026-08-10T09:00:00Z',
  dates: ['2026-08-10', '2026-08-11', '2026-08-12'],
  grid: { step: 0.15, cells: cells.map(({ lat, lon }) => ({ lat, lon })) },
  days: cells.map((c) => c.days),
  stateThrough: '2026-08-09',
});

const day = (level: DangerLevel, fwi: number, date = '2026-08-10'): SiteDay =>
  ({ date, level, fwi, tempC: 30, humidity: 40, windKmh: 10, rainMm: 0, work: workAdvice({ level, windKmh: 10, humidity: 40 }) });

describe('geometry', () => {
  it('names the direction and boxes a circle', () => {
    expect(compass(34, 36, 35, 36)).toBe('north');
    expect(compass(34, 36, 34, 37)).toBe('east');
    expect(compass(34, 36, 33, 35)).toBe('south-west');
    const [w, s, e, n] = circleBox(site);
    expect(n - s).toBeCloseTo(20 / 111.32, 3);
    expect(e - w).toBeGreaterThan(n - s); // degrees of longitude are shorter away from the equator
  });
});

describe('work advice', () => {
  it('stops on high danger or strong wind, warns on moderate danger, wind or dry air', () => {
    expect(workAdvice({ level: 'high', windKmh: 5, humidity: 60 }).advice).toBe('stop');
    expect(workAdvice({ level: 'low', windKmh: 45, humidity: 60 }).advice).toBe('stop');
    expect(workAdvice({ level: 'moderate', windKmh: 5, humidity: 60 }).advice).toBe('caution');
    expect(workAdvice({ level: 'low', windKmh: 30, humidity: 60 }).advice).toBe('caution');
    expect(workAdvice({ level: 'low', windKmh: 5, humidity: 20 }).advice).toBe('caution');
    expect(workAdvice({ level: 'low', windKmh: 5, humidity: 60 })).toEqual({ advice: 'go', why: 'low fire danger', cause: 'danger', value: 'low' });
    expect(workAdvice({ level: 'low', windKmh: 45.4, humidity: 60 })).toMatchObject({ cause: 'wind', value: 45 });
    expect(workAdvice({ level: 'low', windKmh: 5, humidity: 20 })).toMatchObject({ cause: 'humidity', value: 20 });
  });
});

describe('site danger', () => {
  it('takes the worst grid point inside the circle', () => {
    const f = forecast([
      { lat: 34.02, lon: 36.0, days: [cellDay(8, 'low'), cellDay(25, 'high'), cellDay(3, 'very_low')] },
      { lat: 34.05, lon: 36.05, days: [cellDay(14, 'moderate'), cellDay(12, 'moderate'), cellDay(3, 'very_low')] },
      { lat: 35.0, lon: 36.0, days: [cellDay(60, 'extreme'), cellDay(60, 'extreme'), cellDay(60, 'extreme')] },
    ]);
    const d = siteDanger(site, f, 2);
    expect(d.map((x) => x.level)).toEqual(['moderate', 'high']);
    expect(d[1].work.advice).toBe('stop');
  });

  it('falls back to the nearest grid point when none is inside', () => {
    const f = forecast([
      { lat: 34.5, lon: 36.0, days: [cellDay(30, 'high'), cellDay(30, 'high'), cellDay(30, 'high')] },
      { lat: 35.5, lon: 36.0, days: [cellDay(60, 'extreme'), cellDay(60, 'extreme'), cellDay(60, 'extreme')] },
    ]);
    expect(siteDanger({ ...site, radiusKm: 1 }, f, 3).map((x) => x.level)).toEqual(['high', 'high', 'high']);
  });
});

describe('site fires', () => {
  it('counts fires inside, finds the nearest outside, and ignores low confidence and far ones', () => {
    const inside = siteFires(site, [spot(34.01, 36.01), spot(34.02, 36.0, { acquiredAt: '2026-08-10T11:50:00Z' }), spot(34.0, 36.0, { confidence: 'low' })]);
    expect(inside.inside).toBe(2);
    expect(inside.nearest).toMatchObject({ edgeKm: 0, acquiredAt: '2026-08-10T11:50:00Z' });

    // About 22 km north of the centre: 12 km beyond the 10 km edge.
    const near = siteFires(site, [spot(34.2, 36.0)]);
    expect(near.inside).toBe(0);
    expect(near.nearest!.edgeKm).toBeGreaterThan(11);
    expect(near.nearest!.edgeKm).toBeLessThan(13);
    expect(near.nearest!.compass).toBe('north');

    expect(siteFires(site, [spot(35.0, 36.0)])).toEqual({ inside: 0, nearest: null });
  });
});

describe('site score', () => {
  const none = { inside: 0, nearest: null };
  it('puts a fire inside the site at the top, with the reason', () => {
    const s = siteScore({ danger: [day('low', 8)], fires: siteFires(site, [spot(34.01, 36.01)]), reports: 0 }, NOW);
    expect(s).toMatchObject({ score: 100, status: 'act' });
    expect(s.reasons[0]).toBe('1 satellite fire detection inside the site, the latest 40 min ago');
  });

  it('scores a fire by its distance from the edge', () => {
    const at = (lat: number) => siteScore({ danger: null, fires: siteFires(site, [spot(lat, 36.0)]), reports: 0 }, NOW);
    expect(at(34.12)).toMatchObject({ score: 85, status: 'act' }); // ~3 km beyond the edge
    expect(at(34.25)).toMatchObject({ score: 60, status: 'watch' }); // ~18 km beyond
    expect(at(35)).toMatchObject({ score: 0, status: 'ok' });
  });

  it('scores danger from today and, one step lower, from the worst day of the week', () => {
    expect(siteScore({ danger: [day('extreme', 55)], fires: none, reports: 0 }, NOW)).toMatchObject({ score: 95, status: 'act' });
    expect(siteScore({ danger: [day('high', 25)], fires: none, reports: 0 }, NOW)).toMatchObject({ score: 60, status: 'watch' });
    const later = siteScore({ danger: [day('low', 8), day('very_high', 42, '2026-08-13')], fires: none, reports: 0 }, NOW);
    expect(later).toMatchObject({ score: 65, status: 'watch' });
    expect(later.reasons).toEqual(['Very high fire danger on Thursday']);
    const calm = siteScore({ danger: [day('low', 8)], fires: none, reports: 0 }, NOW);
    expect(calm).toMatchObject({ score: 15, status: 'ok', reasons: ['No fire nearby and low fire danger this week'] });
  });

  it('counts people on the ground reporting smoke', () => {
    expect(siteScore({ danger: [day('low', 8)], fires: none, reports: 2 }, NOW)).toMatchObject({ score: 70, status: 'watch' });
  });
});
