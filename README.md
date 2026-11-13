# Ember Almanac

**Is this fire season normal?** Ember Almanac stitches 25 years of NASA fire detections (MODIS since 2000, VIIRS since 2012) into one consistent record, and answers that question for a country or any box you draw inside it.

Built for the NASA Space Apps Challenge 2026, challenge "Harmonization of MODIS and VIIRS Hot Spots".

## What it does

- **Answer first.** Pick a place and a month; get one sentence: how it compares with the usual month and where it ranks.
- **Fire Rings.** One ring per year, 2000 at the core, one step per day. Read a place's fire history like tree rings.
- **Burning calendar.** The same record as a year × month table with year totals.
- **The seam.** Switch between the raw record (it jumps in 2012 when VIIRS arrives) and the harmonized one.
- **Season profile.** The selected year against the median and the usual range, with the critical period named.
- **Evidence.** Held-out validation, conversion factors by month, and what the record cannot tell you.
- **Exports.** CSV of every hotspot in the search, with its weight in the harmonized record; a PNG card of the rings.

## Run it

Needs Node 24 or newer (the pipeline runs TypeScript directly).

```bash
npm install
npm run data     # downloads FIRMS archive files (~26 MB) and builds public/data/
npm run dev      # http://localhost:5173
npm test         # harmonization tests, including checks on the real data
npm run build    # static site in dist/
```

The site is fully static: `dist/` can be hosted anywhere.

## How the two records are stitched

1. **One unit.** Each detection is snapped to a 0.01° grid (about 1 km). A cell counts once per day per sensor: an *active-fire cell-day*. This removes most of the inflation from VIIRS's 375 m pixels.
2. **Calibrate where both flew.** For February 2012 to December 2025, per calendar month: total VIIRS cell-days ÷ total MODIS cell-days. A drawn area is shrunk toward the country's ratio when its own sample is small.
3. **Convert the past.** Before 2012, MODIS cell-days × that month's factor. Before July 2002 only Terra flew, so Terra has its own factor.
4. **Fill outages.** Days when VIIRS was offline are filled from MODIS and marked.
5. **Validate.** Leave one overlap year out, predict it from MODIS alone, compare with VIIRS.

Results on held-out years (median absolute error, raw MODIS → harmonized):

| Country  | VIIRS per MODIS cell-day | Monthly error | Yearly error | Bias        |
|----------|--------------------------|---------------|--------------|-------------|
| Portugal | ×1.47                    | 49% → 18%     | 34% → 5%     | −32% → +2%  |
| Greece   | ×2.40                    | 68% → 20%     | 61% → 6%     | −58% → +1%  |
| Lebanon  | ×5.51                    | 90% → 45%     | 84% → 18%    | −82% → −8%  |
| Cyprus   | ×3.21                    | 67% → 45%     | 71% → 27%    | −69% → −8%  |

The factor differs fourfold between these four countries, which is why it is fitted per place and never global.

## Limits

- Counts detections, not hectares. Cloud and smoke hide fires from both sensors.
- A month in which MODIS saw nothing converts to zero, so quiet seasons before 2012 are understated where fires are small (visible in Lebanon and Cyprus).
- The archive ends on 31 December 2025. Live 2026 data needs a FIRMS MAP_KEY and is not wired in yet.
- Four countries are packaged. Adding one is a line in `pipeline/config.mjs`; very large countries would need pre-aggregated tiles.

## Layout

```
pipeline/   fetch-firms.mjs · pack.mjs · boundaries.mjs · summarize.ts
src/lib/    harmonize.ts · stats.ts · analysis.ts · time.ts   (+ harmonize.test.ts)
src/worker/ analysis.worker.ts   runs the analysis off the main thread
src/components/  MapPanel · Verdict · FireRings · BurnCalendar · SeasonChart · TrustPanel · ExportMenu · Intro
```

## Data and credits

- Hotspots: [NASA FIRMS](https://www.earthdata.nasa.gov/data/tools/firms) yearly country archive, MODIS (Terra, Aqua) and VIIRS (Suomi NPP).
- Imagery: NASA GIBS, Blue Marble Shaded Relief and Bathymetry.
- Borders: Natural Earth (public domain).
- Libraries: React, Vite, MapLibre GL JS, d3-scale, d3-shape; fonts Fraunces and IBM Plex.

An independent project, not a NASA product.

## Use of AI tools

This project was built with Claude Code (Anthropic). The assistant wrote the data pipeline, the harmonization and statistics code, the tests, the interface and this README, and ran the data exploration that chose the method. The team chose the challenge, the concept direction, the showcase region and the features, and reviewed the result.
