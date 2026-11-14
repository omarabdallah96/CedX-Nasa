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
import { startRefresh } from './refresh.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'public', 'data');
const siteDir = path.join(root, 'dist');

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

const app = createApp({ service, dataDir, siteDir: existsSync(siteDir) ? siteDir : undefined });
const port = Number(process.env.PORT) || 8787;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Firesight API on http://localhost:${info.port}/api/v1`);
  startRefresh(service);
});
