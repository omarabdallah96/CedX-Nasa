import { useMemo } from 'react';
import type { Analysis } from '../lib/analysis.ts';
import { fmtCount } from '../lib/format.ts';
import { records } from '../lib/stats.ts';
import { useI18n } from '../i18n/index.tsx';
import type { Selection } from './FireRings.tsx';

interface Props {
  analysis: Analysis;
  sel: Selection;
  onSelect: (s: Selection) => void;
}

/** The most active years and months of the harmonized record. */
export function Records({ analysis, sel, onSelect }: Props) {
  const { t } = useI18n();
  const r = useMemo(() => records(analysis.monthsH, 5), [analysis]);
  if (r.years.length === 0 || r.months[0]?.value === 0) return null;

  // A year is opened on its busiest month.
  const busiest = (year: number): number => {
    const row = analysis.monthsH.values[analysis.monthsH.years.indexOf(year)];
    let best = 0;
    row.forEach((v, m) => {
      if (!Number.isNaN(v) && v > (Number.isNaN(row[best]) ? -1 : row[best])) best = m;
    });
    return best;
  };
  const topYear = r.years[0].total;
  const topMonth = r.months[0].value;

  return (
    <div className="records">
      <div>
        <h3 id="rec-years">{t.records.years}</h3>
        <ol aria-labelledby="rec-years">
          {r.years.map((y, i) => {
            const m = busiest(y.year);
            return (
              <li key={y.year}>
                <button type="button" aria-pressed={sel.year === y.year && sel.month === m} onClick={() => onSelect({ year: y.year, month: m })}>
                  <span className="rec-rank">{i + 1}</span>
                  <span className="rec-name">{y.year} <small>{t.records.peakIn(t.monthsLong[m])}</small></span>
                  <span className="rec-bar"><i style={{ width: `${(y.total / topYear) * 100}%` }} /></span>
                  <span className="rec-value">{fmtCount(y.total)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <div>
        <h3 id="rec-months">{t.records.months}</h3>
        <ol aria-labelledby="rec-months">
          {r.months.map((m, i) => (
            <li key={`${m.year}-${m.month}`}>
              <button type="button" aria-pressed={sel.year === m.year && sel.month === m.month} onClick={() => onSelect({ year: m.year, month: m.month })}>
                <span className="rec-rank">{i + 1}</span>
                <span className="rec-name">{t.monthsLong[m.month]} {m.year}</span>
                <span className="rec-bar"><i style={{ width: `${(m.value / topMonth) * 100}%` }} /></span>
                <span className="rec-value">{fmtCount(m.value)}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <p className="note">{t.records.note}</p>
    </div>
  );
}
