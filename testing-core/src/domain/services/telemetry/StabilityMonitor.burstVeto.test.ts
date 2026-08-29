// The duplicate-detector feed is skipped while a synthetic burst is active, so a force:true
// double-click that bypasses the app's disable-on-submit can't manufacture a SPA_STATE_RACE.
// This pins the veto predicate (isOffTargetScenarioActive() || isRaceScenarioActive()).
// Run: `npx tsx src/domain/services/telemetry/StabilityMonitor.burstVeto.test.ts`.

import assert from 'node:assert/strict';
import { isRaceScenarioActive } from './StabilityMonitor.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// The exact veto used in the request feed.
const burstVeto = () => ActiveScenarioTracker.isOffTargetScenarioActive() || isRaceScenarioActive();

console.log('duplicate-detector burst veto');

check('no scenario active → duplicates are observed (no veto)', () => {
  ActiveScenarioTracker.reset();
  assert.equal(burstVeto(), false);
});

check('a ConcurrentClicker burst vetoes duplicate detection', () => {
  ActiveScenarioTracker.reset();
  ActiveScenarioTracker.begin('ConcurrentClicker', 'http://app.test/cart');
  assert.equal(ActiveScenarioTracker.isOffTargetScenarioActive(), true);
  assert.equal(isRaceScenarioActive(), true); // ConcurrentClicker now listed
  assert.equal(burstVeto(), true);
  ActiveScenarioTracker.reset();
});

check('an AsyncStateRacer burst vetoes duplicate detection', () => {
  ActiveScenarioTracker.reset();
  ActiveScenarioTracker.begin('AsyncStateRacer', 'http://app.test/cart');
  assert.equal(isRaceScenarioActive(), true);
  assert.equal(burstVeto(), true);
  ActiveScenarioTracker.reset();
});

check('a non-burst scenario does NOT veto (organic duplicates still report)', () => {
  ActiveScenarioTracker.reset();
  ActiveScenarioTracker.begin('FormBypasser', 'http://app.test/cart');
  assert.equal(burstVeto(), false);
  ActiveScenarioTracker.reset();
});

console.log(`\n${passed} passed`);
