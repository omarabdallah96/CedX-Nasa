import { describe, expect, it } from 'vitest';
import { parseBox, parseCoord, type BoxFailure } from '../lib/coords.ts';
import { ANSWER, verdictSentence } from '../lib/sentence.ts';
import type { Verdict } from '../lib/stats.ts';
import { dayIndex } from '../lib/time.ts';
import { ar } from './ar.tsx';
import { en } from './en.tsx';

/** Drops the invisible left-to-right isolates wrapped around figures. */
const plain = (s: string) => s.replace(/[⁦⁩]/g, '');

const verdict = (over: Partial<Verdict> = {}): Verdict => ({
  value: 112, median: 57, ratio: 112 / 57, rank: 3, nYears: 26, percentile: 0.9,
  level: 'far-above', firstYear: 2001, lastYear: 2026, ...over,
});

describe('English wording', () => {
  it('is the wording the API uses', () => {
    const v = verdict();
    expect(en.answer).toBe(ANSWER);
    expect(en.verdictSentence(v, 'July 2026', 'July', 'Lebanon')).toBe(verdictSentence(v, 'July 2026', 'July', 'Lebanon'));
  });
});

describe('Arabic wording', () => {
  it('fills every verdict level', () => {
    expect(Object.keys(ar.answer).sort()).toEqual(Object.keys(en.answer).sort());
  });

  it('picks the noun form that goes with the number', () => {
    expect(ar.intro.detections(1)).toBe('حالة رصد واحدة');
    expect(ar.intro.detections(2)).toBe('حالتا رصد');
    expect(ar.intro.detections(7)).toBe('7 حالات رصد');
    expect(ar.intro.detections(10559)).toBe('10,559 حالة رصد');
    expect(ar.intro.detections(181408)).toBe('181,408 حالات رصد');
    expect(ar.verdict.firstDays(1)).toBe('اليوم الأول');
    expect(ar.verdict.firstDays(5)).toBe('أول 5 أيام');
    expect(ar.verdict.firstDays(13)).toBe('أول 13 يومًا');
  });

  it('words a comparison by its size', () => {
    const badge = (ratio: number | null, value = 10) => plain(ar.verdict.badge(verdict({ ratio, value }), 'شهر آب'));
    expect(badge(3.24)).toBe('3.2 أضعاف المعتاد في شهر آب');
    expect(badge(14.2)).toBe('14 ضعف المعتاد في شهر آب');
    expect(badge(1.3)).toBe('أعلى بنسبة 30% من المعتاد في شهر آب');
    expect(badge(0.62)).toBe('62% من المعتاد في شهر آب');
    expect(badge(1)).toBe('بمستوى المعتاد في شهر آب');
    expect(badge(null)).toBe('لا حرائق في شهر آب في العادة');
    expect(badge(null, 0)).toBe('لم تُرصد حرائق');
  });

  it('writes the verdict sentence', () => {
    const s = plain(ar.verdictSentence(verdict(), 'تموز 2026', 'شهر تموز', 'لبنان'));
    expect(s).toBe(
      'في تموز 2026، سُجّلت في لبنان 112 خلية-يوم من الحرائق النشطة: أعلى بنسبة 96% من المعتاد في شهر تموز، والمرتبة 3 من 26 من حيث النشاط في شهر تموز (2001–2026).',
    );
    expect(ar.verdictSentence(verdict({ rank: 1 }), 'آب 2017', 'شهر آب', 'البرتغال')).toContain('أعلى نشاط يُسجَّل في شهر آب خلال 26 سنة');
    expect(ar.verdictSentence(verdict({ level: 'quiet', value: 0, ratio: null }), 'شباط 2020', 'شهر شباط', 'قبرص')).toContain('لا يُسجَّل شيء');
  });

  it('names months and dates the Levantine way', () => {
    expect(ar.monthsLong).toHaveLength(12);
    expect(ar.months).toHaveLength(12);
    expect(ar.longDate(dayIndex(2026, 11, 13))).toBe('13 تشرين الثاني 2026');
    expect(ar.spanName(dayIndex(2026, 11, 7), dayIndex(2026, 11, 13))).toBe('7–13 تشرين الثاني');
    expect(ar.monthWording({ verdict: verdict(), partialDays: 13 }, 2026, 10)).toEqual({
      what: 'تشرين الثاني 2026 حتى الآن (1–13 تشرين الثاني)',
      usual: 'الفترة 1–13 تشرين الثاني',
    });
  });

  it('names the places it knows and keeps the rest', () => {
    expect(ar.country('lebanon', 'Lebanon')).toBe('لبنان');
    expect(ar.country('atlantis', 'Atlantis')).toBe('Atlantis');
    expect(ar.place('لبنان', true)).toBe('المنطقة المحددة من لبنان');
  });

  it('words every reason a typed box is refused', () => {
    const country = { name: 'Lebanon', bbox: [35.109, 33.057, 36.555, 34.684] as [number, number, number, number] };
    const refuse = (text: string[]) => parseBox(text, country) as BoxFailure;
    const cases: [string[], BoxFailure['code']][] = [
      [['x', '33.2', '36', '34'], 'not-a-number'],
      [['200', '33.2', '36', '34'], 'longitude'],
      [['35.2', '95', '36', '34'], 'latitude'],
      [['36', '33.2', '35.2', '34'], 'west-east'],
      [['35.2', '34', '36', '33.2'], 'south-north'],
      [['10', '40', '11', '41'], 'outside'],
    ];
    const seen = new Set<string>();
    for (const [text, code] of cases) {
      const failure = refuse(text);
      expect(failure.code).toBe(code);
      const message = ar.area.boxError(failure, 'لبنان', country.bbox);
      expect(message).toMatch(/[؀-ۿ]/);
      seen.add(message);
      expect(en.area.boxError(failure, 'Lebanon', country.bbox)).toBe(failure.message);
    }
    expect(seen.size).toBe(cases.length);
  });
});

describe('typed coordinates', () => {
  it('reads Arabic-Indic digits', () => {
    expect(parseCoord('٣٥٫٢')).toBe(35.2);
    expect(parseCoord('-٨٫٦')).toBe(-8.6);
  });
});
