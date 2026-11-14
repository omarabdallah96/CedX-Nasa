import { useRef, useState } from 'react';
import { scaleLinear, scaleLog } from 'd3-scale';
import type { Analysis, Outage } from '../lib/analysis.ts';
import { SERIES } from '../lib/color.ts';
import { fmtCount, fmtPct } from '../lib/format.ts';
import { CELL_DEG, KAPPA, MIN_OBS } from '../lib/harmonize.ts';
import { MONTHS, MONTHS_LONG } from '../lib/time.ts';
import { useSize } from './useSize.ts';

interface Props {
  analysis: Analysis;
  place: string;
  isArea: boolean;
  outages: Outage[];
  /** Last day of the record, written out. */
  coverageEnd: string;
  /** First day served by near-real-time data, written out; null when there is none. */
  nrtFrom: string | null;
  /** Last day Suomi-NPP delivered, written out; null while it is still observing. */
  snppEnd: string | null;
}

function Scatter({ analysis }: { analysis: Analysis }) {
  const wrap = useRef<HTMLDivElement>(null);
  const { width } = useSize(wrap);
  const [hover, setHover] = useState<number | null>(null);
  const S = Math.max(260, Math.min(width, 420));
  const m = { top: 10, right: 12, bottom: 38, left: 46 };
  const pairs = analysis.validation.pairs.filter((p) => p.obs > 0 || p.raw > 0);
  const top = Math.max(10, ...pairs.map((p) => Math.max(p.obs, p.pred, p.raw))) + 1;
  // Log axes on value + 1 so zero months stay on the chart.
  const x = scaleLog().domain([1, top]).range([m.left, S - m.right]);
  const y = scaleLog().domain([1, top]).range([S - m.bottom, m.top]);
  const ticks = [0, 10, 100, 1000, 10000].filter((t) => t + 1 <= top);
  const h = hover !== null ? pairs[hover] : null;

  return (
    <figure className="trust-fig">
      <figcaption>
        <strong>Held-out test.</strong> Each mark is one month from a year the model never saw. On the line means MODIS, once
        converted, matches what VIIRS observed.
      </figcaption>
      <ul className="legend" aria-label="Legend">
        <li><i className="key-dot" style={{ background: SERIES.harmonized }} /> Harmonized</li>
        <li><i className="key-ring" style={{ borderColor: SERIES.modis }} /> Raw MODIS</li>
      </ul>
      <div ref={wrap} className="chart-wrap">
        <svg width={S} height={S} role="img" aria-label="Scatter plot of VIIRS-observed monthly cell-days against the prediction from MODIS, before and after harmonization.">
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={m.left} x2={S - m.right} y1={y(t + 1)} y2={y(t + 1)} />
              <line className="grid" x1={x(t + 1)} x2={x(t + 1)} y1={m.top} y2={S - m.bottom} />
              <text className="tick" x={m.left - 8} y={y(t + 1)} dy="0.32em" textAnchor="end">{fmtCount(t)}</text>
              <text className="tick" x={x(t + 1)} y={S - m.bottom + 14} textAnchor="middle">{fmtCount(t)}</text>
            </g>
          ))}
          <line className="identity" x1={x(1)} y1={y(1)} x2={x(top)} y2={y(top)} />
          <text className="tick" x={(m.left + S - m.right) / 2} y={S - 6} textAnchor="middle">VIIRS observed (cell-days per month)</text>
          <text className="tick" transform={`translate(12 ${(m.top + S - m.bottom) / 2}) rotate(-90)`} textAnchor="middle">From MODIS</text>
          {pairs.map((p, i) => (
            <circle key={`r${i}`} cx={x(p.obs + 1)} cy={y(p.raw + 1)} r={3} fill="none" stroke={SERIES.modis} strokeWidth={1.2} opacity={hover === null || hover === i ? 0.8 : 0.25} />
          ))}
          {pairs.map((p, i) => (
            <circle key={`h${i}`} cx={x(p.obs + 1)} cy={y(p.pred + 1)} r={3.2} fill={SERIES.harmonized} stroke="var(--surface-1)" strokeWidth={0.8} opacity={hover === null || hover === i ? 0.9 : 0.25} />
          ))}
          {pairs.map((p, i) => (
            <circle
              key={`t${i}`}
              cx={x(p.obs + 1)}
              cy={(y(p.pred + 1) + y(p.raw + 1)) / 2}
              r={Math.max(9, Math.abs(y(p.pred + 1) - y(p.raw + 1)) / 2 + 5)}
              fill="transparent"
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
            />
          ))}
          {h && <line className="crosshair" x1={x(h.obs + 1)} x2={x(h.obs + 1)} y1={y(h.pred + 1)} y2={y(h.raw + 1)} />}
        </svg>
        {h && (
          <div className="tip tip-above" style={{ left: Math.min(S - 90, Math.max(90, x(h.obs + 1))), top: Math.min(y(h.pred + 1), y(h.raw + 1)) - 6 }} role="status">
            <strong>{MONTHS_LONG[h.month]} {h.year}</strong>
            <span>VIIRS observed: {fmtCount(h.obs)}</span>
            <span>Harmonized: {fmtCount(h.pred)}</span>
            <span>Raw MODIS: {fmtCount(h.raw)}</span>
          </div>
        )}
      </div>
    </figure>
  );
}

