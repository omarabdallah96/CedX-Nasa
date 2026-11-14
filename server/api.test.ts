// The API must give exactly what the library gives the website.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { rangeSummary, type DatasetIndex } from '../src/lib/analysis.ts';
import type { Filters } from '../src/lib/harmonize.ts';
import { createService } from '../src/lib/service.ts';
import { monthVerdict, records } from '../src/lib/stats.ts';
import { dayIndex } from '../src/lib/time.ts';
import { createApp } from './app.ts';

const dataDir = path.resolve(import.meta.dirname, '../public/data');
const hasData = existsSync(path.join(dataDir, 'index.json'));
const ALL: Filters = { vegOnly: true, dropLowConf: true, bbox: null };

describe.skipIf(!hasData)('API', () => {
  const service = createService({
    async index() {
      return JSON.parse(readFileSync(path.join(dataDir, 'index.json'), 'utf8')) as DatasetIndex;
    },
    async bin(manifest) {
      const b = readFileSync(path.join(dataDir, `${manifest.slug}.bin`));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
  });
  const app = createApp({ service, dataDir });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const get = async (url: string): Promise<{ status: number; body: any; headers: Headers }> => {
    const res = await app.request(`/api/v1${url}`);
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // CSV and binary answers stay as text.
    }
    return { status: res.status, body, headers: res.headers };
  };

  it('describes itself and reports its coverage', async () => {
    const root = await get('');
    expect(root.status).toBe(200);
    expect(root.body.endpoints.length).toBeGreaterThan(8);
    const health = await get('/health');
    const index = await service.index();
    expect(health.body).toMatchObject({ ok: true, coverageEnd: index.coverageEnd, countries: index.countries.length });
    expect(health.headers.get('access-control-allow-origin')).toBe('*');
    const countries = await get('/countries');
    expect(countries.body.countries.map((c: { slug: string }) => c.slug)).toEqual(index.countries.map((c) => c.slug));
    expect(countries.body.countries[0].viirsPerModisCellDay).toBeGreaterThan(1);
  });

  it('gives the same verdict as the library', async () => {
    const { analysis } = await service.prepare('portugal', ALL);
    const mine = monthVerdict(analysis.monthsH, 2017, 9)!;
    const { status, body } = await get('/countries/portugal/verdict?year=2017&month=10');
    expect(status).toBe(200);
    expect(body.period).toMatchObject({ year: 2017, month: 10, name: 'October', partialDays: null });
    expect(body.rank).toBe(mine.rank);
    expect(body.level).toBe('record');
    expect(body.value).toBeCloseTo(mine.value, 0);
    expect(body.sentence).toContain('October 2017');
    expect(body.answer).toBe('No. This is a record.');
  });

  it('serves the calendar, the records and the season', async () => {
    const { analysis } = await service.prepare('greece', ALL);
    const cal = (await get('/countries/greece/calendar')).body;
    expect(cal.years.length).toBe(analysis.monthsH.years.length);
    const y2021 = cal.years.find((y: { year: number }) => y.year === 2021);
    expect(y2021.values[7]).toBeCloseTo(analysis.monthsH.values[analysis.monthsH.years.indexOf(2021)][7], 0);
    expect(y2021.complete).toBe(true);
    expect(cal.usual.median).toHaveLength(12);
    const raw = (await get('/countries/greece/calendar?mode=raw')).body;
    expect(raw.usual).toBeNull();

    const rec = (await get('/countries/greece/records?top=3')).body;
    const mine = records(analysis.monthsH, 3);
    expect(rec.years.map((y: { year: number }) => y.year)).toEqual(mine.years.map((y) => y.year));
    expect(rec.months[0]).toMatchObject({ year: mine.months[0].year, month: mine.months[0].month + 1 });

    const season = (await get('/countries/greece/season?year=2021')).body;
    expect(season.values).toHaveLength(73);
    expect(season.peakSeason.names.length).toBe(season.peakSeason.months);
  });

  it('summarises a date range, and its hotspots add up to it', async () => {
    const box = '-8.6,39.6,-7.4,40.6';
    const filters = { ...ALL, bbox: [-8.6, 39.6, -7.4, 40.6] as [number, number, number, number] };
    const p = await service.prepare('portugal', filters);
    const from = dayIndex(2017, 10, 10);
    const to = dayIndex(2017, 10, 20);
    const mine = rangeSummary(p.analysis, p.ctx.cal, from, to);

    const range = (await get(`/countries/portugal/range?from=2017-10-10&to=2017-10-20&bbox=${box}`)).body;
    expect(range.days).toBe(11);
    expect(range.value).toBeCloseTo(mine.harmonized, 0);
    expect(range.daily).toHaveLength(11);
    expect(range.detections).toEqual(mine.detections);
    expect(range.comparison.rank).toBe(mine.verdict!.rank);
    expect(range.area).toEqual([-8.6, 39.6, -7.4, 40.6]);

    const json = (await get(`/countries/portugal/hotspots?from=2017-10-10&to=2017-10-20&bbox=${box}&limit=20000`)).body;
    expect(json.total).toBe(mine.detections.modis + mine.detections.viirs);
    expect(json.truncated).toBe(false);
    const weight = json.hotspots.reduce((a: number, r: { harmonized_weight: number }) => a + r.harmonized_weight, 0);
    expect(Math.abs(weight / mine.harmonized - 1)).toBeLessThan(0.01);

    const csv = await get(`/countries/portugal/hotspots?from=2017-10-10&to=2017-10-20&bbox=${box}&format=csv`);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const lines = (csv.body as string).trim().split('\n');
    expect(lines[0]).toBe('latitude,longitude,acq_date,acq_time,satellite,instrument,confidence,frp,daynight,type,harmonized_weight');
    expect(lines.length - 1).toBe(json.total);
  });

  it('answers "what about now" for every country', async () => {
    const index = await service.index();
    for (const c of index.countries) {
      const { status, body } = await get(`/countries/${c.slug}/now`);
      expect(status).toBe(200);
      expect(body.week.days).toBe(7);
      expect(body.week.to).toBe(index.coverageEnd);
      expect(typeof body.month.sentence).toBe('string');
      expect(body.coverageEnd).toBe(index.coverageEnd);
    }
  });

  it('explains what is wrong with a bad request', async () => {
    const unknown = await get('/countries/atlantis/now');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('unknown_country');
    expect(unknown.body.error.message).toContain('portugal');

    for (const [url, code] of [
      ['/countries/portugal/now?bbox=1,2,3', 'bad_bbox'],
      ['/countries/portugal/now?bbox=10,50,12,52', 'bad_bbox'],
      ['/countries/portugal/now?bbox=-7,39,-8,40', 'bad_bbox'],
      ['/countries/portugal/range?from=2017-10-10', 'missing_parameter'],
      ['/countries/portugal/range?from=10/10/2017&to=2017-10-20', 'bad_date'],
      ['/countries/portugal/range?from=2017-10-20&to=2017-10-10', 'bad_date'],
      ['/countries/portugal/range?from=1990-01-01&to=1990-02-01', 'bad_date'],
      ['/countries/portugal/verdict?month=13', 'bad_parameter'],
      ['/countries/portugal/verdict?year=1999', 'bad_parameter'],
      ['/countries/portugal/calendar?mode=fancy', 'bad_parameter'],
      ['/countries/portugal/hotspots?format=xml', 'bad_parameter'],
      ['/countries/portugal/now?vegOnly=maybe', 'bad_parameter'],
    ] as const) {
      const r = await get(url);
      expect(r.status, url).toBe(400);
      expect(r.body.error.code, url).toBe(code);
      expect(r.body.error.message.length, url).toBeGreaterThan(10);
    }
    expect((await get('/countries/portugal/verdict?year=2000&month=3')).status).toBe(404);
    expect((await get('/nowhere')).status).toBe(404);
  });

  it('serves the data files and nothing else from disk', async () => {
    const index = await get('/data/index.json');
    expect(index.status).toBe(200);
    expect(index.body.countries.length).toBeGreaterThan(0);
    const etag = index.headers.get('etag')!;
    const again = await app.request('/api/v1/data/index.json', { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
    const bin = await app.request('/api/v1/data/cyprus.bin');
    expect(bin.status).toBe(200);
    expect((await bin.arrayBuffer()).byteLength).toBe(index.body.countries.find((c: { slug: string }) => c.slug === 'cyprus').bytes);
    for (const bad of ['/data/..%2F..%2F.env', '/data/.env', '/data/index.json.bak', '/data/missing.json']) {
      expect((await get(bad)).status, bad).toBe(404);
    }
  });
});
