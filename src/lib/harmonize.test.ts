import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze, buildContext, type DatasetIndex } from './analysis.ts';
import {
  calibrate, dailyCounts, harmonizeDaily, hotspotWeights, outageMask, overlapTable, unpackHotspots, validate,
  SRC_GAPFILL, SRC_MODIS, SRC_TERRA, SRC_VIIRS, type Filters, type Hotspots,
} from './harmonize.ts';
import { annualTotals, judge, monthVerdict, peakSeason, yearVerdict } from './stats.ts';
import { AQUA_DAY, buildCalendar, dayIndex, isoDate, SEAM_DAY } from './time.ts';
import { parseBox, parseCoord } from './coords.ts';

const ALL: Filters = { vegOnly: true, dropLowConf: true, bbox: null };

interface Row { lat: number; lon: number; day: number; viirs?: boolean; aqua?: boolean; type?: number; conf?: number }

function make(rows: Row[]): Hotspots {
  const sorted = [...rows].sort((a, b) => a.day - b.day);
  const n = sorted.length;
  const h: Hotspots = {
    n,
    lat: new Float32Array(n), lon: new Float32Array(n), frp: new Float32Array(n),
    day: new Uint16Array(n), time: new Uint16Array(n), flags: new Uint8Array(n), conf: new Uint8Array(n),
  };
  sorted.forEach((r, i) => {
    h.lat[i] = r.lat;
    h.lon[i] = r.lon;
    h.day[i] = r.day;
    const sat = r.viirs ? 2 : r.aqua ? 1 : 0;
    h.flags[i] = (r.viirs ? 1 : 0) | (sat << 2) | ((r.type ?? 0) << 4);
    h.conf[i] = r.conf ?? (r.viirs ? 50 : 80);
  });
  return h;
}

describe('time', () => {
  it('maps day indices to dates', () => {
    expect(isoDate(0)).toBe('2000-01-01');
    expect(isoDate(SEAM_DAY)).toBe('2012-01-20');
    expect(isoDate(AQUA_DAY)).toBe('2002-07-04');
    const cal = buildCalendar(dayIndex(2005, 1, 1));
    const leap = dayIndex(2004, 12, 31);
    expect(cal.year[leap]).toBe(2004);
    expect(cal.month[leap]).toBe(11);
    expect(cal.doy[leap]).toBe(365);
  });
});

describe('cell-days', () => {
  it('counts a cell once per day per sensor', () => {
    const day = dayIndex(2015, 8, 1);
    const h = make([
      // five VIIRS pixels inside one 0.01° cell, one in the next cell
      { lat: 40.001, lon: -8.001, day, viirs: true },
      { lat: 40.003, lon: -8.003, day, viirs: true },
      { lat: 40.005, lon: -8.005, day, viirs: true },
      { lat: 40.007, lon: -8.007, day, viirs: true },
      { lat: 40.009, lon: -8.009, day, viirs: true },
      { lat: 40.015, lon: -8.005, day, viirs: true },
      // Terra and Aqua see the same cell: one MODIS cell-day, one Terra cell-day
      { lat: 40.004, lon: -8.004, day },
      { lat: 40.006, lon: -8.006, day, aqua: true },
    ]);
    const d = dailyCounts(h, ALL, day + 1);
    expect(d.rawV[day]).toBe(6);
    expect(d.cdV[day]).toBe(2);
    expect(d.rawM[day]).toBe(2);
    expect(d.cdM[day]).toBe(1);
    expect(d.cdT[day]).toBe(1);
  });

  it('applies type, confidence and bbox filters', () => {
    const day = dayIndex(2015, 8, 1);
    const h = make([
      { lat: 40.5, lon: -8.5, day, viirs: true },
      { lat: 40.6, lon: -8.6, day, viirs: true, type: 2 },
      { lat: 40.7, lon: -8.7, day, viirs: true, conf: 10 },
      { lat: 40.8, lon: -8.8, day, conf: 20 },
      { lat: 45, lon: 0, day, viirs: true },
    ]);
    expect(dailyCounts(h, ALL, day + 1).rawV[day]).toBe(2);
    expect(dailyCounts(h, { ...ALL, vegOnly: false }, day + 1).rawV[day]).toBe(3);
    expect(dailyCounts(h, { ...ALL, dropLowConf: false }, day + 1).rawV[day]).toBe(3);
    expect(dailyCounts(h, { ...ALL, dropLowConf: false }, day + 1).rawM[day]).toBe(1);
    expect(dailyCounts(h, { ...ALL, bbox: [-9, 40, -8, 41] }, day + 1).rawV[day]).toBe(1);
  });
});

