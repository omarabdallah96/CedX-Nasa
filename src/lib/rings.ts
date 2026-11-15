// Canvas renderer for the Fire Rings: one ring per year, one step per day,
// clockwise from 1 January at the top. Shared by the tool and the intro story.

import { cssVar, ember, ramp } from './color.ts';
import { dayIndex, FIRST_DAY, MONTHS, type Calendar } from './time.ts';

const LEVELS = 48;
const TAU = Math.PI * 2;
const TOP = -Math.PI / 2;

export const daysInYear = (y: number): number => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365);

export interface RingsGeometry {
  size: number;
  pad: number;
  /** Outer radius of the last ring. */
  R: number;
  /** Inner radius of the first ring. */
  r0: number;
  /** Ring thickness. */
  th: number;
  firstYear: number;
  lastYear: number;
  nYears: number;
}

export function ringsGeometry(size: number, cal: Calendar): RingsGeometry {
  const firstYear = cal.year[FIRST_DAY];
  const lastYear = cal.year[cal.nDays - 1];
  const nYears = lastYear - firstYear + 1;
  const pad = size < 360 ? 20 : 26;
  const R = size / 2 - pad;
  const r0 = R * 0.2;
  return { size, pad, R, r0, th: (R - r0) / nYears, firstYear, lastYear, nYears };
}

/** Day under a point given relative to the canvas centre, or null outside the rings. */
export function dayAt(g: RingsGeometry, cal: Calendar, x: number, y: number): number | null {
  const yi = Math.floor((Math.hypot(x, y) - g.r0) / g.th);
  if (yi < 0 || yi >= g.nYears) return null;
  const year = g.firstYear + yi;
  const frac = ((Math.atan2(y, x) - TOP + TAU) % TAU) / TAU;
  const day = dayIndex(year, 1, 1) + Math.min(daysInYear(year) - 1, Math.floor(frac * daysInYear(year)));
  return day >= FIRST_DAY && day < cal.nDays ? day : null;
}

export interface DrawRingsOptions {
  size: number;
  dpr: number;
  cal: Calendar;
  /** Ramp position (0-1) for every day index. */
  t: Float32Array;
  /** Draw only days before this day index: the record "grown" so far. Defaults to all. */
  revealDay?: number;
  sel?: { year: number; month: number } | null;
  title: string;
  subtitle: string;
  /** First year of the VIIRS era; its inner edge is drawn as a dotted seam. */
  seamYear: number;
  /** Phase of the seam's dots, for a stitching animation. */
  seamPhase?: number;
  /** Fill the core with the title (the intro shows the running year there). */
  bigTitle?: boolean;
  /** Twelve short month names for the rim; English when omitted. */
  months?: string[];
}

// Arabic falls through to the Arabic faces; Latin text and digits keep the first one.
const SANS = '"IBM Plex Sans", "IBM Plex Sans Arabic", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", "IBM Plex Sans Arabic", ui-monospace, monospace';
const DISPLAY = '"Fraunces Variable", "Amiri", Georgia, serif';

