// Endpoints the phone app uses beyond the record: live hotspots and ground reports.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DatasetIndex } from '../src/lib/analysis.ts';
import { createService } from '../src/lib/service.ts';
import { createApp } from './app.ts';
import { confidence, createLive, parseFirmsCsv } from './live.ts';
import { createReportStore } from './reports.ts';

const dataDir = path.resolve(import.meta.dirname, '../public/data');
const hasData = existsSync(path.join(dataDir, 'index.json'));

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]);
const everywhere = { accept: () => true, bbox: [35, 33, 36.6, 34.7] };

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

describe('live hotspot parsing', () => {
  it('reads FIRMS CSV for VIIRS and MODIS', () => {
    const csv = [
      'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
      '33.9,35.7,330,0.4,0.4,2026-11-14,0142,N20,VIIRS,h,2.0NRT,290,6.3,N',
      '34.0,35.8,330,0.4,0.4,2026-11-14,1110,N20,VIIRS,l,2.0NRT,290,1.1,D',
    ].join('\n');
    const rows = parseFirmsCsv(csv, 'VIIRS_NOAA20', everywhere);
    expect(rows).toEqual([
      { lat: 33.9, lon: 35.7, acquiredAt: '2026-11-14T01:42:00Z', sensor: 'VIIRS_NOAA20', confidence: 'high', frp: 6.3, daynight: 'N' },
      { lat: 34, lon: 35.8, acquiredAt: '2026-11-14T11:10:00Z', sensor: 'VIIRS_NOAA20', confidence: 'low', frp: 1.1, daynight: 'D' },
    ]);
    expect(parseFirmsCsv(csv, 'X', { ...everywhere, accept: () => false })).toEqual([]);
    expect([confidence('15'), confidence('50'), confidence('90'), confidence('n')]).toEqual(['low', 'nominal', 'high', 'nominal']);
  });

  it('keeps only the asked hours and caches FIRMS answers', async () => {
    let calls = 0;
    const now = Date.parse('2026-11-14T12:00:00Z');
    const live = createLive({
      key: 'test',
      now: () => now,
      clipper: async () => everywhere,
      fetchText: async (url) => {
        calls++;
        if (url.includes('MODIS')) throw new Error('down');
        return 'latitude,longitude,acq_date,acq_time,confidence,frp,daynight\n33.9,35.7,2026-11-14,0900,n,2,D\n33.9,35.7,2026-11-12,0900,n,2,D\n';
      },
    });
    const a = await live.hotspots('LBN', 24);
    expect(a.hotspots.length).toBe(3); // three VIIRS sources answered, one recent row each
    expect(a.missing).toEqual(['MODIS_NRT']);
    expect((await live.hotspots('LBN', 72)).hotspots.length).toBe(6);
    expect(calls).toBe(4);
  });

  it('answers 503 without a key', async () => {
    if (!hasData) return;
    const app = createApp({ service: service(), dataDir, live: createLive({ key: '' }) });
    const res = await app.request('/api/v1/countries/lebanon/live');
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('live_unavailable');
  });
});

describe.skipIf(!hasData)('ground reports', () => {
  const fresh = (limits = {}) => createApp({ service: service(), dataDir, reports: createReportStore(':memory:'), ...limits });
  const form = (fields: Record<string, string>, photo?: Uint8Array<ArrayBuffer>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    if (photo) f.set('photo', new File([photo], 'p.jpg', { type: 'image/jpeg' }));
    return f;
  };
  const base = () => ({
    deviceId: 'device-1',
    clientId: '1731580000000',
    lat: '33.9',
    lon: '35.7',
    createdAt: new Date().toISOString(),
    label: 'smoke',
    bearing: '45',
    note: 'grey smoke over the ridge',
  });

  it('stores, lists, serves the photo and deletes with the token', async () => {
    const app = fresh();
    const res = await app.request('/api/v1/reports', { method: 'POST', body: form(base(), JPEG) });
    expect(res.status).toBe(201);
    const { report, deleteToken } = await res.json();
    expect(report).toMatchObject({ lat: 33.9, lon: 35.7, label: 'smoke', bearing: 45, hasPhoto: true });
    expect(deleteToken).toBeTypeOf('string');
    expect(JSON.stringify(report)).not.toContain('device-1');

    // Sending it again (a retry) gives the same report back.
    const again = await app.request('/api/v1/reports', { method: 'POST', body: form(base(), JPEG) });
    expect(again.status).toBe(200);
    expect((await again.json()).report.id).toBe(report.id);

    const inLebanon = await (await app.request('/api/v1/reports?country=lebanon')).json();
    expect(inLebanon.reports.map((r: { id: string }) => r.id)).toEqual([report.id]);
    const elsewhere = await (await app.request('/api/v1/reports?bbox=20,35,25,40')).json();
    expect(elsewhere.count).toBe(0);

    const photo = await app.request(`/api/v1/reports/${report.id}/photo`);
    expect(photo.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(JPEG);

    const wrong = await app.request(`/api/v1/reports/${report.id}`, { method: 'DELETE', headers: { 'X-Report-Token': 'nope' } });
    expect(wrong.status).toBe(403);
    const ok = await app.request(`/api/v1/reports/${report.id}`, { method: 'DELETE', headers: { 'X-Report-Token': deleteToken } });
    expect(ok.status).toBe(200);
    expect((await app.request(`/api/v1/reports/${report.id}`)).status).toBe(404);
  });

  it('accepts JSON without a photo', async () => {
    const res = await fresh().request('/api/v1/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base(), lat: 33.9, lon: 35.7, bearing: null }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).report).toMatchObject({ bearing: null, hasPhoto: false });
  });

  it('rejects bad input', async () => {
    const app = fresh();
    const post = async (fields: Record<string, string>, photo?: Uint8Array<ArrayBuffer>) =>
      (await app.request('/api/v1/reports', { method: 'POST', body: form(fields, photo) })).status;
    expect(await post({ ...base(), lat: '95' })).toBe(400);
    expect(await post({ ...base(), label: 'party' })).toBe(400);
    expect(await post({ ...base(), deviceId: '../etc' })).toBe(400);
    expect(await post({ ...base(), createdAt: '2020-01-01T00:00:00Z' })).toBe(400);
    expect(await post(base(), new TextEncoder().encode('<script>alert(1)</script>'))).toBe(400);
  });

  it('limits reports per client', async () => {
    const app = fresh({ reportsPerHour: 2 });
    const statuses = [];
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/api/v1/reports', { method: 'POST', body: form({ ...base(), clientId: `c-${i}000` }) });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([201, 201, 429]);
  });

  it('gives Arabic names in /countries', async () => {
    const body = await (await fresh().request('/api/v1/countries')).json();
    expect(body.countries.find((c: { slug: string }) => c.slug === 'lebanon').nameAr).toBe('لبنان');
  });
});
