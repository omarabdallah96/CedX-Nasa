// The morning view: the survey map beside the ranked board (the map's
// gazetteer), the counts that matter and this morning's digest.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { BoardSite, Status } from '../../lib/api.ts';
import { errorText, useT } from '../../lib/i18n.ts';
import { useOrg } from '../../lib/session.tsx';
import { useHotspots, useReorderMotion, useUnseenChanges } from '../../ui/hooks.ts';
import { Icon } from '../../ui/icons.tsx';
import { DangerStrip, Empty, Notice, SkeletonRows, StatusGlyph, WhyText } from '../../ui/parts.tsx';
import { SurveyMap } from '../../ui/SurveyMap.tsx';

function Headline({ act, watch, total }: { act: number; watch: number; total: number }) {
  const { t } = useT();
  return <h1 className="headline">{act > 0 ? t.overview.act(act) : watch > 0 ? t.overview.watch(watch) : t.overview.allOk(total)}</h1>;
}

export function Overview() {
  const { t, f } = useT();
  const { org, board, boardError, reloadBoard, grid, refs, notifications } = useOrg();
  const navigate = useNavigate();
  const [hover, setHover] = useState<string | null>(null);
  const [only, setOnly] = useState<Status | null>(null);
  const sites = useMemo(() => board?.sites.map((s) => s.site) ?? org.sites, [board, org.sites]);
  const statuses = useMemo(() => new Map<string, Status>(board?.sites.map((s) => [s.site.id, s.status]) ?? []), [board]);
  const hotspots = useHotspots(sites, board?.generatedAt);
  const { changed, markSeen } = useUnseenChanges(org.id, statuses);
  const rows = (board?.sites ?? []).filter((s) => !only || s.status === only);
  const list = useReorderMotion<HTMLOListElement>(rows.map((r) => r.site.id));
  const digest = notifications.find((n) => n.kind === 'digest');

  if (org.sites.length === 0 && (!board || board.sites.length === 0)) {
    return (
      <div className="overview-empty">
        <Empty icon="sites" title={t.overview.emptyTitle} action={org.role === 'owner' && <Link className="btn" to="/app/sites?add=1"><Icon name="plus" size={16} />{t.overview.addOnMap}</Link>}>
          {org.role === 'owner' ? t.overview.emptyOwner : t.overview.emptyMember(org.name)}
        </Empty>
      </div>
    );
  }

  const enter = (id: string | null) => {
    setHover(id);
    if (id && changed.has(id)) markSeen(id);
  };
  const s = board?.summary;
  return (
    <div className="overview">
      <section className="ov-map">
        <SurveyMap
          sites={sites} status={statuses} grid={grid} hotspots={hotspots} hover={hover} hoverRef={hover ? refs.get(hover) : null}
          onHover={enter} onSelect={(id) => navigate(`/app/sites/${id}`)} country={org.country} label={t.overview.mapLabel}
        />
        {hotspots.length > 0 && <p className="map-caption"><Icon name="fire" size={14} />{t.overview.fires(hotspots.length)}</p>}
      </section>

      <section className="ov-board" aria-labelledby="board-h" aria-busy={!board}>
        {!board && !boardError && <SkeletonRows rows={6} />}
        {!!boardError && !board && <Notice tone="error">{errorText(t, boardError)} <button type="button" className="link" onClick={() => void reloadBoard()}>{t.common.retry}</button></Notice>}
        {board && s && (
          <>
            <Headline act={s.act} watch={s.watch} total={s.sites} />
            <div className="counts" role="group" aria-label={t.sites.filterStatus}>
              {(['act', 'watch', 'ok'] as Status[]).map((k) => (
                <button key={k} type="button" className="count" data-status={k} aria-pressed={only === k} onClick={() => setOnly(only === k ? null : k)}>
                  <StatusGlyph status={k} size={14} />
                  <span>{t.overview.counts[k]}</span>
                  <b className="num">{s[k]}</b>
                </button>
              ))}
            </div>
            {(s.total.value > 0 || s.total.people > 0) && (
              <p className="at-risk" title={t.overview.atRiskHint}>
                <span>{t.overview.atRisk}</span>
                {s.total.value > 0 && <span><b className="num">{f.compact(s.atRisk.value)}</b> / {f.compact(s.total.value)} {t.overview.value}</span>}
                {s.total.people > 0 && <span><b className="num">{f.int(s.atRisk.people)}</b> / {f.int(s.total.people)} {t.overview.people}</span>}
              </p>
            )}
            {board.unavailable.length > 0 && (
              <Notice tone="warn" role="status">
                {board.unavailable.includes('live') && `${t.overview.unavailable.live} `}
                {board.unavailable.includes('forecast') && `${t.overview.unavailable.forecast} `}
                {t.overview.unavailable.both}
              </Notice>
            )}
            <div className="board-head">
              <h2 id="board-h">{t.overview.board}</h2>
              <span className="board-cols" aria-hidden="true"><span>{t.overview.grid}</span><span>{t.overview.days}</span></span>
            </div>
            <ol className="board" ref={list}>
              {rows.map((b) => <Row key={b.site.id} b={b} gridRef={refs.get(b.site.id) ?? ''} hot={hover === b.site.id} changed={changed.has(b.site.id)} onEnter={enter} />)}
            </ol>
            <p className="fine">{t.overview.note}</p>
          </>
        )}
      </section>

      <section className="ov-digest" aria-labelledby="digest-h">
        <h2 id="digest-h"><Icon name="clock" size={16} />{t.overview.digest}</h2>
        {digest ? (
          <>
            <p className="digest-title">{digest.title}</p>
            <ul className="digest-lines">{digest.body.split('\n').map((line, i) => <li key={i}>{line}</li>)}</ul>
            <p className="fine">{f.dateTime(digest.createdAt)}</p>
          </>
        ) : <p className="fine">{t.overview.noDigest}</p>}
      </section>
    </div>
  );
}

function Row({ b, gridRef, hot, changed, onEnter }: { b: BoardSite; gridRef: string; hot: boolean; changed: boolean; onEnter: (id: string | null) => void }) {
  const { t } = useT();
  return (
    <li data-key={b.site.id} data-hot={hot || undefined} data-changed={changed || undefined} data-status={b.status}>
      <Link to={`/app/sites/${b.site.id}`} onMouseEnter={() => onEnter(b.site.id)} onMouseLeave={() => onEnter(null)} onFocus={() => onEnter(b.site.id)} onBlur={() => onEnter(null)}>
        <StatusGlyph status={b.status} size={14} />
        <span className="row-name">
          {b.site.name}
          {changed && <span className="changed-dot" title={t.status[b.status]}><span className="sr-only">{t.status[b.status]}</span></span>}
        </span>
        <span className="ref num">{gridRef}</span>
        <span className="row-score num" aria-label={`${t.site.score} ${b.score}`}>{b.score}</span>
        <span className="row-why">{b.why[0] ? <WhyText why={b.why[0]} /> : b.reasons[0]}{b.why.length > 1 && <span className="more"> +{b.why.length - 1}</span>}</span>
        {b.danger && b.danger.length > 0 && <DangerStrip days={b.danger.slice(0, 7)} compact />}
      </Link>
    </li>
  );
}
