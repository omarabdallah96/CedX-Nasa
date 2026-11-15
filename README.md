# Firesight

**Is this fire season normal?** Firesight stitches NASA fire detections from November 2000 to yesterday (MODIS since 2000, VIIRS since 2012) into one consistent record, and answers that question for a country or any box you draw inside it.

Built for the NASA Space Apps Challenge 2026, challenge "Harmonization of MODIS and VIIRS Hot Spots".

## What it does

- **Answer first.** Pick a place and a month; get one sentence: how it compares with the usual month and where it ranks. The month still running is judged over the days it has so far.
- **The last 7 days.** The newest week against the same dates in every other year.
- **Any date range.** From–to dates drive the map, a summary against the same dates in other years, and the downloads.
- **Fire Rings.** One ring per year, 2000 at the core, one step per day. Read a place's fire history like tree rings.
- **Burning calendar.** The same record as a year × month table with year totals, and the most active years and months ranked.
- **The seam.** Switch between the raw record (it jumps in 2012 when VIIRS arrives) and the harmonized one.
- **Season profile.** The selected year against the median and the usual range, with the critical period named.
- **Evidence.** Held-out validation, conversion factors by month, and what the record cannot tell you.
- **Exports.** CSV of every hotspot in the period, with its weight in the harmonized record; the daily series and the whole calendar table as CSV; the calendar and the rings as PNG cards.
- **API.** The same answers as JSON, for a phone app or anything else.
- **Air quality.** Is the air safe to breathe at the middle of the map area or at your own location: the index, what drives it, CO2 as a percentage, and what to do.
- **For the phone app.** Live hotspots minutes old from the FIRMS near-real-time feed, and ground reports (label, photo, compass bearing) that phones share so smoke seen by several people can be located.
- **English and Arabic.** The whole site, the charts and the PNG cards switch language; Arabic is laid out right to left. The site opens in the browser's language, the switch in the header remembers the choice, and `?lang=ar` or `?lang=en` in the address forces one. The API and the CSV column names stay in English.

## Run it

Needs Node 24 or newer (the pipeline and the server run TypeScript directly).

```bash
npm install
cp .env.example .env   # optional: paste a free FIRMS MAP_KEY to get data newer than 2025
npm run data           # FIRMS archive (~26 MB), the current year from the FIRMS API, then public/data/
npm run api            # API on http://localhost:8787/api/v1 (also serves dist/ when built)
npm run dev            # website on http://localhost:5173
npm test               # harmonization and API tests, including checks on the real data
npm run build          # static site in dist/
```

Two ways to host it:

- **Static only.** `dist/` works on any static host. It carries its own copy of the data, current as of the build.
- **With the backend.** `npm run api` (or the `Dockerfile`) serves the site and the API together. With `FIRMS_MAP_KEY` set, the server pulls the newest days from NASA every six hours. The website asks `/api/v1/health` at start and uses the backend's data when it answers; otherwise it uses its bundled copy. Set `VITE_API_URL` at build time when the API lives on another origin.

The key is read from the environment on the server only. It is never sent to the browser, and `.env` is git-ignored.

## API

JSON under `/api/v1`, open CORS, no key needed. The record endpoints are read-only; Every answer is computed by the same code the website runs (`src/lib`), so the two cannot disagree.

| Endpoint | Returns |
|---|---|
| `GET /api/v1` | Self-description and endpoint list |
| `GET /health` | Coverage end and when the data was built |
| `GET /countries` | Places, boxes, conversion factor, held-out error |
| `GET /countries/{slug}/now` | Last 7 days and the month so far, each with a verdict and a sentence |
| `GET /countries/{slug}/verdict?year=&month=` | Value, median, ratio, rank, level, sentence |
| `GET /countries/{slug}/calendar?mode=harmonized\|raw` | Year × month table, likely range, usual values |
| `GET /countries/{slug}/season?year=` | Five-day profile against the median and usual range; peak season |
| `GET /countries/{slug}/range?from=&to=` | Totals, daily values, comparison with the same dates in other years |
| `GET /countries/{slug}/records?top=` | Most active years and months |
| `GET /countries/{slug}/hotspots?from=&to=&limit=&format=json\|csv` | Detections with their harmonized weight |
| `GET /countries/{slug}/method` | Conversion factors, validation, limits |
| `GET /countries/{slug}/live?hours=` | FIRMS near-real-time detections of the last 1–72 hours (default 48), fetched at most every 10 minutes. Needs `FIRMS_MAP_KEY` on the server, else 503 |
| `GET /countries/{slug}/forecast?days=` | Fire danger for the next 1–16 days (default 7): per day the danger level, FWI median / 90th percentile / max over the country, share of the country at high or above, and the usual activity for that date from the record; plus every grid point's FWI for a map |
| `GET /forecast?lat=&lon=&days=` | Fire danger at the nearest grid point: level, FWI and its components, noon weather, and the usual activity in the country. 404 outside the four countries |
| `GET /air?lat=&lon=&lang=en\|ar` | Air quality now at any point on Earth: `safe` true or false, US AQI and its class, each pollutant, CO2 in ppm and as a percentage of the air, the worst hour of the next 24, what to do at this level, and safety tips for smoke and for CO2 and CO at home. Text in English or Arabic. From the Copernicus CAMS model through Open-Meteo, cached 20 minutes; a model on a 10–40 km grid, not a sensor |
| `GET /data/{file}` | The packed data files the website loads |
| `POST /reports` | A ground report from the phone app, as `multipart/form-data` (optional `photo`: JPEG, PNG or WebP up to 5 MB) or JSON. Returns the report and a `deleteToken` |
| `GET /reports?bbox=&country=&since=&limit=` | Reports in an area since a time (default: the last 7 days) |
| `GET /reports/{id}` · `GET /reports/{id}/photo` | One report; its photo |
| `DELETE /reports/{id}` | Deletes a report; needs its `deleteToken` in the `X-Report-Token` header |

