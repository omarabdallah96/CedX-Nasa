// Downloads hotspots newer than the yearly country archive from the FIRMS area
// API, clipped to each country's border, into data/raw/api/.
// Usage: node --env-file=.env pipeline/fetch-recent.mjs      (needs FIRMS_MAP_KEY)
//
// Windows that are older than ten days are immutable and cached; newer ones are
// fetched again on every run, because near-real-time data is still being revised.
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_BASE, API_DIR, API_FROM, API_SENSORS, COAST_TOLERANCE, COUNTRIES } from './config.mjs';
import { WORLD_FILE, WORLD_URL, loadWorld, makeClipper } from './clip.mjs';

const DAY = 86_400_000;
const WINDOW = 5;
const CONCURRENCY = 3;
/** Pause when FIRMS reports this many of the key's 5,000 transactions per 10 minutes in use. */
const BUDGET = 3800;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'User-Agent': 'firms-area-fetch/1.0' };

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function getText(url, attempts = 4) {
  let limited = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(90_000) });
      // FIRMS answers 403 / 429 while a key is over its allowance: wait it out (up to 15 minutes).
      if ((res.status === 403 || res.status === 429) && limited++ < 30) {
        await sleep(30_000);
        attempt--;
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt >= attempts) throw err;
      await sleep(2000 * attempt);
    }
  }
}

/**
 * @returns {Promise<{skipped: true, reason: string} | {skipped: false, end: string, files: number, fetched: number, rows: number}>}
 */
