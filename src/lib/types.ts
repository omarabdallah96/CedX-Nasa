export interface CountrySummary {
  slug: string;
  name: string;
  detections: { modis: number; viirs: number };
  ratio: number;
  ratioByMonth: number[];
  validation: {
    mdape: number; mdapeRaw: number; yearlyMdape: number; yearlyMdapeRaw: number;
    bias: number; biasRaw: number; nMonths: number; nYears: number;
  };
  /** Typical VIIRS-era year ÷ typical MODIS-era year, before and after harmonization. */
  seamStepRaw: number;
  seamStepHarmonized: number;
  years: { year: number; complete: boolean; harmonized: number; raw: number }[];
  peak: { start: number; length: number; share: number } | null;
}

export type SeamMode = 'harmonized' | 'raw';
