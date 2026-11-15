import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { lastWeek, rangeSummary, selectionVerdict, type DatasetIndex } from './lib/analysis.ts';
import { AnalysisClient, pickDataSource, type DataSource } from './lib/client.ts';
import { parseBox, type BoxFailure } from './lib/coords.ts';
import { SRC_GAPFILL, SRC_MODIS, SRC_N20, SRC_TERRA, type BBox, type Filters } from './lib/harmonize.ts';
import { completeYears, seamStep } from './lib/stats.ts';
import { buildCalendar, FIRST_DAY, isoDate, SEAM_DAY } from './lib/time.ts';
import type { CountrySummary, GlobeView, IntroStory, SeamMode } from './lib/types.ts';
import type { AnalyzeResult, PointsResult } from './worker/analysis.worker.ts';
import { BurnCalendar } from './components/BurnCalendar.tsx';
import { ExportMenu } from './components/ExportMenu.tsx';
import { FireRings, type FireRingsHandle, type Selection } from './components/FireRings.tsx';
import { Intro } from './components/Intro.tsx';
import { MapPanel } from './components/MapPanel.tsx';
import { NowCard } from './components/NowCard.tsx';
import { monthPeriod, PeriodPanel, type Period } from './components/PeriodPanel.tsx';
import { Records } from './components/Records.tsx';
import { SeasonChart } from './components/SeasonChart.tsx';
import { TrustPanel } from './components/TrustPanel.tsx';
import { shortcuts, Verdict } from './components/Verdict.tsx';
import { LangSwitch, useI18n } from './i18n/index.tsx';
import { setNightStage, ThemeSwitch } from './lib/theme.tsx';

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
  const { t } = useI18n();
  const client = useMemo(() => new AnalysisClient(), []);
  const [source, setSource] = useState<DataSource | null>(null);
  const [index, setIndex] = useState<DatasetIndex | null>(null);
  const [summary, setSummary] = useState<CountrySummary[] | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const initial = useMemo(readHash, []);
  const [phase, setPhase] = useState<'intro' | 'tool'>(initial.phase);
  const [slug, setSlug] = useState(initial.slug ?? 'portugal');
  const [story, setStory] = useState<IntroStory | null>(null);
  const [globeView, setGlobeView] = useState<GlobeView>('spin');
  const [flags, setFlags] = useState({ vegOnly: true, dropLowConf: true });
  const [bbox, setBBox] = useState<BBox | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [boxText, setBoxText] = useState(['', '', '', '']);
  const [boxError, setBoxError] = useState<BoxFailure | null>(null);
  const [result, setResult] = useState<{ key: string; data: AnalyzeResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<Selection | null>(null);
  // Null while the period on the map simply follows the selected month.
  const [range, setRange] = useState<Period | null>(null);
  const [mode, setMode] = useState<SeamMode>('harmonized');
  const [points, setPoints] = useState<PointsResult | null>(null);
  const rings = useRef<FireRingsHandle>(null);

  // The backend's data when it answers, the bundled copy otherwise.
  useEffect(() => {
    let alive = true;
    void pickDataSource().then((s) => {
      if (!alive) return;
      client.baseUrl = s.url;
      setSource(s);
    });
    return () => {
      alive = false;
    };
  }, [client]);

  // Static files the whole app needs.
  useEffect(() => {
    if (!source) return;
    let alive = true;
    const get = async <T,>(name: string): Promise<T> => {
      const res = await fetch(`${client.baseUrl}${name}`);
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
      return (await res.json()) as T;
    };
    Promise.all([get<DatasetIndex>('index.json'), get<CountrySummary[]>('summary.json'), get<IntroStory>('intro.json')]).then(
      ([i, s, st]) => {
        if (!alive) return;
        setIndex(i);
        setSummary(s);
        setStory(st);
        setSlug((cur) => (i.countries.some((c) => c.slug === cur) ? cur : i.countries[0].slug));
      },
      (err: unknown) => alive && setBootError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      alive = false;
    };
  }, [client, source]);

  // Before paint, so neither phase shows a frame in the other's theme.
  useLayoutEffect(() => setNightStage(phase === 'intro'), [phase]);

  useEffect(() => {
    const target = phase === 'tool' ? `#/${slug}` : '';
    if (window.location.hash !== target) history.replaceState(null, '', target || window.location.pathname + window.location.search);
    // 'instant' overrides the page's smooth scrolling: the tool must open at its top.
    if (phase === 'tool') window.scrollTo({ top: 0, behavior: 'instant' });
  }, [phase, slug]);

  const country = index?.countries.find((c) => c.slug === slug) ?? null;
  const countryName = country ? t.country(country.slug, country.name) : null;
  const place = countryName ? t.place(countryName, !!bbox) : '';
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

  const sel: Selection | null = useMemo(() => {
    if (picked) return picked;
    return analysis && cal ? shortcuts(analysis, cal).latestPeak : null;
  }, [picked, analysis, cal]);

  // Picking a month puts the period back on that month.
  const select = useCallback((s: Selection) => {
    setPicked(s);
    setRange(null);
  }, []);
  const period: Period | null = useMemo(
    () => range ?? (sel && index ? monthPeriod(sel, index.coverageEndDay) : null),
    [range, sel, index],
  );

  // Detections of the period, for the map.
  useEffect(() => {
    if (phase !== 'tool' || !period || !index) return;
    let alive = true;
    client.points(slug, filters, period.from, period.to).then(
      (p) => alive && setPoints(p),
      () => alive && setPoints(null),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, index, phase, key, period?.from, period?.to]);

  const open = useCallback((s: string) => {
    setSlug(s);
    setBBox(null);
    setPicked(null);
    setRange(null);
    setDrawing(false);
    setPhase('tool');
  }, []);

  // The four fields always show the box in use: the drawn one, or the country's own.
  const shownBox = bbox ?? country?.focus ?? null;
  const shownBoxKey = shownBox?.join(',') ?? '';
  useEffect(() => {
    setBoxText(shownBox ? shownBox.map(String) : ['', '', '', '']);
    setBoxError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownBoxKey]);
  const boxEdited = shownBox !== null && boxText.some((t, i) => t.trim() !== String(shownBox[i]));

  const applyBox = (b: BBox | null) => {
    setBBox(b);
    setDrawing(false);
    setBoxError(null);
  };

  const submitBox = (e: React.FormEvent) => {
    e.preventDefault();
    if (!country || !boxEdited) return;
    const r = parseBox(boxText, country);
    if (r.ok) applyBox(r.bbox);
    else setBoxError(r);
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
      const date = t.record.dayDate(Number(isoDate(day).slice(8)), cal.month[day], cal.year[day]);
      if (mode === 'raw') return t.record.dayRaw(date, analysis.naive[day], day < SEAM_DAY ? 'MODIS' : 'VIIRS');
      const src = analysis.harmonized.src[day];
      const how = src === SRC_TERRA || src === SRC_MODIS ? 'modis' : src === SRC_GAPFILL ? 'gap-fill' : src === SRC_N20 ? 'noaa20' : 'viirs';
      return t.record.dayHarmonized(date, analysis.harmonized.h[day], how);
    },
    [analysis, cal, mode, t],
  );

  if (bootError) {
    return (
      <div className="fatal" role="alert">
        <h1 lang="en">{t.brand}</h1>
        <p>{t.app.bootError(bootError)}</p>
      </div>
    );
  }

  const empty = analysis !== null && analysis.detections.modis + analysis.detections.viirs === 0;
  const pv = analysis && sel && cal ? selectionVerdict(analysis, cal, sel.year, sel.month) : null;
  const wording = pv && sel ? t.monthWording(pv, sel.year, sel.month) : null;
  const baseline = analysis ? completeYears(analysis.monthsH) : [];
  const summaryOfPeriod = analysis && cal && period ? rangeSummary(analysis, cal, period.from, period.to) : null;
  const week = analysis && cal ? lastWeek(analysis, cal) : null;
  const weekShown = !!(period && week && period.from === week.from && period.to === week.to);

  return (
    <div className="app" data-phase={phase}>
      {phase === 'tool' && index && (
        <header className="head">
          <a className="brand" href="#top" onClick={(e) => { e.preventDefault(); setPhase('intro'); setGlobeView('spin'); }}>
            <img src="./favicon.svg" alt="" width={26} height={26} />
            <span lang="en">{t.brand}</span>
          </a>
          <nav className="places-nav" aria-label={t.app.placeNav}>
            {index.countries.map((c) => (
              <button key={c.slug} type="button" aria-pressed={c.slug === slug} onClick={() => open(c.slug)}>{t.country(c.slug, c.name)}</button>
            ))}
          </nav>
          <a className="head-link" href="#trust">{t.app.howItWorks}</a>
          <ThemeSwitch />
          <LangSwitch />
        </header>
      )}

      {/* One box for the map and the panel: the pinned map lets go where this box ends. */}
      <div className="top">
        {index && (
          <MapPanel
            phase={phase}
            view={globeView}
            countries={index.countries}
            slug={slug}
            bbox={bbox}
            drawing={drawing}
            onDraw={applyBox}
            onPick={open}
            density={phase === 'tool' && !stale ? result?.data.density ?? null : null}
            points={phase === 'tool' ? points : null}
            dataUrl={source?.url ?? client.baseUrl}
          />
        )}
        {phase === 'tool' && index && cal && (
          <aside className="side" aria-busy={!analysis || stale}>
            {error ? (
              <div className="verdict" role="alert">
                <p className="eyebrow">{t.app.wrong}</p>
                <p className="verdict-text">{error}</p>
                <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>{t.app.retry}</button>
              </div>
            ) : analysis && empty ? (
              <div className="verdict">
                <p className="eyebrow">{place}</p>
                <h2 className="verdict-answer">{t.app.nothing}</h2>
                <p className="verdict-text">{t.app.nothingText}</p>
              </div>
            ) : analysis && sel ? (
              <Verdict analysis={analysis} cal={cal} sel={sel} onSelect={select} place={place} />
            ) : (
              <div className="verdict">
                <p className="eyebrow">{countryName}</p>
                <p className="verdict-text">{t.app.reading(country ? country.n : null)}</p>
              </div>
            )}

            {analysis && week && !empty && !error && (
              <NowCard
                analysis={analysis}
                cal={cal}
                week={week}
                live={source?.live ?? false}
                shown={weekShown}
                onShow={() => setRange(weekShown ? null : { from: week.from, to: week.to })}
              />
            )}

            <form className="area" onSubmit={submitBox} aria-labelledby="area-h">
              <h2 id="area-h" className="side-h">{t.area.title}</h2>
              <p className="note">{bbox ? t.area.showingDrawn : t.area.showingAll(countryName)}</p>
              <div className="area-actions">
                <button type="button" className="btn" aria-pressed={drawing} onClick={() => setDrawing((d) => !d)}>
                  {drawing ? t.area.cancelDraw : t.area.draw}
                </button>
                {bbox && <button type="button" className="btn btn-quiet" onClick={() => applyBox(null)}>{t.area.whole}</button>}
              </div>
              {drawing && <p className="note" role="status">{t.area.drawHint}</p>}
              <div className="area-inputs">
                {t.area.edges.map((label, i) => (
                  <label key={i}>
                    <span>{label} <small>{i % 2 === 0 ? t.area.lon : t.area.lat}</small></span>
                    <input
                      type="text"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      enterKeyHint="go"
                      value={boxText[i]}
                      aria-invalid={boxError?.fields.includes(i) || undefined}
                      aria-describedby={boxError ? 'box-error' : 'box-hint'}
                      onChange={(e) => {
                        setBoxError(null);
                        setBoxText((t) => t.map((v, k) => (k === i ? e.target.value : v)));
                      }}
                    />
                  </label>
                ))}
                <button type="submit" className="btn btn-quiet" disabled={!boxEdited}>{t.area.apply}</button>
              </div>
              {boxError && country ? (
                <p id="box-error" className="form-error" role="alert">{t.area.boxError(boxError, countryName ?? country.name, country.bbox)}</p>
              ) : (
                <p id="box-hint" className="note">{t.area.hint}</p>
              )}
              <h3 className="side-sub">{t.area.filters}</h3>
              <div className="filters">
                <label>
                  <input type="checkbox" checked={flags.vegOnly} onChange={(e) => setFlags((f) => ({ ...f, vegOnly: e.target.checked }))} />
                  {t.area.vegOnly} <small>{t.area.vegOnlyNote}</small>
                </label>
                <label>
                  <input type="checkbox" checked={flags.dropLowConf} onChange={(e) => setFlags((f) => ({ ...f, dropLowConf: e.target.checked }))} />
                  {t.area.dropLow}
                </label>
              </div>
              {sel && period && summaryOfPeriod && (
                <PeriodPanel
                  period={period}
                  custom={range}
                  sel={sel}
                  lastDay={index.coverageEndDay}
                  summary={summaryOfPeriod}
                  onChange={setRange}
                />
              )}
              <h3 className="side-sub">{t.area.mapKey}</h3>
              <p className="map-key">
                <span><i className="pt pt-viirs" /> VIIRS</span>
                <span><i className="pt pt-modis" /> MODIS</span>
                <span>
                  {period && points ? t.area.onMap(points.total, points.lon.length, t.rangeName(period.from, period.to)) : ''}
                </span>
                <span><i className="glow" /> {t.area.footprint}</span>
              </p>
            </form>
          </aside>
        )}
      </div>

      {phase === 'intro' && summary && story && cal && <Intro summary={summary} story={story} cal={cal} onView={setGlobeView} onOpen={open} />}
      {phase === 'intro' && !(summary && story && cal) && <p className="boot">{t.app.loading}</p>}

      {phase === 'tool' && index && cal && (
        <>
          {analysis && sel && series && steps && !empty && (
            <main className="main" data-stale={stale || undefined}>
              <section id="record" aria-labelledby="record-h">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">{t.record.eyebrow}</p>
                    <h2 id="record-h">{t.record.title(baseline.length)}</h2>
                  </div>
                  <div className="seg" role="group" aria-label={t.record.modeAria}>
                    <button type="button" aria-pressed={mode === 'harmonized'} onClick={() => setMode('harmonized')}>{t.record.harmonized}</button>
                    <button type="button" aria-pressed={mode === 'raw'} onClick={() => setMode('raw')}>{t.record.raw}</button>
                  </div>
                </div>
                <p className="lede">
                  {mode === 'raw'
                    ? t.record.ledeRaw(Number.isFinite(steps.raw) ? steps.raw : null)
                    : t.record.ledeHarmonized(
                      cal.year[FIRST_DAY],
                      Number.isFinite(steps.harmonized) && Number.isFinite(steps.raw) ? steps : null,
                    )}
                </p>
                <div className="record-grid">
                  <FireRings
                    ref={rings}
                    daily={series}
                    cal={cal}
                    max={ringMax}
                    sel={sel}
                    onSelect={select}
                    title={bbox ? t.record.selectedArea : countryName ?? ''}
                    describe={describeDay}
                    seamYear={SEAM_YEAR}
                  />
                  <BurnCalendar analysis={analysis} mode={mode} sel={sel} onSelect={select} seamYear={SEAM_YEAR} />
                </div>
                <Records analysis={analysis} sel={sel} onSelect={select} />
              </section>

              <section id="season" aria-labelledby="season-h">
                <p className="eyebrow">{t.season.eyebrow}</p>
                <h2 id="season-h">{t.season.title(sel.year)}</h2>
                <SeasonChart season={analysis.season} year={sel.year} baseline={[baseline[0], baseline[baseline.length - 1]]} peak={analysis.peak} />
              </section>

              <section id="trust" aria-labelledby="trust-h">
                <p className="eyebrow">{t.trust.eyebrow}</p>
                <h2 id="trust-h">{t.trust.title}</h2>
                <p className="lede">{t.trust.lede}</p>
                <TrustPanel
                  analysis={analysis}
                  place={place}
                  isArea={!!bbox}
                  outages={index.viirsOutages}
                  coverageEnd={t.longDate(index.coverageEndDay)}
                  nrtFrom={index.nrtFromDay && Object.keys(index.nrtFromDay).length > 0 ? t.longDate(Math.min(...Object.values(index.nrtFromDay))) : null}
                  snppEnd={index.snppEndDay != null ? t.longDate(index.snppEndDay) : null}
                />
              </section>

              <section id="export" aria-labelledby="export-h">
                <p className="eyebrow">{t.exp.eyebrow}</p>
                <h2 id="export-h">{t.exp.title}</h2>
                {period && (
                  <ExportMenu
                    client={client}
                    slug={slug}
                    filters={filters}
                    analysis={analysis}
                    cal={cal}
                    sel={sel}
                    period={period}
                    ringsCanvas={() => rings.current?.canvas() ?? null}
                    place={countryName ? t.exp.placeTitle(countryName, !!bbox) : ''}
                    headline={pv ? t.answer[pv.verdict.level] : ''}
                    detail={pv && wording ? t.verdictSentence(pv.verdict, wording.what, wording.usual, place) : ''}
                  />
                )}
              </section>
            </main>
          )}

          <footer className="foot">
            <p>
              {t.foot.sources(
                analysis ? analysis.detections.modis + analysis.detections.viirs : null,
                t.longDate(index.coverageEndDay),
                source?.live ?? false,
              )}
            </p>
            <p>{t.foot.built}</p>
          </footer>
        </>
      )}
    </div>
  );
}
