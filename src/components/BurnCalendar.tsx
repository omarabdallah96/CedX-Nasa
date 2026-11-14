import { useMemo, useRef, useState } from 'react';
import type { Analysis } from '../lib/analysis.ts';
import { ember, inkOn, rampPosition, SERIES } from '../lib/color.ts';
import { fmtCompact, fmtCount, fmtRatio } from '../lib/format.ts';
import { MONTHS, MONTHS_LONG } from '../lib/time.ts';
import type { SeamMode } from '../lib/types.ts';
import type { Selection } from './FireRings.tsx';

interface Props {
  analysis: Analysis;
  mode: SeamMode;
  sel: Selection;
  onSelect: (s: Selection) => void;
  seamYear: number;
}

export function BurnCalendar({ analysis, mode, sel, onSelect, seamYear }: Props) {
  const mm = mode === 'harmonized' ? analysis.monthsH : analysis.monthsNaive;
  const wrap = useRef<HTMLDivElement>(null);
  const cells = useRef(new Map<string, HTMLButtonElement>());
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);

  const { max, totals, maxTotal } = useMemo(() => {
    let max = 0;
    const totals = mm.values.map((row) => row.reduce((a, v) => a + (Number.isNaN(v) ? 0 : v), 0));
    for (const row of mm.values) for (const v of row) if (v > max) max = v;
    return { max, totals, maxTotal: Math.max(...totals) };
  }, [mm]);

  const unit = mode === 'harmonized' ? 'cell-days' : 'raw detections';
  const order = mm.years.map((_, i) => i).reverse();

  const describe = (yi: number, m: number): string[] => {
    const year = mm.years[yi];
    const v = mm.values[yi][m];
    const partial = mm.partial?.year === year && mm.partial.month === m ? mm.partial.days : 0;
    const head = `${MONTHS_LONG[m]} ${year}${partial ? ` so far (${partial} days)` : ''}: ${fmtCount(v)} ${unit}`;
    if (mode === 'raw') {
      return [head, year < seamYear ? 'MODIS detections, 1 km pixels' : 'VIIRS detections, 375 m pixels'];
    }
    const lines = [head];
    const med = analysis.climate.median[m];
    if (partial) lines.push(`Month still running; a full ${MONTHS_LONG[m]} usually reaches ${fmtCount(med)}`);
    else if (med > 0) lines.push(`${fmtRatio(v / med)} the usual ${MONTHS_LONG[m]} (median ${fmtCount(med)})`);
    else lines.push(`The usual ${MONTHS_LONG[m]} sees none`);
    const lo = analysis.monthsLo.values[yi][m];
    const hi = analysis.monthsHi.values[yi][m];
    if (hi - lo > 0.5) lines.push(`Scaled from MODIS · likely ${fmtCount(lo)}–${fmtCount(hi)}`);
    else if (year >= seamYear) lines.push('VIIRS, as observed');
    return lines;
  };

  const showTip = (el: HTMLElement, yi: number, m: number) => {
    const a = el.getBoundingClientRect();
    const b = wrap.current!.getBoundingClientRect();
    setTip({ x: a.left - b.left + a.width / 2, y: a.top - b.top, lines: describe(yi, m) });
  };

  const move = (e: React.KeyboardEvent, yi: number, m: number) => {
    const pos = order.indexOf(yi);
    let target: [number, number] | null = null;
    if (e.key === 'ArrowLeft') target = [yi, m - 1];
    else if (e.key === 'ArrowRight') target = [yi, m + 1];
    else if (e.key === 'ArrowUp' && pos > 0) target = [order[pos - 1], m];
    else if (e.key === 'ArrowDown' && pos < order.length - 1) target = [order[pos + 1], m];
    if (!target) return;
    const el = cells.current.get(`${target[0]}-${target[1]}`);
    if (el) {
      e.preventDefault();
      el.focus();
    }
  };

  return (
    <div ref={wrap} className="calendar" data-mode={mode}>
      <table>
        <caption className="sr-only">
          Burning calendar: {unit} per month, one row per year. {mode === 'harmonized'
            ? 'Values before 2012 are MODIS scaled to VIIRS-equivalent units.'
            : 'Raw counts: MODIS before 2012, VIIRS from 2012.'}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="cal-year">Year</th>
            {MONTHS.map((m) => <th key={m} scope="col">{m}</th>)}
            <th scope="col" className="cal-total">Year total</th>
          </tr>
        </thead>
        <tbody>
          {order.map((yi) => {
            const year = mm.years[yi];
            const barColor = mode === 'harmonized' ? SERIES.harmonized : year < seamYear ? SERIES.modis : SERIES.viirs;
            return (
              <tr key={year} className={year === seamYear ? 'cal-seam' : undefined}>
                <th scope="row" className="cal-year">{year}</th>
                {mm.values[yi].map((v, m) => {
                  if (Number.isNaN(v)) return <td key={m} className="cal-none" aria-label="No satellite coverage" />;
                  const t = rampPosition(v, max);
                  const selected = sel.year === year && sel.month === m;
                  return (
                    <td key={m}>
                      <button
                        type="button"
                        ref={(el) => {
                          if (el) cells.current.set(`${yi}-${m}`, el);
                          else cells.current.delete(`${yi}-${m}`);
                        }}
                        className="cal-cell"
                        data-partial={mm.partial?.year === year && mm.partial.month === m ? '' : undefined}
                        style={{ background: ember(t), color: inkOn(t) }}
                        aria-pressed={selected}
                        aria-label={describe(yi, m).join('. ')}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onSelect({ year, month: m })}
                        onKeyDown={(e) => move(e, yi, m)}
                        onMouseEnter={(e) => showTip(e.currentTarget, yi, m)}
                        onFocus={(e) => showTip(e.currentTarget, yi, m)}
                        onMouseLeave={() => setTip(null)}
                        onBlur={() => setTip(null)}
                      >
                        <span>{fmtCompact(v)}</span>
                      </button>
                    </td>
                  );
                })}
                <td className="cal-total">
                  <span className="cal-bar" style={{ width: `${(totals[yi] / maxTotal) * 100}%`, background: barColor }} />
                  <span className="cal-total-n">{fmtCompact(totals[yi])}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="cal-legend">
        <span className="ramp" aria-hidden="true" />
        <span>0</span>
        <span className="ramp-max">{fmtCount(max)} {unit} in a month</span>
        <span className="cal-keys">
          {mode === 'raw' ? (
            <>
              <i style={{ background: SERIES.modis }} /> MODIS
              <i style={{ background: SERIES.viirs }} /> VIIRS
            </>
          ) : (
            <>
              <i style={{ background: SERIES.harmonized }} /> Harmonized
            </>
          )}
        </span>
      </div>
      {tip && (
        <div className="tip tip-above" style={{ left: tip.x, top: tip.y }} role="status">
          {tip.lines.map((l, i) => (i === 0 ? <strong key={i}>{l}</strong> : <span key={i}>{l}</span>))}
        </div>
      )}
    </div>
  );
}
