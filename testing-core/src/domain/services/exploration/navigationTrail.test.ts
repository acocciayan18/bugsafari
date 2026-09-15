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

const P11 = 'https://app.io/products/p11';
const P9 = 'https://app.io/products/p9';

check('urlAt returns the page active at the query time, not a later navigation', () => {
  const trail = new NavigationTrail();
  trail.record({ url: P11, atMs: 1000, engineInitiated: true });
  trail.record({ url: P9, atMs: 1200, engineInitiated: true });
  // A request that STARTED at 1100 was issued from p11, even though the page later moved to p9.
  assert.equal(trail.urlAt(1100), P11);
  assert.equal(trail.urlAt(1200), P9);
});

check('urlAt considers app-initiated navigations too (any nav changed the page)', () => {
  const trail = new NavigationTrail();
  trail.record({ url: P11, atMs: 1000, engineInitiated: false });
  assert.equal(trail.urlAt(1500), P11);
});

check('urlAt returns empty when no mark is at or before the query time', () => {
  const trail = new NavigationTrail();
  assert.equal(trail.urlAt(1000), '');
  trail.record({ url: HOME, atMs: 2000, engineInitiated: true });
  assert.equal(trail.urlAt(1000), '');
});

check('urlAt does not return a mark older than the retention window', () => {
  const trail = new NavigationTrail();
  trail.record({ url: HOME, atMs: 1000, engineInitiated: true });
  assert.equal(trail.urlAt(20000), '');
});

console.log(`\n${passed} navigation-trail checks passed.`);
