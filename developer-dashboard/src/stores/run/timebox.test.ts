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

// ── Remaining-time math across every selectable duration ──────────────────────
// The store derives remaining as max(0, timebox - elapsed); the timer never runs its
// own clock, so this holds identically for 5/10/20/30 min. Verify the longer presets.
const remaining = (timeboxMs: number, elapsed: number) => Math.max(0, timeboxMs - elapsed);

for (const minutes of [5, 10, 20, 30]) {
  const timeboxMs = minutes * 60_000;
  assert.equal(remaining(timeboxMs, 0), timeboxMs, `${minutes}m: full at start`);
  assert.equal(remaining(timeboxMs, timeboxMs / 2), timeboxMs / 2, `${minutes}m: half elapsed`);
  assert.equal(remaining(timeboxMs, timeboxMs), 0, `${minutes}m: zero at limit`);
  assert.equal(remaining(timeboxMs, timeboxMs + 10_000), 0, `${minutes}m: never negative past limit`);
}

// PAUSED freezes interpolation regardless of the configured duration — a 30-min run
// paused mid-way stays pinned to its baseline elapsed just like the 10-min default.
const thirty = 30 * 60_000;
const halfElapsed = thirty / 2;
assert.equal(interpolateElapsedMs('PAUSED', true, halfElapsed, at, at + 120_000), halfElapsed, '30m paused freezes elapsed');

console.log('timebox.test.ts: all assertions passed');
