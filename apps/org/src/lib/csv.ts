// Sites in from a CSV file, tables out to one.
import type { Site } from './api.ts';

/**
 * name,lat,lon,radius_km,value,people,started_year, with or without a header row.
 * Quoted fields may hold commas and doubled quotes ("Farm, north").
 */
export function parseSitesCsv(text: string, newId: () => string = () => crypto.randomUUID()): Site[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const split = (line: string) => {
    const out: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',' || ch === ';') { out.push(cell); cell = ''; }
      else cell += ch;
    }
    out.push(cell);
    return out.map((c) => c.trim());
  };
  const first = split(lines[0]).map((c) => c.toLowerCase().replace(/[\s_]/g, ''));
  const hasHeader = first.includes('lat') || first.includes('latitude');
  const order = hasHeader ? first : ['name', 'lat', 'lon', 'radiuskm', 'value', 'people', 'startedyear'];
  const col = (...names: string[]) => order.findIndex((c) => names.includes(c));
  const at = {
    name: col('name', 'site'), lat: col('lat', 'latitude'), lon: col('lon', 'lng', 'long', 'longitude'), radius: col('radiuskm', 'radius'),
    value: col('value', 'insuredvalue'), people: col('people'), started: col('startedyear', 'started', 'projectstarted'),
  };
  const num = (cells: string[], i: number) => (i < 0 || !cells[i] ? null : Number(cells[i].replace(/\s/g, '')));
  return lines.slice(hasHeader ? 1 : 0).map((line, i) => {
    const cells = split(line);
    return {
      id: newId(),
      name: (at.name < 0 ? '' : cells[at.name]) || `Site ${i + 1}`,
      lat: num(cells, at.lat) ?? NaN,
      lon: num(cells, at.lon) ?? NaN,
      radiusKm: num(cells, at.radius) ?? 5,
      value: num(cells, at.value),
      people: num(cells, at.people),
      startedYear: num(cells, at.started),
    };
  });
}

/** Rows → a CSV file the browser downloads. A BOM keeps Arabic readable in Excel. */
export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const url = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fileSafe = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '') || 'firesight';
