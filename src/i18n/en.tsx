// English wording of the website. The shape of this object is the contract
// every other language fills in (see ar.tsx). The API keeps using the plain
// functions in lib/sentence.ts, which this file wraps.
import type { ReactNode } from 'react';
import type { Analysis, Outage, PeriodVerdict } from '../lib/analysis.ts';
import { AIR_TEXT } from '../lib/airText.ts';
import type { BoxFailure } from '../lib/coords.ts';
import { fmtCount, fmtPct, fmtRatio, ordinal } from '../lib/format.ts';
import { ANSWER, monthWording, sourceText, verdictSentence } from '../lib/sentence.ts';
import type { Level, Verdict } from '../lib/stats.ts';
import { longDate, MONTHS, MONTHS_LONG, rangeName, spanName, type Calendar } from '../lib/time.ts';
import type { SeamMode } from '../lib/types.ts';

export type Lang = 'en' | 'ar';

/** Whole numbers with thousands separators. Both languages use Western digits. */
export const num = (v: number): string => v.toLocaleString('en-US');

/** How a day's harmonized value was obtained. */
export type DaySource = 'modis' | 'gap-fill' | 'noaa20' | 'viirs';

const DAY_SOURCE: Record<DaySource, string> = {
  modis: 'scaled from MODIS',
  'gap-fill': 'VIIRS outage, filled from MODIS',
  noaa20: 'VIIRS on NOAA-20',
  viirs: 'VIIRS observed',
};

const unit = (mode: SeamMode) => (mode === 'harmonized' ? 'cell-days' : 'raw detections');

/** "3.2× the usual", "62% of the usual", "level with the usual". */
function versusDates(v: Verdict, level: string): string {
  const r = v.ratio!;
  return `${r >= 1.05 ? fmtRatio(r) : r <= 0.95 ? `${Math.round(r * 100)}% of` : level} the usual for these dates`;
}

