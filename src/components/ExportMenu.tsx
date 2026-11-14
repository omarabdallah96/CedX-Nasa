import { useState } from 'react';
import type { Analysis } from '../lib/analysis.ts';
import { useI18n } from '../i18n/index.tsx';
import type { AnalysisClient } from '../lib/client.ts';
import { ember, inkOn, rampPosition } from '../lib/color.ts';
import { fmtCompact } from '../lib/format.ts';
import { SRC_N20, type Filters } from '../lib/harmonize.ts';
import { annualTotals, monthMatrix } from '../lib/stats.ts';
import { FIRST_DAY, isoDate, type Calendar } from '../lib/time.ts';
import type { Selection } from './FireRings.tsx';
import type { Period } from './PeriodPanel.tsx';

interface Props {
  client: AnalysisClient;
  slug: string;
  filters: Filters;
  analysis: Analysis;
  cal: Calendar;
  sel: Selection;
  period: Period;
  /** Returns the rings canvas as drawn. */
  ringsCanvas: () => HTMLCanvasElement | null;
  place: string;
  /** Lines for the image cards: headline and sentence. */
  headline: string;
  detail: string;
}

const SOURCE = ['none', 'terra-scaled', 'modis-scaled', 'viirs', 'modis-gap-fill', 'noaa20'];
const BG = '#0e0c0a';
// Arabic falls through to the Arabic faces; Latin text and digits keep the first one.
const SANS = '"IBM Plex Sans", "IBM Plex Sans Arabic", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", "IBM Plex Sans Arabic", ui-monospace, monospace';
const DISPLAY = '"Fraunces Variable", "Amiri", Georgia, serif';

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const csvBlob = (lines: string[]) => new Blob([lines.join('\n'), '\n'], { type: 'text/csv' });
const n1 = (v: number) => (Number.isNaN(v) ? '' : v.toFixed(1));

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Card header shared by both images; returns the y below it. Right-to-left text starts at the right margin. */
function cardHeader(ctx: CanvasRenderingContext2D, W: number, rtl: boolean, eyebrow: string, headline: string, detail: string): number {
  const x = rtl ? W - 80 : 80;
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.fillStyle = '#8c8274';
  ctx.font = `500 26px ${SANS}`;
  ctx.fillText(eyebrow.toUpperCase(), x, 96);
  ctx.fillStyle = '#f3ede4';
  ctx.font = `500 68px ${DISPLAY}`;
  let y = 190;
  for (const l of wrapText(ctx, headline, W - 160)) {
    ctx.fillText(l, x, y);
    y += rtl ? 92 : 78;
  }
  ctx.fillStyle = '#c4b9a8';
  ctx.font = `400 30px ${SANS}`;
  y += 6;
  for (const l of wrapText(ctx, detail, W - 160)) {
    ctx.fillText(l, x, y);
    y += rtl ? 48 : 42;
  }
  return y;
}

