// HTTP API over the harmonized record. Every record answer is computed from the
// packed data files by the same code the website runs. Two additions serve the
// phone app: live FIRMS hotspots, and ground reports people send from the field.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { getConnInfo } from '@hono/node-server/conninfo';
import { bodyLimit } from 'hono/body-limit';
import type { Context } from 'hono';
import { COUNTRIES } from '../pipeline/config.mjs';
import { LiveUnavailableError, MAX_HOURS, type Live } from './live.ts';
import { DANGER_CLASSES, dangerLevel } from './fwi.ts';
import { FORECAST_DAYS, ForecastUnavailableError, nearestCell, type CountryForecast, type Forecast } from './forecast.ts';
import { createRateLimit } from './ratelimit.ts';
import { createAdmin } from './admin.ts';
import type { BroadcastStore } from './broadcasts.ts';
import { MAX_ZONES, type AccountZone, type DeviceStore, type DeviceZone } from './devices.ts';
import type { Push } from './push.ts';
import { AccountError, MAX_NAME, MAX_PASSWORD, MIN_PASSWORD, normalizeEmail, type AccountStore, type User } from './accounts.ts';
import { LABELS, MAX_NOTE, MAX_PHOTO_BYTES, PHOTO_TYPES, type Label, type NewReport, type ReportStore } from './reports.ts';
import { lastWeek, rangeSummary, selectionVerdict, type RangeSummary } from '../src/lib/analysis.ts';
import { parseBox } from '../src/lib/coords.ts';
import type { BBox, Filters } from '../src/lib/harmonize.ts';
import { ANSWER, monthWording, sourceText, verdictSentence } from '../src/lib/sentence.ts';
import { toCsv, UnknownCountryError, type Prepared, type Service } from '../src/lib/service.ts';
import { annualTotals, completeYears, PENTADS, records, yearVerdict, type Verdict } from '../src/lib/stats.ts';
import { FIRST_DAY, isoDate, MONTHS_LONG, parseIsoDate, spanName } from '../src/lib/time.ts';

export const UNIT = 'active-fire cell-days, VIIRS-equivalent (one ~1 km grid cell with fire on one day)';
const MAX_JSON_HOTSPOTS = 20_000;

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503;

