// Extracts showcase-country outlines from Natural Earth (public domain) into
// public/data/countries.geojson. Usage: node pipeline/boundaries.mjs
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { COUNTRIES, OUT_DIR, RAW_DIR } from './config.mjs';

const URL_50M = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const cache = path.join(RAW_DIR, 'natural-earth', 'ne_50m_admin_0_countries.geojson');

try {
  await stat(cache);
} catch {
  const res = await fetch(URL_50M);
  if (!res.ok) throw new Error(`Natural Earth download failed: HTTP ${res.status}`);
  await mkdir(path.dirname(cache), { recursive: true });
  await writeFile(cache, await res.text());
}

const world = JSON.parse(await readFile(cache, 'utf8'));
const round = (c) => (typeof c[0] === 'number' ? [Math.round(c[0] * 1e4) / 1e4, Math.round(c[1] * 1e4) / 1e4] : c.map(round));
const features = [];
for (const c of COUNTRIES) {
  // Natural Earth gives France and Norway an ISO_A3 of -99, so match on ADM0_A3 first.
  const f = world.features.find((x) => x.properties.ADM0_A3 === c.iso || x.properties.ISO_A3 === c.iso);
  if (!f) throw new Error(`no Natural Earth feature for ${c.name} (${c.iso})`);
  features.push({
    type: 'Feature',
    properties: { slug: c.slug, name: c.name },
    geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
  });
}
await mkdir(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, 'countries.geojson');
await writeFile(out, JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`wrote ${features.length} outlines, ${((await stat(out)).size / 1024).toFixed(0)} kB`);
