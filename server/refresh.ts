// Keeps the record current: pulls the newest days from FIRMS and repacks.
// Only runs when FIRMS_MAP_KEY is set; without it the server serves what is on disk.
import { run as fetchRecent } from '../pipeline/fetch-recent.mjs';
import { run as pack } from '../pipeline/pack.mjs';
import { run as summarize } from '../pipeline/summarize.ts';
import type { Service } from '../src/lib/service.ts';

const HOUR = 3_600_000;

export function startRefresh(service: Service, { everyHours = 6, log = console.log }: { everyHours?: number; log?: (line: string) => void } = {}) {
  if (!process.env.FIRMS_MAP_KEY) {
    log('refresh: FIRMS_MAP_KEY is not set, serving the data on disk as it is');
    return { stop() {}, runNow: async () => false };
  }
  let running = false;

  async function runNow(): Promise<boolean> {
    if (running) return false;
    running = true;
    try {
      const quiet = () => {};
      const result = await fetchRecent({ log });
      if (result.skipped) return false;
      await pack({ log: quiet });
      await summarize({ log: quiet });
      service.reset();
      log(`refresh: record now runs through ${result.end}`);
      return true;
    } catch (err) {
      // Keep serving what we have; the next run tries again.
      log(`refresh failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      running = false;
    }
  }

  // Refresh at start when the files are stale, then on a timer.
  void service.index().then(
    (index) => {
      const age = index.generatedAt ? Date.now() - Date.parse(index.generatedAt) : Infinity;
      if (age > everyHours * HOUR) void runNow();
    },
    () => void runNow(),
  );
  const timer = setInterval(() => void runNow(), everyHours * HOUR);
  timer.unref();
  return { stop: () => clearInterval(timer), runNow };
}
