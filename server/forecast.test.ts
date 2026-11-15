// Fire danger forecast: the FWI equations, the Open-Meteo plumbing and the endpoints.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { DatasetIndex } from '../src/lib/analysis.ts';
import { createService } from '../src/lib/service.ts';
import { createApp } from './app.ts';
import { createForecast, makeGrid, nearestCell, noonWeather, RateLimitedError } from './forecast.ts';
import { dangerLevel, START, step } from './fwi.ts';

const dataDir = path.resolve(import.meta.dirname, '../public/data');
const hasData = existsSync(path.join(dataDir, 'index.json'));
const tmp = mkdtempSync(path.join(tmpdir(), 'firesight-forecast-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('Fire Weather Index', () => {
  it('matches the published reference day (Van Wagner 1987)', () => {
    const d = step(START, { temp: 17, rh: 42, wind: 25, rain: 0 }, 3);
    expect(d.ffmc).toBeCloseTo(87.69, 1);
    expect(d.dmc).toBeCloseTo(8.55, 1);
    expect(d.dc).toBeCloseTo(19.01, 1);
    expect(d.isi).toBeCloseTo(10.85, 1);
    expect(d.bui).toBeCloseTo(8.49, 1);
    expect(d.fwi).toBeCloseTo(10.1, 1);
  });

  it('rain lowers the danger, dry heat raises it', () => {
    let dry = { ...START };
    let wet = { ...START };
    for (let i = 0; i < 30; i++) {
      dry = step(dry, { temp: 33, rh: 18, wind: 25, rain: 0 }, 6);
      wet = step(wet, { temp: 20, rh: 80, wind: 10, rain: 8 }, 6);
    }
    expect(step(dry, { temp: 33, rh: 18, wind: 25, rain: 0 }, 6).fwi).toBeGreaterThan(50);
    expect(step(wet, { temp: 20, rh: 80, wind: 10, rain: 8 }, 6).fwi).toBeLessThan(2);
  });

  it('uses the EFFIS classes', () => {
    expect([0, 5.2, 11.1, 21.3, 40, 50].map(dangerLevel)).toEqual(['very_low', 'low', 'low', 'high', 'very_high', 'extreme']);
  });
});

