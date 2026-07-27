/**
 * Shared seeded PRNG for reproducible scenario/fuzz randomness (mulberry32 —
 * same algorithm as EdgeSelector's inline stream, so the whole engine shares one
 * deterministic family). One run seeds it once, and every fuzz
 * strategy / saboteur draws from the same stream so "same seed + target → same
 * payload sequence".
 *
 * State is held in an AsyncLocalStorage cell rather than a module global, so
 * concurrent in-process runs each get a private stream and cannot interleave
 * draws. The ~55 draw sites are leaf value-pickers where threading an instance
 * would add noise for no testability gain, so the call signature is unchanged.
 *
 * seedScenarioRandom(n) → deterministic; seedScenarioRandom(undefined) → restores
 * Math.random (the historical, non-reproducible default).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

interface RngCell {
  state: number | undefined;
}

const runScope = new AsyncLocalStorage<RngCell>();

// Fallback for callers outside any run scope (tests, ad-hoc scripts).
const globalCell: RngCell = { state: undefined };

function cell(): RngCell {
  return runScope.getStore() ?? globalCell;
}

/** Run `fn` with a private RNG stream isolated from any concurrent run. */
export function withScenarioRandomScope<T>(fn: () => T): T {
  return runScope.run({ state: undefined }, fn);
}

/** Seed (or, with undefined, unseed) the current scope's scenario RNG. */
export function seedScenarioRandom(seed?: number): void {
  // Coerce to uint32 so the mulberry32 state matches the seed exactly across runs.
  cell().state = seed === undefined ? undefined : seed >>> 0;
}

/** Next value in [0,1). Deterministic when seeded, Math.random otherwise. */
export function scenarioRandom(): number {
  const current = cell();
  if (current.state === undefined) return Math.random();
  let t = (current.state += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform pick from a non-empty array using the scoped RNG. */
export function scenarioPick<T>(items: readonly T[]): T {
  return items[Math.floor(scenarioRandom() * items.length)]!;
}

/** True whether the scoped RNG is currently in reproducible (seeded) mode. */
export function isScenarioRandomSeeded(): boolean {
  return cell().state !== undefined;
}
