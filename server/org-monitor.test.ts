// The monitor: notifications when a site needs action, and one digest a day.
import { describe, expect, it } from 'vitest';
import { createOrgMonitor } from './org-monitor.ts';
import type { OrgBoard } from './org-routes.ts';
import { createOrgStore, type Site } from './orgs.ts';

type Row = OrgBoard['sites'][number];
const site = (id: string, name: string): Site => ({ id, name, lat: 34, lon: 36, radiusKm: 5, country: 'lebanon', value: null, people: null, startedYear: null });
const row = (s: Site, status: Row['status'], reason: string, inside = 0, worst: 'low' | 'very_high' = 'low'): Row => ({
  site: s, status, score: status === 'act' ? 85 : status === 'watch' ? 60 : 15, reasons: [reason], why: [],
  danger: [{ date: '2026-08-13', level: worst, fwi: 10, tempC: 30, humidity: 30, windKmh: 10, rainMm: 0, work: { advice: 'go', why: '', cause: 'danger', value: worst } }],
  fires: { inside, nearest: null }, reports: 0,
});
const boardOf = (rows: Row[]) => ({
  generatedAt: '', unavailable: [], note: '', sites: rows,
  summary: {
    sites: rows.length, act: rows.filter((r) => r.status === 'act').length, watch: rows.filter((r) => r.status === 'watch').length,
    ok: rows.filter((r) => r.status === 'ok').length, atRisk: { sites: 0, value: 0, people: 0 }, total: { value: 0, people: 0 },
  },
}) as unknown as OrgBoard;

function setup() {
  // 05:00 in Beirut (UTC+3 in August): before the digest hour.
  let t = Date.parse('2026-08-10T02:00:00Z');
  const orgs = createOrgStore(':memory:', { now: () => t });
  const org = orgs.create({ name: 'Cedar Farms', kind: 'company' });
  const farm = site('farm', 'Farm');
  const depot = site('depot', 'Depot');
  orgs.setSites(org.id, [farm, depot]);
  let rows: Row[] = [row(farm, 'ok', 'Quiet'), row(depot, 'watch', 'High danger on Thursday')];
  const monitor = createOrgMonitor({ orgs, board: async () => boardOf(rows), now: () => t });
  return {
    orgs, org, farm, depot, monitor,
    set: (r: Row[]) => { rows = r; },
    at: (iso: string) => { t = Date.parse(iso); },
    titles: () => orgs.notifications(org.id, 50).map((n) => n.title).reverse(),
  };
}

describe('organization monitor', () => {
  it('notifies once when a site rises to act, and again when fire appears inside it', async () => {
    const { monitor, set, farm, depot, titles } = setup();
    expect(await monitor.run()).toBe(0);

    set([row(farm, 'act', 'Satellite fire 3 km north of the site'), row(depot, 'watch', 'High danger on Thursday')]);
    expect(await monitor.run()).toBe(1);
    expect(await monitor.run()).toBe(0); // still act: no repeat

    set([row(farm, 'act', '2 satellite fire detections inside the site', 2), row(depot, 'watch', 'x')]);
    await monitor.run();
    set([row(farm, 'ok', 'Quiet'), row(depot, 'watch', 'x')]);
    await monitor.run();
    set([row(farm, 'act', 'Satellite fire 1 km east of the site'), row(depot, 'watch', 'x')]);
    await monitor.run();
    expect(titles()).toEqual(['Farm needs action', 'Fire detected inside Farm', 'Farm needs action']);
  });

  it('writes one digest a day, from 06:00 Beirut time', async () => {
    const { monitor, at, set, farm, depot, orgs, org } = setup();
    await monitor.run();
    expect(orgs.lastNotificationAt(org.id, 'digest')).toBeNull();

    set([row(farm, 'act', 'Satellite fire 3 km north of the site', 0, 'very_high'), row(depot, 'watch', 'High danger on Thursday')]);
    at('2026-08-10T03:30:00Z'); // 06:30 local
    await monitor.run();
    at('2026-08-10T15:00:00Z');
    await monitor.run();
    const digests = orgs.notifications(org.id, 50).filter((n) => n.kind === 'digest');
    expect(digests).toHaveLength(1);
    expect(digests[0].title).toBe('Morning briefing: 1 site needs action');
    expect(digests[0].body.split('\n')).toEqual([
      'Farm (act now): Satellite fire 3 km north of the site',
      'Depot (watch): High danger on Thursday',
      'Worst day this week: Thursday, very high fire danger at Farm.',
    ]);

    at('2026-08-11T03:30:00Z'); // the next morning
    set([row(farm, 'ok', 'Quiet'), row(depot, 'ok', 'Quiet')]);
    await monitor.run();
    expect(orgs.notifications(org.id, 50).filter((n) => n.kind === 'digest').map((n) => n.title)[0]).toBe('Morning briefing: all 2 sites are OK');
  });

  it('skips organizations without sites, and forgets removed sites', async () => {
    const { monitor, orgs, org, farm, set } = setup();
    const empty = orgs.create({ name: 'Empty', kind: 'ngo' });
    await monitor.run();
    expect(orgs.siteStates(empty.id).size).toBe(0);
    expect([...orgs.siteStates(org.id).keys()].sort()).toEqual(['depot', 'farm']);
    orgs.setSites(org.id, [farm]);
    set([row(farm, 'ok', 'Quiet')]);
    expect([...orgs.siteStates(org.id).keys()]).toEqual(['farm']);
  });
});
