import { useRef, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { area, line, curveMonotoneX } from 'd3-shape';
import { useI18n } from '../i18n/index.tsx';
import { fmtCount } from '../lib/format.ts';
import { PENTADS, type PeakSeason, type SeasonProfile } from '../lib/stats.ts';
import { dayIndex } from '../lib/time.ts';
import { useSize } from './useSize.ts';

interface Props {
  season: SeasonProfile;
  year: number;
  baseline: [number, number];
  peak: PeakSeason | null;
}

const MONTH_START = Array.from({ length: 12 }, (_, m) => dayIndex(2001, m + 1, 1) - dayIndex(2001, 1, 1));

/** First and last day of the b-th five-day bin of a year. */
function pentadDays(b: number): [Date, Date] {
  return [new Date(Date.UTC(2001, 0, 1 + b * 5)), new Date(Date.UTC(2001, 0, 1 + Math.min(364, b * 5 + 4)))];
}

export function SeasonChart({ season, year, baseline, peak }: Props) {
  const { t } = useI18n();
  const wrap = useRef<HTMLDivElement>(null);
  const { width } = useSize(wrap);
  const [hover, setHover] = useState<number | null>(null);
  const W = Math.max(280, width);
  const H = 240;
  const m = { top: 12, right: 12, bottom: 26, left: 44 };
  const mine = season.byYear.get(year) ?? new Array<number>(PENTADS).fill(0);
  const yMax = Math.max(1, ...mine, ...season.p90);
  const x = scaleLinear().domain([0, PENTADS - 1]).range([m.left, W - m.right]);
  const y = scaleLinear().domain([0, yMax]).nice(4).range([H - m.bottom, m.top]);
  const idx = Array.from({ length: PENTADS }, (_, i) => i);
  const band = area<number>().x((i) => x(i)).y0((i) => y(season.p10[i])).y1((i) => y(season.p90[i])).curve(curveMonotoneX)(idx)!;
  const medianPath = line<number>().x((i) => x(i)).y((i) => y(season.median[i])).curve(curveMonotoneX)(idx)!;
  const yearPath = line<number>().x((i) => x(i)).y((i) => y(mine[i])).curve(curveMonotoneX)(idx)!;

  // Arabic month names are wider than "Jan": switch to month numbers sooner.
  const narrow = W < (t.lang === 'ar' ? 600 : 520);
  const pentadLabel = (b: number) =>
    pentadDays(b).map((d) => t.dayMonth(d.getUTCDate(), d.getUTCMonth())).join(' – ');

  return (
    <div className="season">
      {peak && (
        <p className="lede">
          {t.season.lede(
            t.monthsLong[peak.start],
            peak.length === 1 ? null : t.monthsLong[(peak.start + peak.length - 1) % 12],
            peak.share,
          )}
        </p>
      )}
      <ul className="legend" aria-label={t.season.legendAria}>
        <li><i className="key-line key-year" /> {year}</li>
        <li><i className="key-line key-median" /> {t.season.median(baseline[0], baseline[1])}</li>
        <li><i className="key-band" /> {t.season.usualRange}</li>
      </ul>
      <div ref={wrap} className="chart-wrap">
        <svg
          width={W}
          height={H}
          role="img"
          aria-label={t.season.aria(year, baseline[0], baseline[1])}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const b = Math.round(x.invert(e.clientX - rect.left));
            setHover(b >= 0 && b < PENTADS ? b : null);
          }}
          onPointerLeave={() => setHover(null)}
        >
          {y.ticks(4).map((tick) => (
            <g key={tick}>
              <line className="grid" x1={m.left} x2={W - m.right} y1={y(tick)} y2={y(tick)} />
              <text className="tick" x={m.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{fmtCount(tick)}</text>
            </g>
          ))}
          {MONTH_START.map((d, i) => (
            <text key={i} className="tick" x={x((d + 15) / 5)} y={H - 8} textAnchor="middle">
              {narrow ? t.monthsNarrow[i] : t.months[i]}
            </text>
          ))}
          <line className="axis" x1={m.left} x2={W - m.right} y1={y(0)} y2={y(0)} />
          <path className="band" d={band} />
          <path className="median-line" d={medianPath} />
          <path className="year-line" d={yearPath} />
          {hover !== null && (
            <g>
              <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={m.top} y2={H - m.bottom} />
              <circle className="dot-median" cx={x(hover)} cy={y(season.median[hover])} r={4} />
              <circle className="dot-year" cx={x(hover)} cy={y(mine[hover])} r={4.5} />
            </g>
          )}
        </svg>
        {hover !== null && (
          <div className="tip tip-above" style={{ left: Math.min(W - 90, Math.max(90, x(hover))), top: m.top + 4 }} role="status">
            <strong>{pentadLabel(hover)}</strong>
            <span>{t.season.tipYear(year, mine[hover])}</span>
            <span>{t.season.tipMedian(season.median[hover])}</span>
            <span>{t.season.tipRange(season.p10[hover], season.p90[hover])}</span>
          </div>
        )}
      </div>
      <p className="axis-note">{t.season.axisNote}</p>
    </div>
  );
}