describe('calibration on synthetic data', () => {
  // Every day: 4 MODIS cells (2 Terra-only cells + 2 seen by both) and, in the
  // VIIRS era, 10 VIIRS cells → ratio 2.5 vs MODIS, 2.5 vs Terra (4 Terra cells).
  const nDays = dayIndex(2016, 1, 1);
  const rows: Row[] = [];
  const outageDays: [number, number] = [dayIndex(2014, 8, 1), dayIndex(2014, 8, 10)];
  for (let day = dayIndex(2001, 1, 1); day < nDays; day += 3) {
    for (let k = 0; k < 4; k++) rows.push({ lat: 40 + k * 0.05, lon: -8, day });
    if (day >= AQUA_DAY) for (let k = 0; k < 2; k++) rows.push({ lat: 40 + k * 0.05, lon: -8, day, aqua: true });
    const inOutage = day >= outageDays[0] && day <= outageDays[1];
    if (day >= SEAM_DAY && !inOutage) {
      for (let k = 0; k < 10; k++) rows.push({ lat: 41 + k * 0.05, lon: -8, day, viirs: true });
    }
  }
  const h = make(rows);
  const cal = buildCalendar(nDays);
  const outage = outageMask([outageDays], nDays);
  const daily = dailyCounts(h, ALL, nDays);
  const table = overlapTable(daily, cal, outage);
  const c = calibrate(table);

  it('recovers the known ratio', () => {
    expect(c.calibrated).toBe(true);
    expect(c.annual).toBeCloseTo(2.5, 6);
    expect(c.annualTerra).toBeCloseTo(2.5, 6);
    for (const r of c.ratio) expect(r).toBeCloseTo(2.5, 6);
  });

  it('builds a seamless record and fills the outage from MODIS', () => {
    const hz = harmonizeDaily(daily, c, cal, outage);
    const terraDay = dayIndex(2001, 1, 1);
    const modisDay = terraDay + 3 * Math.ceil((dayIndex(2008, 6, 1) - terraDay) / 3);
    const viirsDay = terraDay + 3 * Math.ceil((dayIndex(2015, 6, 1) - terraDay) / 3);
    const gapDay = terraDay + 3 * Math.ceil((outageDays[0] - terraDay) / 3);
    expect(hz.src[terraDay]).toBe(SRC_TERRA);
    expect(hz.src[modisDay]).toBe(SRC_MODIS);
    expect(hz.src[viirsDay]).toBe(SRC_VIIRS);
    expect(hz.src[gapDay]).toBe(SRC_GAPFILL);
    for (const d of [terraDay, modisDay, viirsDay, gapDay]) expect(hz.h[d]).toBeCloseTo(10, 4);
    expect(daily.cdV[gapDay]).toBe(0);
  });

  it('gives weights that sum to the harmonized record', () => {
    const hz = harmonizeDaily(daily, c, cal, outage);
    const w = hotspotWeights(h, ALL, c, cal, outage);
    const sumW = w.reduce((a, b) => a + b, 0);
    const sumH = hz.h.reduce((a, b) => a + b, 0);
    expect(sumW).toBeCloseTo(sumH, 0);
    expect(Math.abs(sumW / sumH - 1)).toBeLessThan(1e-4);
  });

  it('shrinks an empty area onto the prior and flags an uncalibrated one', () => {
    const empty = dailyCounts(h, { ...ALL, bbox: [0, 0, 1, 1] }, nDays);
    const emptyTable = overlapTable(empty, cal, outage);
    const withPrior = calibrate(emptyTable, { prior: c });
    expect(withPrior.ratio[7]).toBeCloseTo(c.ratio[7], 6);
    expect(withPrior.usedPrior).toBe(true);
    const alone = calibrate(emptyTable);
    expect(alone.calibrated).toBe(false);
    expect(alone.ratio[7]).toBe(1);
  });

  it('validates with near-zero error when the ratio is constant', () => {
    const v = validate(table);
    expect(v.mdape).toBeLessThan(0.01);
    expect(v.mdapeRaw).toBeCloseTo(0.6, 2);
    expect(Math.abs(v.bias)).toBeLessThan(0.01);
  });
});

