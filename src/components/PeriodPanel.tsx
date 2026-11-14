import { useEffect, useState } from 'react';
import type { RangeSummary } from '../lib/analysis.ts';
import { useI18n } from '../i18n/index.tsx';
import { dayIndex, FIRST_DAY, isoDate, parseIsoDate } from '../lib/time.ts';
import type { Selection } from './FireRings.tsx';

export interface Period {
  from: number;
  to: number;
}

interface Props {
  /** The period in use. */
  period: Period;
  /** Null while the period simply follows the selected month. */
  custom: Period | null;
  sel: Selection;
  lastDay: number;
  summary: RangeSummary;
  onChange: (p: Period | null) => void;
}

export function monthPeriod(sel: Selection, lastDay: number): Period {
  return {
    from: Math.max(FIRST_DAY, dayIndex(sel.year, sel.month + 1, 1)),
    to: Math.min(lastDay, dayIndex(sel.year, sel.month + 2, 1) - 1),
  };
}

const same = (a: Period, b: Period) => a.from === b.from && a.to === b.to;

/** From–to dates for the map, the summary line and the downloads. */
export function PeriodPanel({ period, custom, sel, lastDay, summary, onChange }: Props) {
  const { t } = useI18n();
  const [text, setText] = useState([isoDate(period.from), isoDate(period.to)]);
  const [error, setError] = useState<'both' | 'order' | 'range' | null>(null);
  useEffect(() => {
    setText([isoDate(period.from), isoDate(period.to)]);
    setError(null);
  }, [period.from, period.to]);

  const month = monthPeriod(sel, lastDay);
  const presets: { label: string; range: Period }[] = [
    { label: t.monthYear(sel.month, sel.year), range: month },
    { label: t.period.allOf(sel.year), range: { from: Math.max(FIRST_DAY, dayIndex(sel.year, 1, 1)), to: Math.min(lastDay, dayIndex(sel.year + 1, 1, 1) - 1) } },
    { label: t.period.last7, range: { from: lastDay - 6, to: lastDay } },
    { label: t.period.last30, range: { from: lastDay - 29, to: lastDay } },
    { label: t.period.whole, range: { from: FIRST_DAY, to: lastDay } },
  ];

  const edit = (i: number, value: string) => {
    const next = text.map((t, k) => (k === i ? value : t));
    setText(next);
    const from = parseIsoDate(next[0]);
    const to = parseIsoDate(next[1]);
    if (Number.isNaN(from) || Number.isNaN(to)) return setError('both');
    if (from > to) return setError('order');
    if (to < FIRST_DAY || from > lastDay) return setError('range');
    setError(null);
    const p = { from: Math.max(FIRST_DAY, from), to: Math.min(lastDay, to) };
    onChange(same(p, month) ? null : p);
  };

  const detections = summary.detections.modis + summary.detections.viirs;

  return (
    <fieldset className="period">
      <legend>{t.period.title}</legend>
      <div className="period-inputs">
        {[t.period.from, t.period.to].map((label, i) => (
          <label key={i}>
            <span>{label}</span>
            <input
              type="date"
              value={text[i]}
              min={isoDate(FIRST_DAY)}
              max={isoDate(lastDay)}
              aria-invalid={error ? true : undefined}
              aria-describedby="period-status"
              onChange={(e) => edit(i, e.target.value)}
            />
          </label>
        ))}
      </div>
      <div className="chips" role="group" aria-label={t.period.quickAria}>
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            aria-pressed={same(p.range, period)}
            onClick={() => onChange(same(p.range, month) ? null : p.range)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {error ? (
        <p id="period-status" className="form-error" role="alert">
          {error === 'both' ? t.period.errBoth : error === 'order' ? t.period.errOrder : t.period.errRange(isoDate(FIRST_DAY), isoDate(lastDay))}
        </p>
      ) : (
        <p id="period-status" className="period-sum" role="status">
          <strong>{t.rangeName(period.from, period.to)}</strong>{' '}
          <span>{t.period.summary(detections, summary.harmonized, t.period.compare(summary.verdict), !custom)}</span>
        </p>
      )}
    </fieldset>
  );
}
