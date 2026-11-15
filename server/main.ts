// Starts the API (and the built website, when dist/ exists).
// Usage: npm run api        → http://localhost:8787/api/v1
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import type { DatasetIndex } from '../src/lib/analysis.ts';
import { createService } from '../src/lib/service.ts';
import { createApp } from './app.ts';
import { createForecast } from './forecast.ts';
import { createLive } from './live.ts';
import { startRefresh } from './refresh.ts';
import { createReportStore } from './reports.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'public', 'data');
const siteDir = path.join(root, 'dist');
// Ground reports and their photos. Mount this as a volume in Docker so they survive redeploys.
const storageDir = path.resolve(process.env.STORAGE_DIR || path.join(root, 'storage'));

if (!existsSync(path.join(dataDir, 'index.json'))) {
  console.error('No data files yet. Run "npm run data" first.');
  process.exit(1);
}

const service = createService({
  async index() {
    return JSON.parse(await readFile(path.join(dataDir, 'index.json'), 'utf8')) as DatasetIndex;
  },
  async bin(manifest) {
    const b = await readFile(path.join(dataDir, `${manifest.slug}.bin`));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  },
});

const reports = createReportStore(storageDir);
const live = createLive();
// Fire weather moisture codes are kept with the reports so restarts do not redo the run-up.
const forecast = createForecast({ stateDir: path.join(storageDir, 'forecast') });
const app = createApp({
  service,
  dataDir,
  siteDir: existsSync(siteDir) ? siteDir : undefined,
  reports,
  live,
  forecast,
  requestsPer10Min: Number(process.env.RATE_LIMIT_PER_10_MIN ?? 1200),
  reportsPerHour: Number(process.env.REPORTS_PER_HOUR ?? 30),
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
});
const port = Number(process.env.PORT) || 8787;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Firesight API on http://localhost:${info.port}/api/v1`);
  console.log(`reports: stored in ${storageDir}`);
  if (!live.available) console.log('live: FIRMS_MAP_KEY is not set, /live answers 503');
  if (!process.env.ADMIN_PASSWORD) console.log('admin: ADMIN_PASSWORD is not set, /admin is off');
  startRefresh(service);
  // Fire danger forecast: computed once now, then again on demand every few hours.
  if (process.env.FORECAST_WARM !== '0') setTimeout(() => void forecast.warm(), 5_000).unref();
  // Old reports are deleted daily.
  const prune = () => reports.prune().then((n) => n && console.log(`reports: removed ${n} older than 90 days`), console.error);
  void prune();
  setInterval(prune, 86_400_000).unref();
});
