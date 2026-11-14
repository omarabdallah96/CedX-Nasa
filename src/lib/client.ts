// Promise wrapper around the analysis worker.
import type { Filters } from './harmonize.ts';
import type { AnalyzeResult, CsvResult, PointsResult, Request } from '../worker/analysis.worker.ts';

type Pending = { resolve: (v: never) => void; reject: (e: Error) => void };
type Body<T extends Request['type']> = Omit<Extract<Request, { type: T }>, 'id' | 'baseUrl' | 'type'>;

export class AnalysisClient {
  private worker = new Worker(new URL('../worker/analysis.worker.ts', import.meta.url), { type: 'module' });
  private pending = new Map<number, Pending>();
  private nextId = 1;
  /** Where the data files are read from: the bundled copy, or the backend once it has answered. */
  baseUrl = new URL('data/', document.baseURI).href;

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.result as never);
      else p.reject(new Error(ev.data.error ?? 'Analysis failed'));
    };
    this.worker.onerror = (ev) => {
      for (const p of this.pending.values()) p.reject(new Error(ev.message || 'Analysis worker crashed'));
      this.pending.clear();
    };
  }

  private call<R>(type: Request['type'], body: object): Promise<R> {
    const id = this.nextId++;
    return new Promise<R>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as Pending['resolve'], reject });
      this.worker.postMessage({ id, type, baseUrl: this.baseUrl, ...body });
    });
  }

  analyze(slug: string, filters: Filters): Promise<AnalyzeResult> {
    return this.call('analyze', { slug, filters } satisfies Body<'analyze'>);
  }
  points(slug: string, filters: Filters, from: number, to: number, limit = 40000): Promise<PointsResult> {
    return this.call('points', { slug, filters, from, to, limit } satisfies Body<'points'>);
  }
  csv(slug: string, filters: Filters, from: number, to: number): Promise<CsvResult> {
    return this.call('csv', { slug, filters, from, to } satisfies Body<'csv'>);
  }
}

export interface DataSource {
  url: string;
  /** True when the files come from the backend, which keeps them current. */
  live: boolean;
}

/**
 * Prefers the backend's copy of the data (kept fresh from FIRMS) and falls back
 * to the copy bundled with the site, so the site works with no server at all.
 */
export async function pickDataSource(): Promise<DataSource> {
  const bundled = new URL('data/', document.baseURI).href;
  const api = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
  try {
    const res = await fetch(`${api}/api/v1/health`, { signal: AbortSignal.timeout(2500) });
    if (res.ok && ((await res.json()) as { ok?: boolean }).ok === true) {
      return { url: new URL(`${api}/api/v1/data/`, document.baseURI).href, live: true };
    }
  } catch {
    // No backend here: a static host, or the server is down.
  }
  return { url: bundled, live: false };
}