/** Hourly series in Open-Meteo's shape for local dates from..to. */
function series(from: string, to: string, w = { temp: 30, rh: 20, wind: 20, rainAt: '' }) {
  const h = { time: [] as string[], temperature_2m: [] as number[], relative_humidity_2m: [] as number[], wind_speed_10m: [] as number[], precipitation: [] as number[] };
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T23:00:00Z`); t += 3_600_000) {
    const iso = new Date(t).toISOString().slice(0, 16);
    h.time.push(iso);
    h.temperature_2m.push(w.temp);
    h.relative_humidity_2m.push(w.rh);
    h.wind_speed_10m.push(w.wind);
    h.precipitation.push(iso.slice(0, 10) === w.rainAt ? 1 : 0);
  }
  return h;
}

describe('noon weather', () => {
  it('reads noon values and the 24 hours of rain before noon', () => {
    const h = series('2026-07-01', '2026-07-03', { temp: 25, rh: 30, wind: 12, rainAt: '2026-07-02' });
    const w = noonWeather(h);
    // 1 July has no full day of rain behind it, so it is left out.
    expect([...w.keys()]).toEqual(['2026-07-02', '2026-07-03']);
    // Noon on 2 July holds 00:00–12:00 of that day; noon on 3 July the rest of it.
    expect(w.get('2026-07-02')).toEqual({ temp: 25, rh: 30, wind: 12, rain: 13 });
    expect(w.get('2026-07-03')!.rain).toBe(11);
  });
});

const box = { accept: () => true, bbox: [35, 33, 36.6, 34.7] };

function fakeOpenMeteo() {
  const calls: string[] = [];
  const fetchJson = async (url: string) => {
    calls.push(url);
    const q = new URL(url).searchParams;
    const n = q.get('latitude')!.split(',').length;
    let from: string;
    let to: string;
    if (url.includes('archive')) {
      from = q.get('start_date')!;
      to = q.get('end_date')!;
    } else {
      const today = Date.parse(`${fakeToday}T00:00:00Z`);
      from = new Date(today - Number(q.get('past_days')) * 86_400_000).toISOString().slice(0, 10);
      to = new Date(today + (Number(q.get('forecast_days')) - 1) * 86_400_000).toISOString().slice(0, 10);
    }
    return Array.from({ length: n }, () => ({ hourly: series(from, to) }));
  };
  return { calls, fetchJson };
}
let fakeToday = '2026-08-10';

describe('forecast', () => {
  it('keeps the grid small and finds the nearest point', () => {
    const g = makeGrid(box);
    expect(g.cells.length).toBeGreaterThan(10);
    expect(g.cells.length).toBeLessThanOrEqual(48);
    const near = nearestCell(g, 33.9, 35.7);
    expect(near.km).toBeLessThan(g.step * 111);
  });

  it('runs up from the archive once, then only moves the saved state forward', async () => {
    const stateDir = path.join(tmp, 'state');
    fakeToday = '2026-08-10';
    const om = fakeOpenMeteo();
    const a = createForecast({ stateDir, fetchJson: om.fetchJson, clipper: async () => box, now: () => Date.parse('2026-08-10T09:00:00Z'), log: () => {} });
    const f = await a.country('lebanon');
    expect(om.calls.filter((u) => u.includes('archive')).length).toBe(1);
    expect(om.calls.find((u) => u.includes('archive'))).toContain('start_date=2025-12-31');
    expect(f.dates[0]).toBe('2026-08-10');
    expect(f.dates.length).toBe(16);
    expect(f.stateThrough).toBe('2026-08-09');
    // Months of hot dry weather: extreme everywhere.
    expect(f.days.every((cell) => cell[0].level === 'extreme')).toBe(true);
    const saved = JSON.parse(readFileSync(path.join(stateDir, 'fwi-state-lebanon.json'), 'utf8'));
    expect(saved.through).toBe('2026-08-09');

    // A restart three days later reads the saved codes: no archive call.
    fakeToday = '2026-08-13';
    const om2 = fakeOpenMeteo();
    const b = createForecast({ stateDir, fetchJson: om2.fetchJson, clipper: async () => box, now: () => Date.parse('2026-08-13T09:00:00Z'), log: () => {} });
    const f2 = await b.country('lebanon');
    expect(om2.calls.some((u) => u.includes('archive'))).toBe(false);
    expect(om2.calls[0]).toContain('past_days=5');
    expect(f2.dates[0]).toBe('2026-08-13');
    expect(f2.stateThrough).toBe('2026-08-12');

    // Cached: a second ask does not call Open-Meteo again.
    await b.country('lebanon');
    expect(om2.calls.length).toBe(1);
  });

  it('waits and retries when Open-Meteo rate-limits', async () => {
    fakeToday = '2026-08-10';
    const om = fakeOpenMeteo();
    let refused = 0;
    const waits: number[] = [];
    const f = createForecast({
      fetchJson: async (url) => {
        if (refused++ === 0) throw new RateLimitedError('429');
        return om.fetchJson(url);
      },
      clipper: async () => box,
      now: () => Date.parse('2026-08-10T09:00:00Z'),
      log: () => {},
      sleep: async (ms) => void waits.push(ms),
    });
    expect((await f.country('cyprus')).dates.length).toBe(16);
    expect(waits).toEqual([65_000]);
  });
});

function service() {
  return createService({
    async index() {
      return JSON.parse(readFileSync(path.join(dataDir, 'index.json'), 'utf8')) as DatasetIndex;
    },
    async bin(manifest) {
      const b = readFileSync(path.join(dataDir, `${manifest.slug}.bin`));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
  });
}

describe.skipIf(!hasData)('forecast endpoints', () => {
  fakeToday = '2026-08-10';
  const om = fakeOpenMeteo();
  const forecast = createForecast({ fetchJson: om.fetchJson, clipper: async () => box, now: () => Date.parse('2026-08-10T09:00:00Z'), log: () => {} });
  const app = createApp({ service: service(), dataDir, forecast, requestsPer10Min: 0 });

  it('gives a country forecast with the usual activity for the date', async () => {
    fakeToday = '2026-08-10';
    const res = await app.request('/api/v1/countries/lebanon/forecast?days=3');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.days.map((d: { date: string }) => d.date)).toEqual(['2026-08-10', '2026-08-11', '2026-08-12']);
    expect(body.days[0].level).toBe('extreme');
    expect(body.days[0].areaShare.highOrAbove).toBe(1);
    expect(body.days[0].usual.cellDaysPerDay).toBeGreaterThanOrEqual(0);
    expect(body.points.length).toBe(body.grid.points);
    expect(body.points[0].fwi.length).toBe(3);
  });

  it('gives the forecast near a point', async () => {
    const res = await app.request('/api/v1/forecast?lat=33.9&lon=35.7');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.country.slug).toBe('lebanon');
    expect(body.days.length).toBe(7);
    expect(body.days[0].weather).toEqual({ tempC: 30, humidity: 20, windKmh: 20, rainMm: 0 });
    expect(Object.keys(body.days[0].components)).toEqual(['ffmc', 'dmc', 'dc', 'isi', 'bui']);
  });

  it('rejects bad and far points, and answers 503 when off', async () => {
    expect((await app.request('/api/v1/forecast?lat=abc&lon=1')).status).toBe(400);
    expect((await app.request('/api/v1/forecast?lat=0&lon=0')).status).toBe(404);
    expect((await app.request('/api/v1/countries/lebanon/forecast?days=40')).status).toBe(400);
    const off = createApp({ service: service(), dataDir, requestsPer10Min: 0 });
    const res = await off.request('/api/v1/countries/lebanon/forecast');
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('forecast_unavailable');
  });
});
