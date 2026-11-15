// Wording for air quality, in both languages. The API (`/air?lang=`) and the
// website's air card read the same text, so their advice cannot differ.
import type { AirLevel, Co2Level, Pollutant } from './air.ts';

export interface AirText {
  title: string;
  /** Name of each class, as on a badge. */
  level: Record<AirLevel, string>;
  /** One sentence answering "is it safe?". */
  headline: Record<AirLevel, string>;
  /** What to do at each class. */
  advice: Record<AirLevel, string[]>;
  pollutant: Record<Pollutant, string>;
  co2Level: Record<Co2Level, string>;
  co2Note: (ppm: number, percent: number) => string;
  tips: { smokeTitle: string; smoke: string[]; indoorTitle: string; indoor: string[] };
  /** Limits of the numbers. */
  model: string;

  // Labels of the website's card.
  aqi: string;
  mainPollutant: string;
  atCentre: (place: string) => string;
  atYou: string;
  useMine: string;
  locating: string;
  backToPlace: string;
  loading: string;
  denied: string;
  failed: string;
  retry: string;
  co2: string;
  co: string;
  next: (peak: number, level: string, hour: string) => string;
  whatToDo: string;
}

const en: AirText = {
  title: 'Air quality',
  level: {
    good: 'Good',
    moderate: 'Moderate',
    sensitive: 'Unhealthy for sensitive people',
    unhealthy: 'Unhealthy',
    'very-unhealthy': 'Very unhealthy',
    hazardous: 'Hazardous',
  },
  headline: {
    good: 'The air is clean. Safe to be outside.',
    moderate: 'The air is acceptable. Safe for most people.',
    sensitive: 'Safe for most people, but not for children, older people or anyone with asthma, heart or lung disease.',
    unhealthy: 'Not safe: everyone can start to feel it.',
    'very-unhealthy': 'Not safe: stay indoors.',
    hazardous: 'Dangerous air. Stay indoors or leave the area.',
  },
  advice: {
    good: ['Outdoor activity is fine for everyone.', 'A good time to open the windows and air the house.'],
    moderate: [
      'Fine for most people.',
      'If you have asthma or a heart or lung condition, take it easier outdoors when you notice coughing or shortness of breath.',
    ],
    sensitive: [
      'Children, older people, pregnant women and anyone with asthma, heart or lung disease: shorten long or hard effort outdoors.',
      'Everyone else can be outside; take breaks during exercise.',
      'Keep an inhaler or other relief medicine at hand.',
    ],
    unhealthy: [
      'Everyone: cut down on effort outdoors. Sensitive people should stay inside.',
      'Close the windows. Run an air purifier if you have one.',
      'Outside, wear an N95 or FFP2 mask. Cloth and surgical masks do not stop smoke particles.',
    ],
    'very-unhealthy': [
      'Stay indoors with windows and doors closed.',
      'Avoid all effort outdoors.',
      'If you must go out, wear a well-fitted N95 or FFP2 mask and keep it short.',
      'In a car, close the windows and set the ventilation to recirculate.',
    ],
    hazardous: [
      'Stay indoors. Keep one room closed and as clean as you can, with a purifier if you have one.',
      'Leave the area if you can do it safely, first of all with children, older people and anyone with breathing problems.',
      'Trouble breathing, chest pain or confusion: call the emergency number.',
    ],
  },
  pollutant: {
    pm2_5: 'Fine particles (PM2.5)',
    pm10: 'Coarse particles (PM10)',
    carbon_monoxide: 'Carbon monoxide (CO)',
    nitrogen_dioxide: 'Nitrogen dioxide (NO₂)',
    ozone: 'Ozone (O₃)',
    sulphur_dioxide: 'Sulphur dioxide (SO₂)',
  },
  co2Level: { normal: 'normal for open air', elevated: 'above the open-air background', high: 'far above the open-air background' },
  co2Note: (ppm, percent) =>
    `${ppm} ppm, which is ${percent.toFixed(3)}% of the air. Outdoor CO₂ is almost the same everywhere (about 0.04%) and does not harm health at this level. ` +
    'It affects breathing only above about 0.5% (5,000 ppm), which happens in closed rooms, not in open air. Near a fire the danger is smoke particles and carbon monoxide.',
  tips: {
    smokeTitle: 'When there is smoke',
    smoke: [
      'If you see or smell smoke, trust that over the number here: the model cannot see a single fire next to you.',
      'Close windows, doors and vents. Set air conditioning to recirculate.',
      'Do not add smoke indoors: no candles, no smoking, no frying, and do not vacuum.',
      'Keep inhalers and other medicines within reach, and drink water.',
      'Headache, dizziness, nausea or confusion near a fire can be carbon monoxide poisoning. Get to fresh air and call the emergency number.',
      'If you are told to evacuate, leave early. Do not wait for the smoke to get thick.',
    ],
    indoorTitle: 'CO₂ and CO at home',
    indoor: [
      'CO₂ builds up indoors, not outdoors. When the outside air is clean, open the windows for 5–10 minutes a few times a day.',
      'Above about 1,000 ppm (0.1%) a room feels stuffy and people get sleepy. A small CO₂ monitor (NDIR type) shows the level.',
      'Fit a carbon monoxide alarm near the bedrooms if you burn gas, wood, diesel or charcoal. CO has no smell and a CO₂ monitor does not detect it.',
      'Never run a generator, grill or car engine indoors or in a garage.',
      'Have heaters, boilers and chimneys checked once a year.',
    ],
  },
  model: 'From the Copernicus CAMS model through Open-Meteo, on a grid of about 10 km in Europe and 40 km elsewhere. A model, not a sensor.',

  aqi: 'US AQI',
  mainPollutant: 'Mostly from',
  atCentre: (place) => `At the centre of ${place}`,
  atYou: 'At your location',
  useMine: 'Use my location',
  locating: 'Finding you…',
  backToPlace: 'Back to the map area',
  loading: 'Reading the air…',
  denied: 'Your browser did not share a location. Allow it for this site and try again.',
  failed: 'The air quality service did not answer.',
  retry: 'Try again',
  co2: 'Carbon dioxide (CO₂)',
  co: 'Carbon monoxide',
  next: (peak, level, hour) => `Next 24 hours: worst at ${hour}, AQI ${peak} (${level}).`,
  whatToDo: 'What to do',
};

