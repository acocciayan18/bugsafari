import type { StateHash } from '../DIrectedPathFinder.js';

/** Return a short 8-character prefix of a SHA-256 hash for readable logs */
export function shortHash(hash: StateHash): string {
  return hash.substring(0, 8);
}

/** Max of a numeric array without argument spreading (spread RangeErrors on huge arrays). */
export function maxOf(values: number[], fallback: number): number {
  let max = fallback;
  for (let i = 0; i < values.length; i++) if (values[i]! > max) max = values[i]!;
  return max;
}

/** Infer the dominant action type for an element from its tag name. */
export function inferActionType(tag: string): 'click' | 'type' | 'select' {
  const t = tag.toUpperCase();
  if (t === 'INPUT' || t === 'TEXTAREA') return 'type';
  if (t === 'SELECT') return 'select';
  return 'click';
}

/**
 * Proxy for CSS selector complexity used as the final tie-breaker.
 * Counts ID segments (weight 3), class/attribute segments (weight 2),
 * plus a length bonus — lower = simpler = preferred.
 */
export function computeSelectorComplexity(selector: string): number {
  const ids = (selector.match(/#/g) ?? []).length;
  const classes = (selector.match(/[.[]/g) ?? []).length;
  return ids * 3 + classes * 2 + Math.floor(selector.length / 10);
}
