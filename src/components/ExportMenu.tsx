import { useState } from 'react';
import type { Analysis } from '../lib/analysis.ts';
import type { AnalysisClient } from '../lib/client.ts';
import { ember, inkOn, rampPosition } from '../lib/color.ts';
import { fmtCompact } from '../lib/format.ts';
import { SRC_N20, type Filters } from '../lib/harmonize.ts';
import { annualTotals, monthMatrix } from '../lib/stats.ts';
import { FIRST_DAY, isoDate, MONTHS, rangeName, type Calendar } from '../lib/time.ts';
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

/** Card header shared by both images; returns the y below it. */
function cardHeader(ctx: CanvasRenderingContext2D, W: number, eyebrow: string, headline: string, detail: string): number {
  ctx.fillStyle = '#8c8274';
  ctx.font = '500 26px "IBM Plex Sans", system-ui, sans-serif';
  ctx.fillText(eyebrow.toUpperCase(), 80, 96);
  ctx.fillStyle = '#f3ede4';
  ctx.font = '500 68px "Fraunces Variable", Georgia, serif';
  let y = 190;
  for (const l of wrapText(ctx, headline, W - 160)) {
    ctx.fillText(l, 80, y);
    y += 78;
  }
  ctx.fillStyle = '#c4b9a8';
  ctx.font = '400 30px "IBM Plex Sans", system-ui, sans-serif';
  y += 6;
  for (const l of wrapText(ctx, detail, W - 160)) {
    ctx.fillText(l, 80, y);
    y += 42;
  }
  return y;
}