export function drawRings(ctx: CanvasRenderingContext2D, o: DrawRingsOptions): void {
  const { size, dpr, cal, t, sel } = o;
  const g = ringsGeometry(size, cal);
  const { R, r0, th, pad, firstYear } = g;
  const end = Math.max(FIRST_DAY, Math.min(cal.nDays, Math.floor(o.revealDay ?? cal.nDays)));
  const lastShown = end > FIRST_DAY ? cal.year[end - 1] : firstYear - 1;
  const c = size / 2;
  const radius = (y: number) => r0 + (y - firstYear + 0.5) * th;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = 'butt';

  // Base rings: zero activity, only where the record has coverage and has been revealed.
  ctx.lineWidth = Math.max(1, th - 0.7);
  ctx.strokeStyle = ramp()[0];
  for (let y = firstYear; y <= lastShown; y++) {
    const n = daysInYear(y);
    const from = y === firstYear ? cal.doy[FIRST_DAY] : 0;
    const to = y === lastShown ? cal.doy[end - 1] + 1 : n;
    ctx.beginPath();
    ctx.arc(c, c, radius(y), TOP + (TAU * from) / n, TOP + (TAU * to) / n);
    ctx.stroke();
  }

  // Active days, batched by colour level.
  const buckets: number[][] = Array.from({ length: LEVELS + 1 }, () => []);
  for (let d = FIRST_DAY; d < end; d++) {
    if (t[d] > 0.001) buckets[Math.round(t[d] * LEVELS)].push(d);
  }
  for (let level = 1; level <= LEVELS; level++) {
    const days = buckets[level];
    if (days.length === 0) continue;
    ctx.strokeStyle = ember(level / LEVELS);
    ctx.beginPath();
    for (const d of days) {
      const y = cal.year[d];
      const n = daysInYear(y);
      const r = radius(y);
      const a0 = TOP + (TAU * cal.doy[d]) / n;
      ctx.moveTo(c + r * Math.cos(a0), c + r * Math.sin(a0));
      ctx.arc(c, c, r, a0, a0 + TAU / n + 0.004);
    }
    ctx.stroke();
  }

  // Colours follow the theme's stylesheet tokens.
  const page = cssVar('--page');
  const ink = cssVar('--ink');
  const ink2 = cssVar('--ink-2');
  const ink3 = cssVar('--ink-3');

  // Month spokes: thin cuts of page colour.
  ctx.strokeStyle = page;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let m = 0; m < 12; m++) {
    const a = TOP + (TAU * (dayIndex(2001, m + 1, 1) - dayIndex(2001, 1, 1))) / 365;
    ctx.moveTo(c + r0 * Math.cos(a), c + r0 * Math.sin(a));
    ctx.lineTo(c + R * Math.cos(a), c + R * Math.sin(a));
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Seam: the ring boundary where VIIRS takes over.
  if (lastShown >= o.seamYear) {
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([2, 4]);
    ctx.lineDashOffset = -(o.seamPhase ?? 0);
    ctx.beginPath();
    ctx.arc(c, c, r0 + (o.seamYear - firstYear) * th, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.globalAlpha = 1;
  }

  // Month labels.
  ctx.fillStyle = ink3;
  ctx.font = `500 ${size < 360 ? 9 : 11}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const months = o.months ?? MONTHS;
  for (let m = 0; m < 12; m++) {
    const a = TOP + (TAU * (m + 0.5)) / 12;
    // Longer names (Arabic) are nudged inward rather than cut by the canvas edge.
    const half = ctx.measureText(months[m]).width / 2 + 1;
    const x = Math.min(size - half, Math.max(half, c + (R + pad / 2 + 1) * Math.cos(a)));
    ctx.fillText(months[m], x, c + (R + pad / 2 + 1) * Math.sin(a));
  }

  // Year labels along the 1 January spoke.
  ctx.font = `500 ${size < 360 ? 8 : 9.5}px ${MONO}`;
  ctx.textAlign = 'left';
  for (let y = firstYear; y <= lastShown; y += 5) {
    const label = String(y);
    const w = ctx.measureText(label).width;
    ctx.fillStyle = page;
    ctx.globalAlpha = 0.78;
    ctx.fillRect(c + 2, c - radius(y) - 6, w + 5, 12);
    ctx.globalAlpha = 1;
    ctx.fillStyle = ink2;
    ctx.fillText(label, c + 4.5, c - radius(y) + 0.5);
  }

  // Selected month: outline its sector.
  if (sel && sel.year >= firstYear && sel.year <= lastShown) {
    const n = daysInYear(sel.year);
    const jan1 = dayIndex(sel.year, 1, 1);
    const a0 = TOP + (TAU * (dayIndex(sel.year, sel.month + 1, 1) - jan1)) / n;
    const a1 = TOP + (TAU * (dayIndex(sel.year, sel.month + 2, 1) - jan1)) / n;
    const ri = r0 + (sel.year - firstYear) * th - 1;
    ctx.strokeStyle = cssVar('--select-ring');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c, c, ri + th + 2, a0, a1);
    ctx.arc(c, c, ri, a1, a0, true);
    ctx.closePath();
    ctx.stroke();
  }

  // Core label.
  ctx.textAlign = 'center';
  ctx.fillStyle = ink;
  const titleSize = o.bigTitle ? r0 * 0.66 : Math.max(11, r0 * 0.3);
  ctx.font = `500 ${titleSize}px ${DISPLAY}`;
  ctx.fillText(o.title, c, c - r0 * (o.bigTitle ? 0.1 : 0.14), r0 * 1.7);
  ctx.fillStyle = ink3;
  ctx.font = `500 ${Math.max(8, r0 * 0.19)}px ${MONO}`;
  ctx.fillText(o.subtitle, c, c + r0 * (o.bigTitle ? 0.46 : 0.28), r0 * 1.7);
}
