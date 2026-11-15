// Watches every organization's sites so nobody has to keep the console open:
// a notification when a site rises to "act" or a satellite sees fire inside
// it, and one morning digest a day. The console polls the notifications and
// can show them as browser notifications.
import type { OrgBoard } from './org-routes.ts';
import type { Org, OrgStore, SiteState } from './orgs.ts';

export interface OrgMonitorOptions {
  orgs: OrgStore;
  board: (org: Org, days: number) => Promise<OrgBoard>;
  now?: () => number;
  /** The digest is written once a day, from this local hour on. */
  digestHour?: number;
  timeZone?: string;
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LEVEL: Record<string, string> = { very_low: 'very low', low: 'low', moderate: 'moderate', high: 'high', very_high: 'very high', extreme: 'extreme' };
const RANK = ['very_low', 'low', 'moderate', 'high', 'very_high', 'extreme'];

export function createOrgMonitor({ orgs, board, now = Date.now, digestHour = 6, timeZone = 'Asia/Beirut' }: OrgMonitorOptions) {
  /** Local calendar day and hour in the monitor's time zone. */
  const local = (ms: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
    return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
  };

  function digest(org: Org, b: OrgBoard) {
    const { act, watch, sites } = b.summary;
    const title = act > 0
      ? `Morning briefing: ${act} site${act === 1 ? '' : 's'} need${act === 1 ? 's' : ''} action`
      : watch > 0 ? `Morning briefing: ${watch} site${watch === 1 ? '' : 's'} to watch` : `Morning briefing: all ${sites} site${sites === 1 ? ' is' : 's are'} OK`;
    const lines = b.sites.filter((s) => s.status !== 'ok').slice(0, 8).map((s) => `${s.site.name} (${s.status === 'act' ? 'act now' : 'watch'}): ${s.reasons[0]}`);
    if (b.sites.filter((s) => s.status !== 'ok').length > 8) lines.push(`…and ${b.sites.filter((s) => s.status !== 'ok').length - 8} more.`);
    // The worst day of the week across the organization.
    let worst: { level: string; date: string; site: string } | null = null;
    for (const s of b.sites) for (const d of (s.danger ?? []).slice(0, 7)) {
      if (!worst || RANK.indexOf(d.level) > RANK.indexOf(worst.level)) worst = { level: d.level, date: d.date, site: s.site.name };
    }
    if (worst && RANK.indexOf(worst.level) >= RANK.indexOf('high')) {
      lines.push(`Worst day this week: ${WEEKDAY[new Date(`${worst.date}T00:00:00Z`).getUTCDay()]}, ${LEVEL[worst.level]} fire danger at ${worst.site}.`);
    }
    if (lines.length === 0) lines.push('No fire near any site and low fire danger this week.');
    orgs.addNotification(org.id, { kind: 'digest', title, body: lines.join('\n') });
  }

  /** One pass over every organization. Returns how many notifications it wrote. */
  async function run(): Promise<number> {
    let written = 0;
    const today = local(now());
    for (const org of orgs.all(10_000)) {
      if (org.sites === 0) continue;
      let b: OrgBoard;
      try {
        b = await board(org, 7);
      } catch (err) {
        console.error(`org monitor: ${org.id}`, err);
        continue;
      }
      const before = orgs.siteStates(org.id);
      const after = new Map<string, SiteState>();
      for (const s of b.sites) {
        const was = before.get(s.site.id);
        const inside = s.fires?.inside ?? 0;
        after.set(s.site.id, { status: s.status, score: s.score, inside });
        if (inside > 0 && !(was && was.inside > 0)) {
          orgs.addNotification(org.id, { kind: 'fire', title: `Fire detected inside ${s.site.name}`, body: s.reasons[0], siteId: s.site.id });
          written++;
        } else if (s.status === 'act' && was?.status !== 'act') {
          orgs.addNotification(org.id, { kind: 'act', title: `${s.site.name} needs action`, body: s.reasons.join(' · '), siteId: s.site.id });
          written++;
        }
      }
      orgs.setSiteStates(org.id, after);
      const last = orgs.lastNotificationAt(org.id, 'digest');
      if (today.hour >= digestHour && (!last || local(Date.parse(last)).day !== today.day)) {
        digest(org, b);
        written++;
      }
    }
    return written;
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    run,
    /** First pass shortly after start, then every `everyMs`. */
    start(everyMs = 30 * 60_000, firstAfterMs = 20_000) {
      const tick = () => void run().catch((err) => console.error('org monitor', err));
      setTimeout(tick, firstAfterMs).unref();
      timer = setInterval(tick, everyMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