Common query: `bbox=west,south,east,north` (a box inside the country), `vegOnly=true|false`, `dropLowConf=true|false`. Dates are `YYYY-MM-DD`, months are 1–12. Errors are `{ "error": { "code", "message" } }` with status 400 or 404.

```bash
curl "http://localhost:8787/api/v1/countries/portugal/now"
curl "http://localhost:8787/api/v1/countries/greece/verdict?year=2021&month=8"
curl "http://localhost:8787/api/v1/countries/portugal/range?from=2017-10-10&to=2017-10-20&bbox=-8.6,39.6,-7.4,40.6"
```

Report fields: `deviceId` and `clientId` (4–64 letters, digits, `-`, `_`; the same pair sent twice returns the first copy, so retries are safe), `lat`, `lon`, `createdAt` (ISO time, within 30 days), `label` (`wildfire`, `smoke`, `agriculturalBurn`, `industrial`, `falseAlarm`, `unsure`), and optionally `note` (≤ 500 characters), `bearing` (0–360°, where the reporter pointed at the smoke), `hotspotSensor`, `hotspotTime`. The device id is never returned. Reports are kept 90 days.

**Moderation.** `/admin` is a password-protected page (set `ADMIN_PASSWORD`) listing every report with its photo. A moderator can hide a report (kept, but no longer sent to phones), hide everything from one phone, or delete a report for good. Sign-in sets an HttpOnly, SameSite=Strict session cookie for 12 hours; password guesses are limited to 10 per 15 minutes; changing the password signs everyone out.

There are no user accounts. Reports are stored in SQLite with their photos under `STORAGE_DIR` (default `./storage`; a volume in Docker). Each client gets 1200 requests per 10 minutes and 30 new reports per hour (`RATE_LIMIT_PER_10_MIN`, `REPORTS_PER_HOUR`); behind a proxy the client is the first `X-Forwarded-For` address. Put a proxy limit in front as well before exposing it widely.

## Firesight for Organizations

`/org/` is a second app for organizations that watch many places at once: fire stations and civil defence, insurers, companies, NGOs and municipalities. The phone app stays personal; organizations work on the web only. An organization owns up to 200 **sites** (a named circle, optionally with a value, a head count and the year a project started), and the console answers "which of my sites need attention today, and why?" from the same engine as the public site: live satellite fires, the fire danger forecast and the harmonized record.

Access is by request: a visitor fills in `/org/request-access`, an admin approves the request on the Requests page of `/admin`, and the applicant receives a one-time invitation link. People sign in with a Firesight account; owners change sites and send alerts, members read everything, and owners invite teammates from the Team page.

All routes are under `/api/v1`, need `Authorization: Bearer <token>` from `POST /auth/login`, and are never cached.

