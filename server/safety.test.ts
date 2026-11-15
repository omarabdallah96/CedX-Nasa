// Nearby resources and escape routes, with the outside services faked.
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import {
  awayBearing,
  bearingDeg,
  createSafety,
  dangerArea,
  destination,
  distanceKm,
  exposureKm,
  hedge,
  helpQuery,
  insideRing,
  overpassQuery,
  parseOverpass,
  simplify,
} from './safety.ts';
import type { Service } from '../src/lib/service.ts';

const FIRE = { lat: 33.85, lon: 35.9 };

describe('geometry', () => {
  it('stretches the danger area downwind', () => {
    // Wind from the west blows the fire east.
    const ring = dangerArea(FIRE, { speedKmh: 30, fromDeg: 270 });
    expect(insideRing(destination(FIRE, 90, 5), ring)).toBe(true);
    expect(insideRing(destination(FIRE, 270, 2.5), ring)).toBe(false);
    expect(insideRing(destination(FIRE, 0, 1), ring)).toBe(true);
  });

  it('draws a plain circle in calm air', () => {
    const ring = dangerArea(FIRE, { speedKmh: 2, fromDeg: 270 });
    for (const b of [0, 90, 180, 270]) {
      expect(insideRing(destination(FIRE, b, 1.8), ring)).toBe(true);
      expect(insideRing(destination(FIRE, b, 2.3), ring)).toBe(false);
    }
  });

  it('points away from the fires', () => {
    const me = destination(FIRE, 270, 3); // three km west of the fire
    expect(Math.abs(awayBearing(me, [FIRE]) - 270)).toBeLessThan(2);
  });

  it('simplifies a straight road to its ends', () => {
    const pts = Array.from({ length: 50 }, (_, i) => [33 + i * 0.001, 35 + i * 0.001] as [number, number]);
    expect(simplify(pts)).toEqual([pts[0], pts[49]]);
    const bent: [number, number][] = [[33, 35], [33.05, 35.05], [33, 35.1]];
    expect(simplify(bent)).toEqual(bent);
  });

  it('counts only the danger crossed after leaving it', () => {
    const ring = dangerArea(FIRE, null);
    const line = (from: { lat: number; lon: number }, bearing: number, km: number) =>
      Array.from({ length: 41 }, (_, i) => {
        const p = destination(from, bearing, (km * i) / 40);
        return [p.lat, p.lon] as [number, number];
      });
    // Straight through the fire: about 4 km inside.
    const through = line(destination(FIRE, 270, 5), 90, 10);
    expect(exposureKm(through, [ring])).toBeGreaterThan(3);
    // Starting at the fire and driving out: leaving is not counted.
    expect(exposureKm(line(FIRE, 270, 6), [ring])).toBe(0);
  });
});

describe('Overpass', () => {
  it('asks for water, services and towns around the point', () => {
    const q = overpassQuery(FIRE, 10);
    expect(q).toContain('around:10000,33.85,35.9');
    expect(q).toContain('fire_hydrant');
    expect(q).toContain('"amenity"="fire_station"');
    expect(q).toContain('waterway');
  });

  it('keeps the nearest piece of a river and sorts by distance', () => {
    const json = {
      elements: [
        { type: 'node', id: 1, lat: 33.86, lon: 35.9, tags: { emergency: 'fire_hydrant' } },
        { type: 'way', id: 2, center: { lat: 33.8, lon: 35.9 }, tags: { natural: 'water', name: 'Lake', 'name:ar': 'بحيرة' } },
        { type: 'way', id: 3, geometry: [{ lat: 33.9, lon: 35.8 }, { lat: 33.85, lon: 35.92 }], tags: { waterway: 'river', name: 'Litani' } },
        { type: 'way', id: 4, geometry: [{ lat: 33.95, lon: 35.9 }], tags: { waterway: 'river', name: 'Litani' } },
        { type: 'node', id: 5, lat: 33.87, lon: 35.95, tags: { amenity: 'fire_station', name: 'Station' } },
        { type: 'node', id: 6, lat: 40, lon: 40, tags: { amenity: 'hospital' } },
        { type: 'node', id: 7, lat: 33.85, lon: 35.9, tags: { shop: 'bakery' } },
      ],
    };
    const got = parseOverpass(json, FIRE, 10);
    expect(got.map((r) => r.id)).toEqual(['node/1', 'way/3', 'node/5', 'way/2']);
    const river = got.find((r) => r.id === 'way/3')!;
    expect(river).toMatchObject({ kind: 'water', detail: 'river', lat: 33.85, lon: 35.92 });
    expect(got.find((r) => r.id === 'way/2')).toMatchObject({ detail: 'lake', nameAr: 'بحيرة' });
  });
});

