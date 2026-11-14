import { useEffect, useState } from 'react';
import type { RangeSummary } from '../lib/analysis.ts';
import { fmtCount, fmtRatio, ordinal } from '../lib/format.ts';
import { dayIndex, FIRST_DAY, isoDate, MONTHS, parseIsoDate, rangeName } from '../lib/time.ts';
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
  const [text, setText] = useState([isoDate(period.from), isoDate(period.to)]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText([isoDate(period.from), isoDate(period.to)]);
    setError(null);
  }, [period.from, period.to]);

  const month = monthPeriod(sel, lastDay);
  const presets: { label: string; range: Period }[] = [
    { label: `${MONTHS[sel.month]} ${sel.year}`, range: month },
    { label: `All of ${sel.year}`, range: { from: Math.max(FIRST_DAY, dayIndex(sel.year, 1, 1)), to: Math.min(lastDay, dayIndex(sel.year + 1, 1, 1) - 1) } },
    { label: 'Last 7 days', range: { from: lastDay - 6, to: lastDay } },
    { label: 'Last 30 days', range: { from: lastDay - 29, to: lastDay } },
    { label: 'Whole record', range: { from: FIRST_DAY, to: lastDay } },
  ];

  const edit = (i: number, value: string) => {
    const next = text.map((t, k) => (k === i ? value : t));
    setText(next);
    const from = parseIsoDate(next[0]);
    const to = parseIsoDate(next[1]);
    if (Number.isNaN(from) || Number.isNaN(to)) return setError('Enter both dates.');
    if (from > to) return setError('From must not be after To.');
    if (to < FIRST_DAY || from > lastDay) return setError(`The record runs from ${isoDate(FIRST_DAY)} to ${isoDate(lastDay)}.`);
    setError(null);
    const p = { from: Math.max(FIRST_DAY, from), to: Math.min(lastDay, to) };
    onChange(same(p, month) ? null : p);
  };

  const v = summary.verdict;
  const detections = summary.detections.modis + summary.detections.viirs;
  const compare = !v
    ? ''
    : v.level === 'quiet'
      ? 'quiet, as usual for these dates'
      : v.ratio === null
        ? `these dates usually see none (${ordinal(v.rank)} of ${v.nYears})`
        : `${v.ratio >= 1.05 ? fmtRatio(v.ratio) : v.ratio <= 0.95 ? `${Math.round(v.ratio * 100)}% of` : 'level with'} the usual for these dates (${ordinal(v.rank)} of ${v.nYears})`;

  return (
    <fieldset className="period">
      <legend>Period</legend>
      <div className="period-inputs">
        {(['From', 'To'] as const).map((label, i) => (
          <label key={label}>
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
      <div className="chips" role="group" aria-label="Quick periods">
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
        <p id="period-status" className="form-error" role="alert">{error}</p>
      ) : (
        <p id="period-status" className="period-sum" role="status">
          <strong>{rangeName(period.from, period.to)}</strong>{' '}
          <span>
            {detections.toLocaleString('en-US')} detections · {fmtCount(summary.harmonized)} cell-days{compare ? ` · ${compare}` : ''}
            {custom ? '' : ' · follows the selected month'}
          </span>
        </p>
      )}
    </fieldset>
  );
}
