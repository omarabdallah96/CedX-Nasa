import { selectionVerdict, type Analysis } from '../lib/analysis.ts';
import { useI18n } from '../i18n/index.tsx';
import { fmtCount } from '../lib/format.ts';
import { yearVerdict, type Level } from '../lib/stats.ts';
import { FIRST_DAY, type Calendar } from '../lib/time.ts';
import type { Selection } from './FireRings.tsx';

const ICON: Record<Level, string> = {
  record: '▲▲', 'far-above': '▲▲', above: '▲', typical: '●', below: '▼', 'far-below': '▼▼', quiet: '●',
};

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
  const { t } = useI18n();
  const pv = selectionVerdict(analysis, cal, sel.year, sel.month);
  const v = pv?.verdict ?? null;
  // An unfinished month is judged over the days it has so far.
  const partial = pv?.partialDays ?? null;
  const wording = pv ? t.monthWording(pv, sel.year, sel.month) : null;
  const y = yearVerdict(analysis.monthsH, sel.year);
  const sc = shortcuts(analysis, cal);
  const monthName = t.monthsLong[sel.month];
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
  const source = t.sourceText(analysis, cal, sel.year, sel.month);
  const is = (a: Selection) => a.year === sel.year && a.month === sel.month;

  return (
    <section className="verdict" aria-labelledby="verdict-q">
      <div className="verdict-pick">
        <button type="button" className="icon-btn" onClick={() => go(index - 1)} disabled={index <= minIndex} aria-label={t.verdict.prevMonth}>‹</button>
        <label className="sr-only" htmlFor="pick-month">{t.verdict.month}</label>
        <select id="pick-month" value={sel.month} onChange={(e) => go(Math.max(minIndex, Math.min(maxIndex, sel.year * 12 + Number(e.target.value))))}>
          {t.monthsLong.map((m, i) => <option key={m} value={i}>{m}</option>)}
        </select>
        <label className="sr-only" htmlFor="pick-year">{t.verdict.year}</label>
        <select id="pick-year" value={sel.year} onChange={(e) => go(Math.max(minIndex, Math.min(maxIndex, Number(e.target.value) * 12 + sel.month)))}>
          {years.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
        </select>
        <button type="button" className="icon-btn" onClick={() => go(index + 1)} disabled={index >= maxIndex} aria-label={t.verdict.nextMonth}>›</button>
      </div>

      <p id="verdict-q" className="eyebrow">{t.verdict.question(monthName, sel.year, !!partial, place)}</p>
      {v && wording ? (
        <>
          <h2 className="verdict-answer" data-level={v.level}>{t.answer[v.level]}</h2>
          <p className="verdict-badge" data-level={v.level}>
            <span aria-hidden="true">{ICON[v.level]}</span> {t.verdict.badge(v, wording.usual)}
          </p>
          <p className="verdict-text">{t.verdictSentence(v, wording.what, wording.usual, place)}</p>
          <dl className="tiles">
            <div>
              <dt>{partial ? t.verdict.firstDays(partial) : t.verdict.thisMonth}</dt>
              <dd>{fmtCount(v.value)}</dd>
              {hi - lo > 0.5 && <small>{t.verdict.likely(lo, hi)}</small>}
            </div>
            <div>
              <dt>{partial ? t.verdict.usualByDay(partial) : t.verdict.usualMonth(monthName)}</dt>
              <dd>{fmtCount(v.median)}</dd>
              <small>{t.verdict.median(v.firstYear, v.lastYear)}</small>
            </div>
            <div>
              <dt>{t.verdict.rankLabel}</dt>
              <dd>{t.verdict.rank(v.rank)}<span className="of">{t.verdict.rankOf(v.nYears)}</span></dd>
              <small>{t.verdict.rankNote}</small>
            </div>
          </dl>
          <p className="verdict-foot">
            <span className="src-dot" data-src={source.key} aria-hidden="true" />
            {t.verdict.source(source.text)}
            {y && t.verdict.wholeYear(sel.year, y.ratio, y.rank, y.nYears)}
          </p>
        </>
      ) : (
        <p className="verdict-text">{t.verdict.noCoverage}</p>
      )}

      <div className="chips" role="group" aria-label={t.verdict.jumpAria}>
        <button type="button" aria-pressed={is(sc.latestPeak)} onClick={() => onSelect(sc.latestPeak)}>{t.verdict.latestPeak}</button>
        <button type="button" aria-pressed={is(sc.mostActive)} onClick={() => onSelect(sc.mostActive)}>{t.verdict.mostActive}</button>
        <button type="button" aria-pressed={is(sc.latest)} onClick={() => onSelect(sc.latest)}>{t.verdict.latest}</button>
      </div>
      <p className="note">{t.verdict.note(t.longDate(cal.nDays - 1))}</p>
    </section>
  );
}
