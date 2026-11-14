import type { Analysis, RangeSummary } from '../lib/analysis.ts';
import { fmtCount, fmtRatio, ordinal } from '../lib/format.ts';
import { longDate, spanName, type Calendar } from '../lib/time.ts';

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
  const v = week.verdict;
  const dates = spanName(week.from, week.to);
  const carrier = week.sourceDays.noaa20 > 0
    ? `VIIRS on NOAA-20${week.sourceDays.viirs > 0 ? ' and Suomi-NPP' : ''}`
    : week.sourceDays.viirs > 0
      ? 'VIIRS on Suomi-NPP'
      : 'MODIS, converted';
  let line: string;
  if (!v) line = 'Not enough history to compare these dates.';
  else if (v.level === 'quiet') line = 'No fire detected, as usual for these dates.';
  else if (v.ratio === null) line = `These dates usually see none. ${ordinal(v.rank)} most active of ${v.nYears} years.`;
  else {
    const versus = v.ratio >= 1.05
      ? `${fmtRatio(v.ratio)} the usual for these dates`
      : v.ratio <= 0.95
        ? `${Math.round(v.ratio * 100)}% of the usual for these dates`
        : 'level with the usual for these dates';
    line = `${versus}; ${ordinal(v.rank)} most active of ${v.nYears} years.`;
  }
  return (
    <section className="now" aria-labelledby="now-h">
      <div className="now-head">
        <h2 id="now-h">The last 7 days <small>{dates} {cal.year[week.to]}</small></h2>
        <span className="now-live" data-live={live || undefined}>
          <i aria-hidden="true" /> {live ? 'Live feed' : 'Bundled copy'}
        </span>
      </div>
      <p className="now-figure">
        <strong>{fmtCount(week.harmonized)}</strong> cell-days
        {v && <span className="verdict-badge" data-level={v.level}><span aria-hidden="true">{ICON[v.level]}</span> {v.level === 'quiet' ? 'Quiet' : v.ratio === null ? 'Unusual' : v.ratio >= 1.05 ? `${fmtRatio(v.ratio)} usual` : v.ratio <= 0.95 ? `${Math.round(v.ratio * 100)}% of usual` : 'As usual'}</span>}
      </p>
      <p className="now-line">{line}</p>
      <p className="note">
        Carried by {carrier}{analysis.filters.bbox ? ', in the selected area' : ''}. Data through {longDate(cal.nDays - 1)}; the newest days are near-real-time and can still be revised.
      </p>
      <button type="button" className="btn btn-quiet" aria-pressed={shown} onClick={onShow}>
        {shown ? 'Showing these 7 days on the map' : 'Show these 7 days on the map'}
      </button>
    </section>
  );
}
