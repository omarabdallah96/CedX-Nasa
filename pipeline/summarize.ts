// Writes public/data/summary.json: country-level results the intro and the
// country picker show before any hotspot file is downloaded.
// Usage: node pipeline/summarize.ts   (Node 24 runs TypeScript directly)
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { OUT_DIR } from './config.mjs';
import { analyze, buildContext, type DatasetIndex } from '../src/lib/analysis.ts';
import { unpackHotspots } from '../src/lib/harmonize.ts';
import { annualTotals } from '../src/lib/stats.ts';

const index = JSON.parse(await readFile(path.join(OUT_DIR, 'index.json'), 'utf8')) as DatasetIndex;
const round = (v: number, digits = 2) => (Number.isFinite(v) ? Number(v.toFixed(digits)) : null);
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const mid = (s.length - 1) / 2;
  return (s[Math.floor(mid)] + s[Math.ceil(mid)]) / 2;
};

const summary = [];
for (const man of index.countries) {
  const b = await readFile(path.join(OUT_DIR, `${man.slug}.bin`));
  const h = unpackHotspots(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, man.n);
  const flags = { vegOnly: true, dropLowConf: true };
  const a = analyze(h, { ...flags, bbox: null }, buildContext(h, flags, index));
  const harmonized = annualTotals(a.monthsH);
  const naive = annualTotals(a.monthsNaive);
  // Apparent jump in a typical year across the 2012 sensor switch.
  const step = (t: typeof harmonized) =>
    median(t.filter((x) => x.complete && x.year >= 2012).map((x) => x.total)) /
    median(t.filter((x) => x.complete && x.year < 2012).map((x) => x.total));
  const v = a.validation;
  summary.push({
    slug: man.slug,
    name: man.name,
    detections: a.detections,
    ratio: round(a.calibration.annual),
    ratioByMonth: a.calibration.ratio.map((r) => round(r)),
    validation: {
      mdape: round(v.mdape, 3), mdapeRaw: round(v.mdapeRaw, 3),
      yearlyMdape: round(v.yearlyMdape, 3), yearlyMdapeRaw: round(v.yearlyMdapeRaw, 3),
      bias: round(v.bias, 3), biasRaw: round(v.biasRaw, 3), nMonths: v.nMonths, nYears: v.nYears,
    },
    seamStepRaw: round(step(naive)),
    seamStepHarmonized: round(step(harmonized)),
    years: harmonized.map((t, i) => ({
      year: t.year, complete: t.complete, harmonized: round(t.total, 1), raw: naive[i].total,
    })),
    peak: a.peak && { start: a.peak.start, length: a.peak.length, share: round(a.peak.share, 3) },
  });
  console.log(
    `${man.name.padEnd(9)} ratio ×${a.calibration.annual.toFixed(2)}  monthly error ${(v.mdape * 100).toFixed(0)}% (raw ${(v.mdapeRaw * 100).toFixed(0)}%)` +
    `  seam step raw ×${step(naive).toFixed(2)} → harmonized ×${step(harmonized).toFixed(2)}`,
  );
}
await writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary));
