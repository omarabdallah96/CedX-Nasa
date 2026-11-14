/// <reference lib="webworker" />
// Runs the analysis off the main thread. All logic lives in lib/service.ts.
import type { DatasetIndex } from '../lib/analysis.ts';
import type { Filters } from '../lib/harmonize.ts';
import { createService, toCsv, type AnalyzeResult, type PointsResult, type Service } from '../lib/service.ts';

export type { AnalyzeResult, PointsResult };

export type Request =
  | { id: number; type: 'analyze'; baseUrl: string; slug: string; filters: Filters }
  | { id: number; type: 'points'; baseUrl: string; slug: string; filters: Filters; from: number; to: number; limit: number }
  | { id: number; type: 'csv'; baseUrl: string; slug: string; filters: Filters; from: number; to: number };

export interface CsvResult {
  blob: Blob;
  rows: number;
}

// One service per data location (the bundled copy or the live backend).
const services = new Map<string, Service>();

function serviceFor(baseUrl: string): Service {
  let s = services.get(baseUrl);
  if (!s) {
    s = createService({
      async index() {
        const res = await fetch(`${baseUrl}index.json`);
        if (!res.ok) throw new Error(`Could not load the dataset index (HTTP ${res.status})`);
        return (await res.json()) as DatasetIndex;
      },
      async bin(man) {
        const res = await fetch(`${baseUrl}${man.slug}.bin`);
        if (!res.ok) throw new Error(`Could not load hotspots for ${man.name} (HTTP ${res.status})`);
        return res.arrayBuffer();
      },
    });
    services.set(baseUrl, s);
  }
  return s;
}

async function handle(req: Request): Promise<{ result: unknown; transfer: Transferable[] }> {
  const service = serviceFor(req.baseUrl);
  if (req.type === 'analyze') {
    const result = await service.analyze(req.slug, req.filters);
    return { result, transfer: [result.density.buffer] };
  }
  if (req.type === 'points') {
    const result = await service.points(req.slug, req.filters, req.from, req.to, req.limit);
    return { result, transfer: [result.lon.buffer, result.lat.buffer, result.sensor.buffer] };
  }
  const { rows } = await service.rows(req.slug, req.filters, req.from, req.to);
  const result: CsvResult = { blob: new Blob([toCsv(rows)], { type: 'text/csv' }), rows: rows.length };
  return { result, transfer: [] };
}

self.onmessage = (ev: MessageEvent<Request>) => {
  const req = ev.data;
  handle(req).then(
    ({ result, transfer }) => (self as DedicatedWorkerGlobalScope).postMessage({ id: req.id, ok: true, result }, transfer),
    (err: unknown) => (self as DedicatedWorkerGlobalScope).postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
};