| Endpoint | Who | Does |
|---|---|---|
| `POST /org-requests` `{orgName, kind, country, contactName, email, phone?, sitesEstimate?, message?}` | public | Asks for an organization (`kind`: `fire_station`, `insurer`, `company`, `ngo`). Limited like sign-in attempts; a second request from the same email returns the pending one |
| `GET /invites/{token}` | public | The invitation: organization name and kind, invited email and role, expiry |
| `POST /invites/{token}/accept` `{name, password}` | public | Creates the account for the invited email and joins. Signed in, accepts for the current account instead |
| `GET /orgs` | signed in | My organizations, each with its sites and its active members-only alerts |
| `GET /orgs/{id}` | member | Organization (with my role), members and sites |
| `DELETE /orgs/{id}` | owner | Deletes the organization and its sites |
| `DELETE /orgs/{id}/members/me` | member | Leaves; `409 last_owner` for the only owner |
| `DELETE /orgs/{id}/members/{userId}` | owner | Removes a member |
| `GET /orgs/{id}/invites` | owner | Pending invitations |
| `POST /orgs/{id}/invites` `{email, role?}` | owner | A one-time link (`path`, `/org/invite/{token}`) for a teammate; `role` is `member` (default) or `owner` |
| `DELETE /orgs/{id}/invites/{inviteId}` | owner | Withdraws a pending invitation |
| `PUT /orgs/{id}/sites` `{sites: [...]}` | owner | Replaces the site list. A site is `{id?, name, lat, lon, radiusKm, value?, people?, startedYear?}`; `400 outside_coverage` outside the four countries |
| `GET /orgs/{id}/board?days=7` | member | Sites ranked by a 0–100 score, each with its status (`act`, `watch`, `ok`), reasons, danger per day, fires nearby and ground reports |
| `GET /orgs/{id}/sites/{siteId}/report` | member | One site: history of its box since 2000, danger, live fires within 25 km, ground reports |
| `GET /orgs/{id}/exposure` | member | Per site: average fire activity per year, worst year, peak danger this week; total value and value at risk this week |
| `GET /orgs/{id}/sites/{siteId}/evidence?date=&days=3&km=5` | member | Claim check: every MODIS and VIIRS detection within `km` of the site in the `days` around `date`, with sensor, time and confidence, and ground reports |
| `GET /orgs/{id}/alerts` | member | The last 50 alerts sent, and whether the organization may alert the public |
| `POST /orgs/{id}/alerts` `{siteId, title, message, level, audience, hours?, titleAr?, messageAr?}` | owner | An alert about one site. `audience: "members"` reaches members; `"public"` (verified organizations only, else `403 not_verified`) also reaches every phone in or watching the site, signed with the organization's name. 10 per hour per organization |
| `POST /orgs/{id}/alerts/{alertId}/cancel` | owner | Ends an alert early |
| `GET /orgs/{id}/notifications` | member | The last 50 notifications (sites needing action, the daily digest, alerts sent) with my read mark and unread count |
| `POST /orgs/{id}/notifications/read` | member | Marks everything read for me; returns the read mark |

Errors keep the usual shape: `401 signed_out`, `403 not_member` / `owner_only`, `404 not_found`, `429 rate_limited`. An admin marks an organization **verified** on the Organizations page of `/admin`.

The score (`server/risk.ts`) is a plain rule table, not a model calibrated on real events: a live fire inside the site is 100, within 5 km 85, within 25 km 60; otherwise it follows the fire danger class of today and of the week's peak. A site's country is decided by the country's bounding box, not its border, so a point just across a land border (or just offshore) is accepted. The console is in English and Arabic (RTL), like the public site.

## Fire danger forecast

`server/fwi.ts` is the Canadian Fire Weather Index (Van Wagner 1987), the index EFFIS uses for Europe, checked against the published reference day. `server/forecast.ts` runs it on a grid of at most 48 points inside each country (0.15° in Lebanon and Cyprus, 0.5–0.6° in Portugal and Greece) with Open-Meteo weather at local noon (free, no key).

The index's moisture codes remember weeks to months of weather, so the first run of a country starts them on 1 January from the ERA5 archive. The codes are then saved in `STORAGE_DIR/forecast/` and each refresh only moves them forward through the days that have passed, before running the 16-day forecast. A forecast is recomputed every 3 hours; all four are computed a few seconds after start (`FORECAST_WARM=0` turns that off). The run-up uses many Open-Meteo calls, so when it hits their per-minute limit it waits a minute and tries again.

Danger classes are EFFIS's: very low < 5.2, low < 11.2, moderate < 21.3, high < 38, very high < 50, extreme. A country's headline level is the 90th percentile point, so a few very dry valleys show. Fire danger says how readily fires start and spread with the weather, not where one will start: most fires here are lit by people.

## How the two records are stitched

1. **One unit.** Each detection is snapped to a 0.01° grid (about 1 km). A cell counts once per day per sensor: an *active-fire cell-day*. This removes most of the inflation from VIIRS's 375 m pixels.
2. **Calibrate where both flew.** Over every month since February 2012 in which both observed, per calendar month: total VIIRS cell-days ÷ total MODIS cell-days. A drawn area is shrunk toward the country's ratio when its own sample is small.
3. **Convert the past.** Before 2012, MODIS cell-days × that month's factor. Before July 2002 only Terra flew, so Terra has its own factor.
4. **Fill outages.** Days when VIIRS was offline are filled from MODIS and marked.
5. **Hand over to NOAA-20.** Suomi-NPP stopped delivering after 2 November 2026. From then on, and in Suomi-NPP's 2026 outages, the identical VIIRS instrument on NOAA-20 carries the record, divided by the NOAA-20 ÷ Suomi-NPP ratio over the days both observed (Portugal 1.01, Greece 1.03, Lebanon 0.94, Cyprus 1.14), shrunk firmly toward 1.
6. **Validate.** Leave one overlap year out, predict it from MODIS alone, compare with VIIRS.

