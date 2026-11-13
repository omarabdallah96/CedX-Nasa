import { useEffect, useRef, useState } from 'react';
import { SERIES } from '../lib/color.ts';
import { fmtPct } from '../lib/format.ts';
import type { CountrySummary, SeamMode } from '../lib/types.ts';

interface Props {
  summary: CountrySummary[];
  onStep: (step: number) => void;
  onOpen: (slug: string) => void;
}

/** Yearly totals as bars: raw record with its 2012 jump, or the harmonized one. */
export function SeamBars({ country, mode }: { country: CountrySummary; mode: SeamMode }) {
  const years = country.years.filter((y) => y.complete);
  const max = Math.max(...years.map((y) => (mode === 'raw' ? y.raw : y.harmonized)));
  const first = years[0].year;
  const last = years[years.length - 1].year;
  return (
    <figure className="seam-bars" data-mode={mode}>
      <div
        className="seam-plot"
        role="img"
        aria-label={mode === 'raw'
          ? `Raw yearly fire detections in ${country.name}, ${first} to ${last}: counts jump when VIIRS replaces MODIS in 2012.`
          : `Harmonized yearly fire activity in ${country.name}, ${first} to ${last}: no jump in 2012.`}
      >
        {years.map((y) => {
          const v = mode === 'raw' ? y.raw : y.harmonized;
          const color = mode === 'harmonized' ? SERIES.harmonized : y.year < 2012 ? SERIES.modis : SERIES.viirs;
          return (
            <span key={y.year} className={y.year === 2012 ? 'seam-col seam-first' : 'seam-col'}>
              <i style={{ height: `${Math.max(1.5, (v / max) * 100)}%`, background: color }} />
            </span>
          );
        })}
      </div>
      <div className="seam-axis" aria-hidden="true">
        <span>{first}</span>
        <span className="seam-mark">2012 · VIIRS arrives</span>
        <span>{last}</span>
      </div>
      <ul className="legend" aria-label="Legend">
        {mode === 'raw' ? (
          <>
            <li><i className="key-dot" style={{ background: SERIES.modis }} /> MODIS detections</li>
            <li><i className="key-dot" style={{ background: SERIES.viirs }} /> VIIRS detections</li>
          </>
        ) : (
          <li><i className="key-dot" style={{ background: SERIES.harmonized }} /> Harmonized record</li>
        )}
      </ul>
    </figure>
  );
}

export function Intro({ summary, onStep, onOpen }: Props) {
  const steps = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const pt = summary.find((s) => s.slug === 'portugal') ?? summary[0];

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    steps.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  useEffect(() => onStep(active), [active, onStep]);

  const ref = (i: number) => (el: HTMLElement | null) => {
    steps.current[i] = el;
  };
  const yearsOfData = pt.years.filter((y) => y.complete).length;

  return (
    <main className="intro">
      <button type="button" className="skip" onClick={() => onOpen('portugal')}>Skip to the almanac</button>

      <section ref={ref(0)} data-step={0} className="step step-hero">
        <p className="eyebrow">NASA Space Apps 2026 · MODIS and VIIRS hot spots</p>
        <h1>Ember Almanac</h1>
        <p className="hero-q">Is this fire season normal?</p>
        <p className="hero-sub">
          {yearsOfData} years of NASA fire detections for one place, stitched into a single record you can read like tree rings.
        </p>
        <p className="scroll-cue" aria-hidden="true">Scroll</p>
      </section>

      <section ref={ref(1)} data-step={1} className="step">
        <div className="card">
          <p className="eyebrow">The problem</p>
          <h2>Two sensors. One broken record.</h2>
          <p>
            MODIS has watched for fire since 2000 with 1 km pixels. VIIRS took over in 2012 with 375 m pixels and sees far more.
            Switch sensors without care and a typical year in {pt.name} appears to jump <strong>×{pt.seamStepRaw.toFixed(1)}</strong> overnight.
          </p>
          <SeamBars country={pt} mode="raw" />
        </div>
      </section>

      <section ref={ref(2)} data-step={2} className="step">
        <div className="card">
          <p className="eyebrow">The fix</p>
          <h2>Stitched, then tested.</h2>
          <p>
            We count fire on a common 1 km grid, learn the conversion from the years both sensors flew, and check it on years the
            model never saw. Monthly error in {pt.name} falls from <strong>{fmtPct(pt.validation.mdapeRaw)}</strong> to{' '}
            <strong>{fmtPct(pt.validation.mdape)}</strong>.
          </p>
          <SeamBars country={pt} mode="harmonized" />
        </div>
      </section>

      <section ref={ref(3)} data-step={3} className="step step-pick">
        <div className="card">
          <p className="eyebrow">The almanac</p>
          <h2>Pick a place.</h2>
          <p>Each one opens with an answer first, then the evidence behind it.</p>
          <ul className="places">
            {summary.map((s) => (
              <li key={s.slug}>
                <button type="button" onClick={() => onOpen(s.slug)}>
                  <strong>{s.name}</strong>
                  <span>{(s.detections.modis + s.detections.viirs).toLocaleString('en-US')} detections</span>
                  <span>VIIRS sees ×{s.ratio.toFixed(1)} what MODIS does</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
