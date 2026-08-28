// Guards the engine-liveness predicate. This is the rule that decides whether a run
// the backend still calls RUNNING is actually being executed by anything — the gap that
// let a wedged worker read as healthy for its entire timebox.
// Env is set before the dynamic import because the threshold is a module-level const.
// Self-executing: `npx tsx src/application/services/runHealth.test.ts`.

import assert from 'node:assert/strict';

process.env.BUGSAFARI_ENGINE_STALE_MS = '1000';
const { ENGINE_STALE_MS, engineHealthPhase, isEngineStale, shouldAnnounceHealth } = await import('./runHealth.js');

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('runHealth — engine liveness');

check('the threshold is read from the environment', () => {
  assert.strictEqual(ENGINE_STALE_MS, 1000);
});

// A run that just started has stamped nothing yet. Treating absence as evidence would
// flag EVERY launch as stalled, which is worse than the bug being fixed.
check('no heartbeat yet is never stalled', () => {
  assert.strictEqual(isEngineStale(null), false);
  assert.strictEqual(engineHealthPhase(null), 'live');
});

check('a fresh heartbeat is live', () => {
  assert.strictEqual(isEngineStale(0), false);
  assert.strictEqual(isEngineStale(999), false);
  assert.strictEqual(engineHealthPhase(500), 'live');
});

// Strictly greater: a stamp exactly at the threshold is still within budget, so a
// worker ticking right at the boundary does not flap.
check('the boundary is exclusive', () => {
  assert.strictEqual(isEngineStale(1000), false, 'exactly at the threshold is still live');
  assert.strictEqual(isEngineStale(1001), true);
});

check('an aged heartbeat is stalled', () => {
  assert.strictEqual(isEngineStale(60_000), true);
  assert.strictEqual(engineHealthPhase(60_000), 'stalled');
});

check('an explicit threshold overrides the env default', () => {
  assert.strictEqual(isEngineStale(5_000, 10_000), false);
  assert.strictEqual(isEngineStale(5_000, 1_000), true);
});

// Only edges are announced: re-emitting 'stalled' every sweep would spam the run room
// for the rest of the timebox, and the recovery edge is what clears the banner.
check('only transitions are announced', () => {
  assert.strictEqual(shouldAnnounceHealth(undefined, 'live'), true, 'first observation is a transition');
  assert.strictEqual(shouldAnnounceHealth('live', 'live'), false);
  assert.strictEqual(shouldAnnounceHealth('live', 'stalled'), true);
  assert.strictEqual(shouldAnnounceHealth('stalled', 'stalled'), false);
  assert.strictEqual(shouldAnnounceHealth('stalled', 'live'), true, 'recovery must clear the banner');
});

console.log(`runHealth.test.ts: ${passed} checks passed`);
