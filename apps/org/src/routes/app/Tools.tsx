// One tool per kind of organization, all reading the same board and record.
// The organization's kind picks the one that opens first; all four stay one tab away.
import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router';
import { api, type Board, type Exposure, type OrgKind } from '../../lib/api.ts';
import { downloadCsv, fileSafe } from '../../lib/csv.ts';
import { errorText, periodName, useT } from '../../lib/i18n.ts';
import { useOrg } from '../../lib/session.tsx';
import { Icon } from '../../ui/icons.tsx';
import { DangerKey, DangerStrip, Empty, Notice, SkeletonRows, StatusTag, YearBars } from '../../ui/parts.tsx';
import { PageHead } from '../../ui/Shell.tsx';

export const TOOLS = ['briefing', 'exposure', 'planner', 'impact'] as const;
export type Tool = (typeof TOOLS)[number];
const BY_KIND: Record<OrgKind, Tool> = { fire_station: 'briefing', insurer: 'exposure', company: 'planner', ngo: 'impact' };
export const defaultTool = (kind: OrgKind) => BY_KIND[kind];

const RANK = ['very_low', 'low', 'moderate', 'high', 'very_high', 'extreme'];
const atLeastHigh = (level: string) => RANK.indexOf(level) >= RANK.indexOf('high');

export function Tools({ tool }: { tool: Tool }) {
  const { t } = useT();
  const { org, board, boardError, reloadBoard } = useOrg();
  const [exposure, setExposure] = useState<Exposure | null>(null);
  const [exposureError, setExposureError] = useState<unknown>(null);
  const needsExposure = tool === 'exposure' || tool === 'impact';
  // The 25-year record behind exposure and impact is read once per board.
  useEffect(() => {
    if (!needsExposure || !board) return;
    let alive = true;
    setExposureError(null);
    api<Exposure>('GET', `/orgs/${org.id}/exposure`).then((e) => alive && setExposure(e), (err) => alive && setExposureError(err));
    return () => {
      alive = false;
    };
  }, [needsExposure, board?.generatedAt, org.id, board]);

  const first = defaultTool(org.kind);
  const order = [first, ...TOOLS.filter((x) => x !== first)];
  return (
    <div className="tools-page">
      <nav className="tabs no-print" aria-label={t.nav.tools}>
        {order.map((x) => <NavLink key={x} to={`/app/tools/${x}`} className="tab">{t.tools[x]}</NavLink>)}
      </nav>
      {!board && !boardError && <SkeletonRows rows={6} />}
      {boardError && !board ? <Notice tone="error">{errorText(t, boardError)} <button type="button" className="link" onClick={() => void reloadBoard()}>{t.common.retry}</button></Notice> : null}
      {board && board.sites.length === 0 && (
        <Empty icon="sites" title={t.overview.emptyTitle} action={org.role === 'owner' && <Link className="btn" to="/app/sites?add=1">{t.overview.addOnMap}</Link>}>
          {org.role === 'owner' ? t.overview.emptyOwner : t.overview.emptyMember(org.name)}
        </Empty>
      )}
      {board && board.sites.length > 0 && (
        <>
          {tool === 'briefing' && <Briefing board={board} />}
          {tool === 'exposure' && <ExposureTool exposure={exposure} error={exposureError} />}
          {tool === 'planner' && <Planner board={board} />}
          {tool === 'impact' && <Impact exposure={exposure} error={exposureError} />}
        </>
      )}
    </div>
  );
}

function PrintButton() {
  const { t } = useT();
  return <button type="button" className="btn btn-quiet no-print" onClick={() => window.print()}><Icon name="print" size={16} />{t.common.print}</button>;
}

function Sub() {
  const { f } = useT();
  const { org } = useOrg();
  return <>{org.name} · {f.date(new Date().toISOString())}</>;
}

function SiteLink({ id, name, gridRef }: { id: string; name: string; gridRef?: string }) {
  return (
    <Link to={`/app/sites/${id}`} className="site-link">
      <span>{name}</span>
      {gridRef && <span className="ref num">{gridRef}</span>}
    </Link>
  );
}

