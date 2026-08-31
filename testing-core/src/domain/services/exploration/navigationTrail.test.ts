// Self-executing checks for self-caused navigation cancellation. Run with
// `npx tsx "src/domain/services/exploration/navigationTrail.test.ts"`.

import assert from 'node:assert/strict';
import { NavigationTrail, NAV_STRADDLE_SLACK_MS } from './navigationTrail.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('\nNavigation trail — self-caused request cancellation\n');

const HOME = 'https://app.io/';

check('an engine nav during the request flight supersedes it', () => {
  const trail = new NavigationTrail();
  trail.record({ url: HOME, atMs: 1500, engineInitiated: true });
  assert.equal(trail.supersededInFlight(1000, 2000), true);
});

check('an engine nav just after the failure (within slack) still supersedes', () => {
  const trail = new NavigationTrail();
  trail.record({ url: HOME, atMs: 2000 + NAV_STRADDLE_SLACK_MS, engineInitiated: true });
  assert.equal(trail.supersededInFlight(1000, 2000), true);
});

check('a nav before the request started does not supersede it', () => {
  const trail = new NavigationTrail();
  trail.record({ url: HOME, atMs: 500, engineInitiated: true });
  assert.equal(trail.supersededInFlight(1000, 2000), false);
});

check('a nav well after the failure does not supersede it', () => {
  const trail = new NavigationTrail();
  trail.record({ url: HOME, atMs: 2000 + NAV_STRADDLE_SLACK_MS + 1, engineInitiated: true });
  assert.equal(trail.supersededInFlight(1000, 2000), false);
});

check('an app-initiated nav (not engine) never supersedes — genuine failures stay visible', () => {
  const trail = new NavigationTrail();
  trail.record({ url: HOME, atMs: 1500, engineInitiated: false });
  assert.equal(trail.supersededInFlight(1000, 2000), false);
});

check('an unknown request start time is never treated as superseded', () => {
  const trail = new NavigationTrail();
  trail.record({ url: HOME, atMs: 1500, engineInitiated: true });
  assert.equal(trail.supersededInFlight(undefined, 2000), false);
});

check('stale marks expire and do not match a much later request', () => {
  const trail = new NavigationTrail();
  trail.record({ url: HOME, atMs: 1000, engineInitiated: true });
  // A request 20s later touches the trail; the old mark has expired.
  assert.equal(trail.supersededInFlight(20000, 21000), false);
});

console.log(`\n${passed} navigation-trail checks passed.`);
