import { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { LangSwitch, useI18n } from '../i18n/index.tsx';
import { rampPosition, SERIES } from '../lib/color.ts';
import { drawRings } from '../lib/rings.ts';
import { dayIndex, FIRST_DAY, type Calendar } from '../lib/time.ts';
import type { CountrySummary, GlobeView, IntroStory, SeamMode } from '../lib/types.ts';

gsap.registerPlugin(ScrollTrigger, useGSAP);

interface Props {
  summary: CountrySummary[];
  story: IntroStory;
  cal: Calendar;
  onView: (view: GlobeView) => void;
  onOpen: (slug: string) => void;
}

const SEAM_YEAR = 2012;
// Scroll progress through the pinned scene: the rings finish growing at REVEAL,
// then the raw record is blended into the harmonized one between BLEND_0 and BLEND_1.
const REVEAL = 0.6;
const BLEND_0 = 0.7;
const BLEND_1 = 0.86;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Yearly totals as bars: raw record with its 2012 jump, or the harmonized one. */
export function SeamBars({ country, mode }: { country: CountrySummary; mode: SeamMode }) {
  const { t } = useI18n();
  const years = country.years.filter((y) => y.complete);
  const max = Math.max(...years.map((y) => (mode === 'raw' ? y.raw : y.harmonized)));
  const first = years[0].year;
  const last = years[years.length - 1].year;
  return (
    <figure className="seam-bars" data-mode={mode}>
      <div
        className="seam-plot"
        role="img"
        aria-label={t.intro.barsAria(mode, t.country(country.slug, country.name), first, last)}
      >
        {years.map((y) => {
          const v = mode === 'raw' ? y.raw : y.harmonized;
          const color = mode === 'harmonized' ? SERIES.harmonized : y.year < SEAM_YEAR ? SERIES.modis : SERIES.viirs;
          return (
            <span key={y.year} className={y.year === SEAM_YEAR ? 'seam-col seam-first' : 'seam-col'}>
              <i style={{ height: `${Math.max(1.5, (v / max) * 100)}%`, background: color }} />
            </span>
          );
        })}
      </div>
      <div className="seam-axis" aria-hidden="true">
        <span>{first}</span>
        <span className="seam-mark" dir={t.dir}>{t.intro.viirsArrives(SEAM_YEAR)}</span>
        <span>{last}</span>
      </div>
      <ul className="legend" aria-label={t.intro.legendAria}>
        {mode === 'raw' ? (
          <>
            <li><i className="key-dot" style={{ background: SERIES.modis }} /> {t.intro.modisDetections}</li>
            <li><i className="key-dot" style={{ background: SERIES.viirs }} /> {t.intro.viirsDetections}</li>
          </>
        ) : (
          <li><i className="key-dot" style={{ background: SERIES.harmonized }} /> {t.intro.harmonizedRecord}</li>
        )}
      </ul>
    </figure>
  );
}

function robustMax(values: Float32Array): number {
  const pos = Array.from(values).filter((v) => v > 0).sort((a, b) => a - b);
  return pos.length ? pos[Math.min(pos.length - 1, Math.floor(pos.length * 0.995))] : 1;
}

export function Intro({ summary, story, cal, onView, onOpen }: Props) {
  const { t } = useI18n();
  const root = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ringsBox = useRef<HTMLDivElement>(null);
  const veil = useRef<HTMLDivElement>(null);
  const ticker = useRef<HTMLSpanElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const [caption, setCaption] = useState(0);
  const [bars, setBars] = useState<SeamMode>('raw');
  const onViewRef = useRef(onView);
  onViewRef.current = onView;
  const name = t.country(story.slug, story.name);
  // What the canvas writes, read at draw time so a change of language needs no new scroll setup.
  const labels = useRef({ months: t.months, name });
  labels.current = { months: t.months, name };
  const redraw = useRef<(() => void) | null>(null);

  const pt = summary.find((s) => s.slug === story.slug) ?? summary[0];
  const complete = pt.years.filter((y) => y.complete);
  const topYear = complete.reduce((a, b) => (b.harmonized > a.harmonized ? b : a)).year;

  // Ramp positions for both records, and the running count of raw detections.
  const data = useMemo(() => {
    const n = cal.nDays;
    const raw = new Float32Array(n);
    const harm = new Float32Array(n);
    raw.set(story.raw.slice(0, n - story.firstDay), story.firstDay);
    harm.set(story.harmonized.slice(0, n - story.firstDay), story.firstDay);
    const rawMax = robustMax(raw);
    const harmMax = robustMax(harm);
    const rawT = new Float32Array(n);
    const harmT = new Float32Array(n);
    const seen = new Float64Array(n + 1);
    for (let d = 0; d < n; d++) {
      rawT[d] = rampPosition(raw[d], rawMax);
      harmT[d] = rampPosition(harm[d], harmMax);
      seen[d + 1] = seen[d] + raw[d];
    }
    return { rawT, harmT, seen };
  }, [story, cal]);

  /** Scroll progress at which the rings reach 1 January of `year`. */
  const progressOf = (year: number) => (REVEAL * (dayIndex(year, 1, 1) - FIRST_DAY)) / (cal.nDays - FIRST_DAY);
  const marks = [
    { p: 0, label: String(cal.year[FIRST_DAY]), more: '' },
    { p: progressOf(SEAM_YEAR), label: String(SEAM_YEAR), more: t.intro.markViirs },
    { p: REVEAL, label: String(cal.year[cal.nDays - 1]), more: '' },
    { p: (BLEND_0 + BLEND_1) / 2, label: t.intro.markStitch, more: '' },
  ];

  useGSAP(
    () => {
      const el = root.current;
      const canvas = canvasRef.current;
      const box = ringsBox.current;
      const ctx = canvas?.getContext('2d');
      if (!el || !canvas || !box || !ctx) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const scene = el.querySelector<HTMLElement>('.scene-rings')!;
      const pick = el.querySelector<HTMLElement>('.scene-pick')!;
      const { rawT, harmT, seen } = data;
      const n = cal.nDays;
      const mix = new Float32Array(n);
      const state = { p: 0 };
      let size = 0;
      let dpr = 1;
      let lastBlend = -1;
      let lastKey = '';
      let shownCaption = -1;
      let shownBars: SeamMode | null = null;
      const pTop = progressOf(topYear);
      const pSeam = progressOf(SEAM_YEAR);

      const render = () => {
        if (size === 0) return;
        const p = state.p;
        const revealDay = FIRST_DAY + clamp01(p / REVEAL) * (n - FIRST_DAY);
        const k = clamp01((p - BLEND_0) / (BLEND_1 - BLEND_0));
        const blend = k * k * (3 - 2 * k);
        const day = Math.max(FIRST_DAY + 1, Math.floor(revealDay));
        const key = `${day}|${blend.toFixed(3)}|${size}`;
        if (key !== lastKey) {
          lastKey = key;
          if (blend !== lastBlend) {
            lastBlend = blend;
            for (let d = FIRST_DAY; d < n; d++) mix[d] = rawT[d] + (harmT[d] - rawT[d]) * blend;
          }
          drawRings(ctx, {
            size, dpr, cal, t: mix, revealDay: day, sel: null,
            title: String(cal.year[day - 1]), subtitle: labels.current.name,
            seamYear: SEAM_YEAR, seamPhase: blend * 72, bigTitle: true, months: labels.current.months,
          });
          if (ticker.current) ticker.current.textContent = Math.round(seen[day]).toLocaleString('en-US');
        }
        if (fill.current) fill.current.style.transform = `scaleX(${p})`;
        const cap = p >= 0.9 ? 4 : p >= BLEND_0 - 0.03 ? 3 : p >= pSeam ? 2 : p >= pTop ? 1 : 0;
        if (cap !== shownCaption) {
          shownCaption = cap;
          setCaption(cap);
        }
        const mode: SeamMode = blend >= 0.5 ? 'harmonized' : 'raw';
        if (mode !== shownBars) {
          shownBars = mode;
          setBars(mode);
        }
      };

      const resize = () => {
        const r = box.getBoundingClientRect();
        const next = Math.floor(Math.min(r.width, r.height, 680));
        if (next <= 0 || next === size) return;
        size = next;
        dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        canvas.width = Math.round(size * dpr);
        canvas.height = Math.round(size * dpr);
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;
        lastKey = '';
        render();
      };
      const ro = new ResizeObserver(resize);
      ro.observe(box);
      resize();
      const repaint = () => {
        lastKey = '';
        render();
      };
      redraw.current = repaint;
      document.fonts?.ready.then(repaint);
      // Another script's fonts arrive when the language changes.
      document.fonts?.addEventListener('loadingdone', repaint);

      // Title rises letter by letter, then drifts away as the story starts.
      if (!reduce) {
        gsap.from('.hero-char', { yPercent: 118, duration: 1.1, ease: 'power4.out', stagger: 0.04, delay: 0.1 });
        gsap.from('.hero-fade', { opacity: 0, y: 18, duration: 0.9, ease: 'power2.out', stagger: 0.14, delay: 0.75 });
      }
      gsap.to('.hero-inner', {
        yPercent: -24, opacity: 0, ease: 'none',
        scrollTrigger: { trigger: '.scene-hero', start: 'top top', end: 'bottom 40%', scrub: true },
      });

      // The rings roll in from below, then grow with the scroll.
      gsap.from(box, {
        scale: 0.5, rotate: -40, opacity: 0, ease: 'none',
        scrollTrigger: { trigger: scene, start: 'top 85%', end: 'top top', scrub: true },
      });
      gsap.to(state, {
        p: 1, ease: 'none', onUpdate: render,
        scrollTrigger: { trigger: scene, start: 'top top', end: 'bottom bottom', scrub: reduce ? true : 0.6 },
      });

      // The veil darkens the globe while the rings have the stage.
      const setVeil = () => {
        const vh = window.innerHeight;
        const enter = clamp01((0.9 * vh - scene.getBoundingClientRect().top) / (0.7 * vh));
        const leave = clamp01((0.95 * vh - pick.getBoundingClientRect().top) / (0.6 * vh));
        if (veil.current) veil.current.style.opacity = String(0.9 * enter * (1 - leave));
      };
      ScrollTrigger.create({ trigger: el, start: 'top top', end: 'bottom bottom', onUpdate: setVeil, onRefresh: setVeil });

      // Tell the globe what to do: turn, rest under the veil, or settle for picking.
      ScrollTrigger.create({
        trigger: scene,
        start: 'top 30%',
        end: 'bottom 85%',
        onEnter: () => onViewRef.current('hold'),
        onEnterBack: () => onViewRef.current('hold'),
        onLeave: () => onViewRef.current('pick'),
        onLeaveBack: () => onViewRef.current('spin'),
      });

      return () => {
        ro.disconnect();
        document.fonts?.removeEventListener('loadingdone', repaint);
        redraw.current = null;
      };
    },
    { scope: root, dependencies: [data, cal, story, topYear] },
  );

  // A new language changes the canvas labels and the height of the text around it.
  useEffect(() => {
    redraw.current?.();
    ScrollTrigger.refresh();
  }, [t]);

  const captions = t.intro.captions({
    name,
    firstYear: cal.year[FIRST_DAY],
    topYear,
    seamYear: SEAM_YEAR,
    years: complete.length,
    seamStep: pt.seamStepRaw,
    errorRaw: pt.validation.mdapeRaw,
    error: pt.validation.mdape,
  });

  return (
    <main ref={root} className="intro">
      <div ref={veil} className="veil" aria-hidden="true" />
      <div className="intro-actions">
        <LangSwitch />
        <button type="button" className="skip" onClick={() => onOpen(story.slug)}>{t.intro.skip}</button>
      </div>

      <section className="scene scene-hero">
        <div className="hero-inner">
          <p className="eyebrow hero-fade">{t.intro.eyebrow}</p>
          <h1 lang="en" aria-label={t.brand}>
            {t.brand.split(' ').map((word, w) => (
              <span key={w} className="hero-word" aria-hidden="true">
                {[...word].map((ch, i) => <span key={i} className="hero-char">{ch}</span>)}
              </span>
            ))}
          </h1>
          <p className="hero-q hero-fade">{t.intro.question}</p>
          <p className="hero-sub hero-fade">{t.intro.sub(complete.length)}</p>
          <p className="scroll-cue hero-fade" aria-hidden="true">{t.intro.cue}</p>
        </div>
      </section>

      <section className="scene scene-rings" aria-label={t.intro.sceneAria(name)}>
        <div className="stage">
          <div ref={ringsBox} className="story-rings">
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={t.intro.canvasAria(name, cal.year[FIRST_DAY], cal.year[cal.nDays - 1])}
            />
          </div>

          <div className="story-text">
            <p className="ticker" aria-hidden="true">{t.intro.ticker(<span ref={ticker}>0</span>)}</p>
            <div className="captions" data-active={caption}>
              {captions.map((c, i) => (
                <article key={i}>
                  <p className="eyebrow">{c.eyebrow}</p>
                  <h2>{c.title}</h2>
                  <p>{c.body}</p>
                </article>
              ))}
            </div>
            <div className="story-bars" data-show={caption >= 2 || undefined}>
              <SeamBars country={pt} mode={bars} />
            </div>
          </div>

          <div className="rail" aria-hidden="true">
            <span className="rail-track"><span ref={fill} className="rail-fill" /></span>
            {marks.map((m) => (
              <span key={m.label} className="rail-mark" style={{ left: `${m.p * 100}%` }}>
                {m.label}{m.more && <span className="rail-more">{m.more}</span>}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="scene scene-pick">
        <div className="card">
          <p className="eyebrow">{t.intro.pickEyebrow}</p>
          <h2>{t.intro.pickTitle}</h2>
          <p>{t.intro.pickText}</p>
          <ul className="places">
            {summary.map((s) => (
              <li key={s.slug}>
                <button type="button" onClick={() => onOpen(s.slug)}>
                  <strong>{t.country(s.slug, s.name)}</strong>
                  <span>{t.intro.detections(s.detections.modis + s.detections.viirs)}</span>
                  <span>{t.intro.viirsSees(s.ratio)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
