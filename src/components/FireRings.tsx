import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { rampPosition } from '../lib/color.ts';
import { dayAt, drawRings, ringsGeometry } from '../lib/rings.ts';
import { useTheme } from '../lib/theme.tsx';
import { FIRST_DAY, type Calendar } from '../lib/time.ts';
import { useSize } from './useSize.ts';

export interface Selection {
  year: number;
  /** 0-11 */
  month: number;
}

interface Props {
  /** Daily values, indexed by day since 2000-01-01. */
  daily: Float32Array;
  cal: Calendar;
  /** Value that maps to the top of the ramp. */
  max: number;
  sel: Selection;
  onSelect: (s: Selection) => void;
  title: string;
  /** Tooltip text for a day. */
  describe: (day: number) => string;
  /** Year whose ring starts the VIIRS era, for the seam marker. */
  seamYear: number;
}

export interface FireRingsHandle {
  /** The rings as currently drawn, for export. */
  canvas: () => HTMLCanvasElement | null;
}

export const FireRings = forwardRef<FireRingsHandle, Props>(function FireRings(props, ref) {
  const { daily, cal, max, sel, onSelect, title, describe, seamYear } = props;
  const { t: words } = useI18n();
  const theme = useTheme();
  const months = words.months;
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { width } = useSize(wrap);
  const size = Math.max(240, Math.min(width || 480, 620));
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  /** Ramp positions currently on screen, so mode switches can tween. */
  const shown = useRef<Float32Array | null>(null);
  const describeRef = useRef(describe);
  describeRef.current = describe;
  // Fonts load after first paint, and again when the language brings in another
  // script; redraw each time a batch is ready so labels use them.
  const [fontsReady, setFontsReady] = useState(0);

  useImperativeHandle(ref, () => ({ canvas: () => canvasRef.current }), []);

  useEffect(() => {
    let alive = true;
    const bump = () => alive && setFontsReady((n) => n + 1);
    document.fonts?.ready.then(bump);
    document.fonts?.addEventListener('loadingdone', bump);
    return () => {
      alive = false;
      document.fonts?.removeEventListener('loadingdone', bump);
    };
  }, []);

  const g = ringsGeometry(size, cal);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const target = new Float32Array(cal.nDays);
    for (let d = FIRST_DAY; d < cal.nDays; d++) target[d] = rampPosition(daily[d], max);
    const from = shown.current && shown.current.length === target.length ? shown.current : null;
    const draw = (t: Float32Array) =>
      drawRings(ctx, { size, dpr, cal, t, sel, title, subtitle: `${g.firstYear}–${g.lastYear}`, seamYear, months });

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!from || reduce) {
      shown.current = target;
      draw(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const mix = new Float32Array(target.length);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 750);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      for (let d = FIRST_DAY; d < mix.length; d++) mix[d] = from[d] + (target[d] - from[d]) * e;
      shown.current = mix;
      draw(mix);
      if (k < 1) raf = requestAnimationFrame(step);
      else shown.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      // Keep whatever was on screen as the start of the next tween.
      shown.current = Float32Array.from(shown.current ?? target);
    };
    // sel is split into primitives; g is derived from size and cal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily, cal, max, size, sel.year, sel.month, title, seamYear, fontsReady, months, theme]);

  const locate = (e: React.PointerEvent | React.MouseEvent): number | null => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return dayAt(g, cal, e.clientX - rect.left - size / 2, e.clientY - rect.top - size / 2);
  };

  return (
    <div ref={wrap} className="rings">
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size }}
        role="img"
        aria-label={words.rings.aria(title, g.firstYear, g.lastYear)}
        onPointerMove={(e) => {
          const day = locate(e);
          if (day === null) return setTip(null);
          const rect = wrap.current!.getBoundingClientRect();
          setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, text: describeRef.current(day) });
        }}
        onPointerLeave={() => setTip(null)}
        onClick={(e) => {
          const day = locate(e);
          if (day !== null) onSelect({ year: cal.year[day], month: cal.month[day] });
        }}
      />
      {tip && (
        <div className="tip" style={{ left: tip.x, top: tip.y }} role="status">
          {tip.text}
        </div>
      )}
    </div>
  );
});
