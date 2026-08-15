// Deterministic, bounded value sampling for constrained value-controls (range/color).
// No RNG: the same (kind, constraints, index) always yields the same value so
// reproduction playbooks stay replayable. Callers advance a per-selector cursor so
// repeat encounters of one control walk the ordered sample set (valid + boundaries).

export type ValueControlKind = 'range' | 'color';

export interface ValueControlConstraints {
  min?: string;
  max?: string;
  step?: string;
}

// Fixed ordered palette for color inputs (no min/max to sample). Lowercased #rrggbb.
const COLOR_SAMPLES = ['#000000', '#ffffff', '#ff0000'];

// Parse a numeric attribute, falling back when absent/invalid.
function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Ordered range samples: valid midpoint first, then the two boundaries, then a
// near-min step. Browser clamps guarantee these stay in-range (low false-positive).
function rangeSamples(c: ValueControlConstraints): number[] {
  const min = num(c.min, 0);
  const max = num(c.max, 100);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const step = Math.abs(num(c.step, 1)) || 1;
  const mid = lo + (hi - lo) / 2;
  return [mid, lo, hi, Math.min(hi, lo + step)];
}

// Resolve the value this encounter uses. `index` cycles through the ordered set.
export function sampleValueControl(kind: ValueControlKind, c: ValueControlConstraints, index: number): string {
  const list = kind === 'color' ? COLOR_SAMPLES : rangeSamples(c).map((n) => String(n));
  const wrapped = ((index % list.length) + list.length) % list.length;
  return list[wrapped];
}
