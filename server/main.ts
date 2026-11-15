// Starts the API (and the built website, when dist/ exists).
// Usage: npm run api        → http://localhost:8787/api/v1
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import type { DatasetIndex } from '../src/lib/analysis.ts';
import { createService } from '../src/lib/service.ts';
import { createAccountStore } from './accounts.ts';
import { createBroadcastStore } from './broadcasts.ts';
import { createDeviceStore } from './devices.ts';
import { createPush, parseServiceAccount } from './push.ts';
import { createApp } from './app.ts';
import { createForecast } from './forecast.ts';
import { createLive } from './live.ts';
import { startRefresh } from './refresh.ts';
import { createReportStore } from './reports.ts';
import { createSafety } from './safety.ts';

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
// Optional sign-in for the phone app, in the same storage volume.
const accounts = createAccountStore(storageDir);
// Zone alerts sent from /admin.
const broadcasts = createBroadcastStore(storageDir);
// Phones that turned on instant alerts, and Firebase Cloud Messaging to reach them.
const devices = createDeviceStore(storageDir);
const push = createPush({ account: parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT) });
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
  accounts,
  broadcasts,
  devices,
  push,
  authPer15Min: Number(process.env.AUTH_PER_15_MIN ?? 20),
  // Nearby water and escape routes: OpenStreetMap, Open-Meteo, OSRM (ORS_API_KEY optional).
  safety: createSafety({ cacheDir: path.join(storageDir, 'places') }),
  escapesPer10Min: Number(process.env.ESCAPES_PER_10_MIN ?? 40),
});
const port = Number(process.env.PORT) || 8787;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Firesight API on http://localhost:${info.port}/api/v1`);
  console.log(`reports: stored in ${storageDir}`);
  if (!live.available) console.log('live: FIRMS_MAP_KEY is not set, /live answers 503');
  if (!process.env.ADMIN_PASSWORD) console.log('admin: ADMIN_PASSWORD is not set, /admin is off');
  console.log(push.available ? `push: Firebase project ${push.projectId}` : 'push: FIREBASE_SERVICE_ACCOUNT is not set, zone alerts are not pushed');
  startRefresh(service);
  // Fire danger forecast: computed once now, then again on demand every few hours.
  if (process.env.FORECAST_WARM !== '0') setTimeout(() => void forecast.warm(), 5_000).unref();
  // Old reports are deleted daily.
  const prune = () => reports.prune().then((n) => n && console.log(`reports: removed ${n} older than 90 days`), console.error);
  void prune();
  setInterval(prune, 86_400_000).unref();
  // Expired sign-in sessions too.
  accounts.prune();
  broadcasts.prune();
  setInterval(() => {
    accounts.prune();
    broadcasts.prune();
    devices.prune();
  }, 86_400_000).unref();
});
