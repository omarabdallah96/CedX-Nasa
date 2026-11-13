import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DatasetIndex } from './lib/analysis.ts';
import { AnalysisClient } from './lib/client.ts';
import { fmtCount } from './lib/format.ts';
import { SRC_GAPFILL, SRC_MODIS, SRC_TERRA, type BBox, type Filters } from './lib/harmonize.ts';
import { completeYears, monthVerdict, seamStep } from './lib/stats.ts';
import { buildCalendar, dayIndex, FIRST_DAY, isoDate, MONTHS, MONTHS_LONG, SEAM_DAY } from './lib/time.ts';
import type { CountrySummary, SeamMode } from './lib/types.ts';
import type { AnalyzeResult, PointsResult } from './worker/analysis.worker.ts';
import { BurnCalendar } from './components/BurnCalendar.tsx';
import { ExportMenu } from './components/ExportMenu.tsx';
import { FireRings, type FireRingsHandle, type Selection } from './components/FireRings.tsx';
import { Intro } from './components/Intro.tsx';
import { MapPanel } from './components/MapPanel.tsx';
import { SeasonChart } from './components/SeasonChart.tsx';
import { TrustPanel } from './components/TrustPanel.tsx';
import { ANSWER, shortcuts, Verdict, verdictSentence } from './components/Verdict.tsx';

const SEAM_YEAR = 2012;

function readHash(): { phase: 'intro' | 'tool'; slug: string | null } {
  const m = /^#\/([a-z-]+)$/.exec(window.location.hash);
  return m ? { phase: 'tool', slug: m[1] } : { phase: 'intro', slug: null };
}

/** Value at quantile q among the positive entries: a robust top for the colour ramp. */
function robustMax(values: Float32Array, q: number): number {
  const pos = Array.from(values).filter((v) => v > 0).sort((a, b) => a - b);
  if (pos.length === 0) return 1;
  return pos[Math.min(pos.length - 1, Math.floor(pos.length * q))];
}

