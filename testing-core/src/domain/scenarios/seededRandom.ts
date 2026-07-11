/**
 * Shared seeded PRNG for reproducible scenario/fuzz randomness (mulberry32 —
 * same algorithm as SeededRandomGenerator / EdgeSelector, so the whole engine
 * shares one deterministic family). Module-global by design: one active run seeds
 * it once, and every fuzz strategy / saboteur draws from the same stream so
 * "same seed + target → same payload sequence".
 *
 * seedScenarioRandom(n) → deterministic; seedScenarioRandom(undefined) → restores
 * Math.random (the historical, non-reproducible default). Kept module-global
 * rather than injected because the ~55 draw sites are leaf value-pickers where
 * threading an instance would add noise for no testability gain.
 *
 * ponytail: single global stream. If concurrent in-process runs are ever wired
 * (worker concurrency > 1), promote to a per-run injected instance.
 */
let state: number | undefined;

/** Seed (or, with undefined, unseed) the shared scenario RNG for the next run. */
export function seedScenarioRandom(seed?: number): void {
  // Coerce to uint32 so the mulberry32 state matches the seed exactly across runs.
  state = seed === undefined ? undefined : seed >>> 0;
}

/** Next value in [0,1). Deterministic when seeded, Math.random otherwise. */
export function scenarioRandom(): number {
  if (state === undefined) return Math.random();
  let t = (state += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform pick from a non-empty array using the shared RNG. */
export function scenarioPick<T>(items: readonly T[]): T {
  return items[Math.floor(scenarioRandom() * items.length)]!;
}

/** True whether the shared RNG is currently in reproducible (seeded) mode. */
export function isScenarioRandomSeeded(): boolean {
  return state !== undefined;
}
