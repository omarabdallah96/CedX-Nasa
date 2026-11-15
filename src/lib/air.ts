// Air quality at a point: is it safe to breathe outside, and what is in the air.
//
// Numbers come from the Open-Meteo air quality API (free, no key), which serves
// the Copernicus CAMS model: about 10 km over Europe, 40 km elsewhere. It is a
// model, not a sensor: it sees regional smoke and pollution, not one fire next
// to you. The website and the API both read the answer with this file.

export const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

/** The six classes of the US Air Quality Index. */
export type AirLevel = 'good' | 'moderate' | 'sensitive' | 'unhealthy' | 'very-unhealthy' | 'hazardous';
export const AIR_LEVELS: AirLevel[] = ['good', 'moderate', 'sensitive', 'unhealthy', 'very-unhealthy', 'hazardous'];

export type Pollutant = 'pm2_5' | 'pm10' | 'carbon_monoxide' | 'nitrogen_dioxide' | 'ozone' | 'sulphur_dioxide';
export const POLLUTANTS: Pollutant[] = ['pm2_5', 'pm10', 'carbon_monoxide', 'nitrogen_dioxide', 'ozone', 'sulphur_dioxide'];

/** How outdoor CO2 compares with the open-air background (about 430–450 ppm in 2026). */
export type Co2Level = 'normal' | 'elevated' | 'high';

export interface AirReport {
  /** The model grid point that answered. */
  point: { lat: number; lon: number };
  /** The hour the values are for, in local time, and that time zone. */
  time: string;
  timezone: string;
  usAqi: number;
  level: AirLevel;
  /** Good or moderate: fine outdoors for most people. */
  safe: boolean;
  /** The pollutant with the highest index, which sets the AQI. */
  main: Pollutant | null;
  /** Concentration in µg/m³ and each pollutant's own index and class. */
  pollutants: Record<Pollutant, { value: number | null; aqi: number | null; level: AirLevel | null }>;
  /** Carbon monoxide again in ppm, the unit CO alarms use. */
  carbonMonoxidePpm: number | null;
  /** Carbon dioxide outdoors: parts per million and the same as a percentage of the air. */
  co2: { ppm: number; percent: number; level: Co2Level } | null;
  /** The coming 24 hours, this hour first. */
  next24h: {
    peakAqi: number;
    peakAt: string;
    peakLevel: AirLevel;
    hours: { time: string; usAqi: number | null; pm2_5: number | null }[];
  } | null;
}

export class AirUnavailableError extends Error {}

export function airLevel(usAqi: number): AirLevel {
  if (usAqi <= 50) return 'good';
  if (usAqi <= 100) return 'moderate';
  if (usAqi <= 150) return 'sensitive';
  if (usAqi <= 200) return 'unhealthy';
  if (usAqi <= 300) return 'very-unhealthy';
  return 'hazardous';
}

export function co2Level(ppm: number): Co2Level {
  if (ppm < 500) return 'normal';
  if (ppm < 700) return 'elevated';
  return 'high';
}

/** 10,000 ppm is 1% of the air. */
export const co2Percent = (ppm: number) => Math.round(ppm) / 10_000;

/** µg/m³ of carbon monoxide to ppm at 25 °C and sea-level pressure. */
export const coPpm = (ugm3: number) => Math.round((ugm3 * 24.45) / 28.01) / 1000;

export function airUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    current: ['us_aqi', ...POLLUTANTS.map((p) => `us_aqi_${p}`), ...POLLUTANTS, 'carbon_dioxide'].join(','),
    hourly: 'us_aqi,pm2_5',
    forecast_hours: '24',
    timezone: 'auto',
  });
  return `${AIR_URL}?${q}`;
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Reads an Open-Meteo answer. Throws AirUnavailableError when it holds no index. */
export function readAir(body: unknown): AirReport {
  const b = body as {
    latitude?: number;
    longitude?: number;
    timezone?: string;
    current?: Record<string, unknown>;
    hourly?: { time?: string[]; us_aqi?: unknown[]; pm2_5?: unknown[] };
  };
  const cur = b?.current;
  const usAqi = finite(cur?.us_aqi);
  if (!cur || usAqi === null) throw new AirUnavailableError('The air quality model has no value for this place.');

  const pollutants = {} as AirReport['pollutants'];
  let main: Pollutant | null = null;
  for (const p of POLLUTANTS) {
    const aqi = finite(cur[`us_aqi_${p}`]);
    pollutants[p] = { value: finite(cur[p]), aqi, level: aqi === null ? null : airLevel(aqi) };
    if (aqi !== null && (main === null || aqi > pollutants[main].aqi!)) main = p;
  }

  const co = pollutants.carbon_monoxide.value;
  const co2 = finite(cur.carbon_dioxide);

  let next24h: AirReport['next24h'] = null;
  const times = b.hourly?.time ?? [];
  if (times.length > 0) {
    const hours = times.map((time, i) => ({ time, usAqi: finite(b.hourly?.us_aqi?.[i]), pm2_5: finite(b.hourly?.pm2_5?.[i]) }));
    let peak = hours[0];
    for (const h of hours) if ((h.usAqi ?? -1) > (peak.usAqi ?? -1)) peak = h;
    if (peak.usAqi !== null) next24h = { peakAqi: peak.usAqi, peakAt: peak.time, peakLevel: airLevel(peak.usAqi), hours };
  }

  const level = airLevel(usAqi);
  return {
    point: { lat: finite(b.latitude) ?? NaN, lon: finite(b.longitude) ?? NaN },
    time: typeof cur.time === 'string' ? cur.time : '',
    timezone: b.timezone ?? 'UTC',
    usAqi,
    level,
    safe: level === 'good' || level === 'moderate',
    main,
    pollutants,
    carbonMonoxidePpm: co === null ? null : coPpm(co),
    co2: co2 === null ? null : { ppm: Math.round(co2), percent: co2Percent(co2), level: co2Level(co2) },
    next24h,
  };
}