export function ExportMenu({ client, slug, filters, analysis, cal, sel, period, ringsCanvas, place, headline, detail }: Props) {
  const { t } = useI18n();
  const rtl = t.dir === 'rtl';
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileSlug = `firesight_${slug}${filters.bbox ? '-area' : ''}`;
  const periodSlug = `${isoDate(period.from)}_${isoDate(period.to)}`;
  const periodName = t.rangeName(period.from, period.to);
  const eyebrow = t.exp.cardEyebrow(place, sel.month, sel.year);

  const hotspotsCsv = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const { blob, rows } = await client.csv(slug, filters, period.from, period.to);
      if (rows === 0) {
        setStatus(t.exp.noHotspots);
      } else {
        save(blob, `${fileSlug}_hotspots_${periodSlug}.csv`);
        setStatus(t.exp.savedHotspots(rows, periodName));
      }
    } catch (err) {
      setStatus(t.exp.csvFailed(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  const dailyCsv = () => {
    const { h, lo, hi, src } = analysis.harmonized;
    const d = analysis.daily;
    const lines = ['date,harmonized_cell_days,likely_low,likely_high,source,modis_cell_days,viirs_cell_days,modis_detections,viirs_detections'];
    for (let day = period.from; day <= period.to; day++) {
      const n20 = src[day] === SRC_N20;
      lines.push([
        isoDate(day), h[day].toFixed(2), lo[day].toFixed(2), hi[day].toFixed(2), SOURCE[src[day]],
        d.cdM[day], n20 ? d.cdN[day] : d.cdV[day], d.rawM[day], n20 ? d.rawN[day] : d.rawV[day],
      ].join(','));
    }
    save(csvBlob(lines), `${fileSlug}_daily_${periodSlug}.csv`);
    setStatus(t.exp.savedDays(lines.length - 1, periodName));
  };

  const calendarCsv = () => {
    const mm = analysis.monthsH;
    const rawM = monthMatrix(analysis.daily.rawM, cal);
    const viirs = analysis.daily.rawV.map((v, day) => (analysis.harmonized.src[day] === SRC_N20 ? analysis.daily.rawN[day] : v));
    const rawV = monthMatrix(viirs, cal);
    const lines = ['year,month,harmonized_cell_days,likely_low,likely_high,usual_median,ratio_to_usual,modis_detections,viirs_detections,complete_month'];
    mm.years.forEach((year, yi) => mm.values[yi].forEach((v, m) => {
      if (Number.isNaN(v)) return;
      const partial = mm.partial?.year === year && mm.partial.month === m;
      const med = analysis.climate.median[m];
      lines.push([
        year, m + 1, n1(v), n1(analysis.monthsLo.values[yi][m]), n1(analysis.monthsHi.values[yi][m]), n1(med),
        !partial && med > 0 ? (v / med).toFixed(2) : '', rawM.values[yi][m], rawV.values[yi][m], partial ? 'no' : 'yes',
      ].join(','));
    }));
    save(csvBlob(lines), `${fileSlug}_calendar_${cal.year[FIRST_DAY]}-${cal.year[cal.nDays - 1]}.csv`);
    setStatus(t.exp.savedCalendar(lines.length - 1));
  };

  const toPng = (card: HTMLCanvasElement, name: string, done: string) => {
    card.toBlob((blob) => {
      if (!blob) return setStatus(t.exp.noImage);
      save(blob, name);
      setStatus(done);
    }, 'image/png');
  };

  const ringsCard = async () => {
    const rings = ringsCanvas();
    if (!rings) return setStatus(t.exp.noRings);
    await document.fonts?.ready;
    const W = 1200;
    const H = 1500;
    const card = document.createElement('canvas');
    card.width = W;
    card.height = H;
    const ctx = card.getContext('2d');
    if (!ctx) return setStatus(t.exp.noImage);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const y = cardHeader(ctx, W, rtl, eyebrow, headline, detail);
    const side = Math.min(W - 160, H - y - 130);
    ctx.drawImage(rings, (W - side) / 2, y + 20, side, side);
    ctx.fillStyle = '#8c8274';
    ctx.font = `400 22px ${SANS}`;
    ctx.fillText(t.exp.ringsFooter(cal.year[FIRST_DAY]), rtl ? W - 80 : 80, H - 56);
    toPng(card, `${fileSlug}_rings_${sel.year}-${String(sel.month + 1).padStart(2, '0')}.png`, t.exp.savedRings);
  };

  const calendarCard = async () => {
    await document.fonts?.ready;
    const mm = analysis.monthsH;
    const totals = annualTotals(mm);
    const W = 1200;
    const ROW = 34;
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return setStatus(t.exp.noImage);
    // Measure the header first: its height depends on how the sentence wraps.
    const top = cardHeader(probe, W, rtl, eyebrow, headline, detail) + 40;
    const H = top + (mm.years.length + 1) * ROW + 110;
    const card = document.createElement('canvas');
    card.width = W;
    card.height = H;
    const ctx = card.getContext('2d');
    if (!ctx) return setStatus(t.exp.noImage);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    cardHeader(ctx, W, rtl, eyebrow, headline, detail);
    // The table is laid out left to right, then mirrored for right-to-left
    // languages so it matches the calendar on the page.
    const mx = (x: number, width = 0) => (rtl ? W - x - width : x);
    const start: CanvasTextAlign = rtl ? 'right' : 'left';

    const x0 = 160;
    const cw = 62;
    const barX = x0 + 12 * cw + 20;
    const barW = W - 80 - barX - 90;
    let max = 0;
    for (const row of mm.values) for (const v of row) if (v > max) max = v;
    const maxTotal = Math.max(...totals.map((t) => t.total));
    ctx.textBaseline = 'middle';
    ctx.font = `500 ${rtl ? 16 : 18}px ${SANS}`;
    ctx.fillStyle = '#8c8274';
    ctx.textAlign = 'center';
    t.months.forEach((m, i) => ctx.fillText(m, mx(x0 + i * cw + cw / 2 - 2), top + ROW / 2));
    ctx.textAlign = start;
    ctx.fillText(t.exp.yearTotal, mx(barX), top + ROW / 2);
    // Most recent year on top, as on screen.
    [...mm.years.keys()].reverse().forEach((yi, r) => {
      const y = top + (r + 1) * ROW;
      ctx.font = `500 18px ${MONO}`;
      ctx.fillStyle = '#c4b9a8';
      ctx.textAlign = start;
      ctx.fillText(String(mm.years[yi]), mx(80), y + ROW / 2);
      mm.values[yi].forEach((v, m) => {
        if (Number.isNaN(v)) return;
        const heat = rampPosition(v, max);
        ctx.fillStyle = ember(heat);
        ctx.beginPath();
        ctx.roundRect(mx(x0 + m * cw, cw - 4), y + 2, cw - 4, ROW - 4, 5);
        ctx.fill();
        ctx.fillStyle = inkOn(heat);
        ctx.font = `500 15px ${MONO}`;
        ctx.textAlign = 'center';
        ctx.fillText(fmtCompact(v), mx(x0 + m * cw + cw / 2 - 2), y + ROW / 2 + 1);
      });
      ctx.fillStyle = '#199e70';
      ctx.beginPath();
      const bar = Math.max(2, (totals[yi].total / maxTotal) * barW);
      ctx.roundRect(mx(barX, bar), y + 9, bar, ROW - 18, rtl ? [4, 0, 0, 4] : [0, 4, 4, 0]);
      ctx.fill();
      ctx.fillStyle = '#c4b9a8';
      ctx.textAlign = start;
      ctx.direction = 'ltr';
      ctx.font = `500 15px ${MONO}`;
      ctx.fillText(fmtCompact(totals[yi].total) + (totals[yi].complete ? '' : '*'), mx(barX + bar + 8), y + ROW / 2 + 1);
      ctx.direction = rtl ? 'rtl' : 'ltr';
    });
    ctx.fillStyle = '#8c8274';
    ctx.font = `400 22px ${SANS}`;
    ctx.textAlign = start;
    ctx.fillText(t.exp.calendarFooter, mx(80), H - 56);
    toPng(card, `${fileSlug}_calendar.png`, t.exp.savedCalendarImage);
  };

  return (
    <div className="export">
      <ul className="downloads">
        <li>
          <button type="button" className="btn" onClick={hotspotsCsv} disabled={busy}>{busy ? t.exp.preparing : t.exp.hotspots}</button>
          <span>{t.exp.hotspotsDesc(periodName)}</span>
        </li>
        <li>
          <button type="button" className="btn btn-quiet" onClick={dailyCsv}>{t.exp.daily}</button>
          <span>{t.exp.dailyDesc(periodName)}</span>
        </li>
        <li>
          <button type="button" className="btn btn-quiet" onClick={calendarCsv}>{t.exp.calendarCsv}</button>
          <span>{t.exp.calendarCsvDesc(cal.year[FIRST_DAY])}</span>
        </li>
        <li>
          <button type="button" className="btn btn-quiet" onClick={calendarCard}>{t.exp.calendarPng}</button>
          <span>{t.exp.calendarPngDesc(sel.month, sel.year)}</span>
        </li>
        <li>
          <button type="button" className="btn btn-quiet" onClick={ringsCard}>{t.exp.ringsPng}</button>
          <span>{t.exp.ringsPngDesc}</span>
        </li>
      </ul>
      <p className="note" role="status">
        {status ?? t.exp.hint}
      </p>
    </div>
  );
}
