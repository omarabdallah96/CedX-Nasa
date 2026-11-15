// Site lists come from spreadsheets: headers or not, quotes, semicolons.
import { describe, expect, it } from 'vitest';
import { parseSitesCsv } from './csv.ts';

let n = 0;
const id = () => `id${++n}`;

describe('site CSV', () => {
  it('reads a header row in any order, quoted names and blank optional cells', () => {
    const rows = parseSitesCsv('﻿Latitude,Longitude,Name,Radius_km,Value\n34.45,36.24,"Akkar orchard, north",10,400000\n33.69,35.70,Chouf,,\n', id);
    expect(rows.map((r) => [r.name, r.lat, r.lon, r.radiusKm, r.value])).toEqual([
      ['Akkar orchard, north', 34.45, 36.24, 10, 400000],
      ['Chouf', 33.69, 35.7, 5, null],
    ]);
  });

  it('takes the template order without a header, and semicolon files', () => {
    const rows = parseSitesCsv('Mill;39.92;-8.15;6;1200000;40;2018\nNo coords;;;5;;;\n', id);
    expect(rows[0]).toMatchObject({ name: 'Mill', lat: 39.92, lon: -8.15, radiusKm: 6, value: 1_200_000, people: 40, startedYear: 2018 });
    expect(Number.isNaN(rows[1].lat)).toBe(true);
  });
});