function RatioBars({ analysis }: { analysis: Analysis }) {
  const wrap = useRef<HTMLDivElement>(null);
  const { width } = useSize(wrap);
  const [hover, setHover] = useState<number | null>(null);
  const c = analysis.calibration;
  const W = Math.max(260, Math.min(width, 520));
  const H = 220;
  const m = { top: 14, right: 10, bottom: 24, left: 34 };
  const hi = c.ratio.map((r, i) => r * c.spreadHi[i]);
  const lo = c.ratio.map((r, i) => r * c.spreadLo[i]);
  const y = scaleLinear().domain([0, Math.max(2, ...hi)]).nice(4).range([H - m.bottom, m.top]);
  const step = (W - m.left - m.right) / 12;
  const bw = Math.min(24, step * 0.56);
  const maxI = c.ratio.indexOf(Math.max(...c.ratio));
  const minI = c.ratio.indexOf(Math.min(...c.ratio));

  return (
    <figure className="trust-fig">
      <figcaption>
        <strong>Conversion factor by month.</strong> VIIRS cell-days per MODIS cell-day. Whiskers show how much it moved from
        year to year; that spread becomes the uncertainty on pre-2012 values.
      </figcaption>
      <div ref={wrap} className="chart-wrap">
        <svg width={W} height={H} role="img" aria-label={`Conversion factor by month, from ${c.ratio[minI].toFixed(1)} in ${MONTHS_LONG[minI]} to ${c.ratio[maxI].toFixed(1)} in ${MONTHS_LONG[maxI]}.`}>
          {y.ticks(4).map((t) => (
            <g key={t}>
              <line className="grid" x1={m.left} x2={W - m.right} y1={y(t)} y2={y(t)} />
              <text className="tick" x={m.left - 6} y={y(t)} dy="0.32em" textAnchor="end">{t}×</text>
            </g>
          ))}
          <line className="identity" x1={m.left} x2={W - m.right} y1={y(1)} y2={y(1)} />
          {c.ratio.map((r, i) => {
            const cx = m.left + step * (i + 0.5);
            return (
              <g key={i} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <rect x={cx - step / 2} y={m.top} width={step} height={H - m.top - m.bottom} fill="transparent" />
                <path
                  d={`M${cx - bw / 2},${y(0)} V${y(r) + 4} q0,-4 4,-4 H${cx + bw / 2 - 4} q4,0 4,4 V${y(0)} Z`}
                  fill={SERIES.harmonized}
                  opacity={hover === null || hover === i ? 1 : 0.5}
                />
                <line className="whisker" x1={cx} x2={cx} y1={y(lo[i])} y2={y(hi[i])} />
                {(i === maxI || i === minI) && (
                  <text className="bar-label" x={cx} y={y(hi[i]) - 5} textAnchor="middle">{r.toFixed(1)}×</text>
                )}
                <text className="tick" x={cx} y={H - 7} textAnchor="middle">{W < 400 ? MONTHS[i][0] : MONTHS[i]}</text>
              </g>
            );
          })}
          <line className="axis" x1={m.left} x2={W - m.right} y1={y(0)} y2={y(0)} />
        </svg>
        {hover !== null && (
          <div className="tip tip-above" style={{ left: Math.min(W - 90, Math.max(90, m.left + step * (hover + 0.5))), top: y(hi[hover]) - 4 }} role="status">
            <strong>{MONTHS_LONG[hover]}: ×{c.ratio[hover].toFixed(2)}</strong>
            <span>Year-to-year range: ×{lo[hover].toFixed(2)}–×{hi[hover].toFixed(2)}</span>
            <span>Fitted on {fmtCount(c.mSum[hover])} MODIS cell-days</span>
          </div>
        )}
      </div>
    </figure>
  );
}