describe('verdict', () => {
  it('ranks and labels', () => {
    const others = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
    const top = judge(100, others, 2001, 2010);
    expect(top.rank).toBe(1);
    expect(top.level).toBe('record');
    expect(top.median).toBe(5.5);
    expect(top.ratio).toBeCloseTo(100 / 5.5, 6);
    expect(judge(5, others, 2001, 2010).level).toBe('typical');
    expect(judge(1, others, 2001, 2010).level).toBe('far-below');
    expect(judge(9, others, 2001, 2010).level).toBe('above');
    expect(judge(0, [0, 0, 0, 1], 2001, 2004).level).toBe('quiet');
    expect(judge(0, [0, 0, 0, 1], 2001, 2004).ratio).toBeNull();
  });

  it('finds the shortest peak season, wrapping the year', () => {
    expect(peakSeason([0, 0, 0, 0, 0, 1, 5, 8, 4, 1, 0, 0])).toMatchObject({ start: 6, length: 2 });
    expect(peakSeason([6, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 6])).toMatchObject({ start: 11, length: 2 });
    expect(peakSeason(new Array(12).fill(0))).toBeNull();
  });
});

describe('typed coordinates', () => {
  it('reads the formats people type', () => {
    expect(parseCoord('-8.6')).toBe(-8.6);
    expect(parseCoord(' 8,6 W ')).toBe(-8.6);
    expect(parseCoord('39.6°N')).toBe(39.6);
    expect(parseCoord('12 s')).toBe(-12);
    expect(parseCoord('+35')).toBe(35);
    expect(parseCoord('.5')).toBe(0.5);
    for (const bad of ['', 'abc', '8.6.1', '-8 E', '8 Q', '1e3', '8 6']) expect(parseCoord(bad)).toBeNaN();
  });

  it('validates a box against its country', () => {
    const pt = { name: 'Portugal', bbox: [-28.8, 30.1, -6.2, 42.1] as [number, number, number, number] };
    expect(parseBox(['-8,6', '39.6', '7.4 W', '40.6 N'], pt)).toEqual({ ok: true, bbox: [-8.6, 39.6, -7.4, 40.6] });
    expect(parseBox(['', '39.6', '-7.4', 'x'], pt)).toMatchObject({ ok: false, fields: [0, 3] });
    expect(parseBox(['-7', '39.6', '-8', '40.6'], pt)).toMatchObject({ ok: false, fields: [0, 2] });
    expect(parseBox(['-8', '41', '-7', '40'], pt)).toMatchObject({ ok: false, fields: [1, 3] });
    expect(parseBox(['-8', '39', '-7', '95'], pt)).toMatchObject({ ok: false, fields: [1, 3] });
    expect(parseBox(['20', '39', '25', '40'], pt)).toMatchObject({ ok: false, fields: [0, 1, 2, 3] });
  });
});

// ---- Real FIRMS data (skipped when the pipeline has not been run) ----
const dataDir = path.resolve(import.meta.dirname, '../../public/data');
const hasData = existsSync(path.join(dataDir, 'index.json'));

