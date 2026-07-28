// Deterministic tests for shell-scoped control identity (audit P3-07: the CSS
// selector was the GLOBAL coverage key, so the first control to claim a selector
// consumed the identity for every namesake on every other screen).
// Run via `npm test`.

import assert from 'node:assert/strict';
import { StateClusterRegistry } from './StateClusterRegistry.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('StateClusterRegistry — shell-scoped control identity (P3-07 fix)');

check('the same selector on a different shell is NOT already triggered', () => {
  // #email on the login form and #email on profile-edit are different inputs.
  const registry = new StateClusterRegistry();
  registry.observe('login-shell', '/login', ['#email'], 1);
  registry.observe('profile-shell', '/profile', ['#email'], 2);
  registry.markTriggered('login-shell', '#email', 1);

  assert.equal(registry.isSelectorTriggered('login-shell', '#email'), true);
  assert.equal(
    registry.isSelectorTriggered('profile-shell', '#email'),
    false,
    'the profile field was never touched — demoting it hid a whole form from the run',
  );
});

check('a triggered control stays triggered on its own shell', () => {
  const registry = new StateClusterRegistry();
  registry.observe('shell', '/a', ['#save'], 1);
  registry.markTriggered('shell', '#save', 1);
  assert.equal(registry.isSelectorTriggered('shell', '#save'), true);
});

check('an unknown shell or empty input never claims triggered', () => {
  const registry = new StateClusterRegistry();
  registry.observe('shell', '/a', ['#save'], 1);
  registry.markTriggered('shell', '#save', 1);
  assert.equal(registry.isSelectorTriggered('other-shell', '#save'), false);
  assert.equal(registry.isSelectorTriggered('', '#save'), false);
  assert.equal(registry.isSelectorTriggered('shell', ''), false);
});

check('the cross-shell view is still available for genuinely shared controls', () => {
  // Kept for a persistent navbar, where one identity across shells IS intended.
  const registry = new StateClusterRegistry();
  registry.observe('login-shell', '/login', ['#nav-home'], 1);
  registry.markTriggered('login-shell', '#nav-home', 1);
  assert.equal(registry.isSelectorTriggeredAnywhere('#nav-home'), true);
});

check('per-shell coverage accounting is unchanged', () => {
  const registry = new StateClusterRegistry();
  registry.observe('shell', '/a', ['#a', '#b'], 1);
  registry.markTriggered('shell', '#a', 1);
  assert.equal(registry.coverage('shell'), 0.5);
  assert.equal(registry.hasUnexploredControls(), true);
});

console.log('\nStateClusterRegistry — instance-aware saturation (P3-18 fix)');

check('a saturated shell still admits UNSEEN route instances up to the quota', () => {
  // /products/1 and /products/42 share a normalized shell. Skipping the second
  // before it is ever parsed removes every defect that only manifests for a
  // particular record.
  const registry = new StateClusterRegistry({ maxVisits: 1, minInstances: 3 });
  registry.observe('shell', '/products/1', ['#buy'], 1);
  registry.observe('shell', '/products/1', ['#buy'], 2); // gain-less revisit → saturated
  assert.equal(registry.isSaturated('shell'), true);

  assert.equal(registry.isSaturatedForRoute('shell', '/products/1'), true, 'the explored instance is skipped');
  assert.equal(registry.isSaturatedForRoute('shell', '/products/42'), false, 'an unseen instance still gets tested');
});

check('past the instance quota the shell is skipped again', () => {
  const registry = new StateClusterRegistry({ maxVisits: 1, minInstances: 2 });
  registry.observe('shell', '/products/1', ['#buy'], 1);
  registry.observe('shell', '/products/1', ['#buy'], 2);
  registry.observe('shell', '/products/2', ['#buy'], 3);
  assert.equal(registry.isSaturatedForRoute('shell', '/products/99'), true, 'quota spent — breadth wins again');
});

check('an unsaturated shell is never skipped, whatever the instance count', () => {
  const registry = new StateClusterRegistry({ maxVisits: 0, maxInteractions: 0, minInstances: 3 });
  registry.observe('shell', '/a', ['#x'], 1);
  assert.equal(registry.isSaturatedForRoute('shell', '/a'), false);
});

check('the run summary can distinguish template coverage from data coverage', () => {
  const registry = new StateClusterRegistry();
  registry.observe('shell', '/products/1', ['#buy'], 1);
  registry.observe('shell', '/products/2', ['#buy'], 2);
  const snapshot = registry.snapshot();
  assert.equal(snapshot.clusters, 1, '1 shell');
  assert.equal(snapshot.instances, 2, '2 data instances');
});

console.log(`\nStateClusterRegistry identity: ${passed} checks passed.`);