// ---------- Fire stations ----------
function Briefing({ board }: { board: Board }) {
  const { t, f } = useT();
  const { org, refs } = useOrg();
  const act = board.sites.filter((s) => s.status === 'act');
  const burning = board.sites.filter((s) => (s.fires?.inside ?? 0) > 0);
  const reported = board.sites.filter((s) => s.reports > 0);
  return (
    <section className="lens" aria-labelledby="tool-h">
      <PageHead title={<span id="tool-h">{t.briefing.title}</span>} sub={<Sub />}><PrintButton /></PageHead>
      <p className="lede">
        {t.briefing.lede(act.length, board.sites.length, act.map((s) => s.site.name).join(', '))}
        {burning.length > 0 && ` ${t.briefing.burning(burning.map((s) => s.site.name).join(', '))}`}
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t.briefing.cols.area}</th>
              <th scope="col">{t.briefing.cols.now}</th>
              <th scope="col">{t.briefing.cols.week}</th>
              <th scope="col" className="num">{t.briefing.cols.high}</th>
              <th scope="col">{t.briefing.cols.fires}</th>
              <th scope="col" className="num">{t.briefing.cols.reports}</th>
              {org.role === 'owner' && <th scope="col" className="no-print"><span className="sr-only">{t.briefing.alert}</span></th>}
            </tr>
          </thead>
          <tbody>
            {board.sites.map((s) => {
              const week = (s.danger ?? []).slice(0, 7);
              const near = s.fires?.nearest;
              return (
                <tr key={s.site.id}>
                  <th scope="row"><SiteLink id={s.site.id} name={s.site.name} gridRef={refs.get(s.site.id)} /></th>
                  <td><StatusTag status={s.status} score={s.score} /></td>
                  <td className="strip-cell">{week.length ? <DangerStrip days={week} labels /> : <span className="muted">{t.briefing.noForecast}</span>}</td>
                  <td className="num">{week.length ? week.filter((d) => atLeastHigh(d.level)).length : '–'}</td>
                  <td>
                    {!s.fires ? <span className="muted">{t.briefing.unavailable}</span>
                      : s.fires.inside > 0 && near ? <strong className="hot">{t.briefing.inside(s.fires.inside, f.ago(near.acquiredAt))}</strong>
                        : near ? t.briefing.near(f.one(near.edgeKm), t.compass[near.compass] ?? near.compass, f.ago(near.acquiredAt))
                          : <span className="muted">{t.briefing.noneNear}</span>}
                  </td>
                  <td className="num">{s.reports || '–'}</td>
                  {org.role === 'owner' && <td className="no-print"><Link className="link" to={`/app/alerts?site=${s.site.id}`}>{t.briefing.alert}</Link></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <DangerKey />
      {reported.length > 0 && <p className="fine">{t.briefing.reported(reported.map((s) => s.site.name).join(', '))}</p>}
      <p className="fine">{t.briefing.note}{!org.verified && ` ${t.briefing.notVerified}`}</p>
    </section>
  );
}

// ---------- Insurers ----------
function ExposureTool({ exposure, error }: { exposure: Exposure | null; error: unknown }) {
  const { t, f } = useT();
  const { org, refs } = useOrg();
  const exportCsv = () => exposure && downloadCsv(`firesight_exposure_${fileSafe(org.name)}.csv`, [
    ['site', 'grid', 'lat', 'lon', 'radius_km', 'value', 'avg_cell_days_per_year', 'worst_year', 'worst_year_cell_days', 'years_with_fire', 'years_on_record', 'critical_period', 'peak_danger_this_week', 'peak_danger_date', 'status', 'score', 'at_risk_this_week'],
    ...exposure.sites.map((r) => [
      r.site.name, refs.get(r.site.id), r.site.lat, r.site.lon, r.site.radiusKm, r.site.value, r.averagePerYear, r.worstYear?.year, r.worstYear?.value,
      r.yearsWithFire, r.yearsOnRecord, r.history.criticalPeriod ? periodName(f, r.history.criticalPeriod.startMonth, r.history.criticalPeriod.months) : null,
      r.peakDanger?.level, r.peakDanger?.date, r.status, r.score, r.atRisk ? 'yes' : 'no',
    ]),
  ]);
  return (
    <section className="lens" aria-labelledby="tool-h">
      <PageHead title={<span id="tool-h">{t.exposure.title}</span>} sub={<Sub />}>
        <button type="button" className="btn btn-quiet no-print" disabled={!exposure} onClick={exportCsv}><Icon name="download" size={16} />{t.common.csv}</button>
        <PrintButton />
      </PageHead>
      {error ? <Notice tone="error">{errorText(t, error)}</Notice> : null}
      {!exposure && !error && <><p className="fine" role="status">{t.exposure.reading}</p><SkeletonRows rows={5} /></>}
      {exposure && (
        <>
          <dl className="tiles tiles-wide">
            <div><dt>{t.exposure.tiles.total}</dt><dd className="num">{f.compact(exposure.totalValue)}</dd><small>{t.exposure.sitesN(exposure.sites.length)}</small></div>
            <div><dt>{t.exposure.tiles.atRisk}</dt><dd className="num" data-hot={exposure.valueAtRisk > 0 || undefined}>{f.compact(exposure.valueAtRisk)}</dd><small>{exposure.totalValue > 0 ? t.exposure.share(Math.round((exposure.valueAtRisk / exposure.totalValue) * 100)) : t.exposure.addValues}</small></div>
            <div><dt>{t.exposure.tiles.sites}</dt><dd className="num">{exposure.sitesAtRisk} <span className="of">{t.exposure.of(exposure.sites.length)}</span></dd><small>{t.exposure.riskHint}</small></div>
          </dl>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t.exposure.cols.site}</th>
                  <th scope="col" className="num">{t.exposure.cols.value}</th>
                  <th scope="col" className="num">{t.exposure.cols.perYear}</th>
                  <th scope="col">{t.exposure.cols.worst}</th>
                  <th scope="col" className="num">{t.exposure.cols.years}</th>
                  <th scope="col">{t.exposure.cols.critical}</th>
                  <th scope="col">{t.exposure.cols.peak}</th>
                  <th scope="col">{t.exposure.cols.now}</th>
                </tr>
              </thead>
              <tbody>
                {exposure.sites.map((r) => {
                  const cp = r.history.criticalPeriod;
                  return (
                    <tr key={r.site.id}>
                      <th scope="row"><SiteLink id={r.site.id} name={r.site.name} gridRef={refs.get(r.site.id)} /></th>
                      <td className="num">{r.site.value === null ? '–' : f.compact(r.site.value)}</td>
                      <td className="num">{f.one(r.averagePerYear)}</td>
                      <td>{r.worstYear ? <><span className="num">{r.worstYear.year}</span> <span className="muted num">({f.int(r.worstYear.value)})</span></> : '–'}</td>
                      <td className="num">{r.yearsWithFire}<span className="muted"> / {r.yearsOnRecord}</span></td>
                      <td>{cp ? periodName(f, cp.startMonth, cp.months) : '–'}</td>
                      <td>{r.peakDanger ? <><span className="level" data-level={r.peakDanger.level}>{t.level[r.peakDanger.level]}</span> <span className="muted">{f.weekdayShort(r.peakDanger.date)}</span></> : <span className="muted">{t.briefing.noForecast}</span>}</td>
                      <td><StatusTag status={r.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="fine">{t.exposure.note}</p>
          <p className="fine"><Icon name="info" size={14} /> {t.claim.lede} <Link to={exposure.sites[0] ? `/app/sites/${exposure.sites[0].site.id}#claim-h` : '/app/sites'}>{t.claim.title}</Link></p>
        </>
      )}
    </section>
  );
}

// ---------- Companies ----------
function Planner({ board }: { board: Board }) {
  const { t, f } = useT();
  const { refs } = useOrg();
  const dates = board.sites.find((s) => s.danger?.length)?.danger?.slice(0, 7).map((d) => d.date) ?? [];
  return (
    <section className="lens" aria-labelledby="tool-h">
      <PageHead title={<span id="tool-h">{t.planner.title}</span>} sub={<Sub />}><PrintButton /></PageHead>
      <p className="lede">{t.planner.lede}</p>
      {dates.length === 0 ? <Notice tone="warn">{t.planner.unavailable}</Notice> : (
        <div className="table-wrap">
          <table className="table planner">
            <thead>
              <tr>
                <th scope="col">{t.exposure.cols.site}</th>
                {dates.map((d) => <th key={d} scope="col">{f.weekdayShort(d)}<small className="num">{f.dayMonth(d)}</small></th>)}
                <th scope="col">{t.planner.best}</th>
              </tr>
            </thead>
            <tbody>
              {board.sites.map((s) => {
                const week = (s.danger ?? []).slice(0, 7);
                const best = week.filter((d) => d.work.advice === 'go').sort((a, b) => a.fwi - b.fwi)[0];
                return (
                  <tr key={s.site.id}>
                    <th scope="row">
                      <SiteLink id={s.site.id} name={s.site.name} gridRef={refs.get(s.site.id)} />
                      {s.site.people ? <small className="muted">{t.planner.people(f.int(s.site.people))}</small> : null}
                    </th>
                    {week.map((d) => (
                      <td key={d.date} data-advice={d.work.advice} title={`${t.level[d.level]} · ${Math.round(d.windKmh)} km/h · ${d.humidity}% · ${Math.round(d.tempC)}°C`}>
                        <b>{t.advice[d.work.advice]}</b>
                        <small>{t.workWhy(d.work.cause, d.work.value)}</small>
                      </td>
                    ))}
                    {week.length === 0 && <td colSpan={dates.length} className="muted">{t.planner.noForecast}</td>}
                    <td>{best ? `${f.weekdayShort(best.date)} ${f.dayMonth(best.date)}` : <span className="muted">{t.planner.noneBest}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="fine">{t.planner.note}</p>
    </section>
  );
}

// ---------- NGOs and municipalities ----------
function Impact({ exposure, error }: { exposure: Exposure | null; error: unknown }) {
  const { t, f } = useT();
  const { org, refs } = useOrg();
  const exportCsv = () => {
    if (!exposure || exposure.sites.length === 0) return;
    const years = exposure.sites[0].history.years.map((y) => y.year);
    downloadCsv(`firesight_impact_${fileSafe(org.name)}.csv`, [
      ['site', 'project_started', ...years],
      ...exposure.sites.map((r) => [r.site.name, r.site.startedYear, ...r.history.years.map((y) => y.value)]),
    ]);
  };
  return (
    <section className="lens" aria-labelledby="tool-h">
      <PageHead title={<span id="tool-h">{t.impact.title}</span>} sub={<Sub />}>
        <button type="button" className="btn btn-quiet no-print" disabled={!exposure} onClick={exportCsv}><Icon name="download" size={16} />{t.common.csv}</button>
        <PrintButton />
      </PageHead>
      <p className="lede">{t.impact.lede}</p>
      {error ? <Notice tone="error">{errorText(t, error)}</Notice> : null}
      {!exposure && !error && <><p className="fine" role="status">{t.exposure.reading}</p><SkeletonRows rows={5} /></>}
      <div className="impact-grid">
        {exposure?.sites.map((r) => {
          const h = r.history;
          const p = h.project;
          const cp = h.criticalPeriod;
          const pct = p?.change == null ? null : Math.round(p.change * 100);
          return (
            <article key={r.site.id} className="impact">
              <header>
                <h3><SiteLink id={r.site.id} name={r.site.name} gridRef={refs.get(r.site.id)} /></h3>
                <StatusTag status={r.status} />
              </header>
              <YearBars history={h} compact />
              {p ? (
                <p className="impact-change">
                  <strong className="num" data-dir={pct === null ? undefined : pct < 0 ? 'down' : 'up'}>{pct === null ? t.impact.noBefore : `${pct > 0 ? '+' : ''}${f.int(pct)}%`}</strong>
                  {' '}{t.impact.change(String(pct), p.startedYear, f.one(p.after.averagePerYear), p.after.years, f.one(p.before.averagePerYear), p.before.years)}
                </p>
              ) : <p className="fine">{r.site.startedYear ? t.impact.needYears : t.impact.addYear}</p>}
              <dl className="facts">
                <dt>{t.impact.average}</dt><dd>{t.impact.averageText(f.one(h.averagePerYear), h.yearsWithFire, h.yearsOnRecord)}</dd>
                <dt>{t.site.worst}</dt><dd>{h.worstYear ? <><span className="num">{h.worstYear.year}</span> ({f.int(h.worstYear.value)})</> : '–'}</dd>
                <dt>{t.impact.critical}</dt><dd>{cp ? `${periodName(f, cp.startMonth, cp.months)}: ${cp.inPeriod ? t.impact.underWay : t.impact.startsIn(cp.startsInDays)}` : t.impact.noSeason}</dd>
              </dl>
            </article>
          );
        })}
      </div>
      <p className="fine">{t.impact.note}</p>
    </section>
  );
}
