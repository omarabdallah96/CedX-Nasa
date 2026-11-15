// Air quality: reading the Open-Meteo answer, the cache, and the /air endpoint.
import { describe, expect, it } from 'vitest';
import { createAir } from './air.ts';
import { createApp } from './app.ts';
import { AIR_LEVELS, airLevel, airUrl, AirUnavailableError, co2Level, coPpm, readAir } from '../src/lib/air.ts';
import { AIR_TEXT } from '../src/lib/airText.ts';
import type { Service } from '../src/lib/service.ts';

/** Shaped like a real answer for Beirut. */
const answer = (over: Record<string, unknown> = {}) => ({
  latitude: 33.9,
  longitude: 35.5,
  timezone: 'Asia/Beirut',
  current: {
    time: '2026-11-15T16:00',
    us_aqi: 102, us_aqi_pm2_5: 102, us_aqi_pm10: 45, us_aqi_nitrogen_dioxide: 6, us_aqi_ozone: 33, us_aqi_sulphur_dioxide: 21, us_aqi_carbon_monoxide: 3,
    pm2_5: 23.5, pm10: 35.2, carbon_monoxide: 242, nitrogen_dioxide: 12.2, sulphur_dioxide: 39.4, ozone: 83, carbon_dioxide: 451,
    ...over,
  },
  hourly: { time: ['2026-11-15T16:00', '2026-11-15T17:00', '2026-11-15T18:00'], us_aqi: [102, 160, 99], pm2_5: [23.5, 70, 20.9] },
});

describe('reading the air', () => {
  it('classes the index like the US AQI', () => {
    expect([0, 50, 51, 100, 101, 150, 151, 200, 201, 300, 301].map(airLevel)).toEqual([
      'good', 'good', 'moderate', 'moderate', 'sensitive', 'sensitive', 'unhealthy', 'unhealthy', 'very-unhealthy', 'very-unhealthy', 'hazardous',
    ]);
  });

  it('reports the level, the main pollutant and CO2 as a percentage', () => {
    const r = readAir(answer());
    expect(r).toMatchObject({ usAqi: 102, level: 'sensitive', safe: false, main: 'pm2_5', time: '2026-11-15T16:00', timezone: 'Asia/Beirut' });
    expect(r.pollutants.pm2_5).toEqual({ value: 23.5, aqi: 102, level: 'sensitive' });
    expect(r.co2).toEqual({ ppm: 451, percent: 0.0451, level: 'normal' });
    // 242 µg/m³ of CO is about 0.21 ppm.
    expect(r.carbonMonoxidePpm).toBe(0.211);
    expect(r.next24h).toMatchObject({ peakAqi: 160, peakAt: '2026-11-15T17:00', peakLevel: 'unhealthy' });
  });

  it('calls clean air safe and copes with missing values', () => {
    const r = readAir(answer({ us_aqi: 40, us_aqi_pm2_5: 40, carbon_dioxide: null, carbon_monoxide: null }));
    expect(r).toMatchObject({ level: 'good', safe: true, co2: null, carbonMonoxidePpm: null });
    expect(() => readAir(answer({ us_aqi: null }))).toThrow(AirUnavailableError);
    expect(() => readAir({ error: true, reason: 'x' })).toThrow(AirUnavailableError);
  });

  it('converts units', () => {
    expect(coPpm(1145)).toBe(0.999);
    expect([441, 520, 900].map(co2Level)).toEqual(['normal', 'elevated', 'high']);
    expect(airUrl(33.89, 35.5)).toContain('latitude=33.890&longitude=35.500');
  });

  it('words every level in both languages', () => {
    for (const lang of ['en', 'ar'] as const) {
      const t = AIR_TEXT[lang];
      for (const level of AIR_LEVELS) {
        expect(t.level[level]).toBeTruthy();
        expect(t.headline[level]).toBeTruthy();
        expect(t.advice[level].length).toBeGreaterThan(0);
      }
      expect(t.co2Note(451, 0.0451)).toContain('0.045%');
    }
    expect(AIR_TEXT.ar.headline.good).toMatch(/[؀-ۿ]/);
  });
});

describe('cache', () => {
  it('asks once for nearby points, again when stale, and serves the old answer when the service is down', async () => {
    let time = 0;
    let calls = 0;
    let down = false;
    const air = createAir({
      now: () => time,
      fetchJson: async () => {
        calls++;
        if (down) throw new Error('down');
        return answer({ us_aqi: 100 + calls });
      },
    });
    expect((await air.at(33.89, 35.5)).usAqi).toBe(101);
    expect((await air.at(33.9, 35.51)).usAqi).toBe(101); // same 0.05° square
    expect(calls).toBe(1);
    time = 21 * 60_000;
    expect((await air.at(33.89, 35.5)).usAqi).toBe(102);
    down = true;
    time += 30 * 60_000;
    expect((await air.at(33.89, 35.5)).usAqi).toBe(102);
    time += 4 * 3_600_000;
    await expect(air.at(33.89, 35.5)).rejects.toThrow(AirUnavailableError);
  });
});

describe('GET /air', () => {
  const service = { index: async () => ({ countries: [] }) } as unknown as Service;

  it('answers with advice in the language asked for', async () => {
    const app = createApp({ service, dataDir: '.', air: createAir({ fetchJson: async () => answer() }) });
    const res = await app.request('/api/v1/air?lat=33.89&lon=35.5');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ usAqi: 102, level: 'sensitive', safe: false, label: 'Unhealthy for sensitive people', main: 'pm2_5' });
    expect(body.co2).toMatchObject({ ppm: 451, percent: 0.0451, level: 'normal' });
    expect(body.co2.note).toContain('0.045%');
    expect(body.advice.length).toBeGreaterThan(0);
    expect(body.tips.smoke.length).toBeGreaterThan(0);
    expect(body.tips.indoor.length).toBeGreaterThan(0);

    const arabic = await (await app.request('/api/v1/air?lat=33.89&lon=35.5&lang=ar')).json();
    expect(arabic.label).toBe(AIR_TEXT.ar.level.sensitive);
  });

  it('refuses bad input and says when the service is down', async () => {
    const app = createApp({ service, dataDir: '.', air: createAir({ fetchJson: async () => { throw new Error('down'); } }) });
    expect((await app.request('/api/v1/air?lat=33.89')).status).toBe(400);
    expect((await app.request('/api/v1/air?lat=33.89&lon=35.5&lang=fr')).status).toBe(400);
    expect((await app.request('/api/v1/air?lat=33.89&lon=35.5')).status).toBe(503);
    expect((await createApp({ service, dataDir: '.' }).request('/api/v1/air?lat=1&lon=1')).status).toBe(503);
  });
});
