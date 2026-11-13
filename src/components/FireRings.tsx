import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { EMBER, ember, rampPosition } from '../lib/color.ts';
import { dayIndex, FIRST_DAY, MONTHS, type Calendar } from '../lib/time.ts';
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

const LEVELS = 48;
const TAU = Math.PI * 2;

export const FireRings = forwardRef<FireRingsHandle, Props>(function FireRings(props, ref) {
  const { daily, cal, max, sel, onSelect, title, describe, seamYear } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { width } = useSize(wrap);
  const size = Math.max(240, Math.min(width || 480, 620));
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  /** Ramp positions currently on screen, so mode switches can tween. */
  const shown = useRef<Float32Array | null>(null);
  const describeRef = useRef(describe);
  describeRef.current = describe;

  useImperativeHandle(ref, () => ({ canvas: () => canvasRef.current }), []);

  const firstYear = cal.year[FIRST_DAY];
  const lastYear = cal.year[cal.nDays - 1];
  const nYears = lastYear - firstYear + 1;
  const pad = size < 360 ? 20 : 26;
  const R = size / 2 - pad;
  const r0 = R * 0.2;
  const th = (R - r0) / nYears;
  const daysIn = (y: number) => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const c = size / 2;

    const target = new Float32Array(cal.nDays);
    for (let d = FIRST_DAY; d < cal.nDays; d++) target[d] = rampPosition(daily[d], max);
    const from = shown.current && shown.current.length === target.length ? shown.current : null;

    const draw = (t: Float32Array) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.lineCap = 'butt';

      // Base rings: zero activity, drawn only where the record has coverage.
      ctx.lineWidth = Math.max(1, th - 0.7);
      ctx.strokeStyle = EMBER[0];
      for (let y = firstYear; y <= lastYear; y++) {
        const r = r0 + (y - firstYear + 0.5) * th;
        const startDoy = y === firstYear ? cal.doy[FIRST_DAY] : 0;
        ctx.beginPath();
        ctx.arc(c, c, r, -Math.PI / 2 + (TAU * startDoy) / daysIn(y), -Math.PI / 2 + TAU);
        ctx.stroke();
      }

      // Active days, batched by colour level.
      const buckets: number[][] = Array.from({ length: LEVELS + 1 }, () => []);
      for (let d = FIRST_DAY; d < cal.nDays; d++) {
        if (t[d] > 0.001) buckets[Math.round(t[d] * LEVELS)].push(d);
      }
      for (let level = 1; level <= LEVELS; level++) {
        const days = buckets[level];
        if (days.length === 0) continue;
        ctx.strokeStyle = ember(level / LEVELS);
        ctx.beginPath();
        for (const d of days) {
          const y = cal.year[d];
          const n = daysIn(y);
          const r = r0 + (y - firstYear + 0.5) * th;
          const a0 = -Math.PI / 2 + (TAU * cal.doy[d]) / n;
          const a1 = a0 + TAU / n + 0.004;
          ctx.moveTo(c + r * Math.cos(a0), c + r * Math.sin(a0));
          ctx.arc(c, c, r, a0, a1);
        }
        ctx.stroke();
      }

      // Month spokes.
      ctx.strokeStyle = 'rgba(14, 12, 10, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let m = 0; m < 12; m++) {
        const a = -Math.PI / 2 + (TAU * (dayIndex(2001, m + 1, 1) - dayIndex(2001, 1, 1))) / 365;
        ctx.moveTo(c + r0 * Math.cos(a), c + r0 * Math.sin(a));
        ctx.lineTo(c + R * Math.cos(a), c + R * Math.sin(a));
      }
      ctx.stroke();

      // Seam: the ring boundary where VIIRS takes over.
      const rSeam = r0 + (seamYear - firstYear) * th;
      ctx.strokeStyle = 'rgba(243, 237, 228, 0.55)';
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.arc(c, c, rSeam, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);

      // Month labels.
      ctx.fillStyle = '#8c8274';
      ctx.font = `500 ${size < 360 ? 9 : 11}px "IBM Plex Sans", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let m = 0; m < 12; m++) {
        const a = -Math.PI / 2 + (TAU * (m + 0.5)) / 12;
        ctx.fillText(MONTHS[m], c + (R + pad / 2 + 1) * Math.cos(a), c + (R + pad / 2 + 1) * Math.sin(a));
      }

      // Year labels along the 1 January spoke.
      ctx.font = `500 ${size < 360 ? 8 : 9.5}px "IBM Plex Mono", ui-monospace, monospace`;
      ctx.textAlign = 'left';
      for (let y = firstYear; y <= lastYear; y += 5) {
        const r = r0 + (y - firstYear + 0.5) * th;
        const label = String(y);
        const w = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(14, 12, 10, 0.78)';
        ctx.fillRect(c + 2, c - r - 6, w + 5, 12);
        ctx.fillStyle = '#c4b9a8';
        ctx.fillText(label, c + 4.5, c - r + 0.5);
      }

      // Selected month: outline its sector.
      if (sel.year >= firstYear && sel.year <= lastYear) {
        const n = daysIn(sel.year);
        const jan1 = dayIndex(sel.year, 1, 1);
        const a0 = -Math.PI / 2 + (TAU * (dayIndex(sel.year, sel.month + 1, 1) - jan1)) / n;
        const a1 = -Math.PI / 2 + (TAU * (dayIndex(sel.year, sel.month + 2, 1) - jan1)) / n;
        const ri = r0 + (sel.year - firstYear) * th - 1;
        const ro = ri + th + 2;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(c, c, ro, a0, a1);
        ctx.arc(c, c, ri, a1, a0, true);
        ctx.closePath();
        ctx.stroke();
      }

      // Core label.
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f3ede4';
      ctx.font = `500 ${Math.max(11, r0 * 0.3)}px "Fraunces Variable", Georgia, serif`;
      ctx.fillText(title, c, c - r0 * 0.14, r0 * 1.7);
      ctx.fillStyle = '#8c8274';
      ctx.font = `500 ${Math.max(8, r0 * 0.19)}px "IBM Plex Mono", ui-monospace, monospace`;
      ctx.fillText(`${firstYear}–${lastYear}`, c, c + r0 * 0.28);
    };

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
  }, [daily, cal, max, size, sel.year, sel.month, title, seamYear, firstYear, lastYear, R, r0, th, pad]);

  // Fonts load after first paint; redraw once they are ready so labels use them.
  const [, bump] = useState(0);
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => alive && bump((n) => n + 1));
    return () => {
      alive = false;
    };
  }, []);

  const locate = (e: React.PointerEvent | React.MouseEvent): number | null => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top - size / 2;
    const r = Math.hypot(x, y);
    const yi = Math.floor((r - r0) / th);
    if (yi < 0 || yi >= nYears) return null;
    const year = firstYear + yi;
    const frac = ((Math.atan2(y, x) + Math.PI / 2 + TAU) % TAU) / TAU;
    const day = dayIndex(year, 1, 1) + Math.min(daysIn(year) - 1, Math.floor(frac * daysIn(year)));
    return day >= FIRST_DAY && day < cal.nDays ? day : null;
  };

  return (
    <div ref={wrap} className="rings">
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size }}
        role="img"
        aria-label={`Fire rings for ${title}: one ring per year from ${firstYear} at the centre to ${lastYear} at the edge, one step per day clockwise from 1 January at the top. The same numbers are in the burning calendar table.`}
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