class ApiError extends Error {
  status: ErrorStatus;
  code: string;
  constructor(status: ErrorStatus, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const num = (x: number) => (Number.isFinite(x) ? r1(x) : null);

function verdictJson(v: Verdict) {
  return {
    value: r1(v.value),
    median: r1(v.median),
    ratio: v.ratio === null ? null : r3(v.ratio),
    rank: v.rank,
    of: v.nYears,
    percentile: r3(v.percentile),
    level: v.level,
    answer: ANSWER[v.level],
    baseline: { firstYear: v.firstYear, lastYear: v.lastYear },
  };
}

function flag(value: string | undefined, name: string): boolean {
  if (value === undefined || value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  throw new ApiError(400, 'bad_parameter', `${name} must be true or false.`);
}

function int(value: string | undefined, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ApiError(400, 'bad_parameter', `${name} must be a whole number from ${min} to ${max}.`);
  }
  return n;
}

export interface AppOptions {
  service: Service;
  /** Folder holding index.json and the packed files. */
  dataDir: string;
  /** Built website to serve at /, when it exists. */
  siteDir?: string;
  /** Ground reports from the phone app; the /reports endpoints answer 503 without it. */
  reports?: ReportStore;
  /** Live FIRMS hotspots; /live answers 503 without it. */
  live?: Live;
  /** Fire danger forecast; the /forecast endpoints answer 503 without it. */
  forecast?: Forecast;
  /** Requests per client per 10 minutes across the API (0 turns limiting off). */
  requestsPer10Min?: number;
  /** New reports per client per hour. */
  reportsPerHour?: number;
  /** Password for the /admin moderation page; empty turns it off. */
  adminPassword?: string;
  /** User accounts for the phone app; the /auth endpoints answer 503 without it. */
  accounts?: AccountStore;
  /** Sign-in and sign-up attempts per client per 15 minutes. */
  authPer15Min?: number;
  /** Zone alerts sent from the admin page; /broadcasts answers 503 without it. */
  broadcasts?: BroadcastStore;
  /** Phones registered for instant (push) alerts; /devices answers 503 without it. */
  devices?: DeviceStore;
  push?: Push;
}

/** Arabic names, from pipeline/config.mjs. */
const NAME_AR = new Map<string, string>(COUNTRIES.map((c: { slug: string; ar?: string }) => [c.slug, c.ar ?? '']));

const SAFE_ID = /^[A-Za-z0-9_-]{4,64}$/;

/** First bytes of the photo formats accepted, so the server never stores anything else. */
function looksLike(type: string, b: Uint8Array): boolean {
  if (type === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (type === 'image/png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (type === 'image/webp') return String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP';
  return false;
}

/** Who is asking: the first X-Forwarded-For hop behind a proxy, else the socket address. */
function clientKey(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function createApp({ service, dataDir, siteDir, reports, live, forecast, requestsPer10Min = 1200, reportsPerHour = 30, adminPassword, accounts, authPer15Min = 20, broadcasts, devices, push }: AppOptions) {
  const app = new Hono();
  const api = new Hono();

  api.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Report-Token', 'Authorization'],
    maxAge: 86400,
  }));
  if (requestsPer10Min > 0) {
    const limiter = createRateLimit({ limit: requestsPer10Min, windowMs: 10 * 60_000 });
    api.use('*', async (c, next) => {
      if (c.req.method === 'OPTIONS') return next();
      const wait = limiter.take(clientKey(c));
      if (wait > 0) {
        c.header('Retry-After', String(wait));
        throw new ApiError(429, 'rate_limited', `Too many requests. Try again in ${wait} seconds.`);
      }
      await next();
    });
  }
  api.use('*', async (c, next) => {
    await next();
    if (c.req.method === 'GET' && c.res.status === 200 && !c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'public, max-age=300');
  });

  /** Country, filters and area of a request, analysed. */
  async function prepare(slug: string, query: Record<string, string>): Promise<{ p: Prepared; filters: Filters; place: string }> {
    const index = await service.index();
    const manifest = index.countries.find((m) => m.slug === slug);
    if (!manifest) {
      throw new ApiError(404, 'unknown_country', `No country "${slug}". Available: ${index.countries.map((m) => m.slug).join(', ')}.`);
    }
    let bbox: BBox | null = null;
    if (query.bbox !== undefined) {
      const parts = query.bbox.split(',');
      if (parts.length !== 4) throw new ApiError(400, 'bad_bbox', 'bbox must be west,south,east,north in decimal degrees.');
      const box = parseBox(parts, manifest);
      if (!box.ok) throw new ApiError(400, 'bad_bbox', box.message);
      bbox = box.bbox;
    }
    const filters: Filters = {
      vegOnly: flag(query.vegOnly, 'vegOnly'),
      dropLowConf: flag(query.dropLowConf, 'dropLowConf'),
      bbox,
    };
    const p = await service.prepare(slug, filters);
    return { p, filters, place: bbox ? `the selected area of ${manifest.name}` : manifest.name };
  }

  const head = (p: Prepared, filters: Filters) => ({
    country: { slug: p.manifest.slug, name: p.manifest.name },
    area: filters.bbox,
    filters: { vegOnly: filters.vegOnly, dropLowConf: filters.dropLowConf },
    coverageEnd: p.index.coverageEnd,
    unit: UNIT,
  });

  /** from / to as day indices, clamped to the record. */
  function dateRange(p: Prepared, query: Record<string, string>, fallback?: [number, number]): [number, number] {
    const last = p.index.coverageEndDay;
    const read = (name: 'from' | 'to', def: number | undefined) => {
      if (query[name] === undefined) {
        if (def === undefined) throw new ApiError(400, 'missing_parameter', `${name} is required, as YYYY-MM-DD.`);
        return def;
      }
      const d = parseIsoDate(query[name]);
      if (Number.isNaN(d)) throw new ApiError(400, 'bad_date', `${name} must be a date written as YYYY-MM-DD.`);
      return d;
    };
    const from = read('from', fallback?.[0]);
    const to = read('to', fallback?.[1]);
    if (from > to) throw new ApiError(400, 'bad_date', 'from must not be after to.');
    if (to < FIRST_DAY || from > last) {
      throw new ApiError(400, 'bad_date', `The record runs from ${isoDate(FIRST_DAY)} to ${isoDate(last)}.`);
    }
    return [Math.max(FIRST_DAY, from), Math.min(last, to)];
  }

  function rangeJson(s: RangeSummary, place: string, what: string) {
    return {
      from: isoDate(s.from),
      to: isoDate(s.to),
      days: s.days,
      value: r1(s.harmonized),
      likelyRange: [r1(s.lo), r1(s.hi)],
      detections: s.detections,
      sourceDays: s.sourceDays,
      busiestDay: s.busiest && { date: isoDate(s.busiest.day), value: r1(s.busiest.value) },
      comparison: s.verdict && {
        ...verdictJson(s.verdict),
        sentence: verdictSentence(s.verdict, what, spanName(s.from, s.to), place),
      },
    };
  }

  api.get('/', async (c) => {
    const index = await service.index();
    return c.json({
      name: 'Firesight API',
      version: 1,
      about: 'Harmonized MODIS + VIIRS active-fire record from NASA FIRMS. An independent project, not a NASA product.',
      coverage: { from: isoDate(FIRST_DAY), to: index.coverageEnd },
      unit: UNIT,
      commonQuery: {
        bbox: 'west,south,east,north in decimal degrees; omit for the whole country',
        vegOnly: 'true (default) keeps presumed vegetation fires only',
        dropLowConf: 'true (default) drops low-confidence detections',
      },
      endpoints: [
        'GET /api/v1/health',
        'GET /api/v1/countries',
        'GET /api/v1/countries/{slug}/now',
        'GET /api/v1/countries/{slug}/verdict?year=&month=',
        'GET /api/v1/countries/{slug}/calendar?mode=harmonized|raw',
        'GET /api/v1/countries/{slug}/season?year=',
        'GET /api/v1/countries/{slug}/range?from=YYYY-MM-DD&to=YYYY-MM-DD',
        'GET /api/v1/countries/{slug}/records',
        'GET /api/v1/countries/{slug}/hotspots?from=&to=&limit=&format=json|csv',
        'GET /api/v1/countries/{slug}/method',
        'GET /api/v1/countries/{slug}/live?hours=',
        'GET /api/v1/countries/{slug}/forecast?days=',
        'GET /api/v1/forecast?lat=&lon=&days=',
        'GET /api/v1/data/{file}',
        'POST /api/v1/reports',
        'GET /api/v1/reports?bbox=&country=&since=&limit=',
        'GET /api/v1/reports/{id}',
        'GET /api/v1/reports/{id}/photo',
        'DELETE /api/v1/reports/{id}   (X-Report-Token header)',
        'POST /api/v1/auth/register   {email, password, name?}',
        'POST /api/v1/auth/login      {email, password}',
        'GET /api/v1/auth/me          (Authorization: Bearer <token>)',
        'PATCH /api/v1/auth/me        {name}',
        'POST /api/v1/auth/logout',
        'DELETE /api/v1/auth/me       {password}',
        'GET /api/v1/broadcasts       (active zone alerts)',
        'PUT /api/v1/devices          {installationId, token?, platform, lang, location?, zones}  (instant alerts)',
        'DELETE /api/v1/devices/{installationId}',
        'GET /api/v1/me/zones         (Authorization: Bearer <token>)  alert zones saved to the account',
        'PUT /api/v1/me/zones         {zones}  (Authorization: Bearer <token>)',
      ],
    });
  });

  api.get('/health', async (c) => {
    const index = await service.index();
    c.header('Cache-Control', 'no-store');
    return c.json({
      ok: true,
      coverageEnd: index.coverageEnd,
      generatedAt: index.generatedAt ?? null,
      countries: index.countries.length,
    });
  });

  api.get('/countries', async (c) => {
    const index = await service.index();
    const flags = { vegOnly: true, dropLowConf: true, bbox: null };
    const countries = [];
    for (const m of index.countries) {
      const { analysis: a } = await service.prepare(m.slug, flags);
      countries.push({
        slug: m.slug,
        name: m.name,
        nameAr: NAME_AR.get(m.slug) || m.name,
        iso: m.iso,
        bbox: m.bbox,
        focus: m.focus,
        detections: a.detections,
        viirsPerModisCellDay: r3(a.calibration.annual),
        heldOutError: { monthly: r3(a.validation.mdape), yearly: r3(a.validation.yearlyMdape), rawMonthly: r3(a.validation.mdapeRaw) },
      });
    }
    return c.json({ coverageEnd: index.coverageEnd, generatedAt: index.generatedAt ?? null, countries });
  });

  api.get('/countries/:slug/now', async (c) => {
    const { p, filters, place } = await prepare(c.req.param('slug'), c.req.query());
    const { analysis: a, ctx } = p;
    const cal = ctx.cal;
    const last = cal.nDays - 1;
    const week = lastWeek(a, cal);
    const year = cal.year[last];
    const month = cal.month[last];
    const mv = selectionVerdict(a, cal, year, month);
    const wording = mv && monthWording(mv, year, month);
    return c.json({
      ...head(p, filters),
      generatedAt: p.index.generatedAt ?? null,
      week: rangeJson(week, place, `The last 7 days (${spanName(week.from, week.to)} ${cal.year[week.to]})`),
      month: mv && wording && {
        year,
        month: month + 1,
        name: MONTHS_LONG[month],
        partialDays: mv.partialDays,
        ...verdictJson(mv.verdict),
        source: sourceText(a, cal, year, month).text,
        sentence: verdictSentence(mv.verdict, wording.what, wording.usual, place),
      },
    });
  });

  api.get('/countries/:slug/verdict', async (c) => {
    const query = c.req.query();
    const { p, filters, place } = await prepare(c.req.param('slug'), query);
    const { analysis: a, ctx } = p;
    const cal = ctx.cal;
    const last = cal.nDays - 1;
    const year = int(query.year, 'year', cal.year[FIRST_DAY], cal.year[last]) ?? cal.year[last];
    const month = (int(query.month, 'month', 1, 12) ?? cal.month[last] + 1) - 1;
    const mv = selectionVerdict(a, cal, year, month);
    if (!mv) {
      throw new ApiError(404, 'no_coverage', `The record has no data for ${MONTHS_LONG[month]} ${year}. It runs from ${isoDate(FIRST_DAY)} to ${p.index.coverageEnd}.`);
    }
    const yi = a.monthsH.years.indexOf(year);
    const wording = monthWording(mv, year, month);
    const yv = yearVerdict(a.monthsH, year);
    return c.json({
      ...head(p, filters),
      period: { year, month: month + 1, name: MONTHS_LONG[month], partialDays: mv.partialDays },
      ...verdictJson(mv.verdict),
      likelyRange: [num(a.monthsLo.values[yi][month]), num(a.monthsHi.values[yi][month])],
      source: sourceText(a, cal, year, month).text,
      sentence: verdictSentence(mv.verdict, wording.what, wording.usual, place),
      wholeYear: yv && verdictJson(yv),
    });
  });

  api.get('/countries/:slug/calendar', async (c) => {
    const query = c.req.query();
    const { p, filters } = await prepare(c.req.param('slug'), query);
    const a = p.analysis;
    const mode = query.mode ?? 'harmonized';
    if (mode !== 'harmonized' && mode !== 'raw') throw new ApiError(400, 'bad_parameter', 'mode must be harmonized or raw.');
    const mm = mode === 'raw' ? a.monthsNaive : a.monthsH;
    const totals = annualTotals(mm);
    return c.json({
      ...head(p, filters),
      mode,
      unit: mode === 'raw' ? 'raw detections (MODIS until 2012, VIIRS after): not comparable across 2012' : UNIT,
      months: MONTHS_LONG,
      partialMonth: mm.partial && { year: mm.partial.year, month: mm.partial.month + 1, days: mm.partial.days },
      years: mm.years.map((year, yi) => ({
        year,
        complete: totals[yi].complete,
        total: r1(totals[yi].total),
        values: mm.values[yi].map(num),
        ...(mode === 'harmonized' && {
          low: a.monthsLo.values[yi].map(num),
          high: a.monthsHi.values[yi].map(num),
        }),
      })),
      usual: mode === 'harmonized'
        ? {
          baselineYears: [a.climate.years[0], a.climate.years[a.climate.years.length - 1]],
          median: a.climate.median.map(r1),
          p10: a.climate.p10.map(r1),
          p90: a.climate.p90.map(r1),
        }
        : null,
    });
  });

  api.get('/countries/:slug/season', async (c) => {
    const query = c.req.query();
    const { p, filters } = await prepare(c.req.param('slug'), query);
    const { analysis: a, ctx } = p;
    const last = ctx.cal.nDays - 1;
    const year = int(query.year, 'year', ctx.cal.year[FIRST_DAY], ctx.cal.year[last]) ?? ctx.cal.year[last];
    const baseline = completeYears(a.monthsH);
    return c.json({
      ...head(p, filters),
      year,
      bins: { count: PENTADS, days: 5, note: 'bin 0 starts on 1 January; the last bin also holds 31 December of leap years' },
      values: (a.season.byYear.get(year) ?? []).map(r1),
      median: a.season.median.map(r1),
      p10: a.season.p10.map(r1),
      p90: a.season.p90.map(r1),
      baselineYears: [baseline[0], baseline[baseline.length - 1]],
      peakSeason: a.peak && {
        firstMonth: a.peak.start + 1,
        months: a.peak.length,
        names: Array.from({ length: a.peak.length }, (_, k) => MONTHS_LONG[(a.peak!.start + k) % 12]),
        shareOfTypicalYear: r3(a.peak.share),
      },
    });
  });

  api.get('/countries/:slug/range', async (c) => {
    const query = c.req.query();
    const { p, filters, place } = await prepare(c.req.param('slug'), query);
    const [from, to] = dateRange(p, query);
    const cal = p.ctx.cal;
    const s = rangeSummary(p.analysis, cal, from, to);
    const { h, src } = p.analysis.harmonized;
    const what = `${spanName(from, to)} ${cal.year[to]}`;
    return c.json({
      ...head(p, filters),
      ...rangeJson(s, place, what),
      // Daily values for ranges short enough to chart.
      daily: s.days <= 366
        ? Array.from({ length: s.days }, (_, k) => ({ date: isoDate(from + k), value: r1(h[from + k]), source: SOURCE[src[from + k]] }))
        : null,
    });
  });

  api.get('/countries/:slug/records', async (c) => {
    const query = c.req.query();
    const { p, filters } = await prepare(c.req.param('slug'), query);
    const top = int(query.top, 'top', 1, 50) ?? 5;
    const r = records(p.analysis.monthsH, top);
    return c.json({
      ...head(p, filters),
      years: r.years.map((y) => ({ year: y.year, value: r1(y.total) })),
      months: r.months.map((m) => ({ year: m.year, month: m.month + 1, name: MONTHS_LONG[m.month], value: r1(m.value) })),
    });
  });

  api.get('/countries/:slug/hotspots', async (c) => {
    const query = c.req.query();
    const { p, filters } = await prepare(c.req.param('slug'), query);
    const last = p.index.coverageEndDay;
    const [from, to] = dateRange(p, query, [last - 6, last]);
    const format = query.format ?? 'json';
    if (format !== 'json' && format !== 'csv') throw new ApiError(400, 'bad_parameter', 'format must be json or csv.');
    const slug = p.manifest.slug;
    if (format === 'csv') {
      const { rows } = await service.rows(slug, filters, from, to);
      c.header('Content-Type', 'text/csv; charset=utf-8');
      c.header('Content-Disposition', `attachment; filename="firesight_${slug}_${isoDate(from)}_${isoDate(to)}.csv"`);
      return c.body(toCsv(rows));
    }
    const limit = int(query.limit, 'limit', 1, MAX_JSON_HOTSPOTS) ?? 5000;
    const { rows, total } = await service.rows(slug, filters, from, to, limit);
    return c.json({
      ...head(p, filters),
      from: isoDate(from),
      to: isoDate(to),
      total,
      returned: rows.length,
      truncated: total > rows.length,
      note: 'harmonized_weight sums to the harmonized cell-days of the period. NOAA-20 rows appear only on days Suomi-NPP did not observe.',
      hotspots: rows,
    });
  });

  api.get('/countries/:slug/method', async (c) => {
    const { p, filters } = await prepare(c.req.param('slug'), c.req.query());
    const { calibration: k, validation: v } = p.analysis;
    return c.json({
      ...head(p, filters),
      cellDegrees: 0.01,
      viirsPerModisCellDay: { annual: r3(k.annual), byMonth: k.ratio.map(r3), terraOnlyByMonth: k.ratioTerra.map(r3) },
      noaa20PerSuomiNppCellDay: r3(k.ratioN20),
      fittedLocally: k.usedPrior,
      heldOutValidation: {
        note: 'Leave one overlap year out, predict it from MODIS alone, compare with VIIRS. Median absolute error.',
        monthlyError: r3(v.mdape),
        monthlyErrorRaw: r3(v.mdapeRaw),
        yearlyError: r3(v.yearlyMdape),
        yearlyErrorRaw: r3(v.yearlyMdapeRaw),
        bias: r3(v.bias),
        biasRaw: r3(v.biasRaw),
        months: v.nMonths,
        years: v.nYears,
        thin: v.thin,
      },
      suomiNppLastDay: p.index.snppEndDay != null ? isoDate(p.index.snppEndDay) : null,
      nearRealTimeFrom: Object.fromEntries(Object.entries(p.index.nrtFromDay ?? {}).map(([sensor, d]) => [sensor, isoDate(d)])),
      viirsOutages: p.index.viirsOutages.map((o) => ({ from: o.from, to: o.to, days: o.days })),
      limits: [
        'Counts detections, not burned area. Cloud and smoke hide fires from every sensor.',
        'A month in which MODIS saw nothing converts to zero, so quiet seasons before 2012 are understated where fires are small.',
        'The most recent months are near-real-time data and can still be revised by NASA.',
      ],
    });
  });

  // The packed files themselves: the website loads these when the API is reachable.
  api.get('/data/:file', async (c) => {
    const file = c.req.param('file');
    if (!/^[a-z0-9-]+\.(json|bin|geojson)$/.test(file)) throw new ApiError(404, 'not_found', 'No such data file.');
    const full = path.join(dataDir, file);
    let info;
    try {
      info = await stat(full);
    } catch {
      throw new ApiError(404, 'not_found', 'No such data file.');
    }
    const etag = `"${info.size}-${Math.floor(info.mtimeMs)}"`;
    c.header('ETag', etag);
    c.header('Cache-Control', 'public, max-age=60');
    if (c.req.header('If-None-Match') === etag) return c.body(null, 304);
    const body = await readFile(full);
    c.header('Content-Type', file.endsWith('.bin') ? 'application/octet-stream' : 'application/json; charset=utf-8');
    return c.body(new Uint8Array(body));
  });

  // Live detections from the FIRMS near-real-time feed, minutes old instead of a day.
  api.get('/countries/:slug/live', async (c) => {
    const slug = c.req.param('slug');
    const index = await service.index();
    const manifest = index.countries.find((m) => m.slug === slug);
    if (!manifest) throw new ApiError(404, 'unknown_country', `No country "${slug}". Available: ${index.countries.map((m) => m.slug).join(', ')}.`);
    if (!live?.available) throw new ApiError(503, 'live_unavailable', 'Live hotspots are not configured on this server.');
    const hours = int(c.req.query('hours'), 'hours', 1, MAX_HOURS) ?? 48;
    let answer;
    try {
      answer = await live.hotspots(manifest.iso, hours);
    } catch (err) {
      if (err instanceof LiveUnavailableError) throw new ApiError(503, 'live_unavailable', 'NASA FIRMS did not answer. Try again in a few minutes.');
      throw err;
    }
    c.header('Cache-Control', 'public, max-age=120');
    return c.json({
      country: { slug: manifest.slug, name: manifest.name },
      source: 'NASA FIRMS near-real-time (MODIS, VIIRS Suomi-NPP, NOAA-20, NOAA-21)',
      hours,
      fetchedAt: answer.fetchedAt,
      missingSources: answer.missing,
      note: 'Near-real-time detections are not filtered for industrial sites and can still be revised by NASA.',
      count: answer.hotspots.length,
      hotspots: answer.hotspots,
    });
  });

  // ---- Fire danger forecast ----
  const FORECAST_SOURCE = 'Weather: Open-Meteo (free forecast models, ERA5 archive for the run-up). Index: Canadian Fire Weather Index (Van Wagner 1987). Classes: EFFIS.';
  const FORECAST_NOTE = 'Fire danger says how easily fires start and spread with this weather, not where one will start: most fires here are lit by people. Forecasts beyond about 7 days are uncertain.';
  const forecastDays = (q: string | undefined) => int(q, 'days', 1, FORECAST_DAYS) ?? 7;

  async function needForecast(slug: string): Promise<CountryForecast> {
    if (!forecast) throw new ApiError(503, 'forecast_unavailable', 'The fire danger forecast is not enabled on this server.');
    try {
      return await forecast.country(slug);
    } catch (err) {
      if (err instanceof ForecastUnavailableError) throw new ApiError(503, 'forecast_unavailable', 'The weather service did not answer. Try again in a few minutes.');
      throw err;
    }
  }

  /** What the harmonized record says is usual for this date: median activity of its 5-day bin. */
  async function usualFor(slug: string, dates: string[]) {
    const { analysis: a } = await service.prepare(slug, { vegOnly: true, dropLowConf: true, bbox: null });
    const peakBin = Math.max(...a.season.median, 1e-9);
    const peakMonths = a.peak ? Array.from({ length: a.peak.length }, (_, k) => (a.peak!.start + k) % 12) : [];
    return dates.map((date) => {
      const t = Date.parse(`${date}T00:00:00Z`);
      const doy = Math.round((t - Date.UTC(Number(date.slice(0, 4)), 0, 1)) / 86_400_000);
      const bin = Math.min(PENTADS - 1, Math.floor(doy / 5));
      return {
        cellDaysPerDay: r1(a.season.median[bin] / 5),
        highCellDaysPerDay: r1(a.season.p90[bin] / 5),
        shareOfPeak: r3(a.season.median[bin] / peakBin),
        inPeakSeason: peakMonths.includes(Number(date.slice(5, 7)) - 1),
      };
    });
  }

  const quantile = (sorted: number[], q: number) => {
    const i = (sorted.length - 1) * q;
    const lo = Math.floor(i);
    return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo);
  };

  api.get('/countries/:slug/forecast', async (c) => {
    const slug = c.req.param('slug');
    const index = await service.index();
    const manifest = index.countries.find((m) => m.slug === slug);
    if (!manifest) throw new ApiError(404, 'unknown_country', `No country "${slug}". Available: ${index.countries.map((m) => m.slug).join(', ')}.`);
    const n = forecastDays(c.req.query('days'));
    const f = await needForecast(slug);
    const dates = f.dates.slice(0, n);
    const usual = await usualFor(slug, dates);
    c.header('Cache-Control', 'public, max-age=600');
    return c.json({
      country: { slug: manifest.slug, name: manifest.name },
      generatedAt: f.generatedAt,
      source: FORECAST_SOURCE,
      note: FORECAST_NOTE,
      classes: DANGER_CLASSES,
      grid: { stepDegrees: f.grid.step, points: f.grid.cells.length },
      days: dates.map((date, d) => {
        const values = f.days.map((cell) => cell[d].fwi).sort((a, b) => a - b);
        const p90 = quantile(values, 0.9);
        const atLeast = (from: number) => r3(values.filter((v) => v >= from).length / values.length);
        return {
          date,
          // The worst tenth of the country sets the headline: a few dry valleys matter.
          level: dangerLevel(p90),
          fwi: { median: r1(quantile(values, 0.5)), p90: r1(p90), max: r1(values[values.length - 1]) },
          areaShare: { highOrAbove: atLeast(21.3), veryHighOrAbove: atLeast(38), extreme: atLeast(50) },
          usual: usual[d],
        };
      }),
      points: f.grid.cells.map((cell, i) => ({
        lat: cell.lat,
        lon: cell.lon,
        fwi: f.days[i].slice(0, n).map((x) => r1(x.fwi)),
        level: f.days[i].slice(0, n).map((x) => x.level),
      })),
    });
  });

  api.get('/forecast', async (c) => {
    const query = c.req.query();
    const lat = Number(query.lat);
    const lon = Number(query.lon);
    if (query.lat === undefined || query.lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new ApiError(400, 'bad_parameter', 'lat and lon are required, in decimal degrees.');
    }
    const n = forecastDays(query.days);
    if (!forecast) throw new ApiError(503, 'forecast_unavailable', 'The fire danger forecast is not enabled on this server.');
    const index = await service.index();
    // Countries whose box holds the point, then the nearest grid point among them.
    let best: { slug: string; index: number; km: number; step: number } | null = null;
    for (const m of index.countries) {
      const [w, s, e, nn] = m.bbox;
      if (lon < w - 0.5 || lon > e + 0.5 || lat < s - 0.5 || lat > nn + 0.5) continue;
      const g = await forecast.grid(m.slug);
      const near = nearestCell(g, lat, lon);
      if (!best || near.km < best.km) best = { slug: m.slug, ...near, step: g.step };
    }
    if (!best || best.km > best.step * 111 * 1.5) {
      throw new ApiError(404, 'outside_coverage', `The forecast covers ${index.countries.map((m) => m.name).join(', ')}.`);
    }
    const found = best;
    const f = await needForecast(found.slug);
    const manifest = index.countries.find((m) => m.slug === found.slug)!;
    const cell = f.grid.cells[found.index];
    const dates = f.dates.slice(0, n);
    const usual = await usualFor(found.slug, dates);
    c.header('Cache-Control', 'public, max-age=600');
    return c.json({
      country: { slug: manifest.slug, name: manifest.name },
      point: { lat: cell.lat, lon: cell.lon, distanceKm: r1(found.km) },
      generatedAt: f.generatedAt,
      source: FORECAST_SOURCE,
      note: FORECAST_NOTE,
      classes: DANGER_CLASSES,
      days: dates.map((date, d) => {
        const x = f.days[found.index][d];
        return {
          date,
          level: x.level,
          fwi: r1(x.fwi),
          components: { ffmc: r1(x.ffmc), dmc: r1(x.dmc), dc: r1(x.dc), isi: r1(x.isi), bui: r1(x.bui) },
          weather: { tempC: r1(x.weather.temp), humidity: Math.round(x.weather.rh), windKmh: r1(x.weather.wind), rainMm: r1(x.weather.rain) },
          usualInCountry: usual[d],
        };
      }),
    });
  });

  // ---- Ground reports from the phone app ----
  const reportLimiter = createRateLimit({ limit: reportsPerHour, windowMs: 3_600_000 });
  const needReports = () => {
    if (!reports) throw new ApiError(503, 'reports_unavailable', 'Reports are not enabled on this server.');
    return reports;
  };

  api.post('/reports', bodyLimit({
    maxSize: MAX_PHOTO_BYTES + 64 * 1024,
    onError: () => { throw new ApiError(413, 'too_large', `A report with its photo must be under ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`); },
  }), async (c) => {
    const store = needReports();
    const wait = reportLimiter.take(clientKey(c));
    if (wait > 0) {
      c.header('Retry-After', String(wait));
      throw new ApiError(429, 'rate_limited', `Too many reports from this connection. Try again in ${Math.ceil(wait / 60)} minutes.`);
    }

    // multipart/form-data (with an optional "photo" file) or plain JSON.
    let fields: Record<string, unknown>;
    let photoFile: File | null = null;
    const type = c.req.header('content-type') ?? '';
    if (type.startsWith('multipart/form-data')) {
      const body = await c.req.parseBody();
      fields = body;
      if (body.photo instanceof File) photoFile = body.photo;
    } else {
      try {
        fields = await c.req.json();
      } catch {
        throw new ApiError(400, 'bad_body', 'Send multipart/form-data or JSON.');
      }
    }

    const text = (name: string, max: number, required = false): string | null => {
      const v = fields[name];
      if (v === undefined || v === null || v === '') {
        if (required) throw new ApiError(400, 'missing_parameter', `${name} is required.`);
        return null;
      }
      if (typeof v !== 'string' || v.length > max) throw new ApiError(400, 'bad_parameter', `${name} must be text of at most ${max} characters.`);
      return v;
    };
    const number = (name: string, min: number, max: number, required = false): number | null => {
      const v = fields[name];
      if (v === undefined || v === null || v === '') {
        if (required) throw new ApiError(400, 'missing_parameter', `${name} is required.`);
        return null;
      }
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n) || n < min || n > max) throw new ApiError(400, 'bad_parameter', `${name} must be a number from ${min} to ${max}.`);
      return n;
    };
    const time = (name: string, required = false): string | null => {
      const v = text(name, 40, required);
      if (v === null) return null;
      const t = Date.parse(v);
      if (Number.isNaN(t)) throw new ApiError(400, 'bad_parameter', `${name} must be an ISO 8601 time.`);
      return new Date(t).toISOString();
    };

    const deviceId = text('deviceId', 64, true)!;
    const clientId = text('clientId', 64, true)!;
    if (!SAFE_ID.test(deviceId) || !SAFE_ID.test(clientId)) {
      throw new ApiError(400, 'bad_parameter', 'deviceId and clientId must be 4–64 letters, digits, - or _.');
    }
    const label = text('label', 40, true) as Label;
    if (!LABELS.includes(label)) throw new ApiError(400, 'bad_parameter', `label must be one of ${LABELS.join(', ')}.`);
    const createdAt = time('createdAt', true)!;
    const age = Date.now() - Date.parse(createdAt);
    if (age < -10 * 60_000 || age > 30 * 86_400_000) {
      throw new ApiError(400, 'bad_parameter', 'createdAt must be within the last 30 days.');
    }

    const report: NewReport = {
      deviceId,
      clientId,
      lat: number('lat', -90, 90, true)!,
      lon: number('lon', -180, 180, true)!,
      createdAt,
      label,
      note: text('note', MAX_NOTE) ?? '',
      bearing: number('bearing', 0, 360),
      hotspotSensor: text('hotspotSensor', 40),
      hotspotTime: time('hotspotTime'),
    };

    let photo: { bytes: Uint8Array<ArrayBuffer>; type: string } | undefined;
    if (photoFile) {
      const bytes = new Uint8Array(await photoFile.arrayBuffer());
      const kind = Object.keys(PHOTO_TYPES).find((t) => looksLike(t, bytes));
      if (!kind) throw new ApiError(400, 'bad_photo', 'photo must be a JPEG, PNG or WebP image.');
      if (bytes.length > MAX_PHOTO_BYTES) throw new ApiError(413, 'too_large', 'photo is too large.');
      photo = { bytes, type: kind };
    }

    const { report: saved, deleteToken, created } = await store.add(report, photo);
    return c.json({ report: saved, deleteToken }, created ? 201 : 200);
  });

  api.get('/reports', async (c) => {
    const store = needReports();
    const query = c.req.query();
    let bbox: [number, number, number, number] | null = null;
    if (query.country !== undefined) {
      const index = await service.index();
      const m = index.countries.find((x) => x.slug === query.country);
      if (!m) throw new ApiError(404, 'unknown_country', `No country "${query.country}".`);
      bbox = m.bbox as [number, number, number, number];
    }
    if (query.bbox !== undefined) {
      const parts = query.bbox.split(',').map(Number);
      if (parts.length !== 4 || parts.some((x) => !Number.isFinite(x)) || parts[0] > parts[2] || parts[1] > parts[3]) {
        throw new ApiError(400, 'bad_bbox', 'bbox must be west,south,east,north in decimal degrees.');
      }
      bbox = parts as [number, number, number, number];
    }
    let since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    if (query.since !== undefined) {
      const t = Date.parse(query.since);
      if (Number.isNaN(t)) throw new ApiError(400, 'bad_parameter', 'since must be an ISO 8601 time.');
      since = new Date(t).toISOString();
    }
    const limit = int(query.limit, 'limit', 1, 1000) ?? 500;
    const list = store.list({ bbox, since, limit });
    c.header('Cache-Control', 'no-store');
    return c.json({ since, count: list.length, reports: list });
  });

  api.get('/reports/:id', (c) => {
    const r = needReports().get(c.req.param('id'));
    if (!r) throw new ApiError(404, 'not_found', 'No such report.');
    c.header('Cache-Control', 'no-store');
    return c.json({ report: r });
  });

  api.get('/reports/:id/photo', async (c) => {
    const photo = await needReports().photo(c.req.param('id'));
    if (!photo) throw new ApiError(404, 'not_found', 'This report has no photo.');
    c.header('Content-Type', photo.type);
    c.header('Cache-Control', 'public, max-age=86400, immutable');
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(photo.bytes);
  });

  api.delete('/reports/:id', async (c) => {
    const token = c.req.header('x-report-token');
    if (!token) throw new ApiError(403, 'forbidden', 'X-Report-Token is required.');
    const result = await needReports().remove(c.req.param('id'), token);
    if (result === 'not_found') throw new ApiError(404, 'not_found', 'No such report.');
    if (result === 'forbidden') throw new ApiError(403, 'forbidden', 'This token does not match the report.');
    return c.json({ deleted: true });
  });

  // ---- Zone alerts from the admin page. Phones match them to their zones. ----
  api.get('/broadcasts', (c) => {
    if (!broadcasts) throw new ApiError(503, 'broadcasts_unavailable', 'Zone alerts are not enabled on this server.');
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({ broadcasts: broadcasts.active() });
  });

  // ---- Phones that turned on instant alerts: push token, zones, last location ----
  const needDevices = () => {
    if (!devices) throw new ApiError(503, 'devices_unavailable', 'Instant alerts are not enabled on this server.');
    return devices;
  };

  /** A zone list from a request body; createdAt is kept when it is a date. */
  function readZones(list: unknown): AccountZone[] {
    if (!Array.isArray(list) || list.length > MAX_ZONES) throw new ApiError(400, 'bad_parameter', `zones must be a list of at most ${MAX_ZONES}.`);
    const okNum = (v: unknown, max: number) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;
    return list.map((z: Record<string, unknown>) => {
      if (!z || typeof z.id !== 'string' || z.id.length > 64 || typeof z.name !== 'string' || z.name.length > 60 ||
        !okNum(z.lat, 90) || !okNum(z.lon, 180) || !okNum(z.radiusKm, 200) || (z.radiusKm as number) <= 0) {
        throw new ApiError(400, 'bad_parameter', 'Each zone needs id, name, lat, lon and radiusKm.');
      }
      const at = typeof z.createdAt === 'string' ? Date.parse(z.createdAt) : NaN;
      return {
        id: z.id, name: z.name, lat: z.lat as number, lon: z.lon as number, radiusKm: z.radiusKm as number,
        ...(!Number.isNaN(at) && { createdAt: new Date(at).toISOString() }),
      };
    });
  }

  api.put('/devices', bodyLimit({
    maxSize: 64 * 1024,
    onError: () => { throw new ApiError(413, 'too_large', 'Too much data.'); },
  }), async (c) => {
    const store = needDevices();
    let b: Record<string, unknown>;
    try {
      b = await c.req.json();
    } catch {
      throw new ApiError(400, 'bad_body', 'Send JSON.');
    }
    const installationId = b.installationId;
    if (typeof installationId !== 'string' || !SAFE_ID.test(installationId)) {
      throw new ApiError(400, 'bad_parameter', 'installationId must be 4–64 letters, digits, - or _.');
    }
    const token = b.token === null || b.token === undefined ? null : b.token;
    if (token !== null && (typeof token !== 'string' || token.length < 20 || token.length > 4096)) {
      throw new ApiError(400, 'bad_parameter', 'token must be an FCM registration token.');
    }
    const okNum = (v: unknown, max: number) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;
    let location: { lat: number; lon: number; at: string } | null = null;
    const loc = b.location as Record<string, unknown> | null | undefined;
    if (loc) {
      if (!okNum(loc.lat, 90) || !okNum(loc.lon, 180)) throw new ApiError(400, 'bad_parameter', 'location needs lat and lon.');
      const at = typeof loc.at === 'string' && !Number.isNaN(Date.parse(loc.at)) ? new Date(Math.min(Date.parse(loc.at), Date.now())).toISOString() : new Date().toISOString();
      location = { lat: loc.lat as number, lon: loc.lon as number, at };
    }
    const zones: DeviceZone[] = readZones(b.zones).map(({ id, name, lat, lon, radiusKm }) => ({ id, name, lat, lon, radiusKm }));
    // Signed in: link the phone to the account (the admin sees its last location).
    const authToken = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(c.req.header('authorization') ?? '')?.[1];
    const user = authToken && accounts ? accounts.authenticate(authToken) : null;
    const saved = store.upsert({
      installationId,
      token: token as string | null,
      platform: b.platform === 'android' || b.platform === 'ios' ? b.platform : 'other',
      lang: b.lang === 'ar' ? 'ar' : 'en',
      userId: user?.id ?? null,
      location,
      zones,
    });
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, push: !!push?.available, zones: saved.zones.length });
  });

  api.delete('/devices/:id', (c) => {
    needDevices().remove(c.req.param('id'));
    return c.json({ deleted: true });
  });

  // ---- Accounts (optional: the app works as a guest) ----
  const authLimiter = createRateLimit({ limit: authPer15Min, windowMs: 15 * 60_000 });
  const needAccounts = () => {
    if (!accounts) throw new ApiError(503, 'accounts_unavailable', 'Accounts are not enabled on this server.');
    return accounts;
  };
  const limitAuth = (c: Context) => {
    const wait = authLimiter.take(clientKey(c));
    if (wait > 0) {
      c.header('Retry-After', String(wait));
      throw new ApiError(429, 'rate_limited', `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.`);
    }
  };
  async function jsonBody(c: Context): Promise<Record<string, unknown>> {
    try {
      const body = await c.req.json();
      if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
    } catch {
      // Falls through.
    }
    throw new ApiError(400, 'bad_body', 'Send a JSON object.');
  }
  const bearer = (c: Context) => {
    const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(c.req.header('authorization') ?? '');
    return m ? m[1] : null;
  };
  /** The signed-in user, or a 401. */
  function signedIn(c: Context): User {
    const store = needAccounts();
    const token = bearer(c);
    const user = token ? store.authenticate(token) : null;
    if (!user) throw new ApiError(401, 'signed_out', 'Sign in again.');
    return user;
  }
  const readEmail = (body: Record<string, unknown>) => {
    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : null;
    if (!email) throw new ApiError(400, 'bad_email', 'Enter a valid email address.');
    return email;
  };
  const readPassword = (body: Record<string, unknown>, checkLength: boolean) => {
    const pw = body.password;
    if (typeof pw !== 'string' || pw.length === 0 || pw.length > MAX_PASSWORD) {
      throw new ApiError(400, 'bad_password', 'Enter your password.');
    }
    if (checkLength && pw.length < MIN_PASSWORD) {
      throw new ApiError(400, 'weak_password', `The password must be at least ${MIN_PASSWORD} characters.`);
    }
    return pw;
  };
  const readName = (body: Record<string, unknown>) => {
    const v = body.name ?? '';
    if (typeof v !== 'string' || v.trim().length > MAX_NAME) {
      throw new ApiError(400, 'bad_name', `The name must be at most ${MAX_NAME} characters.`);
    }
    return v.trim();
  };
  const accountError = (err: unknown): never => {
    if (err instanceof AccountError) {
      throw err.code === 'email_taken'
        ? new ApiError(409, err.code, err.message)
        : new ApiError(401, err.code, err.message);
    }
    throw err;
  };

  api.use('/auth/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  api.post('/auth/register', async (c) => {
    const store = needAccounts();
    limitAuth(c);
    const body = await jsonBody(c);
    const input = { email: readEmail(body), password: readPassword(body, true), name: readName(body) };
    const { user, token } = await store.register(input).catch(accountError);
    return c.json({ user, token }, 201);
  });

  api.post('/auth/login', async (c) => {
    const store = needAccounts();
    limitAuth(c);
    const body = await jsonBody(c);
    const input = { email: readEmail(body), password: readPassword(body, false) };
    const { user, token } = await store.login(input).catch(accountError);
    return c.json({ user, token });
  });

  api.get('/auth/me', (c) => c.json({ user: signedIn(c) }));

  api.patch('/auth/me', async (c) => {
    const user = signedIn(c);
    const name = readName(await jsonBody(c));
    return c.json({ user: needAccounts().updateName(user.id, name) });
  });

  // Alert zones saved to the account: a reinstall or a second phone gets them back.
  api.get('/me/zones', (c) => {
    const user = signedIn(c);
    c.header('Cache-Control', 'no-store');
    return c.json(needDevices().accountZones(user.id));
  });

  api.put('/me/zones', bodyLimit({
    maxSize: 64 * 1024,
    onError: () => { throw new ApiError(413, 'too_large', 'Too much data.'); },
  }), async (c) => {
    const user = signedIn(c);
    const zones = readZones((await jsonBody(c)).zones);
    c.header('Cache-Control', 'no-store');
    return c.json(needDevices().setAccountZones(user.id, zones));
  });

  api.post('/auth/logout', (c) => {
    const token = bearer(c);
    if (token && accounts) accounts.logout(token);
    return c.json({ signedIn: false });
  });

  // Deleting an account asks for the password again. App stores require that
  // people can delete an account from inside the app.
  api.delete('/auth/me', async (c) => {
    const store = needAccounts();
    const user = signedIn(c);
    limitAuth(c);
    const password = readPassword(await jsonBody(c), false);
    await store.login({ email: user.email, password }).catch(accountError);
    store.remove(user.id);
    devices?.unlinkUser(user.id);
    devices?.removeAccountZones(user.id);
    return c.json({ deleted: true });
  });

  api.notFound((c) => c.json({ error: { code: 'not_found', message: `No such endpoint: ${c.req.path}. See /api/v1 for the list.` } }, 404));
  api.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
    if (err instanceof UnknownCountryError) return c.json({ error: { code: 'unknown_country', message: err.message } }, 404);
    console.error(err);
    return c.json({ error: { code: 'internal', message: 'The server could not answer this request.' } }, 500);
  });

  app.get('/api/v1/', (c) => c.redirect('/api/v1'));
  app.route('/api/v1', api);
  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: 'The API lives under /api/v1.' } }, 404));
  app.route('/', createAdmin({ password: adminPassword, reports, accounts, broadcasts, devices, push, clientKey }));
  if (siteDir) app.use('*', serveStatic({ root: path.relative(process.cwd(), siteDir) || '.' }));
  return app;
}

/** Names for the `src` codes of the harmonized record. */
const SOURCE = ['none', 'terra-scaled', 'modis-scaled', 'viirs', 'modis-gap-fill', 'noaa20'];
