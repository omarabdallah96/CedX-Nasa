const INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const ONE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** Counts: whole numbers, with one decimal below 10 when the value is fractional (scaled values). */
export function fmtCount(v: number): string {
  if (!Number.isFinite(v)) return '–';
  if (v !== 0 && Math.abs(v) < 10 && !Number.isInteger(v)) return ONE.format(v);
  return INT.format(v);
}

/** Compact counts for tight cells: 1.2k, 14k. */
export function fmtCompact(v: number): string {
  if (!Number.isFinite(v)) return '';
  if (v >= 9950) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (v >= 10 || Number.isInteger(v)) return String(Math.round(v));
  return v.toFixed(1);
}

export function fmtRatio(r: number): string {
  if (r >= 10) return `${Math.round(r)}×`;
  return `${r.toFixed(1)}×`;
}

export function fmtPct(x: number, signed = false): string {
  if (!Number.isFinite(x)) return '–';
  const v = Math.round(x * 100);
  return `${signed && v > 0 ? '+' : ''}${v}%`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
