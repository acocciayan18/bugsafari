// Run-scoped fuzz salt. Folded into per-field seeds so different runs/retests
// sweep different vectors of the same corpus, while a run stays deterministic
// (salt fixed for its lifetime) and every finding replays from its stored literal.
// Reset per run alongside the other module-scoped fuzz state.

let runSalt = 0;

// Set once at run start (engine supplies a Date.now-derived salt).
export function setFuzzRunSeed(salt: number): void {
  runSalt = salt >>> 0;
}

// Clear to base so a reused engine instance can't leak a stale salt.
export function resetFuzzRunSeed(): void {
  runSalt = 0;
}

// Current run salt (0 when unset — back-compat with the pre-salt seed).
export function currentFuzzRunSeed(): number {
  return runSalt;
}

// Fold the run salt into a stable per-field seed.
export function saltFieldSeed(seed: number): number {
  return ((seed >>> 0) ^ runSalt) >>> 0;
}
