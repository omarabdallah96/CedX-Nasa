// Arabic wording of the website. Modern Standard Arabic, Western digits,
// Levantine month names (كانون الثاني … كانون الأول).
//
// Names of instruments and data sources (MODIS, VIIRS, NOAA-20, NASA FIRMS)
// stay in Latin script. Figures that carry a sign or a symbol (×2.7, +12%,
// -8.6) are wrapped in a left-to-right isolate so they keep their order
// inside right-to-left text.
import type { Analysis, PeriodVerdict } from '../lib/analysis.ts';
import { fmtCount, fmtPct } from '../lib/format.ts';
import { SRC_GAPFILL, SRC_N20, SRC_VIIRS } from '../lib/harmonize.ts';
import type { Verdict } from '../lib/stats.ts';
import { dayIndex, longDate, rangeName, spanName, type Calendar } from '../lib/time.ts';
import type { SeamMode } from '../lib/types.ts';
import { num, type DaySource, type Strings } from './en.tsx';

const MONTHS_LONG = [
  'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
  'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول',
];
/** The abbreviations used in Lebanon and Syria for the four two-word months. */
const MONTHS = ['ك2', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'ت1', 'ت2', 'ك1'];

const COUNTRIES: Record<string, string> = {
  portugal: 'البرتغال',
  greece: 'اليونان',
  lebanon: 'لبنان',
  cyprus: 'قبرص',
};

/** Keeps a figure such as "×2.7" or "-8.6" in its own left-to-right order. */
const ltr = (text: string): string => `⁦${text}⁩`;
const x = (value: string): string => ltr(`×${value}`);
/** A share out of a hundred, kept as "97%" rather than the mirrored "%97". */
const percent = (share: number): string => ltr(`${Math.round(share * 100)}%`);

// Arabic nouns change with the number in front of them: 1 and 2 have their own
// forms, 3-10 take the plural, 11-99 the singular accusative, hundreds the singular.
interface Forms { one: string; two: string; few: string; many: string; other: string }
const rules = new Intl.PluralRules('ar');

function count(n: number, forms: Forms, shown: string = fmtCount(n)): string {
  switch (rules.select(n)) {
    case 'one': return forms.one;
    case 'two': return forms.two;
    case 'zero':
    case 'few': return `${shown} ${forms.few}`;
    case 'many': return `${shown} ${forms.many}`;
    default: return `${shown} ${forms.other}`;
  }
}

const DETECTIONS: Forms = { one: 'حالة رصد واحدة', two: 'حالتا رصد', few: 'حالات رصد', many: 'حالة رصد', other: 'حالة رصد' };
const RAW_DETECTIONS: Forms = { one: 'حالة رصد خام واحدة', two: 'حالتا رصد خام', few: 'حالات رصد خام', many: 'حالة رصد خام', other: 'حالة رصد خام' };
const HOTSPOTS: Forms = { one: 'بؤرة حرارية واحدة', two: 'بؤرتين حراريتين', few: 'بؤر حرارية', many: 'بؤرة حرارية', other: 'بؤرة حرارية' };
const YEARS: Forms = { one: 'سنة واحدة', two: 'سنتين', few: 'سنوات', many: 'سنة', other: 'سنة' };
const MONTHS_N: Forms = { one: 'شهر واحد', two: 'شهرين', few: 'أشهر', many: 'شهرًا', other: 'شهر' };
const DAYS: Forms = { one: 'يوم واحد', two: 'يومين', few: 'أيام', many: 'يومًا', other: 'يوم' };
const TIMES: Forms = { one: 'مرة واحدة', two: 'مرتين', few: 'مرات', many: 'مرة', other: 'مرة' };

const CELL_DAYS = 'خلية-يوم';
const cellDays = (v: number): string => `${fmtCount(v)} ${CELL_DAYS}`;

/**
 * How a value compares with the usual one, in words: "3.2 أضعاف المعتاد",
 * "أعلى بنسبة 30% من المعتاد", "62% من المعتاد", "بمستوى المعتاد".
 * `usual` names what it is compared with.
 */
function versus(ratio: number, usual: string): string {
  if (ratio >= 1.995) {
    const shown = ratio >= 10 ? String(Math.round(ratio)) : ratio.toFixed(1);
    return `${shown} ${Number(shown) >= 11 ? 'ضعف' : 'أضعاف'} ${usual}`;
  }
  if (ratio >= 1.05) return `أعلى بنسبة ${percent(ratio - 1)} من ${usual}`;
  if (ratio <= 0.95) return `${percent(ratio)} من ${usual}`;
  return `بمستوى ${usual}`;
}

const USUAL_DATES = 'المعتاد لهذه التواريخ';
const rankOfYears = (v: Verdict): string => `المرتبة ${v.rank} من ${count(v.nYears, YEARS)} من حيث النشاط`;

