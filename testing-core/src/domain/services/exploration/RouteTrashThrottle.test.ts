// Standalone deterministic tests for the session-scoped RouteTrashThrottle
// (max-executions budget + cooldown, disabled for route-focused profiles). No
// unit-test runner is configured in this package, so this is a self-executing
// script: run with
// `npx tsx src/domain/services/exploration/RouteTrashThrottle.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { RouteTrashThrottle } from './RouteTrashThrottle.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('RouteTrashThrottle — session budget + cooldown');

check('session budget blocks after N runs; record() flags exactly the exhausting run', () => {
  const t = new RouteTrashThrottle({ sessionBudget: 3, cooldownMs: 0, enabled: true });
  assert.equal(t.canRun(), true);
  assert.equal(t.record(), false); // 1/3
  assert.equal(t.record(), false); // 2/3
  assert.equal(t.canRun(), true);
  assert.equal(t.record(), true); // 3/3 — exhausts, announce once
  assert.equal(t.canRun(), false); // budget spent
  assert.equal(t.record(), false); // over-budget record never re-flags
});

check('cooldown blocks within the window and clears after it', () => {
  let clock = 1000;
  const t = new RouteTrashThrottle({ sessionBudget: 0, cooldownMs: 500, enabled: true, now: () => clock });
  assert.equal(t.canRun(), true); // never run — no cooldown yet
  t.record();
  clock += 200;
  assert.equal(t.canRun(), false); // 200ms < 500ms cooldown
  clock += 400; // now 600ms since last run
  assert.equal(t.canRun(), true);
});

check('sessionBudget 0 = unlimited (only cooldown may gate)', () => {
  const t = new RouteTrashThrottle({ sessionBudget: 0, cooldownMs: 0, enabled: true });
  for (let i = 0; i < 50; i++) assert.equal(t.record(), false);
  assert.equal(t.canRun(), true);
});

check('disabled (route-focused profile) bypasses both limits', () => {
  let clock = 0;
  const t = new RouteTrashThrottle({ sessionBudget: 1, cooldownMs: 10000, enabled: false, now: () => clock });
  assert.equal(t.record(), false); // never flags exhaustion when disabled
  assert.equal(t.canRun(), true); // past budget + inside cooldown, still allowed
  clock += 1;
  assert.equal(t.canRun(), true);
});

check('reset() clears counters and cooldown for a reused engine', () => {
  let clock = 0;
  const t = new RouteTrashThrottle({ sessionBudget: 1, cooldownMs: 1000, enabled: true, now: () => clock });
  t.record();
  assert.equal(t.canRun(), false);
  t.reset();
  assert.equal(t.canRun(), true);
});

console.log(`\nRouteTrashThrottle: ${passed} checks passed.`);
