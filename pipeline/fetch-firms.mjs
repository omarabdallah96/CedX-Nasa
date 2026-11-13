// Downloads FIRMS yearly per-country hotspot CSVs into data/raw/.
// Usage: node pipeline/fetch-firms.mjs
// Files already on disk are skipped, so the script is safe to re-run.
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { COUNTRIES, SENSORS, rawPath, rawUrl } from './config.mjs';

const CONCURRENCY = 4;
const EXPECTED_HEADER = 'latitude,longitude,';

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function fetchOne(job) {
  const { sensor, year, country } = job;
  const file = rawPath(sensor, year, country.firms);
  if (await exists(file)) return { ...job, status: 'cached' };

  const url = rawUrl(sensor, year, country.firms);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'firms-archive-fetch/1.0' } });
      if (res.status === 404) return { ...job, status: 'missing' };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.startsWith(EXPECTED_HEADER)) throw new Error('unexpected file header');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, text);
      return { ...job, status: 'downloaded', bytes: text.length };
    } catch (err) {
      if (attempt === 3) return { ...job, status: 'failed', error: String(err) };
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

const jobs = [];
for (const country of COUNTRIES) {
  for (const s of SENSORS) {
    for (let year = s.from; year <= s.to; year++) jobs.push({ sensor: s.id, year, country });
  }
}

const results = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    const r = await fetchOne(job);
    results.push(r);
    if (r.status !== 'cached') {
      console.log(`${r.status.padEnd(10)} ${r.sensor} ${r.year} ${r.country.name}${r.error ? ' ' + r.error : ''}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const tally = {};
for (const r of results) tally[r.status] = (tally[r.status] ?? 0) + 1;
console.log('done', tally);
if (tally.failed) process.exitCode = 1;