export function TrustPanel({ analysis, place, isArea, outages, coverageEnd, nrtFrom, snppEnd }: Props) {
  const v = analysis.validation;
  const c = analysis.calibration;
  const years = analysis.table.years;
  return (
    <div className="trust">
      <dl className="tiles tiles-wide">
        <div>
          <dt>Monthly error</dt>
          <dd>{fmtPct(v.mdape)}</dd>
          <small>raw record: {fmtPct(v.mdapeRaw)}</small>
        </div>
        <div>
          <dt>Yearly error</dt>
          <dd>{fmtPct(v.yearlyMdape)}</dd>
          <small>raw record: {fmtPct(v.yearlyMdapeRaw)}</small>
        </div>
        <div>
          <dt>Bias</dt>
          <dd>{fmtPct(v.bias, true)}</dd>
          <small>raw record: {fmtPct(v.biasRaw, true)}</small>
        </div>
        <div>
          <dt>Conversion</dt>
          <dd>×{c.annual.toFixed(2)}</dd>
          <small>VIIRS per MODIS cell-day</small>
        </div>
      </dl>
      <p className="note">
        Median absolute error against VIIRS in {v.nYears} held-out years ({years[0]}–{years[years.length - 1]}), over the {v.nMonths} months
        with at least {MIN_OBS} VIIRS cell-days.
        {v.thin && ' Few busy months here, so treat these figures as rough.'}
        {!c.calibrated && ' No overlap data in this area: values before 2012 are unscaled MODIS.'}
      </p>

      <div className="trust-figs">
        <Scatter analysis={analysis} />
        <RatioBars analysis={analysis} />
      </div>

      <div className="trust-text">
        <div>
          <h3>How the two records were stitched</h3>
          <ol>
            <li>
              <strong>One unit.</strong> Every detection is snapped to a {CELL_DEG}° grid (about 1 km). A cell counts once per
              day per sensor, so one fire seen as seven small VIIRS pixels and one large MODIS pixel counts the same.
            </li>
            <li>
              <strong>Calibrate where both flew.</strong> From February 2012 both sensors watched {place}. For each calendar
              month we take total VIIRS cell-days over total MODIS cell-days.
              {isArea && ` Because this is a drawn area, its ratio is pulled toward the country's when local data is thin (weight of ${KAPPA} cell-days).`}
            </li>
            <li>
              <strong>Convert the past.</strong> Before 2012, MODIS cell-days are multiplied by that month's factor. Before July
              2002 only Terra flew, so Terra gets its own factor (×{c.annualTerra.toFixed(1)} here).
            </li>
            <li>
              <strong>Check on unseen years.</strong> Each overlap year is held out in turn, predicted from MODIS alone, and
              compared with what VIIRS saw.
            </li>
          </ol>
        </div>
        <div>
          <h3>What this record cannot tell you</h3>
          <ul>
            <li>It counts where and when fire was detected, not hectares burned. Cloud and thick smoke hide fires from both sensors.</li>
            <li>VIIRS catches many small fires MODIS misses, so the factor depends on the place and season. It is fitted per area, never global.</li>
            <li>Months with very few detections convert poorly. The likely range on each pre-2012 value shows how much.</li>
            <li>
              VIIRS was offline on {outages.length} occasion{outages.length === 1 ? '' : 's'} ({outages.map((o) => `${o.from} to ${o.to}`).join('; ')});
              those days are filled from MODIS and marked as such.
            </li>
            {nrtFrom ? (
              <li>
                The record runs through {coverageEnd}. From {nrtFrom} it uses NASA's near-real-time files, which are revised later and carry no
                fire-type label: a spot that held a factory or flare in earlier years is treated as one, everything else as vegetation fire.
              </li>
            ) : (
              <li>The record ends on {coverageEnd}.</li>
            )}
            {snppEnd && (
              <li>
                Suomi-NPP stopped delivering after {snppEnd}. From then on the same VIIRS instrument on NOAA-20 carries the record, divided by{' '}
                {c.ratioN20.toFixed(2)}: the ratio between the two over the days both observed.
              </li>
            )}
          </ul>
        </div>
      </div>
      <p className="note">
        Showing: {analysis.filters.vegOnly ? 'presumed vegetation fires only' : 'all thermal anomalies, including volcanoes and industrial sources'};{' '}
        {analysis.filters.dropLowConf ? 'low-confidence detections dropped' : 'low-confidence detections kept'}. Month by month:{' '}
        {MONTHS.map((mo, i) => `${mo} ×${c.ratio[i].toFixed(1)}`).join(', ')}.
      </p>
    </div>
  );
}