/** Keeps a figure left-to-right inside Arabic text. */
const ltr = (text: string | number): string => `⁦${text}⁩`;

const ar: AirText = {
  title: 'جودة الهواء',
  level: {
    good: 'جيدة',
    moderate: 'مقبولة',
    sensitive: 'غير صحية للفئات الحساسة',
    unhealthy: 'غير صحية',
    'very-unhealthy': 'غير صحية جدًا',
    hazardous: 'خطرة',
  },
  headline: {
    good: 'الهواء نظيف. الخروج آمن.',
    moderate: 'الهواء مقبول. آمن لمعظم الناس.',
    sensitive: 'آمن لمعظم الناس، لكن ليس للأطفال وكبار السن ومرضى الربو والقلب والرئة.',
    unhealthy: 'غير آمن: قد يشعر الجميع بأثره.',
    'very-unhealthy': 'غير آمن: ابقَ في الداخل.',
    hazardous: 'هواء خطر. ابقَ في الداخل أو غادر المنطقة.',
  },
  advice: {
    good: ['النشاط في الخارج مناسب للجميع.', 'وقت جيد لفتح النوافذ وتهوية البيت.'],
    moderate: [
      'مناسب لمعظم الناس.',
      'إذا كنت مصابًا بالربو أو بمرض في القلب أو الرئة، خفّف مجهودك في الخارج عند الشعور بسعال أو ضيق في التنفس.',
    ],
    sensitive: [
      'الأطفال وكبار السن والحوامل ومرضى الربو والقلب والرئة: قلّلوا المجهود الطويل أو الشاق في الخارج.',
      'يمكن للباقين البقاء في الخارج مع أخذ استراحات أثناء الرياضة.',
      'أبقِ البخاخ أو دواء الإسعاف في متناول اليد.',
    ],
    unhealthy: [
      'على الجميع تقليل المجهود في الخارج، وعلى الفئات الحساسة البقاء في الداخل.',
      'أغلق النوافذ، وشغّل منقّي الهواء إن وُجد.',
      `في الخارج ضع كمامة ${ltr('N95')} أو ${ltr('FFP2')}. الكمامات القماشية والجراحية لا تحجب جزيئات الدخان.`,
    ],
    'very-unhealthy': [
      'ابقَ في الداخل وأغلق النوافذ والأبواب.',
      'تجنّب أي مجهود في الخارج.',
      `إذا اضطررت للخروج، ضع كمامة ${ltr('N95')} أو ${ltr('FFP2')} محكمة ولا تُطل البقاء.`,
      'في السيارة أغلق النوافذ واجعل التهوية على وضع تدوير الهواء الداخلي.',
    ],
    hazardous: [
      'ابقَ في الداخل. خصّص غرفة واحدة مغلقة ونظيفة قدر الإمكان، مع منقّي هواء إن وُجد.',
      'غادر المنطقة إذا أمكن ذلك بأمان، وأولًا الأطفال وكبار السن ومن يعانون مشاكل في التنفس.',
      'عند صعوبة التنفس أو ألم في الصدر أو تشوّش الذهن: اتصل بالطوارئ.',
    ],
  },
  pollutant: {
    pm2_5: `الجسيمات الدقيقة (${ltr('PM2.5')})`,
    pm10: `الجسيمات الخشنة (${ltr('PM10')})`,
    carbon_monoxide: `أول أكسيد الكربون (${ltr('CO')})`,
    nitrogen_dioxide: `ثاني أكسيد النيتروجين (${ltr('NO₂')})`,
    ozone: `الأوزون (${ltr('O₃')})`,
    sulphur_dioxide: `ثاني أكسيد الكبريت (${ltr('SO₂')})`,
  },
  co2Level: { normal: 'طبيعي للهواء الطلق', elevated: 'أعلى من مستوى الهواء الطلق', high: 'أعلى بكثير من مستوى الهواء الطلق' },
  co2Note: (ppm, percent) =>
    `${ltr(`${ppm} ppm`)}، أي ${ltr(`${percent.toFixed(3)}%`)} من الهواء. نسبة ثاني أكسيد الكربون في الهواء الطلق متقاربة في كل مكان (نحو ${ltr('0.04%')}) ولا تضرّ بالصحة عند هذا المستوى. ` +
    `لا يتأثر التنفس إلا فوق نحو ${ltr('0.5%')} (${ltr('5,000 ppm')})، وهذا يحدث في الغرف المغلقة لا في الهواء الطلق. قرب الحريق يكمن الخطر في جزيئات الدخان وأول أكسيد الكربون.`,
  tips: {
    smokeTitle: 'عند وجود دخان',
    smoke: [
      'إذا رأيت الدخان أو شممته فاعتمد على ذلك لا على الرقم هنا: النموذج لا يرى حريقًا واحدًا بقربك.',
      'أغلق النوافذ والأبواب وفتحات التهوية، واجعل المكيّف على وضع تدوير الهواء الداخلي.',
      'لا تُضف دخانًا في الداخل: لا شموع ولا تدخين ولا قلي، ولا تستخدم المكنسة الكهربائية.',
      'أبقِ البخاخات والأدوية في متناول اليد، واشرب الماء.',
      'الصداع أو الدوار أو الغثيان أو تشوّش الذهن قرب الحريق قد يكون تسممًا بأول أكسيد الكربون. اخرج إلى هواء نقي واتصل بالطوارئ.',
      'إذا طُلب منك الإخلاء فغادر مبكرًا، ولا تنتظر حتى يشتدّ الدخان.',
    ],
    indoorTitle: `${ltr('CO₂')} و${ltr('CO')} في البيت`,
    indoor: [
      'ثاني أكسيد الكربون يتراكم في الداخل لا في الخارج. عندما يكون الهواء الخارجي نظيفًا، افتح النوافذ 5 إلى 10 دقائق عدة مرات في اليوم.',
      `فوق نحو ${ltr('1,000 ppm')} (${ltr('0.1%')}) يصبح هواء الغرفة خانقًا ويشعر الناس بالنعاس. جهاز صغير لقياس ${ltr('CO₂')} (من نوع ${ltr('NDIR')}) يبيّن المستوى.`,
      `ركّب جهاز إنذار لأول أكسيد الكربون قرب غرف النوم إذا كنت تستخدم الغاز أو الحطب أو المازوت أو الفحم. هذا الغاز بلا رائحة، وجهاز قياس ${ltr('CO₂')} لا يكشفه.`,
      'لا تشغّل مولّدًا أو شواية أو محرك سيارة داخل البيت أو في المرأب.',
      'افحص المدافئ والسخّانات والمداخن مرة في السنة.',
    ],
  },
  model: `من نموذج ${ltr('CAMS')} التابع لكوبرنيكوس عبر ${ltr('Open-Meteo')}، بشبكة دقتها نحو 10 كم في أوروبا و40 كم في غيرها. هذا نموذج وليس جهاز قياس.`,

  aqi: `مؤشر ${ltr('AQI')} الأميركي`,
  mainPollutant: 'المصدر الأبرز',
  atCentre: (place) => `في وسط ${place}`,
  atYou: 'في موقعك',
  useMine: 'استخدم موقعي',
  locating: 'جارٍ تحديد موقعك…',
  backToPlace: 'العودة إلى منطقة الخريطة',
  loading: 'جارٍ قراءة حالة الهواء…',
  denied: 'لم يشارك المتصفح موقعك. اسمح بذلك لهذا الموقع ثم حاول مجددًا.',
  failed: 'خدمة جودة الهواء لم تستجب.',
  retry: 'حاول مجددًا',
  co2: `ثاني أكسيد الكربون (${ltr('CO₂')})`,
  co: 'أول أكسيد الكربون',
  next: (peak, level, hour) => `خلال 24 ساعة: الأسوأ عند ${ltr(hour)}، المؤشر ${ltr(peak)} (${level}).`,
  whatToDo: 'ما العمل',
};

export const AIR_TEXT: Record<'en' | 'ar', AirText> = { en, ar };
