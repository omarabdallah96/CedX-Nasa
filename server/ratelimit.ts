// Fixed-window request counter per client, in memory. Enough for one server
// process; put a proxy limit in front as well when exposing the API widely.
export function createRateLimit({ limit, windowMs, now = Date.now }: { limit: number; windowMs: number; now?: () => number }) {
  const hits = new Map<string, { start: number; count: number }>();
  let sweep = now();
  return {
    /** Counts one request; returns seconds to wait when over the limit, else 0. */
    take(key: string): number {
      const t = now();
      if (t - sweep > windowMs) {
        for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
        sweep = t;
      }
      let h = hits.get(key);
      if (!h || t - h.start >= windowMs) {
        h = { start: t, count: 0 };
        hits.set(key, h);
      }
      h.count++;
      return h.count > limit ? Math.ceil((h.start + windowMs - t) / 1000) : 0;
    },
  };
}