export function App() {
  const client = useMemo(() => new AnalysisClient(), []);
  const [index, setIndex] = useState<DatasetIndex | null>(null);
  const [summary, setSummary] = useState<CountrySummary[] | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const initial = useMemo(readHash, []);
  const [phase, setPhase] = useState<'intro' | 'tool'>(initial.phase);
  const [slug, setSlug] = useState(initial.slug ?? 'portugal');
  const [introStep, setIntroStep] = useState(0);
  const [flags, setFlags] = useState({ vegOnly: true, dropLowConf: true });
  const [bbox, setBBox] = useState<BBox | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [boxText, setBoxText] = useState(['', '', '', '']);
  const [boxError, setBoxError] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; data: AnalyzeResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<Selection | null>(null);
  const [mode, setMode] = useState<SeamMode>('harmonized');
  const [points, setPoints] = useState<PointsResult | null>(null);
  const rings = useRef<FireRingsHandle>(null);

  // Static files the whole app needs.
  useEffect(() => {
    let alive = true;
    const get = async <T,>(name: string): Promise<T> => {
      const res = await fetch(`${client.baseUrl}${name}`);
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
      return (await res.json()) as T;
    };
    Promise.all([get<DatasetIndex>('index.json'), get<CountrySummary[]>('summary.json')]).then(
      ([i, s]) => {
        if (!alive) return;
        setIndex(i);
        setSummary(s);
        setSlug((cur) => (i.countries.some((c) => c.slug === cur) ? cur : i.countries[0].slug));
      },
      (err: unknown) => alive && setBootError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      alive = false;
    };
  }, [client]);

  useEffect(() => {
    const target = phase === 'tool' ? `#/${slug}` : '';
    if (window.location.hash !== target) history.replaceState(null, '', target || window.location.pathname + window.location.search);
    if (phase === 'tool') window.scrollTo({ top: 0 });
  }, [phase, slug]);

  const filters: Filters = useMemo(() => ({ ...flags, bbox }), [flags, bbox]);
  const key = `${slug}|${flags.vegOnly}|${flags.dropLowConf}|${bbox?.join(',') ?? 'all'}`;

  // Run the analysis whenever the place or the filters change.
  useEffect(() => {
    if (phase !== 'tool' || !index) return;
    let alive = true;
    setError(null);
    client.analyze(slug, filters).then(
      (data) => alive && setResult({ key, data }),
      (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      alive = false;
    };
    // `key` captures slug + filters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, index, phase, key, attempt]);

  const cal = useMemo(() => (index ? buildCalendar(index.coverageEndDay + 1) : null), [index]);
  const analysis = result?.data.analysis ?? null;
  const stale = result !== null && result.key !== key;
  const country = index?.countries.find((c) => c.slug === slug) ?? null;
  const place = country ? (bbox ? `the selected area of ${country.name}` : country.name) : '';

  const sel: Selection | null = useMemo(() => {
    if (picked) return picked;
    return analysis && cal ? shortcuts(analysis, cal).latestPeak : null;
  }, [picked, analysis, cal]);

  // Detections of the selected month, for the map.
  useEffect(() => {
    if (phase !== 'tool' || !sel || !index) return;
    let alive = true;
    const from = dayIndex(sel.year, sel.month + 1, 1);
    const to = Math.min(index.coverageEndDay, dayIndex(sel.year, sel.month + 2, 1) - 1);
    client.points(slug, filters, from, to).then(
      (p) => alive && setPoints(p),
      () => alive && setPoints(null),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, index, phase, key, sel?.year, sel?.month]);

  const open = useCallback((s: string) => {
    setSlug(s);
    setBBox(null);
    setPicked(null);
    setDrawing(false);
    setPhase('tool');
  }, []);

  const applyBox = (b: BBox | null) => {
    setBBox(b);
    setDrawing(false);
    setBoxError(null);
    setBoxText(b ? b.map((v) => String(v)) : ['', '', '', '']);
  };

  const submitBox = (e: React.FormEvent) => {
    e.preventDefault();
    const [w, s, east, n] = boxText.map((t) => Number(t.trim()));
    if (boxText.some((t) => t.trim() === '') || [w, s, east, n].some((v) => !Number.isFinite(v))) {
      return setBoxError('Enter all four edges as decimal degrees, for example West -8.6.');
    }
    if (w < -180 || east > 180 || s < -90 || n > 90) return setBoxError('Longitude runs from -180 to 180 and latitude from -90 to 90.');
    if (w >= east) return setBoxError('West must be smaller than East.');
    if (s >= n) return setBoxError('South must be smaller than North.');
    applyBox([w, s, east, n]);
  };

  const series = analysis ? (mode === 'harmonized' ? analysis.harmonized.h : analysis.naive) : null;
  const ringMax = useMemo(() => (series ? robustMax(series, 0.995) : 1), [series]);
  const steps = useMemo(
    () => (analysis ? { raw: seamStep(analysis.monthsNaive, SEAM_YEAR), harmonized: seamStep(analysis.monthsH, SEAM_YEAR) } : null),
    [analysis],
  );

  const describeDay = useCallback(
    (day: number) => {
      if (!analysis || !cal) return '';
      const date = `${Number(isoDate(day).slice(8))} ${MONTHS[cal.month[day]]} ${cal.year[day]}`;
      if (mode === 'raw') {
        return `${date}: ${fmtCount(analysis.naive[day])} raw ${day < SEAM_DAY ? 'MODIS' : 'VIIRS'} detections`;
      }
      const src = analysis.harmonized.src[day];
      const how = src === SRC_TERRA || src === SRC_MODIS ? 'scaled from MODIS' : src === SRC_GAPFILL ? 'VIIRS outage, filled from MODIS' : 'VIIRS observed';
      return `${date}: ${fmtCount(analysis.harmonized.h[day])} cell-days · ${how}`;
    },
    [analysis, cal, mode],
  );

  if (bootError) {
    return (
      <div className="fatal" role="alert">
        <h1>Ember Almanac</h1>
        <p>The data files could not be loaded ({bootError}). Run <code>npm run data</code> to build them, then reload.</p>
      </div>
    );
  }

  const verdict = analysis && sel ? monthVerdict(analysis.monthsH, sel.year, sel.month) : null;
  const baseline = analysis ? completeYears(analysis.monthsH) : [];

  return (
    <div className="app" data-phase={phase}>
      {index && (
        <MapPanel
          phase={phase}
          spin={introStep < 3}
          countries={index.countries}
          slug={slug}
          bbox={bbox}
          drawing={drawing}
          onDraw={applyBox}
          onPick={open}
          density={phase === 'tool' && !stale ? result?.data.density ?? null : null}
          points={phase === 'tool' ? points : null}
          dataUrl={client.baseUrl}
        />
      )}

      {phase === 'intro' && summary && <Intro summary={summary} onStep={setIntroStep} onOpen={open} />}
      {phase === 'intro' && !summary && <p className="boot">Loading the almanac…</p>}

      {phase === 'tool' && index && cal && (
        <>
          <header className="head">
            <a className="brand" href="#top" onClick={(e) => { e.preventDefault(); setPhase('intro'); setIntroStep(0); }}>
              <img src="./favicon.svg" alt="" width={26} height={26} />
              <span>Ember Almanac</span>
            </a>
            <nav className="places-nav" aria-label="Place">
              {index.countries.map((c) => (
                <button key={c.slug} type="button" aria-pressed={c.slug === slug} onClick={() => open(c.slug)}>{c.name}</button>
              ))}
            </nav>
            <a className="head-link" href="#trust">How it works</a>
          </header>

          <aside className="side" aria-busy={!analysis || stale}>
            {error ? (
              <div className="verdict" role="alert">
                <p className="eyebrow">Something went wrong</p>
                <p className="verdict-text">{error}</p>
                <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
              </div>
            ) : analysis && sel ? (
              <Verdict analysis={analysis} cal={cal} sel={sel} onSelect={setPicked} place={place} coverageEnd={`${Number(isoDate(index.coverageEndDay).slice(8))} ${MONTHS_LONG[cal.month[index.coverageEndDay]]} ${cal.year[index.coverageEndDay]}`} />
            ) : (
              <div className="verdict">
                <p className="eyebrow">{country?.name}</p>
                <p className="verdict-text">Reading {country ? country.n.toLocaleString('en-US') : ''} satellite detections…</p>
              </div>
            )}

            <form className="area" onSubmit={submitBox} aria-labelledby="area-h">
              <h2 id="area-h">Area</h2>
              <p className="note">
                {bbox ? 'Showing a drawn area. Its conversion factor is fitted locally.' : `Showing all of ${country?.name ?? 'the country'}.`}
              </p>
              <div className="area-actions">
                <button type="button" className="btn" aria-pressed={drawing} onClick={() => setDrawing((d) => !d)}>
                  {drawing ? 'Cancel drawing' : 'Draw a box on the map'}
                </button>
                {bbox && <button type="button" className="btn btn-quiet" onClick={() => applyBox(null)}>Whole country</button>}
              </div>
              {drawing && <p className="note" role="status">Drag on the map from one corner to the opposite corner.</p>}
              <div className="area-inputs">
                {['West', 'South', 'East', 'North'].map((label, i) => (
                  <label key={label}>
                    <span>{label}</span>
                    <input
                      inputMode="decimal"
                      value={boxText[i]}
                      placeholder={country ? String(country.focus[i]) : ''}
                      onChange={(e) => setBoxText((t) => t.map((v, k) => (k === i ? e.target.value : v)))}
                    />
                  </label>
                ))}
                <button type="submit" className="btn btn-quiet">Apply</button>
              </div>
              {boxError && <p className="form-error" role="alert">{boxError}</p>}
              <div className="filters">
                <label>
                  <input type="checkbox" checked={flags.vegOnly} onChange={(e) => setFlags((f) => ({ ...f, vegOnly: e.target.checked }))} />
                  Vegetation fires only <small>(hide volcanoes, gas flares, industry)</small>
                </label>
                <label>
                  <input type="checkbox" checked={flags.dropLowConf} onChange={(e) => setFlags((f) => ({ ...f, dropLowConf: e.target.checked }))} />
                  Drop low-confidence detections
                </label>
              </div>
              <p className="map-key">
                <span><i className="pt pt-viirs" /> VIIRS</span>
                <span><i className="pt pt-modis" /> MODIS</span>
                <span>
                  {sel && points
                    ? `${points.total.toLocaleString('en-US')} detections in ${MONTHS_LONG[sel.month]} ${sel.year}` +
                      (points.total > points.lon.length ? ` (${points.lon.length.toLocaleString('en-US')} drawn)` : '')
                    : ''}
                </span>
                <span><i className="glow" /> all-time footprint</span>
              </p>
            </form>
          </aside>

          {analysis && sel && series && steps && (
            <main className="main" data-stale={stale || undefined}>
              <section id="record" aria-labelledby="record-h">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">The record</p>
                    <h2 id="record-h">{baseline.length} years, ring by ring</h2>
                  </div>
                  <div className="seg" role="group" aria-label="Which record to show">
                    <button type="button" aria-pressed={mode === 'harmonized'} onClick={() => setMode('harmonized')}>Harmonized</button>
                    <button type="button" aria-pressed={mode === 'raw'} onClick={() => setMode('raw')}>Raw record</button>
                  </div>
                </div>
                <p className="lede">
                  {mode === 'raw' ? (
                    Number.isFinite(steps.raw) ? (
                      <>
                        Raw counts: MODIS until 2012, VIIRS after. A typical year appears to jump{' '}
                        <strong>×{steps.raw.toFixed(1)}</strong> at the dotted ring. That is sharper pixels, not more fire.
                      </>
                    ) : (
                      <>Raw counts: MODIS until 2012, VIIRS after. MODIS saw almost nothing here before 2012, so the two halves cannot be compared at all.</>
                    )
                  ) : (
                    <>
                      One ring per year, {cal.year[FIRST_DAY]} at the core, 1 January at the top. Inside the dotted ring MODIS is converted to VIIRS-equivalent
                      units.{' '}
                      {Number.isFinite(steps.harmonized) && Number.isFinite(steps.raw) ? (
                        <>
                          Raw counts put a typical year since 2012 at ×{steps.raw.toFixed(1)} of one before; with the sensor effect removed it
                          is <strong>×{steps.harmonized.toFixed(1)}</strong>.{' '}
                        </>
                      ) : null}
                      Click any ring or cell to ask about that month.
                    </>
                  )}
                </p>
                <div className="record-grid">
                  <FireRings
                    ref={rings}
                    daily={series}
                    cal={cal}
                    max={ringMax}
                    sel={sel}
                    onSelect={setPicked}
                    title={bbox ? 'Selected area' : country?.name ?? ''}
                    describe={describeDay}
                    seamYear={SEAM_YEAR}
                  />
                  <BurnCalendar analysis={analysis} mode={mode} sel={sel} onSelect={setPicked} seamYear={SEAM_YEAR} />
                </div>
              </section>

              <section id="season" aria-labelledby="season-h">
                <p className="eyebrow">The season</p>
                <h2 id="season-h">When it burns, and how {sel.year} compares</h2>
                <SeasonChart season={analysis.season} year={sel.year} baseline={[baseline[0], baseline[baseline.length - 1]]} peak={analysis.peak} />
              </section>

              <section id="trust" aria-labelledby="trust-h">
                <p className="eyebrow">The evidence</p>
                <h2 id="trust-h">Can you trust the stitch?</h2>
                <TrustPanel analysis={analysis} place={place} isArea={!!bbox} outages={index.viirsOutages} />
              </section>

              <section id="export" aria-labelledby="export-h">
                <p className="eyebrow">Take it with you</p>
                <h2 id="export-h">Download the search</h2>
                <ExportMenu
                  client={client}
                  slug={slug}
                  filters={filters}
                  sel={sel}
                  lastDay={index.coverageEndDay}
                  ringsCanvas={() => rings.current?.canvas() ?? null}
                  place={country ? (bbox ? `${country.name}, selected area` : country.name) : ''}
                  headline={verdict ? ANSWER[verdict.level] : ''}
                  detail={verdict ? verdictSentence(verdict, `${MONTHS_LONG[sel.month]} ${sel.year}`, MONTHS_LONG[sel.month], place) : ''}
                />
              </section>
            </main>
          )}

          <footer className="foot">
            <p>
              Hotspots: NASA FIRMS archive, MODIS (Terra and Aqua) and VIIRS (Suomi NPP), {analysis ? `${(analysis.detections.modis + analysis.detections.viirs).toLocaleString('en-US')} detections in this view` : ''}.
              Imagery: NASA GIBS Blue Marble. Borders: Natural Earth.
            </p>
            <p>Built for the NASA Space Apps Challenge 2026. An independent project, not a NASA product.</p>
          </footer>
        </>
      )}
    </div>
  );
}
