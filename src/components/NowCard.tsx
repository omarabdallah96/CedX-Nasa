import type { Analysis, RangeSummary } from '../lib/analysis.ts';
import { useI18n } from '../i18n/index.tsx';
import { fmtCount } from '../lib/format.ts';
import type { Calendar } from '../lib/time.ts';

interface Props {
  analysis: Analysis;
  cal: Calendar;
  week: RangeSummary;
  /** Whether the data comes from the backend (kept current) or the bundled copy. */
  live: boolean;
  /** True while the map shows these seven days. */
  shown: boolean;
  onShow: () => void;
}

const ICON = { record: '▲▲', 'far-above': '▲▲', above: '▲', typical: '●', below: '▼', 'far-below': '▼▼', quiet: '●' };

/** The last seven days of the record against the same dates in every other year. */
export function NowCard({ analysis, cal, week, live, shown, onShow }: Props) {
  const { t } = useI18n();
  const v = week.verdict;
  const dates = t.spanName(week.from, week.to);
  return (
    <section className="now" aria-labelledby="now-h">
      <div className="now-head">
        <h2 id="now-h" className="side-h">{t.now.title} <small>{dates} {cal.year[week.to]}</small></h2>
        <span className="now-live" data-live={live || undefined}>
          <i aria-hidden="true" /> {live ? t.now.live : t.now.bundled}
        </span>
      </div>
      <p className="now-figure">
        <strong>{fmtCount(week.harmonized)}</strong> {t.now.unit}
        {v && <span className="verdict-badge" data-level={v.level}><span aria-hidden="true">{ICON[v.level]}</span> {t.now.badge(v)}</span>}
      </p>
      <p className="now-line">{t.now.line(v)}</p>
      <dl className="facts">
        <dt>{t.facts.satellite}</dt>
        <dd>{t.now.carrier(week.sourceDays)}{analysis.filters.bbox && t.now.areaOnly}</dd>
        <dt>{t.facts.upTo}</dt>
        <dd>{t.longDate(cal.nDays - 1)}. {t.now.revised}</dd>
      </dl>
      <button type="button" className="btn btn-quiet" aria-pressed={shown} onClick={onShow}>
        {shown ? t.now.showing : t.now.show}
      </button>
    </section>
  );
}
