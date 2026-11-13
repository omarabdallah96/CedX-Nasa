// Sequential "ember" ramp: one warm hue family, lightness strictly increasing
// (OKLab L 0.23 → 0.96), so it reads in greyscale and under colour-vision
// deficiency. Step 0 is the chart surface: zero activity recedes.
export const EMBER = [
  '#1f1b17', '#3a1d14', '#5c2412', '#832e0f', '#ab3f0d', '#cf5a12', '#ea7f24', '#f7a846', '#fccd78', '#fff0c2',
];

const STOPS = EMBER.map((hex) => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
]);

/** t in 0-1 → CSS colour on the ember ramp. */
export function ember(t: number): string {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

/**
 * Value → ramp position. Square-root scaling keeps small fires visible next to
 * extreme days; any non-zero value gets at least the first visible step.
 */
export function rampPosition(value: number, max: number): number {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.min(1, 0.12 + 0.88 * Math.sqrt(value / max));
}

/** Text colour that stays readable on a ramp cell. */
export function inkOn(t: number): string {
  return t > 0.6 ? '#1a1410' : '#f3ede4';
}

/** Categorical series colours (validated for the dark surface). */
export const SERIES = { modis: '#3987e5', viirs: '#d95926', harmonized: '#199e70' } as const;
