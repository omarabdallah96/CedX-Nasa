# Product

<!-- impeccable:product-schema 1 -->

Scope: this record covers **Firesight for Organizations**, the web app in `apps/org` served at `/org/`. The public Firesight site (`src/`, `index.html`) and the personal phone app share the data engine and the name but are separate surfaces with their own identity; they are out of scope here.

## Platform

web

## Users

Organizations that answer for many places at once and need to know, every morning, **"which of my sites need attention today, and why?"** Four sectors, given equal weight (no lead sector; the organization's kind picks its default tool):

- **Fire stations and civil defence** (commanders, shift crews): what is burning in the coverage area now, what the week brings, alert the public.
- **Insurers** (underwriters, claims teams): exposure of an insured portfolio, value at risk this week, satellite evidence for a claim.
- **Companies**: farms, factories, resorts, utilities (operations managers). Is it safe to work at each site this week? Warn the staff.
- **NGOs and municipalities** (programme leads, donor reporting): fire in each project area year by year, before and after a project, when the critical period starts.

Each organization has **owners** (manage sites, invite the team, send alerts) and **members** (read everything).

## Product Purpose

It turns NASA satellite fire data into a daily, ranked answer for a portfolio of places. Success means an organization opens it in the morning, sees in seconds which sites need action and why, and acts: warn staff or the public, reschedule work, document a claim, report to donors.

## Positioning

- **One harmonized record.** 25 years of MODIS and VIIRS detections, harmonized into one consistent record. A site's history since 2000 is measured the same way before and after 2012 (validated: Greece yearly error 61% → 6%).
- **Three sources in one score.** That record, live FIRMS satellite fires (last 48 h) and a 16-day Canadian Fire Weather Index forecast are combined into one explainable score per site. Every score carries its plain-language reasons.
- **Coverage.** Four Mediterranean countries: Portugal, Greece, Lebanon, Cyprus.

## Operating Context

- **Access is by invitation only.**
  - An organization asks for access (`/org/request-access`).
  - The Firesight team approves it in `/admin` and sends the owner a one-time link by hand (WhatsApp or email; the server sends no email).
  - Owners invite members the same way.
  - Nobody can sign up as an organization on their own.
- **Monitoring.** A server monitor checks every organization every 30 minutes. It writes a notification when a site rises to "act" or a satellite sees fire inside it, plus a morning digest at 06:00 Beirut time. The app shows these in the app and, if the person allows it, as browser notifications while a tab is open.
- **Use context.** Desk use in an office or a station, often on a shared screen; checked on a phone too. Printed shift briefings go on the station wall. CSV in and out (site lists, exposure, claim evidence).
- **Verification.** Only an organization an admin marked **verified** (fire stations, civil defence, municipalities) can send alerts to the public inside its sites; any organization can alert its own members.

## Capabilities and Constraints

- **Sites:** up to 200 per organization. A site is a named circle (lat, lon, radius 0.5–50 km), with optional value, people, and the year a project started.
- **Daily view:** risk board with scores 0–100 and status act ≥ 80, watch ≥ 50, ok. Each site also has a report: score reasons, 7-day danger, 25-year history, fires nearby, citizens' ground reports with photos.
- **Tools:** shift briefing, portfolio exposure with claim check, work planner (go / caution / stop), project impact.
- **Alerts:** to members, or to the public when verified. Limited to 10 per hour per organization.
- **Score:** a rule table, not calibrated against real events, and must be presented as such. Fire danger says how easily fires start and spread, not where one will start.
- **Country check:** a site's country is decided by bounding box, not border.
- **Languages:** English and Arabic at launch, with full right-to-left layout.
- **Stack:** React + Vite + MapLibre in the existing repo, React Router, Hono + SQLite API (`/api/v1`). One Docker deploy.
- **Undecided:** paid plans will come later. There are no prices, plans or trial terms yet, and the product must not show any.

## Brand Commitments

- Name: **Firesight**; this product is "Firesight for Organizations".
- Data credits must stay visible: NASA FIRMS (MODIS, VIIRS), Open-Meteo, Natural Earth, NASA GIBS imagery. It is an independent project, **not a NASA product**.
- Firesight supports decisions and does not replace official warnings or emergency services.

## Evidence on Hand

- **Validation:** leave-one-year-out validation of the harmonization (README, "How the two records are stitched").
- **Real cases** reproducible on the real record:
  - Pedrógão Grande, Portugal, 17 June 2017: the claim check finds it.
  - The worst-year history of any site.
- **None of these exist:** no customers, testimonials, logos, case studies, press or usage numbers. Never fabricate them.

## Product Principles

1. **Answer first.** Every screen leads with the decision (which sites, what to do), then the evidence.
2. **Every number explains itself.** A score shows its reasons, a forecast shows its source, and a caveat sits next to the claim it limits.
3. **Calm under pressure.** Urgency is shown precisely (status, distance, time seen), never theatrically.
4. **Owners act, members see.** Permissions are clear and never block reading.
5. **Honest scope.** Show coverage limits, calibration limits and unavailable sources plainly.

## Accessibility & Inclusion

- Status and danger are never conveyed by color alone; each also has a label or letter.
- Arabic users get a native right-to-left layout, not a mirrored afterthought.
- The app is keyboard-operable throughout and readable on a phone and when printed.
