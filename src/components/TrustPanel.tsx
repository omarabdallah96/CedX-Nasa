import { useRef, useState } from 'react';
import { scaleLinear, scaleLog } from 'd3-scale';
import type { Analysis, Outage } from '../lib/analysis.ts';
import { useI18n } from '../i18n/index.tsx';
import { SERIES } from '../lib/color.ts';
import { fmtCount } from '../lib/format.ts';
import { CELL_DEG, KAPPA, MIN_OBS } from '../lib/harmonize.ts';
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
  const { t } = useI18n();
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
      <figcaption>{t.trust.scatterCaption()}</figcaption>
      <ul className="legend" aria-label={t.trust.legendAria}>
        <li><i className="key-dot" style={{ background: SERIES.harmonized }} /> {t.trust.harmonized}</li>
        <li><i className="key-ring" style={{ borderColor: SERIES.modis }} /> {t.trust.rawModis}</li>
      </ul>
      <div ref={wrap} className="chart-wrap">
        <div className="chart-box" style={{ width: S }}>
          <svg width={S} height={S} role="img" aria-label={t.trust.scatterAria}>
            {ticks.map((tick) => (
              <g key={tick}>
                <line className="grid" x1={m.left} x2={S - m.right} y1={y(tick + 1)} y2={y(tick + 1)} />
                <line className="grid" x1={x(tick + 1)} x2={x(tick + 1)} y1={m.top} y2={S - m.bottom} />
                <text className="tick" x={m.left - 8} y={y(tick + 1)} dy="0.32em" textAnchor="end">{fmtCount(tick)}</text>
                <text className="tick" x={x(tick + 1)} y={S - m.bottom + 14} textAnchor="middle">{fmtCount(tick)}</text>
              </g>
            ))}
            <line className="identity" x1={x(1)} y1={y(1)} x2={x(top)} y2={y(top)} />
            <text className="tick tick-label" x={(m.left + S - m.right) / 2} y={S - 6} textAnchor="middle">{t.trust.axisViirs}</text>
            <text className="tick tick-label" transform={`translate(12 ${(m.top + S - m.bottom) / 2}) rotate(-90)`} textAnchor="middle">{t.trust.axisModis}</text>
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
              <strong>{t.monthsLong[h.month]} {h.year}</strong>
              <span>{t.trust.tipViirs(h.obs)}</span>
              <span>{t.trust.tipHarmonized(h.pred)}</span>
              <span>{t.trust.tipRaw(h.raw)}</span>
            </div>
          )}
        </div>
      </div>
    </figure>
  );
}

function RatioBars({ analysis }: { analysis: Analysis }) {
  const { t } = useI18n();
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
  // Arabic month names are wider than "Jan": switch to month numbers sooner.
  const narrowBelow = t.lang === 'ar' ? 500 : 400;
  const maxI = c.ratio.indexOf(Math.max(...c.ratio));
  const minI = c.ratio.indexOf(Math.min(...c.ratio));

  return (
    <figure className="trust-fig">
      <figcaption>{t.trust.ratioCaption()}</figcaption>
      <div ref={wrap} className="chart-wrap">
        <div className="chart-box" style={{ width: W }}>
          <svg width={W} height={H} role="img" aria-label={t.trust.ratioAria(c.ratio[minI].toFixed(1), t.monthsLong[minI], c.ratio[maxI].toFixed(1), t.monthsLong[maxI])}>
            {y.ticks(4).map((tick) => (
              <g key={tick}>
                <line className="grid" x1={m.left} x2={W - m.right} y1={y(tick)} y2={y(tick)} />
                <text className="tick" x={m.left - 6} y={y(tick)} dy="0.32em" textAnchor="end">{tick}×</text>
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
                  <text className="tick" x={cx} y={H - 7} textAnchor="middle">{W < narrowBelow ? t.monthsNarrow[i] : t.months[i]}</text>
                </g>
              );
            })}
            <line className="axis" x1={m.left} x2={W - m.right} y1={y(0)} y2={y(0)} />
          </svg>
          {hover !== null && (
            <div className="tip tip-above" style={{ left: Math.min(W - 90, Math.max(90, m.left + step * (hover + 0.5))), top: y(hi[hover]) - 4 }} role="status">
              <strong>{t.trust.tipRatio(t.monthsLong[hover], c.ratio[hover])}</strong>
              <span>{t.trust.tipSpread(lo[hover], hi[hover])}</span>
              <span>{t.trust.tipFitted(c.mSum[hover])}</span>
            </div>
          )}
        </div>
      </div>
    </figure>
  );
}

export function TrustPanel({ analysis, place, isArea, outages, coverageEnd, nrtFrom, snppEnd }: Props) {
  const { t } = useI18n();
  const v = analysis.validation;
  const c = analysis.calibration;
  const years = analysis.table.years;
  return (
    <div className="trust">
      <dl className="tiles tiles-wide">
        <div>
          <dt>{t.trust.monthlyError}</dt>
          <dd>{t.pct(v.mdape)}</dd>
          <small>{t.trust.rawRecord(t.pct(v.mdapeRaw))}</small>
        </div>
        <div>
          <dt>{t.trust.yearlyError}</dt>
          <dd>{t.pct(v.yearlyMdape)}</dd>
          <small>{t.trust.rawRecord(t.pct(v.yearlyMdapeRaw))}</small>
        </div>
        <div>
          <dt>{t.trust.bias}</dt>
          <dd>{t.pct(v.bias, true)}</dd>
          <small>{t.trust.rawRecord(t.pct(v.biasRaw, true))}</small>
        </div>
        <div>
          <dt>{t.trust.conversion}</dt>
          <dd>{t.x(c.annual.toFixed(2))}</dd>
          <small>{t.trust.perCellDay}</small>
        </div>
      </dl>
      <p className="note">
        {t.trust.note({
          nYears: v.nYears, nMonths: v.nMonths, first: years[0], last: years[years.length - 1],
          minObs: MIN_OBS, thin: v.thin, calibrated: c.calibrated,
        })}
      </p>

      <div className="trust-figs">
        <Scatter analysis={analysis} />
        <RatioBars analysis={analysis} />
      </div>

      <div className="trust-text">
        <div>
          <h3>{t.trust.howTitle}</h3>
          <ol>
            {t.trust.steps({ cellDeg: CELL_DEG, place, isArea, kappa: KAPPA, terra: c.annualTerra }).map((step, i) => <li key={i}>{step}</li>)}
          </ol>
        </div>
        <div>
          <h3>{t.trust.limitsTitle}</h3>
          <ul>
            {t.trust.limits({ outages, coverageEnd, nrtFrom, snppEnd, ratioN20: c.ratioN20 }).map((limit, i) => <li key={i}>{limit}</li>)}
          </ul>
        </div>
      </div>
      <p className="note">{t.trust.showing(analysis.filters.vegOnly, analysis.filters.dropLowConf, c.ratio)}</p>
    </div>
  );
}