export function ExportMenu({ client, slug, filters, analysis, cal, sel, period, ringsCanvas, place, headline, detail }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileSlug = `ember-almanac_${slug}${filters.bbox ? '-area' : ''}`;
  const periodSlug = `${isoDate(period.from)}_${isoDate(period.to)}`;
  const periodName = rangeName(period.from, period.to);
  const eyebrow = `Ember Almanac · ${place} · ${MONTHS[sel.month]} ${sel.year}`;

  const hotspotsCsv = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const { blob, rows } = await client.csv(slug, filters, period.from, period.to);
      if (rows === 0) {
        setStatus('No hotspots in that period, so there is nothing to download.');
      } else {
        save(blob, `${fileSlug}_hotspots_${periodSlug}.csv`);
        setStatus(`Saved ${rows.toLocaleString('en-US')} hotspots, ${periodName}.`);
      }
    } catch (err) {
      setStatus(`CSV export failed: ${err instanceof Error ? err.message : String(err)}`);
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
    setStatus(`Saved ${lines.length - 1} days, ${periodName}.`);
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
    setStatus(`Saved the calendar table: ${lines.length - 1} months.`);
  };

  const toPng = (card: HTMLCanvasElement, name: string, done: string) => {
    card.toBlob((blob) => {
      if (!blob) return setStatus('This browser could not create the image.');
      save(blob, name);
      setStatus(done);
    }, 'image/png');
  };

  const ringsCard = async () => {
    const rings = ringsCanvas();
    if (!rings) return setStatus('The rings are not drawn yet.');
    await document.fonts?.ready;
    const W = 1200;
    const H = 1500;
    const card = document.createElement('canvas');
    card.width = W;
    card.height = H;
    const ctx = card.getContext('2d');
    if (!ctx) return setStatus('This browser could not create the image.');
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const y = cardHeader(ctx, W, eyebrow, headline, detail);
    const side = Math.min(W - 160, H - y - 130);
    ctx.drawImage(rings, (W - side) / 2, y + 20, side, side);
    ctx.fillStyle = '#8c8274';
    ctx.font = '400 22px "IBM Plex Sans", system-ui, sans-serif';
    ctx.fillText(`One ring per year, ${cal.year[FIRST_DAY]} at the core. Harmonized MODIS + VIIRS active-fire cell-days. Data: NASA FIRMS.`, 80, H - 56);
    toPng(card, `${fileSlug}_rings_${sel.year}-${String(sel.month + 1).padStart(2, '0')}.png`, 'Saved the rings card.');
  };

  const calendarCard = async () => {
    await document.fonts?.ready;
    const mm = analysis.monthsH;
    const totals = annualTotals(mm);
    const W = 1200;
    const ROW = 34;
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return setStatus('This browser could not create the image.');
    // Measure the header first: its height depends on how the sentence wraps.
    const top = cardHeader(probe, W, eyebrow, headline, detail) + 40;
    const H = top + (mm.years.length + 1) * ROW + 110;
    const card = document.createElement('canvas');
    card.width = W;
    card.height = H;
    const ctx = card.getContext('2d');
    if (!ctx) return setStatus('This browser could not create the image.');
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    cardHeader(ctx, W, eyebrow, headline, detail);

    const x0 = 160;
    const cw = 62;
    const barX = x0 + 12 * cw + 20;
    const barW = W - 80 - barX - 90;
    let max = 0;
    for (const row of mm.values) for (const v of row) if (v > max) max = v;
    const maxTotal = Math.max(...totals.map((t) => t.total));
    ctx.textBaseline = 'middle';
    ctx.font = '500 18px "IBM Plex Sans", system-ui, sans-serif';
    ctx.fillStyle = '#8c8274';
    ctx.textAlign = 'center';
    MONTHS.forEach((m, i) => ctx.fillText(m, x0 + i * cw + cw / 2 - 2, top + ROW / 2));
    ctx.textAlign = 'left';
    ctx.fillText('Year total', barX, top + ROW / 2);
    // Most recent year on top, as on screen.
    [...mm.years.keys()].reverse().forEach((yi, r) => {
      const y = top + (r + 1) * ROW;
      ctx.font = '500 18px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillStyle = '#c4b9a8';
      ctx.textAlign = 'left';
      ctx.fillText(String(mm.years[yi]), 80, y + ROW / 2);
      mm.values[yi].forEach((v, m) => {
        if (Number.isNaN(v)) return;
        const t = rampPosition(v, max);
        ctx.fillStyle = ember(t);
        ctx.beginPath();
        ctx.roundRect(x0 + m * cw, y + 2, cw - 4, ROW - 4, 5);
        ctx.fill();
        ctx.fillStyle = inkOn(t);
        ctx.font = '500 15px "IBM Plex Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(fmtCompact(v), x0 + m * cw + cw / 2 - 2, y + ROW / 2 + 1);
      });
      ctx.fillStyle = '#199e70';
      ctx.beginPath();
      ctx.roundRect(barX, y + 9, Math.max(2, (totals[yi].total / maxTotal) * barW), ROW - 18, [0, 4, 4, 0]);
      ctx.fill();
      ctx.fillStyle = '#c4b9a8';
      ctx.textAlign = 'left';
      ctx.font = '500 15px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText(fmtCompact(totals[yi].total) + (totals[yi].complete ? '' : '*'), barX + Math.max(2, (totals[yi].total / maxTotal) * barW) + 8, y + ROW / 2 + 1);
    });
    ctx.fillStyle = '#8c8274';
    ctx.font = '400 22px "IBM Plex Sans", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Harmonized MODIS + VIIRS active-fire cell-days per month. * year not complete. Data: NASA FIRMS.', 80, H - 56);
    toPng(card, `${fileSlug}_calendar.png`, 'Saved the calendar image.');
  };

  return (
    <div className="export">
      <ul className="downloads">
        <li>
          <button type="button" className="btn" onClick={hotspotsCsv} disabled={busy}>{busy ? 'Preparing…' : 'Hotspots (CSV)'}</button>
          <span>Every detection in <strong>{periodName}</strong> that passes the filters, with its sensor and its weight in the harmonized record.</span>
        </li>
        <li>
          <button type="button" className="btn btn-quiet" onClick={dailyCsv}>Daily series (CSV)</button>
          <span>One row per day of <strong>{periodName}</strong>: harmonized cell-days, likely range, source, and the raw counts behind it.</span>
        </li>
        <li>
          <button type="button" className="btn btn-quiet" onClick={calendarCsv}>Calendar table (CSV)</button>
          <span>The whole burning calendar: every month since {cal.year[FIRST_DAY]} with its usual value and the ratio to it.</span>
        </li>
        <li>
          <button type="button" className="btn btn-quiet" onClick={calendarCard}>Calendar (PNG)</button>
          <span>The burning calendar as an image, with the verdict for {MONTHS[sel.month]} {sel.year} on top.</span>
        </li>
        <li>
          <button type="button" className="btn btn-quiet" onClick={ringsCard}>Fire rings (PNG)</button>
          <span>The rings as drawn above, with the same verdict.</span>
        </li>
      </ul>
      <p className="note" role="status">
        {status ?? 'The period is the one set beside the map. Area and filters apply to every file.'}
      </p>
    </div>
  );
}