const DAY_SOURCE: Record<DaySource, string> = {
  modis: 'محوَّلة من MODIS',
  'gap-fill': 'انقطاع VIIRS، سُدّت الفجوة من MODIS',
  noaa20: 'VIIRS على NOAA-20',
  viirs: 'رصد VIIRS',
};

const unitName = (mode: SeamMode) => (mode === 'harmonized' ? CELL_DAYS : 'حالات الرصد الخام');
const value = (v: number, mode: SeamMode) => (mode === 'harmonized' ? cellDays(v) : count(v, RAW_DETECTIONS));

export const ar: Strings = {
  lang: 'ar',
  dir: 'rtl',
  brand: 'Firesight',
  switchTo: { lang: 'en', label: 'English', aria: 'View the site in English' },
  theme: { light: 'التبديل إلى المظهر الفاتح', dark: 'التبديل إلى المظهر الداكن' },

  months: MONTHS,
  monthsLong: MONTHS_LONG,
  // No single letter tells the Arabic months apart, so tight axes use the month number.
  monthsNarrow: MONTHS.map((_, i) => String(i + 1)),
  longDate: (day) => longDate(day, MONTHS_LONG),
  spanName: (from, to) => spanName(from, to, MONTHS_LONG),
  rangeName: (from, to) => rangeName(from, to, MONTHS_LONG),
  monthYear: (month, year) => `${MONTHS_LONG[month]} ${year}`,
  dayMonth: (day, month) => `${day} ${MONTHS_LONG[month]}`,
  x,
  pct: (v, signed = false) => ltr(fmtPct(v, signed)),

  country: (slug, name) => COUNTRIES[slug] ?? name,
  place: (country, isArea) => (isArea ? `المنطقة المحددة من ${country}` : country),

  answer: {
    record: 'لا. هذا رقم قياسي.',
    'far-above': 'لا. أعلى بكثير من المعتاد.',
    above: 'أعلى من المعتاد.',
    typical: 'نعم، هذا طبيعي.',
    below: 'أقل من المعتاد.',
    'far-below': 'هدوء غير معتاد.',
    quiet: 'نعم. هادئ كالمعتاد.',
  },

  // `usual` arrives ready to follow "في": "شهر آب", "الفترة 1–13 تشرين الثاني".
  verdictSentence: (v, what, usual, place) => {
    const amount = `في ${what}، سُجّلت في ${place} ${cellDays(v.value)} من الحرائق النشطة`;
    if (v.level === 'quiet') return `${amount}، وفي العادة لا يُسجَّل شيء في ${usual} أيضًا.`;
    const span = `${v.firstYear}–${v.lastYear}`;
    const compared = v.ratio === null ? `في العادة لا يُسجَّل شيء في ${usual}` : versus(v.ratio, `المعتاد في ${usual}`);
    const rank = v.rank === 1
      ? `وهذا أعلى نشاط يُسجَّل في ${usual} خلال ${count(v.nYears, YEARS)} (${span})`
      : v.rank === v.nYears
        ? `وهذا أدنى نشاط يُسجَّل في ${usual} خلال ${count(v.nYears, YEARS)} (${span})`
        : `والمرتبة ${v.rank} من ${v.nYears} من حيث النشاط في ${usual} (${span})`;
    return `${amount}: ${compared}، ${rank}.`;
  },
  monthWording: (p: PeriodVerdict, year, month) => {
    const name = MONTHS_LONG[month];
    if (p.partialDays === null) return { what: `${name} ${year}`, usual: `شهر ${name}` };
    const from = dayIndex(year, month + 1, 1);
    const days = spanName(from, from + p.partialDays - 1, MONTHS_LONG);
    return { what: `${name} ${year} حتى الآن (${days})`, usual: `الفترة ${days}` };
  },
  sourceText: (a: Analysis, cal: Calendar, year, month) => {
    const src = a.harmonized.src[Math.min(cal.nDays - 1, dayIndex(year, month + 1, 15))];
    if (src === SRC_VIIRS) return { key: 'viirs', text: 'VIIRS (Suomi-NPP)، كما رُصد' };
    if (src === SRC_N20) {
      return { key: 'viirs', text: `VIIRS على NOAA-20، ${ltr(`÷${a.calibration.ratioN20.toFixed(2)}`)} ليطابق Suomi-NPP` };
    }
    if (src === SRC_GAPFILL) return { key: 'modis', text: 'انقطاع VIIRS: سُدّت الفجوة من MODIS' };
    return { key: 'modis', text: `MODIS، محوَّلًا بمعامل ${x(a.calibration.ratio[month].toFixed(1))}` };
  },

  app: {
    bootError: (error) => (
      <>تعذّر تحميل ملفات البيانات ({error}). شغّل <code dir="ltr">npm run data</code> لبنائها، ثم أعد تحميل الصفحة.</>
    ),
    loading: 'جارٍ تحميل Firesight…',
    placeNav: 'المكان',
    howItWorks: 'كيف يعمل',
    wrong: 'حدث خطأ',
    retry: 'أعد المحاولة',
    nothing: 'لا شيء للحكم عليه.',
    nothingText:
      'لم يُرصد أي حريق داخل هذا المستطيل طوال السجل، فلا يوجد معتاد يُقارَن به. ارسم مستطيلًا أكبر أو عُد إلى البلد كاملًا.',
    reading: (n) =>
      n === null ? 'جارٍ قراءة حالات الرصد من الأقمار الصناعية…' : `جارٍ قراءة ${count(n, DETECTIONS, num(n))} من الأقمار الصناعية…`,
  },

  area: {
    title: 'المنطقة',
    showingDrawn: 'تُعرض منطقة مرسومة. معامل تحويلها محسوب محليًا.',
    showingAll: (country) => `تُعرض كامل مساحة ${country ?? 'البلد'}.`,
    cancelDraw: 'إلغاء الرسم',
    draw: 'ارسم مستطيلًا على الخريطة',
    whole: 'البلد كاملًا',
    drawHint: 'اسحب على الخريطة من زاوية إلى الزاوية المقابلة.',
    edges: ['غرب', 'جنوب', 'شرق', 'شمال'],
    lon: 'طول',
    lat: 'عرض',
    apply: 'تطبيق',
    hint: `عدّل أي حدّ بالدرجات العشرية (${ltr('-8.6')} أو ${ltr('8.6 W')})، ثم اضغط «تطبيق».`,
    boxError: (e, country, bounds) => {
      const edges = ['الغرب', 'الجنوب', 'الشرق', 'الشمال'];
      switch (e.code) {
        case 'not-a-number':
          return `قيمة غير رقمية في: ${e.fields.map((i) => edges[i]).join('، ')}. استخدم الدرجات العشرية، مثل ${ltr('-8.6')} أو ${ltr('8.6 W')}.`;
        case 'longitude': return `خط الطول يتراوح بين ${ltr('-180')} و180.`;
        case 'latitude': return `خط العرض يتراوح بين ${ltr('-90')} و90.`;
        case 'west-east': return 'يجب أن تكون قيمة الغرب أصغر من قيمة الشرق.';
        case 'south-north': return 'يجب أن تكون قيمة الجنوب أصغر من قيمة الشمال.';
        default: {
          const [w, s, east, n] = bounds.map((v) => ltr(String(v)));
          return `هذا المستطيل خارج ${country}. حدود ${country}: خطوط الطول من ${w} إلى ${east}، وخطوط العرض من ${s} إلى ${n}.`;
        }
      }
    },
    vegOnly: 'حرائق الغطاء النباتي فقط',
    vegOnlyNote: '(إخفاء البراكين وشعلات الغاز والمنشآت الصناعية)',
    dropLow: 'استبعاد حالات الرصد منخفضة الثقة',
    onMap: (total, drawn, range) =>
      `${count(total, DETECTIONS, num(total))} على الخريطة، ${range}${total > drawn ? ` (المرسوم منها ${num(drawn)})` : ''}`,
    footprint: 'الأثر التراكمي لكل السنوات',
  },

  verdict: {
    prevMonth: 'الشهر السابق',
    month: 'الشهر',
    year: 'السنة',
    nextMonth: 'الشهر التالي',
    question: (month, year, partial, place) => `${month} ${year}${partial ? ' حتى الآن' : ''} في ${place}: هل هذا طبيعي؟`,
    badge: (v, usual) => {
      if (v.ratio === null) return v.value > 0 ? `لا حرائق في ${usual} في العادة` : 'لم تُرصد حرائق';
      return versus(v.ratio, `المعتاد في ${usual}`);
    },
    firstDays: (days) => (days === 1 ? 'اليوم الأول' : days === 2 ? 'أول يومين' : `أول ${count(days, DAYS)}`),
    thisMonth: 'هذا الشهر',
    likely: (lo, hi) => `المرجّح ${fmtCount(lo)}–${fmtCount(hi)}`,
    usualByDay: (day) => `المعتاد حتى اليوم ${day}`,
    usualMonth: (month) => `المعتاد في ${month}`,
    median: (first, last) => `الوسيط، ${first}–${last}`,
    rankLabel: 'المرتبة',
    rank: (rank) => String(rank),
    rankOf: (n) => ` من ${n}`,
    rankNote: 'الأكثر نشاطًا أولًا',
    source: (text) => `مصدر هذا الشهر: ${text}.`,
    wholeYear: (year, ratio, rank, n) =>
      ` سنة ${year} كاملةً: ${ratio !== null ? versus(ratio, 'السنة الاعتيادية') : 'لا سنة اعتيادية للمقارنة'}، المرتبة ${rank} من ${n}.`,
    noCoverage: 'لا تغطية من الأقمار الصناعية لهذا الشهر. يبدأ السجل في تشرين الثاني 2000.',
    jumpAria: 'الانتقال إلى شهر',
    latestPeak: 'آخر موسم ذروة',
    mostActive: 'الشهر الأكثر نشاطًا في السجل',
    latest: 'آخر شهر في البيانات',
    note: (date) =>
      `البيانات متوفرة حتى ${date}. «${CELL_DAYS}» واحدة هي خلية من الشبكة بعرض نحو 1 كم سُجّل فيها حريق في يوم واحد، بوحدات مكافئة لـVIIRS.`,
  },

  now: {
    title: 'آخر 7 أيام',
    live: 'بثّ مباشر',
    bundled: 'نسخة مرفقة',
    unit: CELL_DAYS,
    carrier: (days) =>
      days.noaa20 > 0
        ? `VIIRS على NOAA-20${days.viirs > 0 ? ' وSuomi-NPP' : ''}`
        : days.viirs > 0
          ? 'VIIRS على Suomi-NPP'
          : 'MODIS بعد التحويل',
    line: (v) => {
      if (!v) return 'لا يكفي السجل لمقارنة هذه التواريخ.';
      if (v.level === 'quiet') return 'لم تُرصد حرائق، كالمعتاد في هذه التواريخ.';
      if (v.ratio === null) return `في العادة لا يُسجَّل شيء في هذه التواريخ. ${rankOfYears(v)}.`;
      return `${versus(v.ratio, USUAL_DATES)}؛ ${rankOfYears(v)}.`;
    },
    badge: (v) => (v.level === 'quiet' ? 'هادئ' : v.ratio === null ? 'غير معتاد' : v.ratio > 0.95 && v.ratio < 1.05 ? 'كالمعتاد' : versus(v.ratio, 'المعتاد')),
    note: (carrier, isArea, date) =>
      `المصدر: ${carrier}${isArea ? '، في المنطقة المحددة' : ''}. البيانات حتى ${date}؛ الأيام الأحدث شبه آنية وقد تُراجَع لاحقًا.`,
    showing: 'هذه الأيام السبعة معروضة على الخريطة',
    show: 'اعرض هذه الأيام السبعة على الخريطة',
  },

  period: {
    title: 'الفترة',
    from: 'من',
    to: 'إلى',
    quickAria: 'فترات سريعة',
    allOf: (year) => `سنة ${year} كاملة`,
    last7: 'آخر 7 أيام',
    last30: 'آخر 30 يومًا',
    whole: 'السجل كاملًا',
    errBoth: 'أدخل التاريخين.',
    errOrder: 'يجب ألّا يكون تاريخ البداية بعد تاريخ النهاية.',
    errRange: (first, last) => `يمتد السجل من ${ltr(first)} إلى ${ltr(last)}.`,
    compare: (v) =>
      !v
        ? ''
        : v.level === 'quiet'
          ? 'هادئ كالمعتاد في هذه التواريخ'
          : v.ratio === null
            ? `في العادة لا يُسجَّل شيء في هذه التواريخ (المرتبة ${v.rank} من ${v.nYears})`
            : `${versus(v.ratio, USUAL_DATES)} (المرتبة ${v.rank} من ${v.nYears})`,
    summary: (detections, cd, compare, followsMonth) =>
      `${count(detections, DETECTIONS, num(detections))} · ${cellDays(cd)}${compare ? ` · ${compare}` : ''}${followsMonth ? ' · تتبع الشهر المحدد' : ''}`,
  },

  record: {
    eyebrow: 'السجل',
    title: (years) => `${count(years, YEARS)}، حلقةً حلقة`,
    modeAria: 'السجل المعروض',
    harmonized: 'الموحَّد',
    raw: 'السجل الخام',
    ledeRaw: (step) =>
      step !== null ? (
        <>
          الأعداد الخام: MODIS حتى 2012 ثم VIIRS. تبدو السنة الاعتيادية كأنها تقفز <strong>{x(step.toFixed(1))}</strong> عند
          الحلقة المنقّطة. السبب بكسلات أدقّ، لا حرائق أكثر.
        </>
      ) : (
        <>
          الأعداد الخام: MODIS حتى 2012 ثم VIIRS. لم يرصد MODIS هنا شيئًا يُذكر قبل 2012، فلا يمكن مقارنة النصفين إطلاقًا.
        </>
      ),
    ledeHarmonized: (firstYear, steps) => (
      <>
        حلقة لكل سنة: {firstYear} في المركز، و1 كانون الثاني في الأعلى. داخل الحلقة المنقّطة تُحوَّل قراءات MODIS إلى وحدات
        مكافئة لـVIIRS.{' '}
        {steps && (
          <>
            منذ 2012 تبدو السنة الاعتيادية بالأعداد الخام {x(steps.raw.toFixed(1))} مما كانت عليه قبله، وبعد إزالة أثر المستشعر
            تصبح <strong>{x(steps.harmonized.toFixed(1))}</strong>.{' '}
          </>
        )}
        انقر أي حلقة أو خانة للسؤال عن ذلك الشهر.
      </>
    ),
    selectedArea: 'المنطقة المحددة',
    dayDate: (day, month, year) => `${day} ${MONTHS_LONG[month]} ${year}`,
    dayRaw: (date, v, sensor) => `${date}: ${count(v, RAW_DETECTIONS)} من ${sensor}`,
    dayHarmonized: (date, v, source) => `${date}: ${cellDays(v)} · ${DAY_SOURCE[source]}`,
  },

  rings: {
    aria: (title, first, last) =>
      `حلقات النار في ${title}: حلقة لكل سنة من ${first} في المركز إلى ${last} عند الحافة، وخطوة لكل يوم باتجاه عقارب الساعة بدءًا من 1 كانون الثاني في الأعلى. الأرقام نفسها متوفرة في جدول تقويم الحرائق.`,
  },

  cal: {
    value,
    head: (month, year, partialDays, shown) =>
      `${month} ${year}${partialDays ? ` حتى الآن (${count(partialDays, DAYS)})` : ''}: ${shown}`,
    rawModis: 'رصد MODIS، بكسلات 1 كم',
    rawViirs: 'رصد VIIRS، بكسلات 375 م',
    running: (month, median) => `الشهر لم ينتهِ بعد؛ شهر ${month} الكامل يبلغ في العادة ${fmtCount(median)}`,
    versus: (ratio, month, median) => `${versus(ratio, `المعتاد في شهر ${month}`)} (الوسيط ${fmtCount(median)})`,
    none: (month) => `في العادة لا يُسجَّل شيء في شهر ${month}`,
    scaled: (lo, hi) => `محوَّل من MODIS · المرجّح ${fmtCount(lo)}–${fmtCount(hi)}`,
    observed: 'VIIRS، كما رُصد',
    caption: (mode) =>
      `تقويم الحرائق: ${unitName(mode)} في كل شهر، صف لكل سنة. ${
        mode === 'harmonized'
          ? 'قيم ما قبل 2012 هي قراءات MODIS محوَّلة إلى وحدات مكافئة لـVIIRS.'
          : 'أعداد خام: MODIS قبل 2012، وVIIRS منذ 2012.'
      }`,
    year: 'السنة',
    yearTotal: 'مجموع السنة',
    noCoverage: 'لا تغطية من الأقمار الصناعية',
    legendMax: (max, mode) => `${value(max, mode)} في الشهر`,
    harmonized: 'موحَّد',
  },

  records: {
    years: 'السنوات الأكثر نشاطًا',
    peakIn: (month) => `الذروة في ${month}`,
    months: 'الأشهر الأكثر نشاطًا',
    note: `بوحدة ${CELL_DAYS} الموحَّدة. السنوات والأشهر المكتملة فقط، فلا تُصنَّف السنة والشهر الجاريان غير المكتملين.`,
  },

  season: {
    eyebrow: 'الموسم',
    title: (year) => `متى تشتعل الحرائق، وكيف تبدو ${year} بالمقارنة`,
    lede: (start, end, share) => (
      <>
        الفترة الحرجة: <strong>{end ? `من ${start} إلى ${end}` : `${start} وحده`}</strong>، وفيها{' '}
        <strong>{percent(share)}</strong> من حرائق السنة الاعتيادية هنا.
      </>
    ),
    legendAria: 'مفتاح الرسم',
    median: (first, last) => `الوسيط، ${first}–${last}`,
    usualRange: 'المدى المعتاد (بين المئين 10 والمئين 90)',
    aria: (year, first, last) =>
      `منحنى الموسم: ${CELL_DAYS} الموحَّدة لكل خمسة أيام على مدار السنة، ${year} مقارنةً بوسيط ${first}–${last} والمدى المعتاد.`,
    tipYear: (year, v) => `${year}: ${cellDays(v)}`,
    tipMedian: (v) => `الوسيط: ${fmtCount(v)}`,
    tipRange: (lo, hi) => `المدى المعتاد: ${fmtCount(lo)}–${fmtCount(hi)}`,
    axisNote: `${CELL_DAYS} موحَّدة للحرائق النشطة لكل خمسة أيام`,
  },

  trust: {
    eyebrow: 'الأدلة',
    title: 'هل يمكن الوثوق بهذا الوصل؟',
    monthlyError: 'الخطأ الشهري',
    yearlyError: 'الخطأ السنوي',
    bias: 'الانحياز',
    conversion: 'التحويل',
    rawRecord: (shown) => `السجل الخام: ${shown}`,
    perCellDay: `VIIRS مقابل كل ${CELL_DAYS} من MODIS`,
    note: (o) =>
      `وسيط الخطأ المطلق مقارنةً بـVIIRS في ${count(o.nYears, YEARS)} محجوبة (${o.first}–${o.last})، محسوبًا على ${count(o.nMonths, MONTHS_N)} بلغ كلٌّ منها ${o.minObs} ${CELL_DAYS} على الأقل من VIIRS.` +
      (o.thin ? ' الأشهر النشطة هنا قليلة، فاعتبر هذه الأرقام تقريبية.' : '') +
      (o.calibrated ? '' : ' لا بيانات تداخل في هذه المنطقة: قيم ما قبل 2012 هي قراءات MODIS بلا تحويل.'),
    legendAria: 'مفتاح الرسم',
    harmonized: 'موحَّد',
    rawModis: 'MODIS الخام',
    scatterCaption: () => (
      <>
        <strong>اختبار على سنوات محجوبة.</strong> كل علامة شهرٌ من سنة لم يرها النموذج. الوقوع على الخط يعني أن MODIS بعد
        التحويل يطابق ما رصده VIIRS.
      </>
    ),
    scatterAria: `مخطط انتشار يقارن قيم ${CELL_DAYS} الشهرية التي رصدها VIIRS بما يُتوقَّع من MODIS، قبل التوحيد وبعده.`,
    axisViirs: `رصد VIIRS (${CELL_DAYS} في الشهر)`,
    axisModis: 'من MODIS',
    tipViirs: (v) => `رصد VIIRS: ${fmtCount(v)}`,
    tipHarmonized: (v) => `الموحَّد: ${fmtCount(v)}`,
    tipRaw: (v) => `MODIS الخام: ${fmtCount(v)}`,
    ratioCaption: () => (
      <>
        <strong>معامل التحويل لكل شهر.</strong> {CELL_DAYS} من VIIRS مقابل كل {CELL_DAYS} من MODIS. الخطوط الرأسية تُظهر مقدار
        تغيّره من سنة إلى أخرى، وهذا التباين يصبح هامش عدم اليقين في قيم ما قبل 2012.
      </>
    ),
    ratioAria: (min, minMonth, max, maxMonth) => `معامل التحويل لكل شهر، من ${min} في ${minMonth} إلى ${max} في ${maxMonth}.`,
    tipRatio: (month, ratio) => `${month}: ${x(ratio.toFixed(2))}`,
    tipSpread: (lo, hi) => `المدى بين السنوات: ${ltr(`×${lo.toFixed(2)}–×${hi.toFixed(2)}`)}`,
    tipFitted: (cd) => `محسوب من ${cellDays(cd)} من MODIS`,
    howTitle: 'كيف وُصل السجلّان',
    steps: (o) => [
      <>
        <strong>وحدة واحدة.</strong> تُسقَط كل حالة رصد على شبكة بخلايا {ltr(`${o.cellDeg}°`)} (نحو 1 كم). تُحتسب الخلية مرة واحدة
        في اليوم لكل مستشعر، فالحريق الذي يراه VIIRS سبعة بكسلات صغيرة ويراه MODIS بكسلًا واحدًا كبيرًا يُحتسب بالقدر نفسه.
      </>,
      <>
        <strong>المعايرة حيث عمل الاثنان معًا.</strong> منذ شباط 2012 يراقب المستشعران {o.place} معًا. لكل شهر من أشهر السنة
        نقسم مجموع {CELL_DAYS} من VIIRS على مجموعها من MODIS.
        {o.isArea && ` ولأن هذه منطقة مرسومة، تُقرَّب نسبتها من نسبة البلد حين تقلّ البيانات المحلية (بوزن ${o.kappa} ${CELL_DAYS}).`}
      </>,
      <>
        <strong>تحويل الماضي.</strong> قبل 2012 تُضرب قيم MODIS في معامل الشهر نفسه. وقبل تموز 2002 لم يكن في المدار سوى
        Terra، فله معامل خاص به ({x(o.terra.toFixed(1))} هنا).
      </>,
      <>
        <strong>التحقق على سنوات لم تُرَ.</strong> تُحجب كل سنة من سنوات التداخل بدورها، فتُقدَّر من MODIS وحده ثم تُقارَن بما
        رصده VIIRS.
      </>,
    ],
    limitsTitle: 'ما لا يخبرك به هذا السجل',
    limits: (o) => [
      'يحصي أين ومتى رُصدت الحرائق، لا المساحات المحترقة بالهكتار. الغيوم والدخان الكثيف يحجبان الحرائق عن المستشعرَين كليهما.',
      'يلتقط VIIRS حرائق صغيرة كثيرة تفوت MODIS، فالمعامل يتبدّل بحسب المكان والموسم. لذلك يُحسب لكل منطقة على حدة، لا عالميًا.',
      'الأشهر القليلة الرصد يصعب تحويلها بدقة. والمدى المرجّح المرفق بكل قيمة قبل 2012 يبيّن مقدار ذلك.',
      `توقّف VIIRS عن العمل ${count(o.outages.length, TIMES)} (${o.outages.map((out) => rangeName(out.start, out.end, MONTHS_LONG)).join('؛ ')})؛ تُسدّ تلك الأيام من MODIS ويُشار إليها بذلك.`,
      o.nrtFrom
        ? `يمتد السجل حتى ${o.coverageEnd}. ومنذ ${o.nrtFrom} يعتمد على ملفات ناسا شبه الآنية، وهي تُراجَع لاحقًا ولا تحمل تصنيفًا لنوع الحريق: الموقع الذي ضمّ مصنعًا أو شعلة غاز في سنوات سابقة يُعامَل على هذا الأساس، وما عداه يُعدّ حريق غطاء نباتي.`
        : `ينتهي السجل في ${o.coverageEnd}.`,
      ...(o.snppEnd
        ? [
            `توقّف Suomi-NPP عن إرسال البيانات بعد ${o.snppEnd}. منذ ذلك الحين يحمل السجلَّ مستشعر VIIRS نفسه على متن NOAA-20، مقسومًا على ${o.ratioN20.toFixed(2)}: وهي النسبة بين الاثنين في الأيام التي رصدا فيها معًا.`,
          ]
        : []),
    ],
    showing: (vegOnly, dropLowConf, ratios) =>
      `المعروض: ${vegOnly ? 'حرائق الغطاء النباتي المفترضة فقط' : 'جميع الشذوذات الحرارية، بما فيها البراكين والمصادر الصناعية'}؛ ${
        dropLowConf ? 'حالات الرصد منخفضة الثقة مستبعدة' : 'حالات الرصد منخفضة الثقة مُبقاة'
      }. شهرًا بشهر: ${MONTHS_LONG.map((m, i) => `${m} ${x(ratios[i].toFixed(1))}`).join('، ')}.`,
  },

  exp: {
    eyebrow: 'خذه معك',
    title: 'نزّل نتائج البحث',
    placeTitle: (country, isArea) => (isArea ? `${country}، المنطقة المحددة` : country),
    cardEyebrow: (place, month, year) => `Firesight · ${place} · ${MONTHS_LONG[month]} ${year}`,
    noHotspots: 'لا بؤر حرارية في هذه الفترة، فلا شيء للتنزيل.',
    savedHotspots: (rows, period) => `تم حفظ ${count(rows, HOTSPOTS, num(rows))}، ${period}.`,
    csvFailed: (message) => `تعذّر تصدير CSV: ${message}`,
    savedDays: (days, period) => `تم حفظ ${count(days, DAYS, num(days))}، ${period}.`,
    savedCalendar: (months) => `تم حفظ جدول التقويم: ${count(months, MONTHS_N)}.`,
    noImage: 'تعذّر على هذا المتصفح إنشاء الصورة.',
    noRings: 'لم تُرسم الحلقات بعد.',
    savedRings: 'تم حفظ بطاقة الحلقات.',
    savedCalendarImage: 'تم حفظ صورة التقويم.',
    ringsFooter: (firstYear) =>
      `حلقة لكل سنة، ${firstYear} في المركز. ${CELL_DAYS} موحَّدة للحرائق النشطة من MODIS وVIIRS. البيانات: NASA FIRMS.`,
    calendarFooter: `${CELL_DAYS} موحَّدة للحرائق النشطة من MODIS وVIIRS في كل شهر. * سنة غير مكتملة. البيانات: NASA FIRMS.`,
    yearTotal: 'مجموع السنة',
    preparing: 'جارٍ التحضير…',
    hotspots: 'البؤر الحرارية (CSV)',
    hotspotsDesc: (period) => (
      <>كل حالة رصد في <strong>{period}</strong> تجتاز عوامل التصفية، مع مستشعرها ووزنها في السجل الموحَّد.</>
    ),
    daily: 'السلسلة اليومية (CSV)',
    dailyDesc: (period) => (
      <>صف لكل يوم من <strong>{period}</strong>: {CELL_DAYS} الموحَّدة، والمدى المرجّح، والمصدر، والأعداد الخام التي تستند إليها.</>
    ),
    calendarCsv: 'جدول التقويم (CSV)',
    calendarCsvDesc: (firstYear) => `تقويم الحرائق كاملًا: كل شهر منذ ${firstYear} مع قيمته المعتادة ونسبته إليها.`,
    calendarPng: 'التقويم (PNG)',
    calendarPngDesc: (month, year) => `تقويم الحرائق صورةً، يعلوها الحكم على ${MONTHS_LONG[month]} ${year}.`,
    ringsPng: 'حلقات النار (PNG)',
    ringsPngDesc: 'الحلقات كما تظهر أعلاه، مع الحكم نفسه.',
    hint: 'الفترة هي المحددة بجانب الخريطة. المنطقة وعوامل التصفية تنطبق على كل الملفات.',
  },

  intro: {
    skip: 'انتقل إلى الأداة',
    eyebrow: 'NASA Space Apps 2026 · البؤر الحرارية من MODIS وVIIRS',
    question: 'هل موسم الحرائق هذا طبيعي؟',
    sub: (years) => `${count(years, YEARS)} من رصد ناسا للحرائق في مكان واحد، موصولة في سجل واحد تقرؤه كما تُقرأ حلقات الأشجار.`,
    cue: 'مرِّر لتنمو الحلقات',
    sceneAria: (name) => `سجل الحرائق في ${name}، سنة بعد سنة`,
    canvasAria: (name, first, last) =>
      `حلقات النار في ${name} تنمو من ${first} إلى ${last} مع تمرير الصفحة: حلقة لكل سنة، وأشدّ سطوعًا حيث رُصدت حرائق أكثر.`,
    ticker: (counter) => <>حالات الرصد المسجّلة حتى الآن: {counter}</>,
    captions: (o) => [
      {
        eyebrow: `منذ ${o.firstYear}`,
        title: 'كل حلقة سنة.',
        body: (
          <>
            منذ تشرين الثاني {o.firstYear} يسجّل مستشعر MODIS التابع لناسا كل حريق يستطيع رؤيته في {o.name}. كل خطوة على محيط
            الحلقة يوم واحد، وكلما اشتدّ السطوع زادت الحرائق.
          </>
        ),
      },
      {
        eyebrow: String(o.topYear),
        title: 'بعض السنوات تترك ندبة.',
        body: (
          <>
            سنة {o.topYear} هي الأكثر نشاطًا في سجل {o.name}. الأشجار تحفظ ندوب الحرائق في حلقاتها، وهذه الفكرة نفسها مقروءةً
            من المدار.
          </>
        ),
      },
      {
        eyebrow: `${o.seamYear} · المشكلة`,
        title: 'عين أحدّ تصل، فينكسر السجل.',
        body: (
          <>
            يستعيض VIIRS عن بكسلات 1 كم ببكسلات 375 م، فيلتقط حرائق فاتت MODIS. بعد الحلقة المنقّطة تبدو السنة الاعتيادية كأنها
            قفزت <strong>{x(o.seamStep.toFixed(1))}</strong>. ولم يتغيّر شيء على الأرض.
          </>
        ),
      },
      {
        eyebrow: 'الحل',
        title: 'فوصلنا السجلّين.',
        body: (
          <>
            تُعَدّ الحرائق على شبكة واحدة بخلايا 1 كم، ويُستخلَص معامل التحويل من السنوات التي عمل فيها المستشعران معًا، ثم يُختبَر
            على سنوات لم يرها النموذج قط. فينخفض الخطأ الشهري من <strong>{ltr(fmtPct(o.errorRaw))}</strong> إلى{' '}
            <strong>{ltr(fmtPct(o.error))}</strong>.
          </>
        ),
      },
      {
        eyebrow: 'سجل واحد',
        title: 'والآن اسأله.',
        body: <>{count(o.years, YEARS)}، مستشعران، وسجل واحد متّسق. تابع التمرير لاختيار مكان.</>,
      },
    ],
    markViirs: ' · VIIRS',
    markStitch: 'الوصل',
    pickEyebrow: 'Firesight',
    pickTitle: 'اختر مكانًا.',
    pickText: 'كل مكان يبدأ بالجواب، ثم بالأدلة التي تسنده.',
    detections: (n) => count(n, DETECTIONS, num(n)),
    viirsSees: (ratio) => `يرصد VIIRS ${x(ratio.toFixed(1))} مما يرصده MODIS`,
    barsAria: (mode, name, first, last) =>
      mode === 'raw'
        ? `حالات رصد الحرائق السنوية الخام في ${name}، من ${first} إلى ${last}: تقفز الأعداد حين يحلّ VIIRS محل MODIS عام 2012.`
        : `النشاط السنوي الموحَّد للحرائق في ${name}، من ${first} إلى ${last}: بلا قفزة عام 2012.`,
    viirsArrives: (year) => `${year} · وصول VIIRS`,
    legendAria: 'مفتاح الرسم',
    modisDetections: 'رصد MODIS',
    viirsDetections: 'رصد VIIRS',
    harmonizedRecord: 'السجل الموحَّد',
  },

  map: {
    open: (name) => `افتح ${name}`,
    aria: 'خريطة البؤر الحرارية للحرائق',
    failed: (error) => `تعذّر تشغيل الخريطة (${error}). الرسوم والتنزيلات أدناه ما زالت تعمل.`,
  },

  foot: {
    sources: (detections, date, live) =>
      `البؤر الحرارية: NASA FIRMS، MODIS (Terra وAqua) وVIIRS (Suomi NPP وNOAA-20)${
        detections !== null ? `، ${count(detections, DETECTIONS, num(detections))} في هذا العرض` : ''
      }. البيانات حتى ${date}${live ? '، تُقدَّم مباشرةً عبر واجهة Firesight البرمجية' : '، من النسخة المرفقة بهذا الموقع'}. الصور: NASA GIBS Blue Marble. الحدود: Natural Earth.`,
    built: 'أُنجز ضمن تحدي NASA Space Apps 2026. مشروع مستقل وليس من منتجات ناسا.',
  },
};