Results on held-out years (median absolute error, raw MODIS → harmonized):

| Country  | VIIRS per MODIS cell-day | Monthly error | Yearly error | Bias        |
|----------|--------------------------|---------------|--------------|-------------|
| Portugal | ×1.47                    | 48% → 19%     | 34% → 6%     | −32% → +2%  |
| Greece   | ×2.41                    | 68% → 19%     | 61% → 6%     | −58% → +1%  |
| Lebanon  | ×5.50                    | 90% → 44%     | 84% → 17%    | −82% → −7%  |
| Cyprus   | ×3.28                    | 67% → 49%     | 71% → 26%    | −70% → −8%  |

The factor differs fourfold between these four countries, which is why it is fitted per place and never global.

## Limits

- Counts detections, not hectares. Cloud and smoke hide fires from both sensors.
- A month in which MODIS saw nothing converts to zero, so quiet seasons before 2012 are understated where fires are small (visible in Lebanon and Cyprus).
- Data after 2025 comes from the FIRMS area API and needs a MAP_KEY; without one the record ends on 31 December 2025. API rows are clipped to the Natural Earth border (99.8–100% agreement with NASA's own country files on 2025 test windows).
- The newest months (MODIS from September 2026, VIIRS from August 2026) are near-real-time files: NASA revises them later, and they carry no fire-type label. A cell that held a factory or flare in earlier years is treated as one; tested on 2025 this catches 93–99% of such detections in Portugal, Greece and Cyprus and wrongly flags 0–3% of fires. Lebanon had too few to test.
- NOAA-20 is compared with Suomi-NPP over 2026 only. Where fires are few (Cyprus) that ratio is mostly the prior.
- Four countries are packaged. Adding one is a line in `pipeline/config.mjs`; very large countries would need pre-aggregated tiles.

## Layout

```
pipeline/   fetch-firms.mjs · fetch-recent.mjs · clip.mjs · pack.mjs · boundaries.mjs · summarize.ts
src/lib/    harmonize.ts · stats.ts · analysis.ts · service.ts · sentence.ts · rings.ts · coords.ts · time.ts   (+ harmonize.test.ts)
src/worker/ analysis.worker.ts   runs lib/service.ts off the main thread
server/     app.ts (routes) · main.ts · refresh.ts · live.ts (FIRMS NRT) · fwi.ts + forecast.ts (fire danger) · reports.ts (SQLite) · admin.ts + admin-page.ts (/admin) · ratelimit.ts   runs the same lib/service.ts   (+ api.test.ts, phone.test.ts, admin.test.ts, forecast.test.ts)
            orgs.ts (organizations, SQLite) · risk.ts (site score) · org-routes.ts (/orgs)   (+ orgs.test.ts, risk.test.ts)
apps/org/src/  the console for organizations (/org/): routes/ (Landing · RequestAccess · Login · Invite · app/Overview · Sites · SitePage · Tools · Alerts · Team · Settings) · ui/ (Shell, SurveyMap, parts, icons) · lib/ (api, session, i18n, grid, csv)
src/components/  MapPanel · Verdict · NowCard · PeriodPanel · FireRings · BurnCalendar · Records · SeasonChart · TrustPanel · ExportMenu · Intro
src/i18n/   en.tsx (English wording, and the shape every language fills) · ar.tsx (Arabic) · index.tsx (which language is in use)   (+ i18n.test.ts)
```

To add a language, copy `src/i18n/ar.tsx`, translate it (TypeScript reports any wording left out), and add its code to `Lang` in `en.tsx` and to `STRINGS` in `index.tsx`. The header switch toggles between two languages; a third needs a menu there.

## Data and credits

- Hotspots: [NASA FIRMS](https://www.earthdata.nasa.gov/data/tools/firms) yearly country archive and area API, MODIS (Terra, Aqua) and VIIRS (Suomi NPP, NOAA-20).
- Imagery: NASA GIBS, Blue Marble Shaded Relief and Bathymetry.
- Borders: Natural Earth (public domain).
- Libraries: React, Vite, MapLibre GL JS, GSAP (ScrollTrigger), d3-scale, d3-shape, Hono; fonts Fraunces and IBM Plex, with Amiri and IBM Plex Sans Arabic for Arabic.

An independent project, not a NASA product.
