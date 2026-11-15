// The survey grid gives every site one stable reference.
import { describe, expect, it } from 'vitest';
import { cellBox, makeGrid, refOf } from './grid.ts';

describe('survey grid', () => {
  it('fits the sites in at most 8 × 8 cells and names each square', () => {
    const sites = [
      { lat: 34.45, lon: 36.24, radiusKm: 10 }, // Akkar
      { lat: 33.69, lon: 35.7, radiusKm: 8 }, // Chouf
      { lat: 33.89, lon: 35.5, radiusKm: 3 }, // Beirut
    ];
    const g = makeGrid(sites)!;
    expect(g.cols).toBeLessThanOrEqual(8);
    expect(g.rows).toBeLessThanOrEqual(8);
    const akkar = refOf(g, 34.45, 36.24);
    const chouf = refOf(g, 33.69, 35.7);
    expect(akkar).toMatch(/^[A-H][1-8]$/);
    // North is row 1 and west is column A, as on a printed sheet.
    expect(Number(akkar.slice(1))).toBeLessThan(Number(chouf.slice(1)));
    expect(akkar[0] > chouf[0]).toBe(true);
    // The square holds the site.
    const [w, s, e, n] = cellBox(g, akkar)!;
    expect(36.24 >= w && 36.24 <= e && 34.45 >= s && 34.45 <= n).toBe(true);
  });

  it('widens the step for sites far apart, and has no grid without sites', () => {
    const g = makeGrid([{ lat: 39.9, lon: -8.15, radiusKm: 6 }, { lat: 34.93, lon: 32.87, radiusKm: 4 }])!;
    expect(g.step).toBeGreaterThanOrEqual(5);
    expect(refOf(g, 39.9, -8.15)).not.toBe(refOf(g, 34.93, 32.87));
    expect(makeGrid([])).toBeNull();
  });
});
