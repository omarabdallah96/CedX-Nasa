// Packs the raw FIRMS CSVs of each country into one compact binary file plus a
// JSON manifest that the browser loads.
// Usage: node pipeline/pack.mjs
//
// Binary layout (little-endian, n = number of detections, rows sorted by day
// then time):
//   Float32[n] lat · Float32[n] lon · Float32[n] frp
//   Uint16[n]  day (days since 2000-01-01 UTC) · Uint16[n] time (HHMM UTC)
//   Uint8[n]   flags · Uint8[n] confidence
// flags: bit0 sensor (0 MODIS, 1 VIIRS) · bit1 night · bits2-3 satellite
//        (0 Terra, 1 Aqua, 2 Suomi-NPP) · bits4-5 FIRMS `type` (0-3)
// confidence: MODIS 0-100 as published; VIIRS l/n/h stored as 10/50/90.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { COUNTRIES, SENSORS, OUT_DIR, EPOCH_UTC, rawPath, FIRMS_BASE } from './config.mjs';

const VIIRS_CONF = { l: 10, n: 50, h: 90 };
const SATELLITE = { Terra: 0, Aqua: 1, N: 2 };

function parseCsv(text, sensorId, file) {
  const lines = text.split('\n');
  const header = lines[0].trim().split(',');
  const col = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`${file}: missing column ${name}`);
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
  const cType = col('type');
  const isViirs = sensorId !== 'modis';

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const f = line.split(',');
    const [y, m, d] = f[cDate].split('-').map(Number);
    const day = Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / 86400000);
    const sat = SATELLITE[f[cSat]];
    if (sat === undefined) throw new Error(`${file}:${i + 1}: unknown satellite "${f[cSat]}"`);
    let conf;
    if (isViirs) {
      conf = VIIRS_CONF[f[cConf]];
      if (conf === undefined) throw new Error(`${file}:${i + 1}: unknown confidence "${f[cConf]}"`);
    } else {
      conf = Number(f[cConf]);
    }
    const type = Number(f[cType]);
    const lat = Number(f[cLat]);
    const lon = Number(f[cLon]);
    const frp = Number(f[cFrp]);
    const time = Number(f[cTime]);
    if (
      !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(day) ||
      !Number.isFinite(conf) || !(type >= 0 && type <= 3) || day < 0 || day > 65535
    ) {
      throw new Error(`${file}:${i + 1}: unparseable row "${line}"`);
    }
    const flags = (isViirs ? 1 : 0) | (f[cDn] === 'N' ? 2 : 0) | (sat << 2) | (type << 4);
    rows.push({ lat, lon, frp: Number.isFinite(frp) ? frp : 0, day, time, flags, conf });
  }
  return rows;
}

await mkdir(OUT_DIR, { recursive: true });
const index = [];

// Pooled raw daily detection counts over all countries, for outage detection.
const lastYear = Math.max(...SENSORS.map((s) => s.to));
const coverageEndDay = Math.round((Date.UTC(lastYear + 1, 0, 1) - EPOCH_UTC) / 86400000) - 1;
const pooledM = new Float64Array(coverageEndDay + 1);
const pooledV = new Float64Array(coverageEndDay + 1);

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
    if (r.day <= coverageEndDay) (r.flags & 1 ? pooledV : pooledM)[r.day]++;
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
  console.log(
    `${country.name.padEnd(9)} rows ${String(n).padStart(7)}  modis ${counts.modis}  viirs ${counts['viirs-snpp']}` +
    `  ${(buf.byteLength / 1e6).toFixed(1)} MB${missing.length ? `  missing: ${missing.join(', ')}` : ''}`,
  );
}

// VIIRS outages: runs of 3+ days with no VIIRS detection in any packed country
// while MODIS kept detecting (10+ detections over the run). Static heat sources
// are seen by VIIRS almost daily, so a multi-day zero means the sensor was down.
const firstViirsDay = Math.round((Date.UTC(2012, 0, 20) - EPOCH_UTC) / 86400000);
const iso = (day) => new Date(EPOCH_UTC + day * 86400000).toISOString().slice(0, 10);
const viirsOutages = [];
let runStart = -1;
let runModis = 0;
for (let d = firstViirsDay; d <= coverageEndDay + 1; d++) {
  const zero = d <= coverageEndDay && pooledV[d] === 0;
  if (zero) {
    if (runStart < 0) { runStart = d; runModis = 0; }
    runModis += pooledM[d];
  } else if (runStart >= 0) {
    const days = d - runStart;
    if (days >= 3 && runModis >= 10) {
      viirsOutages.push({ start: runStart, end: d - 1, from: iso(runStart), to: iso(d - 1), days, modisDetections: runModis });
    }
    runStart = -1;
  }
}
for (const o of viirsOutages) console.log(`VIIRS outage ${o.from} → ${o.to} (${o.days} days, ${o.modisDetections} MODIS detections meanwhile)`);

await writeFile(
  path.join(OUT_DIR, 'index.json'),
  JSON.stringify({ epoch: '2000-01-01', coverageEndDay, coverageEnd: iso(coverageEndDay), viirsOutages, countries: index }, null, 1),
);