describe.skipIf(!hasData)('real FIRMS data', () => {
  const index = JSON.parse(hasData ? readFileSync(path.join(dataDir, 'index.json'), 'utf8') : '{"countries":[]}') as DatasetIndex;
  const load = (slug: string) => {
    const man = index.countries.find((c) => c.slug === slug)!;
    const b = readFileSync(path.join(dataDir, `${slug}.bin`));
    return unpackHotspots(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, man.n);
  };
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

  it.each(index.countries.map((c) => c.slug))('%s: harmonization beats the raw record on held-out years', (slug) => {
    const h = load(slug);
    const ctx = buildContext(h, { vegOnly: true, dropLowConf: true }, index);
    const a = analyze(h, ALL, ctx);
    const v = a.validation;

    // Step in the yearly totals across the 2012 seam: MODIS-era vs VIIRS-era median.
    const step = (mm: typeof a.monthsH) => {
      const t = annualTotals(mm).filter((x) => x.complete);
      return med(t.filter((x) => x.year >= 2012).map((x) => x.total)) / med(t.filter((x) => x.year < 2012).map((x) => x.total));
    };
    console.log(
      `${slug.padEnd(9)} ratio ${a.calibration.annual.toFixed(2)} (Terra-only ${a.calibration.annualTerra.toFixed(2)})` +
      ` | monthly error ${pct(v.mdape)} vs raw ${pct(v.mdapeRaw)} (n=${v.nMonths})` +
      ` | yearly error ${pct(v.yearlyMdape)} vs raw ${pct(v.yearlyMdapeRaw)}` +
      ` | bias ${pct(v.bias)} vs raw ${pct(v.biasRaw)}` +
      ` | seam step: raw ×${step(a.monthsNaive).toFixed(2)}, harmonized ×${step(a.monthsH).toFixed(2)}`,
    );

    expect(a.calibration.calibrated).toBe(true);
    expect(v.mdape).toBeLessThan(v.mdapeRaw);
    expect(v.yearlyMdape).toBeLessThan(v.yearlyMdapeRaw);
    expect(Math.abs(v.bias)).toBeLessThan(0.1);
    expect(Math.abs(v.bias)).toBeLessThan(Math.abs(v.biasRaw));
    expect(Math.abs(Math.log(step(a.monthsH)))).toBeLessThan(Math.abs(Math.log(step(a.monthsNaive))));

    // Weights must reproduce the harmonized record exactly.
    const w = hotspotWeights(h, ALL, a.calibration, ctx.cal, ctx.outage);
    const sumW = w.reduce((x, y) => x + y, 0);
    const sumH = a.harmonized.h.reduce((x, y) => x + y, 0);
    expect(Math.abs(sumW / sumH - 1)).toBeLessThan(1e-3);
  });

  it('Portugal: 2017 and October 2017 stand out, and the 2022 outage is filled', () => {
    const h = load('portugal');
    const ctx = buildContext(h, { vegOnly: true, dropLowConf: true }, index);
    const a = analyze(h, ALL, ctx);
    const y = yearVerdict(a.monthsH, 2017)!;
    const oct = monthVerdict(a.monthsH, 2017, 9)!;
    console.log(`Portugal 2017: rank ${y.rank}/${y.nYears}, ${y.ratio?.toFixed(1)}× median; Oct 2017: rank ${oct.rank}/${oct.nYears}, ${oct.ratio?.toFixed(1)}× median`);
    expect(y.rank).toBeLessThanOrEqual(3);
    expect(oct.rank).toBe(1);
    expect(oct.level).toBe('record');

    const gap = dayIndex(2022, 8, 5);
    expect(a.daily.cdV[gap]).toBe(0);
    expect(a.harmonized.src[gap]).toBe(SRC_GAPFILL);
    expect(a.harmonized.h[gap]).toBeGreaterThan(0);
  });

  it('a drawn area is calibrated locally and validated without leakage', () => {
    const h = load('portugal');
    const ctx = buildContext(h, { vegOnly: true, dropLowConf: true }, index);
    const area = analyze(h, { ...ALL, bbox: [-8.6, 39.6, -7.4, 40.6] }, ctx);
    console.log(
      `central Portugal box: ratio ${area.calibration.annual.toFixed(2)}, monthly error ${pct(area.validation.mdape)}` +
      ` vs raw ${pct(area.validation.mdapeRaw)} (n=${area.validation.nMonths})`,
    );
    expect(area.calibration.usedPrior).toBe(true);
    expect(area.detections.viirs).toBeGreaterThan(1000);
    expect(area.validation.mdape).toBeLessThan(area.validation.mdapeRaw);
  });
});
