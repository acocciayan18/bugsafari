// Standalone deterministic tests for EscalationTracker's escalate/reset state
// machine. No unit-test runner is configured in this package, so this is a
// self-executing script: run with
// `npx tsx src/domain/services/exploration/EscalationTracker.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { EscalationTracker } from './EscalationTracker.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('EscalationTracker — adaptive payload-escalation state machine');

check('a field never encountered starts at level 0', () => {
  const tracker = new EscalationTracker();
  assert.equal(tracker.getLevel('#email', 'EMAIL'), 0);
});

check('escalate() advances one level and getLevel() reflects it', () => {
  const tracker = new EscalationTracker();
  const next = tracker.escalate('#email', 'EMAIL');
  assert.equal(next, 1);
  assert.equal(tracker.getLevel('#email', 'EMAIL'), 1);
});

check('repeated survival escalates through L1..L4 then caps at L4', () => {
  const tracker = new EscalationTracker();
  const seen: number[] = [];
  for (let i = 0; i < 6; i++) {
    seen.push(tracker.escalate('#search', 'TEXT_SEARCH'));
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 4, 4]);
});

check('reset() drops a field back to level 0 (fault or vanished field)', () => {
  const tracker = new EscalationTracker();
  tracker.escalate('#qty', 'NUMERIC');
  tracker.escalate('#qty', 'NUMERIC');
  assert.equal(tracker.getLevel('#qty', 'NUMERIC'), 2);
  tracker.reset('#qty', 'NUMERIC');
  assert.equal(tracker.getLevel('#qty', 'NUMERIC'), 0);
});

check('reset() on an untouched field is a no-op (stays at 0)', () => {
  const tracker = new EscalationTracker();
  tracker.reset('#never-seen', 'EMAIL');
  assert.equal(tracker.getLevel('#never-seen', 'EMAIL'), 0);
});

check('the same selector under different categories tracks independently', () => {
  const tracker = new EscalationTracker();
  tracker.escalate('#combo', 'NUMERIC');
  assert.equal(tracker.getLevel('#combo', 'NUMERIC'), 1);
  assert.equal(tracker.getLevel('#combo', 'EMAIL'), 0);
});

check('resetAll() clears every tracked field (run-scoped reset)', () => {
  const tracker = new EscalationTracker();
  tracker.escalate('#a', 'NUMERIC');
  tracker.escalate('#b', 'EMAIL');
  tracker.resetAll();
  assert.equal(tracker.getLevel('#a', 'NUMERIC'), 0);
  assert.equal(tracker.getLevel('#b', 'EMAIL'), 0);
});

check('the tracked-field map is bounded (does not grow without limit)', () => {
  const tracker = new EscalationTracker();
  for (let i = 0; i < 600; i++) {
    tracker.escalate(`#field-${i}`, 'NUMERIC');
  }
  // The oldest entries should have been evicted; the most recent must survive.
  assert.equal(tracker.getLevel('#field-599', 'NUMERIC'), 1);
  assert.equal(tracker.getLevel('#field-0', 'NUMERIC'), 0);
});

console.log(`\n${passed} EscalationTracker checks passed.`);