export const en = {
  lang: 'en' as Lang,
  dir: 'ltr' as 'ltr' | 'rtl',
  brand: 'Firesight',
  /** The button that switches to the other language, worded in that language. */
  switchTo: { lang: 'ar' as Lang, label: 'العربية', aria: 'عرض الموقع بالعربية' },
  /** Labels the theme button by what it switches to. */
  theme: { light: 'Switch to light theme', dark: 'Switch to dark theme' },

  months: MONTHS,
  monthsLong: MONTHS_LONG,
  /** One character per month, for the tightest axes. */
  monthsNarrow: MONTHS.map((m) => m[0]),
  longDate: (day: number): string => longDate(day),
  spanName: (from: number, to: number): string => spanName(from, to),
  rangeName: (from: number, to: number): string => rangeName(from, to),
  /** "Aug 2025" */
  monthYear: (month: number, year: number): string => `${MONTHS[month]} ${year}`,
  /** "5 Aug" */
  dayMonth: (day: number, month: number): string => `${day} ${MONTHS[month]}`,
  /** A multiplication factor: "×2.7". */
  x: (value: string): string => `×${value}`,
  pct: (v: number, signed = false): string => fmtPct(v, signed),

  country: (_slug: string, name: string): string => name,
  place: (country: string, isArea: boolean): string => (isArea ? `the selected area of ${country}` : country),

  answer: ANSWER as Record<Level, string>,
  verdictSentence: (v: Verdict, what: string, usual: string, place: string): string => verdictSentence(v, what, usual, place),
  monthWording: (p: PeriodVerdict, year: number, month: number): { what: string; usual: string } => monthWording(p, year, month),
  sourceText: (a: Analysis, cal: Calendar, year: number, month: number): { key: 'viirs' | 'modis'; text: string } =>
    sourceText(a, cal, year, month),

  app: {
    bootError: (error: string): ReactNode => (
      <>The data files could not be loaded ({error}). Run <code>npm run data</code> to build them, then reload.</>
    ),
    loading: 'Loading Firesight…',
    placeNav: 'Place',
    howItWorks: 'How it works',
    forOrgs: 'For organizations',
    wrong: 'Something went wrong',
    retry: 'Try again',
    nothing: 'Nothing to judge.',
    nothingText:
      'No fire was detected inside this box in the whole record, so there is no normal to compare with. Draw a larger box or go back to the whole country.',
    reading: (count: number | null): string => `Reading ${count === null ? '' : `${num(count)} `}satellite detections…`,
  },

  area: {
    title: 'Map area',
    filters: 'Filters',
    mapKey: 'Map key',
    showingDrawn: 'Showing a drawn area. Its conversion factor is fitted locally.',
    showingAll: (country: string | null): string => `Showing all of ${country ?? 'the country'}.`,
    cancelDraw: 'Cancel drawing',
    draw: 'Draw a box on the map',
    whole: 'Whole country',
    drawHint: 'Drag on the map from one corner to the opposite corner.',
    /** West, South, East, North: the order of a bounding box. */
    edges: ['West', 'South', 'East', 'North'],
    lon: 'lon',
    lat: 'lat',
    apply: 'Apply',
    hint: 'Edit any edge in decimal degrees (-8.6 or 8.6 W), then Apply.',
    boxError: (e: BoxFailure, _country: string, _bounds: readonly number[]): string => e.message,
    vegOnly: 'Vegetation fires only',
    vegOnlyNote: '(hide volcanoes, gas flares, industry)',
    dropLow: 'Drop low-confidence detections',
    onMap: (total: number, drawn: number, range: string): string =>
      `${num(total)} detections on the map, ${range}${total > drawn ? ` (${num(drawn)} drawn)` : ''}`,
    footprint: 'all-time footprint',
  },

  /** Labels for the fact rows of the side panel. */
  facts: {
    satellite: 'Satellite',
    upTo: 'Data up to',
    cellDay: 'What is a cell-day?',
    cellDayText: 'One ~1 km square where fire was seen on one day, in VIIRS-equivalent units.',
    detections: 'Fire detections',
    cellDays: 'Cell-days',
    vsUsual: 'Compared with usual',
  },
  verdict: {
    heading: 'This month vs. the usual',
    prevMonth: 'Previous month',
    month: 'Month',
    year: 'Year',
    nextMonth: 'Next month',
    question: (month: string, year: number, partial: boolean, place: string): string =>
      `${month} ${year}${partial ? ' so far' : ''} in ${place}: is this normal?`,
    /** Short figure for the badge: how the period compares with the usual one. */
    badge: (v: Verdict, usual: string): string => {
      if (v.ratio === null) return v.value > 0 ? `The usual ${usual} has no fire` : 'No fire detected';
      if (v.ratio >= 1.05) return `${fmtRatio(v.ratio)} the usual ${usual}`;
      if (v.ratio <= 0.95) return `${Math.round(v.ratio * 100)}% of the usual ${usual}`;
      return `Level with the usual ${usual}`;
    },
    firstDays: (days: number): string => `First ${days} days`,
    thisMonth: 'This month',
    likely: (lo: number, hi: number): string => `likely ${fmtCount(lo)}–${fmtCount(hi)}`,
    usualByDay: (day: number): string => `Usual by day ${day}`,
    usualMonth: (month: string): string => `Usual ${month}`,
    median: (first: number, last: number): string => `median, ${first}–${last}`,
    rankLabel: 'Rank',
    rank: (rank: number): string => ordinal(rank),
    rankOf: (n: number): string => ` of ${n}`,
    rankNote: '1st = most fires',
    allOf: (year: number): string => `All of ${year}`,
    wholeYear: (ratio: number | null, rank: number, n: number): string =>
      `${ratio !== null ? `${fmtRatio(ratio)} a typical year` : 'no typical year to compare'}, ${ordinal(rank)} of ${n}`,
    noCoverage: 'No satellite coverage for this month. The record starts in November 2000.',
    jumpAria: 'Jump to a month',
    latestPeak: 'Latest peak season',
    mostActive: 'Most active month on record',
    latest: 'Latest month in the data',
  },

  now: {
    title: 'The last 7 days',
    live: 'Live feed',
    bundled: 'Bundled copy',
    unit: 'cell-days',
    carrier: (days: { noaa20: number; viirs: number }): string =>
      days.noaa20 > 0
        ? `VIIRS on NOAA-20${days.viirs > 0 ? ' and Suomi-NPP' : ''}`
        : days.viirs > 0
          ? 'VIIRS on Suomi-NPP'
          : 'MODIS, converted',
    line: (v: Verdict | null): string => {
      if (!v) return 'Not enough history to compare these dates.';
      if (v.level === 'quiet') return 'No fire detected, as usual for these dates.';
      if (v.ratio === null) return `These dates usually see none. ${ordinal(v.rank)} most active of ${v.nYears} years.`;
      return `${versusDates(v, 'level with')}; ${ordinal(v.rank)} most active of ${v.nYears} years.`;
    },
    badge: (v: Verdict): string =>
      v.level === 'quiet'
        ? 'Quiet'
        : v.ratio === null
          ? 'Unusual'
          : v.ratio >= 1.05
            ? `${fmtRatio(v.ratio)} usual`
            : v.ratio <= 0.95
              ? `${Math.round(v.ratio * 100)}% of usual`
              : 'As usual',
    areaOnly: ' (selected area only)',
    revised: 'The newest days may still change.',
    showing: 'Showing these 7 days on the map',
    show: 'Show these 7 days on the map',
  },

  /** Air quality card; shared with the API (lib/airText.ts). */
  air: AIR_TEXT.en,

  period: {
    title: 'Dates shown on the map',
    from: 'From',
    to: 'To',
    quickAria: 'Quick periods',
    allOf: (year: number): string => `All of ${year}`,
    last7: 'Last 7 days',
    last30: 'Last 30 days',
    whole: 'Whole record',
    errBoth: 'Enter both dates.',
    errOrder: 'From must not be after To.',
    errRange: (first: string, last: string): string => `The record runs from ${first} to ${last}.`,
    compare: (v: Verdict | null): string =>
      !v
        ? ''
        : v.level === 'quiet'
          ? 'quiet, as usual for these dates'
          : v.ratio === null
            ? `these dates usually see none (${ordinal(v.rank)} of ${v.nYears})`
            : `${versusDates(v, 'level with')} (${ordinal(v.rank)} of ${v.nYears})`,
    follows: 'Follows the month picked above.',
  },

  record: {
    eyebrow: 'The record',
    title: (years: number): string => `${years} years, ring by ring`,
    modeAria: 'Which record to show',
    harmonized: 'Harmonized',
    raw: 'Raw record',
    /** `step` is null when MODIS saw too little before 2012 to compare. */
    ledeRaw: (step: number | null): ReactNode =>
      step !== null ? (
        <>
          Raw counts: MODIS until 2012, VIIRS after. A typical year appears to jump <strong>×{step.toFixed(1)}</strong> at the
          dotted ring. That is sharper pixels, not more fire.
        </>
      ) : (
        <>
          Raw counts: MODIS until 2012, VIIRS after. MODIS saw almost nothing here before 2012, so the two halves cannot be
          compared at all.
        </>
      ),
    ledeHarmonized: (firstYear: number, steps: { raw: number; harmonized: number } | null): ReactNode => (
      <>
        One ring per year, {firstYear} at the core, 1 January at the top. Inside the dotted ring MODIS is converted to
        VIIRS-equivalent units.{' '}
        {steps && (
          <>
            Raw counts put a typical year since 2012 at ×{steps.raw.toFixed(1)} of one before; with the sensor effect removed
            it is <strong>×{steps.harmonized.toFixed(1)}</strong>.{' '}
          </>
        )}
        Click any ring or cell to ask about that month.
      </>
    ),
    selectedArea: 'Selected area',
    dayDate: (day: number, month: number, year: number): string => `${day} ${MONTHS[month]} ${year}`,
    dayRaw: (date: string, value: number, sensor: 'MODIS' | 'VIIRS'): string =>
      `${date}: ${fmtCount(value)} raw ${sensor} detections`,
    dayHarmonized: (date: string, value: number, source: DaySource): string =>
      `${date}: ${fmtCount(value)} cell-days · ${DAY_SOURCE[source]}`,
  },

  rings: {
    aria: (title: string, first: number, last: number): string =>
      `Fire rings for ${title}: one ring per year from ${first} at the centre to ${last} at the edge, one step per day clockwise from 1 January at the top. The same numbers are in the burning calendar table.`,
  },

  cal: {
    value: (v: number, mode: SeamMode): string => `${fmtCount(v)} ${unit(mode)}`,
    head: (month: string, year: number, partialDays: number, value: string): string =>
      `${month} ${year}${partialDays ? ` so far (${partialDays} days)` : ''}: ${value}`,
    rawModis: 'MODIS detections, 1 km pixels',
    rawViirs: 'VIIRS detections, 375 m pixels',
    running: (month: string, median: number): string =>
      `Month still running; a full ${month} usually reaches ${fmtCount(median)}`,
    versus: (ratio: number, month: string, median: number): string =>
      `${fmtRatio(ratio)} the usual ${month} (median ${fmtCount(median)})`,
    none: (month: string): string => `The usual ${month} sees none`,
    scaled: (lo: number, hi: number): string => `Scaled from MODIS · likely ${fmtCount(lo)}–${fmtCount(hi)}`,
    observed: 'VIIRS, as observed',
    caption: (mode: SeamMode): string =>
      `Burning calendar: ${unit(mode)} per month, one row per year. ${
        mode === 'harmonized'
          ? 'Values before 2012 are MODIS scaled to VIIRS-equivalent units.'
          : 'Raw counts: MODIS before 2012, VIIRS from 2012.'
      }`,
    year: 'Year',
    yearTotal: 'Year total',
    noCoverage: 'No satellite coverage',
    legendMax: (max: number, mode: SeamMode): string => `${fmtCount(max)} ${unit(mode)} in a month`,
    harmonized: 'Harmonized',
  },

  records: {
    years: 'Most active years',
    peakIn: (month: string): string => `peak in ${month}`,
    months: 'Most active months',
    note: 'Harmonized cell-days. Complete years and months only, so the unfinished current ones are not ranked.',
  },

  season: {
    eyebrow: 'The season',
    title: (year: number): string => `When it burns, and how ${year} compares`,
    /** `end` is null when the peak is a single month. */
    lede: (start: string, end: string | null, share: number): ReactNode => (
      <>
        Critical period: <strong>{end ? `${start} to ${end}` : `${start} alone`}</strong> {end ? 'carry' : 'carries'}{' '}
        <strong>{Math.round(share * 100)}%</strong> of a typical year's burning here.
      </>
    ),
    legendAria: 'Legend',
    median: (first: number, last: number): string => `Median, ${first}–${last}`,
    usualRange: 'Usual range (10th–90th percentile)',
    aria: (year: number, first: number, last: number): string =>
      `Season profile: harmonized cell-days per five days through the year, ${year} against the ${first}–${last} median and usual range.`,
    tipYear: (year: number, v: number): string => `${year}: ${fmtCount(v)} cell-days`,
    tipMedian: (v: number): string => `Median: ${fmtCount(v)}`,
    tipRange: (lo: number, hi: number): string => `Usual range: ${fmtCount(lo)}–${fmtCount(hi)}`,
    axisNote: 'Harmonized active-fire cell-days per five days',
  },

  trust: {
    eyebrow: 'Data quality',
    title: 'How accurate the joined record is',
    lede:
      'Before 2012 only the older MODIS sensors watched; since then the sharper VIIRS sensor has too. MODIS counts are converted to VIIRS units so every year compares fairly. The figures below show how close that conversion gets when tested on years where the real VIIRS answer is known.',
    monthlyError: 'Typical monthly error',
    yearlyError: 'Typical yearly error',
    bias: 'Over- or under-count',
    conversion: 'MODIS → VIIRS factor',
    rawRecord: (value: string): string => `without conversion: ${value}`,
    perCellDay: 'VIIRS per MODIS cell-day',
    note: (o: { nYears: number; nMonths: number; first: number; last: number; minObs: number; thin: boolean; calibrated: boolean }): string =>
      `Typical (median) error when VIIRS is predicted from MODIS, in ${o.nYears} years the model never saw (${o.first}–${o.last}), over the ${o.nMonths} months with at least ${o.minObs} VIIRS cell-days.` +
      (o.thin ? ' Few busy months here, so treat these figures as rough.' : '') +
      (o.calibrated ? '' : ' No overlap data in this area: values before 2012 are unscaled MODIS.'),
    legendAria: 'Legend',
    harmonized: 'Harmonized',
    rawModis: 'Raw MODIS',
    scatterCaption: (): ReactNode => (
      <>
        <strong>Held-out test.</strong> Each mark is one month from a year the model never saw. On the line means MODIS, once
        converted, matches what VIIRS observed.
      </>
    ),
    scatterAria:
      'Scatter plot of VIIRS-observed monthly cell-days against the prediction from MODIS, before and after harmonization.',
    axisViirs: 'VIIRS observed (cell-days per month)',
    axisModis: 'From MODIS',
    tipViirs: (v: number): string => `VIIRS observed: ${fmtCount(v)}`,
    tipHarmonized: (v: number): string => `Harmonized: ${fmtCount(v)}`,
    tipRaw: (v: number): string => `Raw MODIS: ${fmtCount(v)}`,
    ratioCaption: (): ReactNode => (
      <>
        <strong>Conversion factor by month.</strong> VIIRS cell-days per MODIS cell-day. Whiskers show how much it moved from
        year to year; that spread becomes the uncertainty on pre-2012 values.
      </>
    ),
    ratioAria: (min: string, minMonth: string, max: string, maxMonth: string): string =>
      `Conversion factor by month, from ${min} in ${minMonth} to ${max} in ${maxMonth}.`,
    tipRatio: (month: string, ratio: number): string => `${month}: ×${ratio.toFixed(2)}`,
    tipSpread: (lo: number, hi: number): string => `Year-to-year range: ×${lo.toFixed(2)}–×${hi.toFixed(2)}`,
    tipFitted: (cellDays: number): string => `Fitted on ${fmtCount(cellDays)} MODIS cell-days`,
    howTitle: 'How the two records were joined',
    steps: (o: { cellDeg: number; place: string; isArea: boolean; kappa: number; terra: number }): ReactNode[] => [
      <>
        <strong>One unit.</strong> Every detection is snapped to a {o.cellDeg}° grid (about 1 km). A cell counts once per day
        per sensor, so one fire seen as seven small VIIRS pixels and one large MODIS pixel counts the same.
      </>,
      <>
        <strong>Calibrate where both flew.</strong> From February 2012 both sensors watched {o.place}. For each calendar month
        we take total VIIRS cell-days over total MODIS cell-days.
        {o.isArea &&
          ` Because this is a drawn area, its ratio is pulled toward the country's when local data is thin (weight of ${o.kappa} cell-days).`}
      </>,
      <>
        <strong>Convert the past.</strong> Before 2012, MODIS cell-days are multiplied by that month's factor. Before July
        2002 only Terra flew, so Terra gets its own factor (×{o.terra.toFixed(1)} here).
      </>,
      <>
        <strong>Check on unseen years.</strong> Each overlap year is held out in turn, predicted from MODIS alone, and
        compared with what VIIRS saw.
      </>,
    ],
    limitsTitle: 'What this record cannot tell you',
    limits: (o: { outages: Outage[]; coverageEnd: string; nrtFrom: string | null; snppEnd: string | null; ratioN20: number }): ReactNode[] => [
      'It counts where and when fire was detected, not hectares burned. Cloud and thick smoke hide fires from both sensors.',
      'VIIRS catches many small fires MODIS misses, so the factor depends on the place and season. It is fitted per area, never global.',
      'Months with very few detections convert poorly. The likely range on each pre-2012 value shows how much.',
      `VIIRS was offline on ${o.outages.length} occasion${o.outages.length === 1 ? '' : 's'} (${o.outages.map((x) => `${x.from} to ${x.to}`).join('; ')}); those days are filled from MODIS and marked as such.`,
      o.nrtFrom
        ? `The record runs through ${o.coverageEnd}. From ${o.nrtFrom} it uses NASA's near-real-time files, which are revised later and carry no fire-type label: a spot that held a factory or flare in earlier years is treated as one, everything else as vegetation fire.`
        : `The record ends on ${o.coverageEnd}.`,
      ...(o.snppEnd
        ? [
            `Suomi-NPP stopped delivering after ${o.snppEnd}. From then on the same VIIRS instrument on NOAA-20 carries the record, divided by ${o.ratioN20.toFixed(2)}: the ratio between the two over the days both observed.`,
          ]
        : []),
    ],
    showing: (vegOnly: boolean, dropLowConf: boolean, ratios: number[]): string =>
      `Showing: ${vegOnly ? 'presumed vegetation fires only' : 'all thermal anomalies, including volcanoes and industrial sources'}; ${
        dropLowConf ? 'low-confidence detections dropped' : 'low-confidence detections kept'
      }. Month by month: ${MONTHS.map((m, i) => `${m} ×${ratios[i].toFixed(1)}`).join(', ')}.`,
  },

  exp: {
    eyebrow: 'Take it with you',
    title: 'Download the search',
    placeTitle: (country: string, isArea: boolean): string => (isArea ? `${country}, selected area` : country),
    cardEyebrow: (place: string, month: number, year: number): string => `Firesight · ${place} · ${MONTHS[month]} ${year}`,
    noHotspots: 'No hotspots in that period, so there is nothing to download.',
    savedHotspots: (rows: number, period: string): string => `Saved ${num(rows)} hotspots, ${period}.`,
    csvFailed: (message: string): string => `CSV export failed: ${message}`,
    savedDays: (days: number, period: string): string => `Saved ${days} days, ${period}.`,
    savedCalendar: (months: number): string => `Saved the calendar table: ${months} months.`,
    noImage: 'This browser could not create the image.',
    noRings: 'The rings are not drawn yet.',
    savedRings: 'Saved the rings card.',
    savedCalendarImage: 'Saved the calendar image.',
    ringsFooter: (firstYear: number): string =>
      `One ring per year, ${firstYear} at the core. Harmonized MODIS + VIIRS active-fire cell-days. Data: NASA FIRMS.`,
    calendarFooter: 'Harmonized MODIS + VIIRS active-fire cell-days per month. * year not complete. Data: NASA FIRMS.',
    yearTotal: 'Year total',
    preparing: 'Preparing…',
    hotspots: 'Hotspots (CSV)',
    hotspotsDesc: (period: string): ReactNode => (
      <>Every detection in <strong>{period}</strong> that passes the filters, with its sensor and its weight in the harmonized record.</>
    ),
    daily: 'Daily series (CSV)',
    dailyDesc: (period: string): ReactNode => (
      <>One row per day of <strong>{period}</strong>: harmonized cell-days, likely range, source, and the raw counts behind it.</>
    ),
    calendarCsv: 'Calendar table (CSV)',
    calendarCsvDesc: (firstYear: number): string =>
      `The whole burning calendar: every month since ${firstYear} with its usual value and the ratio to it.`,
    calendarPng: 'Calendar (PNG)',
    calendarPngDesc: (month: number, year: number): string =>
      `The burning calendar as an image, with the verdict for ${MONTHS[month]} ${year} on top.`,
    ringsPng: 'Fire rings (PNG)',
    ringsPngDesc: 'The rings as drawn above, with the same verdict.',
    hint: 'The period is the one set beside the map. Area and filters apply to every file.',
  },

  intro: {
    skip: 'Skip to the tool',
    eyebrow: 'NASA Space Apps 2026 · MODIS and VIIRS hot spots',
    question: 'Is this fire season normal?',
    sub: (years: number): string =>
      `${years} years of NASA fire detections for one place, stitched into a single record you can read like tree rings.`,
    cue: 'Scroll to grow the rings',
    sceneAria: (name: string): string => `The fire record of ${name}, year by year`,
    canvasAria: (name: string, first: number, last: number): string =>
      `Fire rings for ${name} growing from ${first} to ${last} as the page scrolls: one ring per year, brighter where more fire was detected.`,
    /** `count` is the live counter element. */
    ticker: (count: ReactNode): ReactNode => <>{count} detections logged so far</>,
    captions: (o: {
      name: string; firstYear: number; topYear: number; seamYear: number; years: number;
      seamStep: number; errorRaw: number; error: number;
    }): { eyebrow: string; title: string; body: ReactNode }[] => [
      {
        eyebrow: `${o.firstYear} onward`,
        title: 'Every ring is a year.',
        body: (
          <>
            Since November {o.firstYear}, NASA's MODIS has logged each fire it could see in {o.name}. One step around the ring
            is one day. Brighter means more fire.
          </>
        ),
      },
      {
        eyebrow: String(o.topYear),
        title: 'Some years leave a scar.',
        body: (
          <>
            {o.topYear} is the most active year in {o.name}'s record. Trees keep fire scars in their rings; this is the same
            idea, read from orbit.
          </>
        ),
      },
      {
        eyebrow: `${o.seamYear} · the problem`,
        title: 'A sharper eye arrives. The record breaks.',
        body: (
          <>
            VIIRS swaps 1 km pixels for 375 m ones and catches fires MODIS missed. Past the dotted ring a typical year appears
            to jump <strong>×{o.seamStep.toFixed(1)}</strong>. Nothing on the ground changed.
          </>
        ),
      },
      {
        eyebrow: 'The fix',
        title: 'So we stitched it.',
        body: (
          <>
            Fire is counted on one 1 km grid, the conversion is learned from the years both sensors flew, and it is checked on
            years the model never saw. Monthly error falls from <strong>{fmtPct(o.errorRaw)}</strong> to{' '}
            <strong>{fmtPct(o.error)}</strong>.
          </>
        ),
      },
      {
        eyebrow: 'One record',
        title: 'Now ask it something.',
        body: <>{o.years} years, two sensors, one consistent record. Keep scrolling to pick a place.</>,
      },
    ],
    markViirs: ' · VIIRS',
    markStitch: 'Stitch',
    pickEyebrow: 'Firesight',
    pickTitle: 'Pick a place.',
    pickText: 'Each one opens with an answer first, then the evidence behind it.',
    detections: (count: number): string => `${num(count)} detections`,
    viirsSees: (ratio: number): string => `VIIRS sees ×${ratio.toFixed(1)} what MODIS does`,
    barsAria: (mode: SeamMode, name: string, first: number, last: number): string =>
      mode === 'raw'
        ? `Raw yearly fire detections in ${name}, ${first} to ${last}: counts jump when VIIRS replaces MODIS in 2012.`
        : `Harmonized yearly fire activity in ${name}, ${first} to ${last}: no jump in 2012.`,
    viirsArrives: (year: number): string => `${year} · VIIRS arrives`,
    legendAria: 'Legend',
    modisDetections: 'MODIS detections',
    viirsDetections: 'VIIRS detections',
    harmonizedRecord: 'Harmonized record',
  },

  map: {
    open: (name: string): string => `Open ${name}`,
    aria: 'Map of fire hotspots',
    failed: (error: string): string => `The map could not start (${error}). The charts and exports below still work.`,
  },

  foot: {
    sources: (detections: number | null, date: string, live: boolean): string =>
      `Hotspots: NASA FIRMS, MODIS (Terra and Aqua) and VIIRS (Suomi NPP, NOAA-20)${
        detections !== null ? `, ${num(detections)} detections in this view` : ''
      }. Data through ${date}${live ? ', served live by the Firesight API' : ', from the copy bundled with this site'}. Imagery: NASA GIBS Blue Marble. Borders: Natural Earth.`,
    built: 'Built for the NASA Space Apps Challenge 2026. An independent project, not a NASA product.',
  },
};

export type Strings = typeof en;
