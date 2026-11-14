// Packs the raw FIRMS CSVs of each country into one compact binary file plus a
// JSON manifest that the browser and the API server load.
// Usage: node pipeline/pack.mjs
//
// Sources: the yearly country archive (data/raw/<sensor>/…) and, when
// fetch-recent.mjs has run, the newer rows from the FIRMS area API (data/raw/api/…).
//
// Binary layout (little-endian, n = number of detections, rows sorted by day
// then time):
//   Float32[n] lat · Float32[n] lon · Float32[n] frp
//   Uint16[n]  day (days since 2000-01-01 UTC) · Uint16[n] time (HHMM UTC)
//   Uint8[n]   flags · Uint8[n] confidence
// flags: bit0 sensor (0 MODIS, 1 VIIRS) · bit1 night · bits2-3 satellite
//        (0 Terra, 1 Aqua, 2 Suomi-NPP, 3 NOAA-20) · bits4-5 FIRMS `type` (0-3)
// confidence: MODIS 0-100 as published; VIIRS low/nominal/high stored as 10/50/90.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_DIR, COUNTRIES, SENSORS, OUT_DIR, EPOCH_UTC, rawPath, FIRMS_BASE } from './config.mjs';

const VIIRS_CONF = { l: 10, n: 50, h: 90 };
// The archive spells satellites out; near-real-time files abbreviate them.
const SATELLITE = { Terra: 0, T: 0, Aqua: 1, A: 1, N: 2, N20: 3 };
const dayOf = (isoDate) => Math.round((Date.parse(`${isoDate}T00:00:00Z`) - EPOCH_UTC) / 86400000);
const iso = (day) => new Date(EPOCH_UTC + day * 86400000).toISOString().slice(0, 10);
/** Same 0.01° cell as src/lib/harmonize.ts. */
const cellKey = (lat, lon) => Math.floor((lat + 90) / 0.01) * 36000 + Math.floor((lon + 180) / 0.01);

/** Rows of one CSV. `type` is -1 where the file has no such column (near-real-time data). */
function parseCsv(text, sensorId, file) {
  const lines = text.split('\n');
  const header = lines[0].trim().split(',');
  const col = (name, optional = false) => {
    const i = header.indexOf(name);
    if (i < 0 && !optional) throw new Error(`${file}: missing column ${name}`);
    return i;
  };
  const cLat = col('latitude');
  const cLon = col('longitude');
  const cDate = col('acq_date');
  const cTime = col('acq_time');
  const cSat = col('satellite');
  const cConf = col('confidence');
  const cFrp = col('frp');
  const cDn = col('daynight');
  const cType = col('type', true);
  const isViirs = sensorId !== 'modis';

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const f = line.split(',');
    const day = dayOf(f[cDate]);
    const sat = SATELLITE[f[cSat]];
    if (sat === undefined) throw new Error(`${file}:${i + 1}: unknown satellite "${f[cSat]}"`);
    let conf;
    if (isViirs) {
      conf = VIIRS_CONF[f[cConf][0]?.toLowerCase()];
      if (conf === undefined) throw new Error(`${file}:${i + 1}: unknown confidence "${f[cConf]}"`);
    } else {
      conf = Number(f[cConf]);
    }
    const type = cType < 0 ? -1 : Number(f[cType]);
    const lat = Number(f[cLat]);
    const lon = Number(f[cLon]);
    const frp = Number(f[cFrp]);
    const time = Number(f[cTime]);
    if (
      !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(day) ||
      !Number.isFinite(conf) || !(type >= -1 && type <= 3) || day < 0 || day > 65535
    ) {
      throw new Error(`${file}:${i + 1}: unparseable row "${line}"`);
    }
    const flags = (isViirs ? 1 : 0) | (f[cDn] === 'N' ? 2 : 0) | (sat << 2);
    rows.push({ lat, lon, frp: Number.isFinite(frp) ? frp : 0, day, time, flags, conf, type });
  }
  return rows;
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

