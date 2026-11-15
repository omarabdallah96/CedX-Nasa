// One site: why it has its score, the week ahead, 25 years of history, what
// satellites and people see now, and the claim check.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { API, api, type Evidence, type SiteReport, type Status } from '../../lib/api.ts';
import { downloadCsv, fileSafe } from '../../lib/csv.ts';
import { coords } from '../../lib/grid.ts';
import { errorText, periodName, useT } from '../../lib/i18n.ts';
import { useOrg } from '../../lib/session.tsx';
import { useHotspots } from '../../ui/hooks.ts';
import { Icon } from '../../ui/icons.tsx';
import { DangerStrip, Notice, SkeletonRows, StatusTag, WhyText, YearBars } from '../../ui/parts.tsx';
import { SurveyMap } from '../../ui/SurveyMap.tsx';

export function SitePage() {
  const { siteId = '' } = useParams();
  const { t, f } = useT();
  const { org, board, grid, refs } = useOrg();
  const navigate = useNavigate();
  const [report, setReport] = useState<SiteReport | null>(null);
  const [error, setError] = useState<unknown>(null);
  const site = org.sites.find((s) => s.id === siteId);

  useEffect(() => {
    if (!site) return;
    let alive = true;
    setReport(null);
    setError(null);
    api<SiteReport>('GET', `/orgs/${org.id}/sites/${siteId}/report`).then((r) => alive && setReport(r), (err) => alive && setError(err));
    return () => {
      alive = false;
    };
  }, [org.id, siteId, site, board?.generatedAt]);

  const statuses = useMemo(() => new Map<string, Status>(board?.sites.map((s) => [s.site.id, s.status]) ?? []), [board]);
  const hotspots = useHotspots(org.sites, board?.generatedAt);

  if (!site) {
    return (
      <div className="site-page">
        <Link className="back" to="/app/sites"><Icon name="back" size={16} />{t.site.back}</Link>
        <Notice tone="warn">{t.site.notFound}</Notice>
      </div>
    );
  }

  const h = report?.history;
  const week = (report?.danger ?? []).slice(0, 7);
  const today = week[0];
  const cp = h?.criticalPeriod;
  return (
    <div className="site-page">
      <Link className="back" to="/app"><Icon name="back" size={16} />{t.site.back}</Link>
      <header className="site-head">
        <div>
          <h1>{site.name}</h1>
          <p className="site-meta">
            <span className="ref num">{refs.get(site.id)}</span>
            <span className="num">{coords(site.lat, site.lon)}</span>
            <span>{t.site.radius} <span className="num">{f.one(site.radiusKm)}</span> km</span>
          </p>
        </div>
        <div className="site-head-end">
          {report && <StatusTag status={report.status} score={report.score} />}
          {org.role === 'owner' && <Link className="btn" to={`/app/alerts?site=${site.id}`}><Icon name="alerts" size={16} />{t.site.alert}</Link>}
        </div>
      </header>

      <div className="site-grid">
        <div className="site-main">
          {error ? <Notice tone="error">{errorText(t, error)}</Notice> : null}
          {!report && !error && <SkeletonRows rows={8} />}
          {report && h && (
            <>
              <section className="panel" aria-labelledby="why-h">
                <h2 id="why-h">{t.site.why}</h2>
                <ul className="reasons">{report.why.map((w, i) => <li key={i}><WhyText why={w} /></li>)}</ul>
                <dl className="tiles">
                  <div><dt>{t.site.firesNow}</dt><dd className="num" data-hot={(report.fires?.inside ?? 0) > 0 || undefined}>{report.fires ? report.fires.inside : '–'}</dd><small>{t.site.last48}</small></div>
                  <div><dt>{t.site.perYear}</dt><dd className="num">{f.one(h.averagePerYear)}</dd><small>{t.site.yearsWith(h.yearsWithFire, h.yearsOnRecord)}</small></div>
                  <div><dt>{t.site.worst}</dt><dd className="num">{h.worstYear?.year ?? '–'}</dd><small>{h.worstYear ? t.site.cellDays(f.int(h.worstYear.value)) : ''}</small></div>
                </dl>
              </section>

              {week.length > 0 && (
                <section className="panel" aria-labelledby="week-h">
                  <h2 id="week-h">{t.site.week}</h2>
                  <DangerStrip days={week} labels />
                  {today && (
                    <p className="fine">
                      {t.site.today(t.level[today.level], Math.round(today.tempC), Math.round(today.windKmh), today.humidity)}{' '}
                      {t.site.hotWork} <strong className="advice" data-advice={today.work.advice}>{t.advice[today.work.advice]}</strong> ({t.workWhy(today.work.cause, today.work.value)}).
                    </p>
                  )}
                </section>
              )}

              <section className="panel" aria-labelledby="hist-h">
                <h2 id="hist-h">{t.site.history}</h2>
                <YearBars history={h} />
                {cp && (
                  <p className="fine">
                    {t.site.critical(periodName(f, cp.startMonth, cp.months), Math.round(cp.share * 100))}{' '}
                    {cp.inPeriod ? t.site.underWay : t.site.startsIn(cp.startsInDays)}
                  </p>
                )}
              </section>

              <ClaimCheck orgId={org.id} siteId={site.id} siteName={site.name} />
            </>
          )}
        </div>

        <aside className="site-side">
          <div className="site-map">
            <SurveyMap
              sites={org.sites} status={statuses} grid={grid} hotspots={hotspots} hover={null} focus={site.id} hoverRef={refs.get(site.id)}
              onHover={() => {}} onSelect={(id) => navigate(`/app/sites/${id}`)} country={org.country} label={t.overview.mapLabel}
            />
          </div>
          {report && report.hotspots.length > 0 && (
            <section className="panel" aria-labelledby="near-h">
              <h2 id="near-h"><Icon name="satellite" size={16} />{t.site.nearby}</h2>
              <ul className="rows">
                {report.hotspots.slice(0, 8).map((x, i) => (
                  <li key={i}>
                    <span>{x.inside ? <strong className="hot">{t.site.inside}</strong> : t.site.ofCentre(f.one(x.km), t.compass[x.compass] ?? x.compass)}</span>
                    <span className="muted">{f.ago(x.acquiredAt)} · {x.sensor.replace(/_/g, ' ')}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {report && report.groundReports.length > 0 && (
            <section className="panel" aria-labelledby="ground-h">
              <h2 id="ground-h">{t.site.ground}</h2>
              <ul className="ground">
                {report.groundReports.slice(0, 8).map((g) => {
                  const label = t.site.label[g.label] ?? g.label;
                  return (
                    <li key={g.id}>
                      {g.hasPhoto && <img src={`${API}/reports/${g.id}/photo`} alt={t.site.photoAlt(label)} loading="lazy" width={64} height={64} />}
                      <div>
                        <strong>{label}</strong>
                        <span className="muted">{f.dateTime(g.createdAt)}{g.bearing !== null ? ` · ${t.site.pointed(Math.round(g.bearing))}` : ''}</span>
                        {g.note && <p>{g.note}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function ClaimCheck({ orgId, siteId, siteName }: { orgId: string; siteId: string; siteName: string }) {
  const { t, f } = useT();
  const [date, setDate] = useState('');
  const [days, setDays] = useState(3);
  const [km, setKm] = useState(5);
  const [result, setResult] = useState<Evidence | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await api<Evidence>('GET', `/orgs/${orgId}/sites/${siteId}/evidence?date=${date}&days=${days}&km=${km}`));
    } catch (err) {
      setResult(null);
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };
  const where = result ? (result.withinKm === 0 ? t.claim.whereInside : t.claim.whereWithin(result.withinKm)) : '';
  const s = result?.window.searched;
  const summary = !result ? '' : !s
    ? t.claim.outside(f.date(result.window.from), f.date(result.window.to))
    : result.found
      ? t.claim.summaryFound(result.fireDays.length, result.detectionsTotal, result.detections.filter((d) => d.inside).length, where, f.dayMonth(s.from), f.dayMonth(s.to))
      : t.claim.summaryNone(where, f.dayMonth(s.from), f.dayMonth(s.to));
  const exportCsv = () => result && downloadCsv(`firesight_claim_${fileSafe(siteName)}_${result.date}.csv`, [
    ['date', 'time_utc', 'latitude', 'longitude', 'km_from_site_centre', 'inside_site', 'instrument', 'satellite', 'confidence', 'frp_mw'],
    ...result.detections.map((d) => [d.date, d.timeUtc, d.lat, d.lon, d.km, d.inside ? 'yes' : 'no', d.instrument, d.satellite, d.confidence, d.frp]),
  ]);

  return (
    <section className="panel" aria-labelledby="claim-h">
      <h2 id="claim-h">{t.claim.title}</h2>
      <p className="fine">{t.claim.lede}</p>
      <form className="inline-form" onSubmit={submit}>
        <label className="field">{t.claim.date}<input type="date" required min="2000-11-01" max={new Date().toISOString().slice(0, 10)} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field">{t.claim.days}<input type="number" min={0} max={30} required value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
        <label className="field">{t.claim.km}<input type="number" min={0} max={50} required value={km} onChange={(e) => setKm(Number(e.target.value))} /></label>
        <button type="submit" className="btn" disabled={busy}>{busy ? t.claim.checking : t.claim.check}</button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
      {result && (
        <div className="claim-result" aria-live="polite">
          <div className="verdict" data-found={result.found || undefined}>
            <strong><Icon name={result.found ? 'fire' : 'check'} size={18} />{result.found ? t.claim.found : t.claim.notFound}</strong>
            <p>{summary}</p>
          </div>
          <p className="fine">{t.claim.caveat}</p>
          {result.detections.length > 0 && (
            <>
              <div className="table-head">
                <button type="button" className="btn btn-quiet" onClick={exportCsv}><Icon name="download" size={16} />{t.claim.csv}</button>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t.claim.cols.date}</th><th scope="col">{t.claim.cols.time}</th><th scope="col" className="num">{t.claim.cols.dist}</th>
                      <th scope="col">{t.claim.cols.where}</th><th scope="col">{t.claim.cols.sensor}</th><th scope="col">{t.claim.cols.conf}</th><th scope="col" className="num">{t.claim.cols.frp}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.detections.slice(0, 15).map((d, i) => (
                      <tr key={i}>
                        <td className="num">{d.date}</td><td className="num">{d.timeUtc}</td>
                        <td className="num">{f.one(d.km)} km {t.compass[d.compass] ?? d.compass}</td>
                        <td>{d.inside ? <strong className="hot">{t.site.inside}</strong> : t.claim.outsideSite}</td>
                        <td>{d.instrument} · {d.satellite}</td><td>{t.claim.confidence[d.confidence] ?? d.confidence}</td><td className="num">{f.one(d.frp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.detectionsTotal > 15 && <p className="fine">{t.claim.closest(15)}</p>}
            </>
          )}
          {result.groundReports.length > 0 && <p className="fine">{t.claim.ground(result.groundReports.length)}</p>}
        </div>
      )}
    </section>
  );
}
