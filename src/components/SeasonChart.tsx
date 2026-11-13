import { useRef, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { area, line, curveMonotoneX } from 'd3-shape';
import { fmtCount } from '../lib/format.ts';
import { PENTADS, type PeakSeason, type SeasonProfile } from '../lib/stats.ts';
import { dayIndex, MONTHS, MONTHS_LONG } from '../lib/time.ts';
import { useSize } from './useSize.ts';

interface Props {
  season: SeasonProfile;
  year: number;
  baseline: [number, number];
  peak: PeakSeason | null;
}

const MONTH_START = MONTHS.map((_, m) => dayIndex(2001, m + 1, 1) - dayIndex(2001, 1, 1));

function pentadLabel(b: number): string {
  const d0 = new Date(Date.UTC(2001, 0, 1 + b * 5));
  const d1 = new Date(Date.UTC(2001, 0, 1 + Math.min(364, b * 5 + 4)));
  const f = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return `${f(d0)} – ${f(d1)}`;
}

export function SeasonChart({ season, year, baseline, peak }: Props) {
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

  const peakText = peak
    ? peak.length === 1
      ? `${MONTHS_LONG[peak.start]} alone`
      : `${MONTHS_LONG[peak.start]} to ${MONTHS_LONG[(peak.start + peak.length - 1) % 12]}`
    : null;

  return (
    <div className="season">
      {peak && peakText && (
        <p className="lede">
          Critical period: <strong>{peakText}</strong> {peak.length === 1 ? 'carries' : 'carry'}{' '}
          <strong>{Math.round(peak.share * 100)}%</strong> of a typical year's burning here.
        </p>
      )}
      <ul className="legend" aria-label="Legend">
        <li><i className="key-line key-year" /> {year}</li>
        <li><i className="key-line key-median" /> Median, {baseline[0]}–{baseline[1]}</li>
        <li><i className="key-band" /> Usual range (10th–90th percentile)</li>
      </ul>
      <div ref={wrap} className="chart-wrap">
        <svg
          width={W}
          height={H}
          role="img"
          aria-label={`Season profile: harmonized cell-days per five days through the year, ${year} against the ${baseline[0]}–${baseline[1]} median and usual range.`}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const b = Math.round(x.invert(e.clientX - rect.left));
            setHover(b >= 0 && b < PENTADS ? b : null);
          }}
          onPointerLeave={() => setHover(null)}
        >
          {y.ticks(4).map((t) => (
            <g key={t}>
              <line className="grid" x1={m.left} x2={W - m.right} y1={y(t)} y2={y(t)} />
              <text className="tick" x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{fmtCount(t)}</text>
            </g>
          ))}
          {MONTH_START.map((d, i) => (
            <text key={i} className="tick" x={x((d + 15) / 5)} y={H - 8} textAnchor="middle">
              {W < 520 ? MONTHS[i][0] : MONTHS[i]}
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
            <span>{year}: {fmtCount(mine[hover])} cell-days</span>
            <span>Median: {fmtCount(season.median[hover])}</span>
            <span>Usual range: {fmtCount(season.p10[hover])}–{fmtCount(season.p90[hover])}</span>
          </div>
        )}
      </div>
      <p className="axis-note">Harmonized active-fire cell-days per five days</p>
    </div>
  );
}
