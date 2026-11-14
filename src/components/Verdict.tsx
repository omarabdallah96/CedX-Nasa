import { selectionVerdict, type Analysis } from '../lib/analysis.ts';
import { fmtCount, fmtRatio, ordinal } from '../lib/format.ts';
import { ANSWER, monthWording, sourceText, verdictSentence } from '../lib/sentence.ts';
import { yearVerdict, type Level, type Verdict as V } from '../lib/stats.ts';
import { FIRST_DAY, longDate, MONTHS_LONG, type Calendar } from '../lib/time.ts';
import type { Selection } from './FireRings.tsx';

const ICON: Record<Level, string> = {
  record: '▲▲', 'far-above': '▲▲', above: '▲', typical: '●', below: '▼', 'far-below': '▼▼', quiet: '●',
};

/** Short figure for the badge: how the period compares with the usual one. */
function badgeText(v: V, monthName: string): string {
  if (v.ratio === null) return v.value > 0 ? `The usual ${monthName} has no fire` : 'No fire detected';
  if (v.ratio >= 1.05) return `${fmtRatio(v.ratio)} the usual ${monthName}`;
  if (v.ratio <= 0.95) return `${Math.round(v.ratio * 100)}% of the usual ${monthName}`;
  return `Level with the usual ${monthName}`;
}

/** Named selections offered as shortcuts. */
export function shortcuts(a: Analysis, cal: Calendar): { latest: Selection; latestPeak: Selection; mostActive: Selection } {
  const last = cal.nDays - 1;
  const latest = { year: cal.year[last], month: cal.month[last] };
  // Most recent occurrence of the calendar month that is busiest on average.
  let peakMonth = 0;
  a.climate.mean.forEach((v, m) => {
    if (v > a.climate.mean[peakMonth]) peakMonth = m;
  });
  const latestPeak = { year: peakMonth <= latest.month ? latest.year : latest.year - 1, month: peakMonth };
  let mostActive = latest;
  let best = -1;
  a.monthsH.values.forEach((row, yi) => row.forEach((v, m) => {
    if (v > best) {
      best = v;
      mostActive = { year: a.monthsH.years[yi], month: m };
    }
  }));
  return { latest, latestPeak, mostActive };
}

interface Props {
  analysis: Analysis;
  cal: Calendar;
  sel: Selection;
  onSelect: (s: Selection) => void;
  place: string;
}

export function Verdict({ analysis, cal, sel, onSelect, place }: Props) {
  const pv = selectionVerdict(analysis, cal, sel.year, sel.month);
  const v = pv?.verdict ?? null;
  // An unfinished month is judged over the days it has so far.
  const partial = pv?.partialDays ?? null;
  const wording = pv ? monthWording(pv, sel.year, sel.month) : null;
  const y = yearVerdict(analysis.monthsH, sel.year);
  const sc = shortcuts(analysis, cal);
  const monthName = MONTHS_LONG[sel.month];
  const firstYear = cal.year[FIRST_DAY];
  const firstMonth = cal.month[FIRST_DAY];
  const lastYear = sc.latest.year;
  const index = sel.year * 12 + sel.month;
  const minIndex = firstYear * 12 + firstMonth;
  const maxIndex = lastYear * 12 + sc.latest.month;
  const go = (i: number) => onSelect({ year: Math.floor(i / 12), month: i % 12 });
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => lastYear - i);

  const yi = analysis.monthsH.years.indexOf(sel.year);
  const lo = yi >= 0 ? analysis.monthsLo.values[yi][sel.month] : NaN;
  const hi = yi >= 0 ? analysis.monthsHi.values[yi][sel.month] : NaN;
  const source = sourceText(analysis, cal, sel.year, sel.month);
  const is = (a: Selection) => a.year === sel.year && a.month === sel.month;

  return (
    <section className="verdict" aria-labelledby="verdict-q">
      <div className="verdict-pick">
        <button type="button" className="icon-btn" onClick={() => go(index - 1)} disabled={index <= minIndex} aria-label="Previous month">‹</button>
        <label className="sr-only" htmlFor="pick-month">Month</label>
        <select id="pick-month" value={sel.month} onChange={(e) => go(Math.max(minIndex, Math.min(maxIndex, sel.year * 12 + Number(e.target.value))))}>
          {MONTHS_LONG.map((m, i) => <option key={m} value={i}>{m}</option>)}
        </select>
        <label className="sr-only" htmlFor="pick-year">Year</label>
        <select id="pick-year" value={sel.year} onChange={(e) => go(Math.max(minIndex, Math.min(maxIndex, Number(e.target.value) * 12 + sel.month)))}>
          {years.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
        </select>
        <button type="button" className="icon-btn" onClick={() => go(index + 1)} disabled={index >= maxIndex} aria-label="Next month">›</button>
      </div>

      <p id="verdict-q" className="eyebrow">{monthName} {sel.year}{partial ? ' so far' : ''} in {place}: is this normal?</p>
      {v && wording ? (
        <>
          <h2 className="verdict-answer" data-level={v.level}>{ANSWER[v.level]}</h2>
          <p className="verdict-badge" data-level={v.level}>
            <span aria-hidden="true">{ICON[v.level]}</span> {badgeText(v, wording.usual)}
          </p>
          <p className="verdict-text">{verdictSentence(v, wording.what, wording.usual, place)}</p>
          <dl className="tiles">
            <div>
              <dt>{partial ? `First ${partial} days` : 'This month'}</dt>
              <dd>{fmtCount(v.value)}</dd>
              {hi - lo > 0.5 && <small>likely {fmtCount(lo)}–{fmtCount(hi)}</small>}
            </div>
            <div>
              <dt>{partial ? `Usual by day ${partial}` : `Usual ${monthName}`}</dt>
              <dd>{fmtCount(v.median)}</dd>
              <small>median, {v.firstYear}–{v.lastYear}</small>
            </div>
            <div>
              <dt>Rank</dt>
              <dd>{ordinal(v.rank)}<span className="of"> of {v.nYears}</span></dd>
              <small>most active first</small>
            </div>
          </dl>
          <p className="verdict-foot">
            <span className="src-dot" data-src={source.key} aria-hidden="true" />
            Source for this month: {source.text}.
            {y && (
              <>
                {' '}All of {sel.year}: {y.ratio !== null ? `${fmtRatio(y.ratio)} a typical year` : 'no typical year to compare'},
                {' '}{ordinal(y.rank)} of {y.nYears}.
              </>
            )}
          </p>
        </>
      ) : (
        <p className="verdict-text">No satellite coverage for this month. The record starts in November 2000.</p>
      )}

      <div className="chips" role="group" aria-label="Jump to a month">
        <button type="button" aria-pressed={is(sc.latestPeak)} onClick={() => onSelect(sc.latestPeak)}>Latest peak season</button>
        <button type="button" aria-pressed={is(sc.mostActive)} onClick={() => onSelect(sc.mostActive)}>Most active month on record</button>
        <button type="button" aria-pressed={is(sc.latest)} onClick={() => onSelect(sc.latest)}>Latest month in the data</button>
      </div>
      <p className="note">Data runs through {longDate(cal.nDays - 1)}. One cell-day is a ~1 km grid cell with fire on one day, in VIIRS-equivalent units.</p>
    </section>
  );
}