export async function run({ key = process.env.FIRMS_MAP_KEY, log = console.log, now = Date.now() } = {}) {
  if (!key) {
    log('FIRMS_MAP_KEY is not set: keeping the yearly archive only.');
    return { skipped: true, reason: 'no key' };
  }
  // Never print or store the key: every URL that carries it stays inside this function.
  const redact = (s) => String(s).replaceAll(key, '<key>');

  if (!(await exists(WORLD_FILE))) {
    const res = await fetch(WORLD_URL);
    if (!res.ok) throw new Error(`Natural Earth download failed: HTTP ${res.status}`);
    await mkdir(path.dirname(WORLD_FILE), { recursive: true });
    await writeFile(WORLD_FILE, await res.text());
  }
  const world = await loadWorld();

  const availability = {};
  const table = await getText(`${API_BASE}/api/data_availability/csv/${key}/all`).catch((e) => {
    throw new Error(redact(e.message));
  });
  if (!table.startsWith('data_id,')) throw new Error(`FIRMS did not accept the key: ${redact(table.slice(0, 120))}`);
  for (const line of table.trim().split('\n').slice(1)) {
    const [id, min, max] = line.split(',');
    availability[id] = { min, max };
  }

  // Last complete UTC day.
  const end = iso(Math.floor(now / DAY) * DAY - DAY);
  const mutableFrom = iso(Date.parse(end) - 10 * DAY);

  /** Windows of one source between two dates, aligned to the source's own start. */
  const windows = (source, from, to) => {
    const out = [];
    for (let t = Date.parse(from); t <= Date.parse(to); t += WINDOW * DAY) {
      const days = Math.min(WINDOW, Math.round((Date.parse(to) - t) / DAY) + 1);
      out.push({ source, start: iso(t), end: iso(t + (days - 1) * DAY), days });
    }
    return out;
  };

  const jobs = [];
  for (const country of COUNTRIES) {
    const clip = makeClipper(world, country.iso, COAST_TOLERANCE);
    for (const sensor of API_SENSORS) {
      const sp = availability[sensor.sp];
      const nrt = availability[sensor.nrt];
      const plan = [];
      // Science-quality data as far as it reaches, near-real-time after that.
      const spEnd = sp && sp.max >= API_FROM ? (sp.max < end ? sp.max : end) : null;
      if (spEnd) plan.push(...windows(sensor.sp, API_FROM, spEnd));
      const nrtFrom = spEnd ? iso(Date.parse(spEnd) + DAY) : API_FROM;
      if (nrt) {
        const from = nrt.min > nrtFrom ? nrt.min : nrtFrom;
        const to = nrt.max < end ? nrt.max : end;
        if (from <= to) plan.push(...windows(sensor.nrt, from, to));
      }
      for (const w of plan) {
        jobs.push({
          ...w, country, sensor: sensor.id, clip,
          file: path.join(API_DIR, country.slug, sensor.id, `${w.source}_${w.start}_${w.days}.csv`),
        });
      }
    }
  }

  let fetched = 0;
  let rows = 0;
  let next = 0;
  const failures = [];

  // FIRMS weighs requests by size, so ask it how much of the allowance is used
  // instead of guessing: check every few requests and wait while it is nearly full.
  let sinceCheck = Infinity;
  let gate = Promise.resolve();
  async function transactionsUsed() {
    try {
      const status = JSON.parse(await getText(`${API_BASE}/mapserver/mapkey_status/?MAP_KEY=${key}`, 2));
      return Number(status.current_transactions) || 0;
    } catch {
      return 0;
    }
  }
  function pace() {
    gate = gate.then(async () => {
      if (++sinceCheck < 12) return;
      sinceCheck = 0;
      let said = false;
      while ((await transactionsUsed()) > BUDGET) {
        if (!said) log('FIRMS transaction allowance nearly used, waiting for it to roll over');
        said = true;
        await sleep(30_000);
      }
    });
    return gate;
  }

  async function fetchOne(job) {
    if (job.end < mutableFrom && (await exists(job.file))) return;
    await pace();
    const url = `${API_BASE}/api/area/csv/${key}/${job.source}/${job.clip.bbox.join(',')}/${job.days}/${job.start}`;
    let text;
    for (let attempt = 1; ; attempt++) {
      text = await getText(url);
      if (text.startsWith('latitude,longitude')) break;
      if (attempt >= 12) throw new Error(text.slice(0, 120).trim());
      // Most often the transaction limit; give it time to roll over.
      sinceCheck = Infinity;
      await sleep(60_000);
    }
    const lines = text.split('\n');
    const header = lines[0].trim().split(',');
    const cLat = header.indexOf('latitude');
    const cLon = header.indexOf('longitude');
    const cDate = header.indexOf('acq_date');
    const kept = [lines[0].trim()];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const f = line.split(',');
      // The API returns whole windows; keep only the dates this source is responsible for.
      if (f[cDate] < job.start || f[cDate] > job.end) continue;
      if (job.clip.accept(Number(f[cLon]), Number(f[cLat]))) kept.push(line);
    }
    await mkdir(path.dirname(job.file), { recursive: true });
    await writeFile(job.file, kept.join('\n') + '\n');
    fetched++;
    rows += kept.length - 1;
  }

  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        await fetchOne(job);
      } catch (err) {
        failures.push(redact(`${job.country.name} ${job.source} ${job.start}: ${err.message}`));
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (failures.length > 0) {
    throw new Error(`${failures.length} of ${jobs.length} FIRMS requests failed, first: ${failures[0]}`);
  }

  const manifest = {
    generatedAt: new Date(now).toISOString(),
    from: API_FROM,
    end,
    availability: Object.fromEntries(
      API_SENSORS.flatMap((s) => [s.sp, s.nrt]).filter((id) => availability[id]).map((id) => [id, availability[id]]),
    ),
    files: jobs.map((j) => ({
      country: j.country.slug, sensor: j.sensor, source: j.source, start: j.start, end: j.end,
      file: path.relative(API_DIR, j.file),
    })),
  };
  await mkdir(API_DIR, { recursive: true });
  await writeFile(path.join(API_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1));
  log(`recent data through ${end}: ${jobs.length} windows, ${fetched} fetched, ${rows} rows kept after clipping`);
  return { skipped: false, end, files: jobs.length, fetched, rows };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
