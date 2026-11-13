import { useState } from 'react';
import type { Filters } from '../lib/harmonize.ts';
import type { AnalysisClient } from '../lib/client.ts';
import { dayIndex, FIRST_DAY, MONTHS, MONTHS_LONG } from '../lib/time.ts';
import type { Selection } from './FireRings.tsx';

type Scope = 'month' | 'year' | 'all';

interface Props {
  client: AnalysisClient;
  slug: string;
  filters: Filters;
  sel: Selection;
  lastDay: number;
  /** Returns the rings canvas as drawn. */
  ringsCanvas: () => HTMLCanvasElement | null;
  place: string;
  /** Lines for the image card: headline and sentence. */
  headline: string;
  detail: string;
}

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

export function ExportMenu({ client, slug, filters, sel, lastDay, ringsCanvas, place, headline, detail }: Props) {
  const [scope, setScope] = useState<Scope>('month');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileSlug = `${slug}${filters.bbox ? '-area' : ''}`;

  const downloadCsv = async () => {
    const range: Record<Scope, [number, number, string]> = {
      month: [dayIndex(sel.year, sel.month + 1, 1), dayIndex(sel.year, sel.month + 2, 1) - 1, `${sel.year}-${String(sel.month + 1).padStart(2, '0')}`],
      year: [dayIndex(sel.year, 1, 1), dayIndex(sel.year + 1, 1, 1) - 1, String(sel.year)],
      all: [FIRST_DAY, lastDay, '2000-2025'],
    };
    const [from, to, label] = range[scope];
    setBusy(true);
    setStatus(null);
    try {
      const { blob, rows } = await client.csv(slug, filters, from, Math.min(to, lastDay));
      if (rows === 0) {
        setStatus('No hotspots in that period, so there is nothing to download.');
      } else {
        save(blob, `ember-almanac_${fileSlug}_${label}.csv`);
        setStatus(`Saved ${rows.toLocaleString('en-US')} hotspots.`);
      }
    } catch (err) {
      setStatus(`CSV export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const downloadCard = async () => {
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
    ctx.fillStyle = '#0e0c0a';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#8c8274';
    ctx.font = '500 26px "IBM Plex Sans", system-ui, sans-serif';
    ctx.fillText(`EMBER ALMANAC · ${place.toUpperCase()} · ${MONTHS[sel.month].toUpperCase()} ${sel.year}`, 80, 96);
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
    const side = Math.min(W - 160, H - y - 130);
    ctx.drawImage(rings, (W - side) / 2, y + 20, side, side);
    ctx.fillStyle = '#8c8274';
    ctx.font = '400 22px "IBM Plex Sans", system-ui, sans-serif';
    ctx.fillText('One ring per year, 2000 at the core. Harmonized MODIS + VIIRS active-fire cell-days. Data: NASA FIRMS.', 80, H - 56);
    card.toBlob((blob) => {
      if (!blob) return setStatus('This browser could not create the image.');
      save(blob, `ember-almanac_${fileSlug}_${sel.year}-${String(sel.month + 1).padStart(2, '0')}.png`);
      setStatus('Saved the rings card.');
    }, 'image/png');
  };

  return (
    <div className="export">
      <div className="export-row">
        <label htmlFor="csv-scope">Hotspots in this search</label>
        <select id="csv-scope" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
          <option value="month">{MONTHS_LONG[sel.month]} {sel.year}</option>
          <option value="year">All of {sel.year}</option>
          <option value="all">Whole record, 2000–2025</option>
        </select>
        <button type="button" className="btn" onClick={downloadCsv} disabled={busy}>
          {busy ? 'Preparing…' : 'Download CSV'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={downloadCard}>Download rings card (PNG)</button>
      </div>
      <p className="note" role="status">
        {status ?? 'The CSV lists every detection that passes the filters, with its sensor and its weight in the harmonized record.'}
      </p>
    </div>
  );
}