export async function run({ log = console.log } = {}) {
  await mkdir(OUT_DIR, { recursive: true });
  const index = [];
  const recent = await readJson(path.join(API_DIR, 'manifest.json'));

  const lastYear = Math.max(...SENSORS.map((s) => s.to));
  const archiveEndDay = dayOf(`${lastYear}-12-31`);
  const coverageEndDay = recent ? Math.max(archiveEndDay, dayOf(recent.end)) : archiveEndDay;
  // Pooled raw daily detection counts over all countries, for outage detection.
  const pooledM = new Float64Array(coverageEndDay + 1);
  const pooledV = new Float64Array(coverageEndDay + 1);
  const pooledN = new Float64Array(coverageEndDay + 1);

  for (const country of COUNTRIES) {
    const rows = [];
    const counts = {};
    const missing = [];
    for (const s of SENSORS) {
      counts[s.id] = 0;
      for (let year = s.from; year <= s.to; year++) {
        const file = rawPath(s.id, year, country.firms);
        let text;
        try {
          text = await readFile(file, 'utf8');
        } catch {
          missing.push(`${s.id} ${year}`);
          continue;
        }
        const parsed = parseCsv(text, s.id, path.basename(file));
        counts[s.id] += parsed.length;
        for (const r of parsed) rows.push(r);
      }
    }
    let recentRows = 0;
    for (const f of recent?.files ?? []) {
      if (f.country !== country.slug) continue;
      const text = await readFile(path.join(API_DIR, f.file), 'utf8');
      const parsed = parseCsv(text, f.sensor, f.file);
      counts[f.sensor] = (counts[f.sensor] ?? 0) + parsed.length;
      recentRows += parsed.length;
      for (const r of parsed) if (r.day > archiveEndDay && r.day <= coverageEndDay) rows.push(r);
    }

    // Near-real-time rows carry no `type`. Static heat sources (factories, flares,
    // volcanoes) sit still, so a cell that held one in the typed history is taken
    // to hold one now; everything else is presumed vegetation fire.
    const staticCells = new Set();
    const staticBefore2025 = new Set();
    const day2025 = dayOf('2025-01-01');
    for (const r of rows) {
      if (r.type <= 0) continue;
      const key = cellKey(r.lat, r.lon);
      staticCells.add(key);
      if (r.day < day2025) staticBefore2025.add(key);
    }
    // How well that rule would have worked on 2025, where the truth is known.
    const check = { staticHit: 0, staticAll: 0, vegFlagged: 0, vegAll: 0 };
    let inferred = 0;
    for (const r of rows) {
      if (r.type >= 0 && r.day >= day2025 && r.day <= archiveEndDay) {
        const hit = staticBefore2025.has(cellKey(r.lat, r.lon));
        if (r.type > 0) {
          check.staticAll++;
          if (hit) check.staticHit++;
        } else {
          check.vegAll++;
          if (hit) check.vegFlagged++;
        }
      }
      if (r.type < 0) {
        r.type = staticCells.has(cellKey(r.lat, r.lon)) ? 2 : 0;
        inferred++;
      }
      r.flags |= r.type << 4;
    }
    rows.sort((a, b) => a.day - b.day || a.time - b.time);

    const n = rows.length;
    const buf = new ArrayBuffer(18 * n);
    const lat = new Float32Array(buf, 0, n);
    const lon = new Float32Array(buf, 4 * n, n);
    const frp = new Float32Array(buf, 8 * n, n);
    const day = new Uint16Array(buf, 12 * n, n);
    const time = new Uint16Array(buf, 14 * n, n);
    const flags = new Uint8Array(buf, 16 * n, n);
    const conf = new Uint8Array(buf, 17 * n, n);
    let west = 180, east = -180, south = 90, north = -90;
    for (let i = 0; i < n; i++) {
      const r = rows[i];
      if (r.day <= coverageEndDay) {
        const pooled = !(r.flags & 1) ? pooledM : ((r.flags >> 2) & 3) === 3 ? pooledN : pooledV;
        pooled[r.day]++;
      }
      lat[i] = r.lat; lon[i] = r.lon; frp[i] = r.frp;
      day[i] = r.day; time[i] = r.time; flags[i] = r.flags; conf[i] = r.conf;
      if (r.lon < west) west = r.lon;
      if (r.lon > east) east = r.lon;
      if (r.lat < south) south = r.lat;
      if (r.lat > north) north = r.lat;
    }
    await writeFile(path.join(OUT_DIR, `${country.slug}.bin`), Buffer.from(buf));

    // Central 95 % of detections on each axis: a view of the mainland that is not
    // stretched by a few detections on distant islands.
    const pct = (arr, q) => arr[Math.min(n - 1, Math.max(0, Math.round((n - 1) * q)))];
    const lons = Float32Array.from(lon).sort();
    const lats = Float32Array.from(lat).sort();
    const focus = [pct(lons, 0.025), pct(lats, 0.025), pct(lons, 0.975), pct(lats, 0.975)];

    const manifest = {
      slug: country.slug,
      name: country.name,
      iso: country.iso,
      n,
      counts,
      bbox: [west, south, east, north].map((v) => Math.round(v * 1000) / 1000),
      focus: focus.map((v) => Math.round(v * 1000) / 1000),
      firstDay: rows[0].day,
      lastDay: rows[n - 1].day,
      epoch: '2000-01-01',
      bytes: buf.byteLength,
      missingFiles: missing,
      source: `${FIRMS_BASE}/{sensor}/{year}/{sensor}_{year}_${country.firms}.csv`,
    };
    await writeFile(path.join(OUT_DIR, `${country.slug}.json`), JSON.stringify(manifest, null, 1));
    index.push(manifest);
    const pc = (a, b) => (b > 0 ? `${((100 * a) / b).toFixed(0)}% (${a} of ${b})` : 'none to test');
    log(
      `${country.name.padEnd(9)} rows ${String(n).padStart(7)}  modis ${counts.modis}  s-npp ${counts['viirs-snpp']}` +
      `  noaa-20 ${counts['viirs-noaa20'] ?? 0}  recent ${recentRows}  ${(buf.byteLength / 1e6).toFixed(1)} MB` +
      `${missing.length ? `  missing: ${missing.join(', ')}` : ''}` +
      (inferred > 0
        ? `\n          type inferred for ${inferred} near-real-time rows; on 2025 the rule finds ${pc(check.staticHit, check.staticAll)}` +
          ` of static-source detections and wrongly flags ${pc(check.vegFlagged, check.vegAll)} of fires`
        : ''),
    );
  }

  // Where Suomi-NPP stops delivering before the record ends, NOAA-20 takes over.
  const snppMax = recent?.availability?.VIIRS_SNPP_NRT?.max ?? recent?.availability?.VIIRS_SNPP_SP?.max;
  const snppEndDay = snppMax && dayOf(snppMax) < coverageEndDay ? Math.max(dayOf(snppMax), archiveEndDay) : null;

  // VIIRS outages: runs of 3+ days with no Suomi-NPP detection in any packed
  // country while another sensor kept detecting (10+ detections over the run).
  // Static heat sources are seen by VIIRS almost daily, so a multi-day zero
  // means the sensor was down.
  const firstViirsDay = dayOf('2012-01-20');
  const lastViirsDay = snppEndDay ?? coverageEndDay;
  const viirsOutages = [];
  let runStart = -1;
  let runModis = 0;
  let runOther = 0;
  for (let d = firstViirsDay; d <= lastViirsDay + 1; d++) {
    const zero = d <= lastViirsDay && pooledV[d] === 0;
    if (zero) {
      if (runStart < 0) { runStart = d; runModis = 0; runOther = 0; }
      runModis += pooledM[d];
      runOther += pooledM[d] + pooledN[d];
    } else if (runStart >= 0) {
      const days = d - runStart;
      if (days >= 3 && runOther >= 10) {
        viirsOutages.push({ start: runStart, end: d - 1, from: iso(runStart), to: iso(d - 1), days, modisDetections: runModis });
      }
      runStart = -1;
    }
  }
  for (const o of viirsOutages) log(`VIIRS outage ${o.from} → ${o.to} (${o.days} days, ${o.modisDetections} MODIS detections meanwhile)`);
  if (snppEndDay !== null) log(`Suomi-NPP delivered until ${iso(snppEndDay)}; NOAA-20 carries the record from ${iso(snppEndDay + 1)}`);

  const nrtFromDay = {};
  for (const f of recent?.files ?? []) {
    if (!f.source.endsWith('_NRT')) continue;
    const d = dayOf(f.start);
    if (nrtFromDay[f.sensor] === undefined || d < nrtFromDay[f.sensor]) nrtFromDay[f.sensor] = d;
  }

  const out = {
    epoch: '2000-01-01',
    generatedAt: recent?.generatedAt ?? new Date().toISOString(),
    coverageEndDay,
    coverageEnd: iso(coverageEndDay),
    recentFromDay: recent ? archiveEndDay + 1 : null,
    snppEndDay,
    nrtFromDay,
    viirsOutages,
    countries: index,
  };
  await writeFile(path.join(OUT_DIR, 'index.json'), JSON.stringify(out, null, 1));
  log(`record runs ${iso(index.reduce((a, m) => Math.min(a, m.firstDay), Infinity))} → ${out.coverageEnd}`);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
