// Promise wrapper around the analysis worker.
import type { Filters } from './harmonize.ts';
import type { AnalyzeResult, CsvResult, PointsResult, Request } from '../worker/analysis.worker.ts';

type Pending = { resolve: (v: never) => void; reject: (e: Error) => void };
type Body<T extends Request['type']> = Omit<Extract<Request, { type: T }>, 'id' | 'baseUrl' | 'type'>;

export class AnalysisClient {
  private worker = new Worker(new URL('../worker/analysis.worker.ts', import.meta.url), { type: 'module' });
  private pending = new Map<number, Pending>();
  private nextId = 1;
  readonly baseUrl = new URL('data/', document.baseURI).href;

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
