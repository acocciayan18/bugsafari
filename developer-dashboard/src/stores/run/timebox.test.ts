// Self-check for the authoritative-clock interpolation that replaced the client's
// independent countdown. No framework — run via `npm test`. Exits non-zero on the
// first failed node:assert.

import assert from 'node:assert/strict';
import { interpolateElapsedMs } from './types.js';

const base = 30_000; // last engine-reported elapsed
const at = 100_000;  // wall-clock when that sync landed

// ACTIVE + seeded → interpolate forward from the baseline.
assert.equal(interpolateElapsedMs('ACTIVE', true, base, at, at + 2_500), 32_500, 'interpolates while active');

// Not seeded yet (boot/queue) → frozen at baseline, never counts boot time.
assert.equal(interpolateElapsedMs('ACTIVE', false, 0, at, at + 5_000), 0, 'unseeded stays frozen at 0');

// Paused → frozen at baseline regardless of elapsed wall-clock.
assert.equal(interpolateElapsedMs('PAUSED', true, base, at, at + 60_000), base, 'paused freezes elapsed');
assert.equal(interpolateElapsedMs('STARTING', true, base, at, at + 60_000), base, 'starting freezes elapsed');

// A stale anchor (now before the sync) never yields negative interpolation.
assert.equal(interpolateElapsedMs('ACTIVE', true, base, at, at - 5_000), base, 'no negative interpolation');

console.log('timebox.test.ts: all assertions passed');
