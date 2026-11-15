// Canadian Forest Fire Weather Index (FWI) System, as published by Van Wagner (1987),
// "Development and structure of the Canadian Forest Fire Weather Index System",
// with the equations as implemented in the cffdrs package. EFFIS uses the same index
// for Europe. Inputs are noon local standard time: temperature (°C), relative
// humidity (%), 10 m wind (km/h) and rain over the previous 24 hours (mm).
//
// Three moisture codes carry over from day to day (fine fuels, duff, deep organic
// layer); the other three indices are computed from them for the day.
// Day-length factors are the standard ones, valid north of 30°N, which covers
// every country Firesight serves.

export interface Codes {
  /** Fine Fuel Moisture Code: litter, reacts within hours. */
  ffmc: number;
  /** Duff Moisture Code: loosely packed organic layer, reacts within ~2 weeks. */
  dmc: number;
  /** Drought Code: deep compact organic layer, reacts over months. */
  dc: number;
}

export interface Weather {
  /** °C at noon */
  temp: number;
  /** % at noon */
  rh: number;
  /** km/h at noon, 10 m */
  wind: number;
  /** mm over the 24 hours ending at noon */
  rain: number;
}

export interface FwiDay extends Codes {
  /** Initial Spread Index: expected rate of spread. */
  isi: number;
  /** Buildup Index: fuel available for burning. */
  bui: number;
  /** Fire Weather Index: fire intensity, the headline number. */
  fwi: number;
}

/** Usual start-up values after a wet winter. */
export const START: Codes = { ffmc: 85, dmc: 6, dc: 15 };

const DMC_DAY_LENGTH = [6.5, 7.5, 9.0, 12.8, 13.9, 13.9, 12.4, 10.9, 9.4, 8.0, 7.0, 6.0];
const DC_DAY_LENGTH = [-1.6, -1.6, -1.6, 0.9, 3.8, 5.8, 6.4, 5.0, 2.4, 0.4, -1.6, -1.6];

export function ffmc(prev: number, { temp: t, rh: h, wind: w, rain: r }: Weather): number {
  h = Math.min(100, Math.max(0, h));
  let mo = (147.2 * (101 - prev)) / (59.5 + prev);
  if (r > 0.5) {
    const rf = r - 0.5;
    let mr = mo + 42.5 * rf * Math.exp(-100 / (251 - mo)) * (1 - Math.exp(-6.93 / rf));
    if (mo > 150) mr += 0.0015 * (mo - 150) ** 2 * Math.sqrt(rf);
    mo = Math.min(250, mr);
  }
  const ed = 0.942 * h ** 0.679 + 11 * Math.exp((h - 100) / 10) + 0.18 * (21.1 - t) * (1 - Math.exp(-0.115 * h));
  let m: number;
  if (mo > ed) {
    const ko = 0.424 * (1 - (h / 100) ** 1.7) + 0.0694 * Math.sqrt(w) * (1 - (h / 100) ** 8);
    const kd = ko * 0.581 * Math.exp(0.0365 * t);
    m = ed + (mo - ed) * 10 ** -kd;
  } else {
    const ew = 0.618 * h ** 0.753 + 10 * Math.exp((h - 100) / 10) + 0.18 * (21.1 - t) * (1 - Math.exp(-0.115 * h));
    if (mo < ew) {
      const k1 = 0.424 * (1 - ((100 - h) / 100) ** 1.7) + 0.0694 * Math.sqrt(w) * (1 - ((100 - h) / 100) ** 8);
      const kw = k1 * 0.581 * Math.exp(0.0365 * t);
      m = ew - (ew - mo) * 10 ** -kw;
    } else {
      m = mo;
    }
  }
  return Math.min(101, Math.max(0, (59.5 * (250 - m)) / (147.2 + m)));
}

/** month is 0-11. */
export function dmc(prev: number, { temp, rh, rain }: Weather, month: number): number {
  const t = Math.max(-1.1, temp);
  const h = Math.min(100, Math.max(0, rh));
  const rk = 1.894 * (t + 1.1) * (100 - h) * DMC_DAY_LENGTH[month] * 1e-4;
  let pr = prev;
  if (rain > 1.5) {
    const re = 0.92 * rain - 1.27;
    const mo = 20 + Math.exp(5.6348 - prev / 43.43);
    const b = prev <= 33 ? 100 / (0.5 + 0.3 * prev) : prev <= 65 ? 14 - 1.3 * Math.log(prev) : 6.2 * Math.log(prev) - 17.2;
    const mr = mo + (1000 * re) / (48.77 + b * re);
    pr = Math.max(0, 244.72 - 43.43 * Math.log(mr - 20));
  }
  return Math.max(0, pr + rk);
}

/** month is 0-11. */
export function dc(prev: number, { temp, rain }: Weather, month: number): number {
  const t = Math.max(-2.8, temp);
  const pe = Math.max(0, (0.36 * (t + 2.8) + DC_DAY_LENGTH[month]) / 2);
  let dr = prev;
  if (rain > 2.8) {
    const rd = 0.83 * rain - 1.27;
    const qr = 800 * Math.exp(-prev / 400) + 3.937 * rd;
    dr = Math.max(0, 400 * Math.log(800 / qr));
  }
  return Math.max(0, dr + pe);
}

export function isi(ffmcValue: number, wind: number): number {
  const m = (147.2 * (101 - ffmcValue)) / (59.5 + ffmcValue);
  const ff = 91.9 * Math.exp(-0.1386 * m) * (1 + m ** 5.31 / 4.93e7);
  return ff * 0.208 * Math.exp(0.05039 * wind);
}

export function bui(p: number, d: number): number {
  if (p === 0 && d === 0) return 0;
  const u = p <= 0.4 * d
    ? (0.8 * p * d) / (p + 0.4 * d)
    : p - (1 - (0.8 * d) / (p + 0.4 * d)) * (0.92 + (0.0114 * p) ** 1.7);
  return Math.max(0, u);
}

export function fwi(isiValue: number, buiValue: number): number {
  const fd = buiValue <= 80 ? 0.626 * buiValue ** 0.809 + 2 : 1000 / (25 + 108.64 * Math.exp(-0.023 * buiValue));
  const b = 0.1 * isiValue * fd;
  return b > 1 ? Math.exp(2.72 * (0.434 * Math.log(b)) ** 0.647) : b;
}

/** One day forward. month is 0-11. */
export function step(prev: Codes, w: Weather, month: number): FwiDay {
  const f = ffmc(prev.ffmc, w);
  const p = dmc(prev.dmc, w, month);
  const d = dc(prev.dc, w, month);
  const i = isi(f, w.wind);
  const u = bui(p, d);
  return { ffmc: f, dmc: p, dc: d, isi: i, bui: u, fwi: fwi(i, u) };
}

/** EFFIS fire danger classes for the FWI (European Forest Fire Information System). */
export const DANGER_CLASSES = [
  { level: 'very_low', from: 0 },
  { level: 'low', from: 5.2 },
  { level: 'moderate', from: 11.2 },
  { level: 'high', from: 21.3 },
  { level: 'very_high', from: 38 },
  { level: 'extreme', from: 50 },
] as const;

export type DangerLevel = (typeof DANGER_CLASSES)[number]['level'];

export function dangerLevel(value: number): DangerLevel {
  let level: DangerLevel = 'very_low';
  for (const c of DANGER_CLASSES) if (value >= c.from) level = c.level;
  return level;
}