describe('civil defence and Red Cross', () => {
  const json = {
    elements: [
      { type: 'node', id: 1, lat: 33.86, lon: 35.9, tags: { amenity: 'fire_station', name: 'الدفاع المدني بيت مري' } },
      { type: 'node', id: 2, lat: 33.87, lon: 35.9, tags: { emergency: 'ambulance_station', name: 'Lebanese Red Cross EMS Station' } },
      { type: 'node', id: 3, lat: 33.88, lon: 35.9, tags: { emergency: 'ambulance_station' } },
      { type: 'node', id: 4, lat: 33.89, lon: 35.9, tags: { amenity: 'fire_station' } },
      { type: 'way', id: 5, center: { lat: 33.9, lon: 35.9 }, tags: { highway: 'residential', name: 'Red Cross Street' } },
      { type: 'node', id: 6, lat: 33.91, lon: 35.9, tags: { office: 'ngo', operator: 'الصليب الأحمر اللبناني' } },
      { type: 'node', id: 7, lat: 33.92, lon: 35.9, tags: { amenity: 'hospital', name: 'Saint George' } },
      { type: 'node', id: 8, lat: 33.93, lon: 35.9, tags: { amenity: 'clinic', name: 'Clinic' } },
      { type: 'node', id: 9, lat: 34.2, lon: 35.9, tags: { office: 'government', name: 'Civil Defence Deir al Kamar' } },
    ],
  };

  it('recognises them by tag, name or operator', () => {
    const got = parseOverpass(json, FIRE, 10);
    expect(got.map((r) => [r.id, r.kind, r.detail])).toEqual([
      ['node/1', 'civil_defense', 'civil_defense'],
      ['node/2', 'red_cross', 'red_cross'],
      ['node/3', 'red_cross', 'ambulance_station'],
      ['node/4', 'fire_station', 'fire_station'],
      ['node/6', 'red_cross', 'red_cross'],
      ['node/7', 'hospital', 'hospital'],
      ['node/8', 'hospital', 'clinic'],
    ]);
    expect(overpassQuery(FIRE, 10)).toContain('ambulance_station');
    expect(helpQuery(FIRE, 60)).not.toContain('waterway');
    // Names are checked here, never searched for inside Overpass (too slow there).
    expect(helpQuery(FIRE, 60)).not.toContain('"name"');
  });

  it('finds the nearest help far beyond the resource radius', async () => {
    const bodies: string[] = [];
    const safety = createSafety({
      orsKey: '',
      fetchJson: async (_url, init) => {
        bodies.push(decodeURIComponent(init!.body!));
        return json;
      },
    });
    const got = await safety.help(FIRE);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('around:60000');
    // Clinics are left out; the centre 39 km away is still found.
    expect(got.map((r) => r.id)).toEqual(['node/1', 'node/2', 'node/3', 'node/4', 'node/6', 'node/7', 'node/9']);
    expect(got.at(-1)).toMatchObject({ kind: 'civil_defense' });
    expect(got.at(-1)!.distanceKm).toBeGreaterThan(35);

    const service = { index: async () => ({ countries: [] }) } as unknown as Service;
    const app = createApp({ service, dataDir: '.', safety });
    const res = await app.request(`/api/v1/help?lat=${FIRE.lat}&lon=${FIRE.lon}`);
    expect(res.status).toBe(200);
    expect((await res.json()).resources[0]).toMatchObject({ kind: 'civil_defense', bearingDeg: 0 });
    expect((await app.request('/api/v1/help?lat=1')).status).toBe(400);
  });

  it('does not keep an answer from a query that ran out of time', async () => {
    let fail = true;
    const safety = createSafety({
      orsKey: '',
      fetchJson: async () => (fail ? { elements: [], remark: 'runtime error: Query timed out in "query" at line 1 after 26 seconds.' } : json),
    });
    await expect(safety.help(FIRE)).rejects.toThrow(/Overpass/);
    fail = false;
    expect((await safety.help(FIRE)).length).toBe(7);
  });

  it('treats an empty help answer as a failure, asks the next server and never saves it', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'help-'));
    try {
      const hosts: string[] = [];
      const safety = createSafety({
        orsKey: '',
        cacheDir: dir,
        fetchJson: async (url) => {
          hosts.push(new URL(url).host);
          return hosts.length === 1 ? { elements: [] } : json;
        },
      });
      expect((await safety.help(FIRE)).length).toBe(7);
      expect(hosts).toHaveLength(2);

      // An empty file left by an older version is ignored, not served for a week.
      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      await writeFile(path.join(dir, files[0]), '[]');
      const again = createSafety({ orsKey: '', cacheDir: dir, fetchJson: async () => json });
      expect((await again.help(FIRE)).length).toBe(7);

      const allEmpty = createSafety({ orsKey: '', cacheDir: await mkdtemp(path.join(tmpdir(), 'help-')), fetchJson: async () => ({ elements: [] }) });
      await expect(allEmpty.help(FIRE)).rejects.toThrow(/empty answer/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('hedge asks the next source when the first is slow, and the first answer wins', async () => {
    const asked: string[] = [];
    const got = await hedge(['slow', 'fast'], (s) => {
      asked.push(s);
      return new Promise((r) => setTimeout(() => r(s), s === 'slow' ? 200 : 10));
    }, 20);
    expect(got).toBe('fast');
    expect(asked).toEqual(['slow', 'fast']);
  });
});

describe('escape', () => {
  const me = destination(FIRE, 270, 3);
  const west = destination(me, 270, 8);
  const east = destination(me, 90, 9); // past the fire
  const north = destination(me, 0, 6);

  function fake(calls: string[]) {
    return async (url: string, init?: { body?: string }) => {
      calls.push(url);
      if (url.includes('overpass')) {
        expect(decodeURIComponent(init!.body!)).toContain('place');
        return {
          elements: [
            { type: 'node', id: 10, lat: west.lat, lon: west.lon, tags: { place: 'town', name: 'Westtown' } },
            { type: 'node', id: 11, lat: east.lat, lon: east.lon, tags: { place: 'town', name: 'Easttown' } },
            { type: 'node', id: 12, lat: north.lat, lon: north.lon, tags: { place: 'village', name: 'Northville' } },
            { type: 'node', id: 13, lat: me.lat, lon: me.lon + 0.01, tags: { emergency: 'fire_hydrant' } },
          ],
        };
      }
      if (url.includes('open-meteo')) return { current: { wind_speed_10m: 25, wind_direction_10m: 270 } };
      if (url.includes('/route/v1/')) {
        const [, coords] = url.split('/route/v1/driving/');
        const [a, b] = coords.split('?')[0].split(';').map((p) => p.split(',').map(Number));
        // A straight two-point road.
        return {
          code: 'Ok',
          routes: [{ distance: distanceKm({ lat: a[1], lon: a[0] }, { lat: b[1], lon: b[0] }) * 1000, duration: 600, geometry: { coordinates: [a, b] } }],
        };
      }
      throw new Error(`unexpected ${url}`);
    };
  }

  it('routes away from the fire, never through it', async () => {
    const calls: string[] = [];
    const safety = createSafety({ fetchJson: fake(calls), orsKey: '' });
    const plan = await safety.escape(me, [FIRE, { lat: FIRE.lat + 0.001, lon: FIRE.lon }]);
    expect(plan.wind).toEqual({ speedKmh: 25, fromDeg: 270 });
    expect(plan.danger).toHaveLength(1); // the two fires are one
    expect(plan.startInDanger).toBe(false);
    const names = plan.routes.map((r) => r.destination.name);
    expect(names).toContain('Westtown');
    expect(names).not.toContain('Easttown');
    expect(plan.routes[0]).toMatchObject({ safe: true, provider: 'osrm', durationMin: 10 });
    expect(Math.abs(bearingDeg(me, plan.routes[0].destination) - 270)).toBeLessThan(60);
    // Cached: no new calls the second time.
    const n = calls.length;
    await safety.escape(me, [FIRE, { lat: FIRE.lat + 0.001, lon: FIRE.lon }]);
    expect(calls.length).toBe(n);
  });

  it('gives exits in different directions when there is no fire', async () => {
    const safety = createSafety({ fetchJson: fake([]), orsKey: '' });
    const plan = await safety.escape(me, []);
    expect(plan.wind).toBeNull();
    expect(plan.danger).toEqual([]);
    expect(plan.routes.map((r) => r.destination.name).sort()).toEqual(['Easttown', 'Northville', 'Westtown']);
  });

  it('drives straight away when no town is that way', async () => {
    const safety = createSafety({
      orsKey: '',
      fetchJson: async (url) => {
        if (url.includes('overpass')) return { elements: [] };
        if (url.includes('open-meteo')) throw new Error('down');
        return fake([])(url);
      },
    });
    const plan = await safety.escape(me, [FIRE]);
    expect(plan.wind).toBeNull();
    expect(plan.routes).toHaveLength(1);
    expect(plan.routes[0].destination).toMatchObject({ kind: 'direction', name: null });
    expect(Math.abs(plan.routes[0].headingDeg - 270)).toBeLessThan(2);
  });

  it('serves /resources and /escape', async () => {
    const service = { index: async () => ({ countries: [] }) } as unknown as Service;
    const app = createApp({ service, dataDir: '.', safety: createSafety({ fetchJson: fake([]), orsKey: '' }), escapesPer10Min: 2 });
    const res = await app.request(`/api/v1/resources?lat=${me.lat}&lon=${me.lon}&radiusKm=5`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resources.map((r: { kind: string }) => r.kind)).toEqual(['water']);

    const esc = await app.request(`/api/v1/escape?lat=${me.lat}&lon=${me.lon}&fires=${FIRE.lat},${FIRE.lon}`);
    expect(esc.status).toBe(200);
    const plan = await esc.json();
    expect(plan.fires).toBe(1);
    expect(plan.routes[0].geometry.length).toBeGreaterThan(1);
    expect(plan.note).toMatch(/evacuation orders/);

    expect((await app.request('/api/v1/escape?lat=1&lon=1&fires=x')).status).toBe(400);
    expect((await app.request('/api/v1/resources?lat=1')).status).toBe(400);
    expect((await app.request(`/api/v1/resources?lat=1&lon=1&radiusKm=99`)).status).toBe(400);
    // Third route request in ten minutes from the same client.
    await app.request(`/api/v1/escape?lat=${me.lat}&lon=${me.lon}`);
    expect((await app.request(`/api/v1/escape?lat=${me.lat}&lon=${me.lon}`)).status).toBe(429);
  });

  it('keeps places on disk and uses them when Overpass is down', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'safety-'));
    try {
      const first = createSafety({ fetchJson: fake([]), orsKey: '', cacheDir: dir });
      expect((await first.resources(me, 5)).length).toBe(1);
      const calls: string[] = [];
      const offline = createSafety({
        orsKey: '',
        cacheDir: dir,
        fetchJson: async (url) => {
          calls.push(url);
          throw new Error('down');
        },
      });
      expect((await offline.resources(me, 5)).length).toBe(1);
      expect(calls).toEqual([]); // fresh on disk: Overpass not asked at all
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers 503 when the server has no safety service', async () => {
    const service = { index: async () => ({ countries: [] }) } as unknown as Service;
    const app = createApp({ service, dataDir: '.' });
    expect((await app.request('/api/v1/resources?lat=1&lon=1')).status).toBe(503);
  });
});
