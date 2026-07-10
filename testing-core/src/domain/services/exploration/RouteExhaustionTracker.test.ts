// Standalone deterministic tests for RouteExhaustionTracker's consecutive
// defensive/error-route detection. No unit-test runner is configured in this
// package, so this is a self-executing script: run with
// `npx tsx src/domain/services/exploration/RouteExhaustionTracker.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { RouteExhaustionTracker } from './RouteExhaustionTracker.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('RouteExhaustionTracker — consecutive defensive/error-route detection');

check('a lone non-error step is never an error state', () => {
  const t = new RouteExhaustionTracker();
  const v = t.observe({ structureHash: 'A', routePath: '/home', httpStatus: 200 });
  assert.equal(v.isErrorState, false);
  assert.equal(v.consecutiveErrorStates, 0);
  assert.equal(v.exhausted, false);
});

check('identical template at DIFFERENT routes = route-collapse error state', () => {
  const t = new RouteExhaustionTracker();
  t.observe({ structureHash: 'H', routePath: '/null', httpStatus: 200 });
  const v = t.observe({ structureHash: 'H', routePath: '/-1', httpStatus: 200 });
  assert.equal(v.isErrorState, true);
  assert.equal(v.consecutiveErrorStates, 1);
  assert.equal(v.exhausted, false);
});

check('same template across THREE distinct routes exhausts at threshold 2', () => {
  const t = new RouteExhaustionTracker();
  t.observe({ structureHash: 'H', routePath: '/null', httpStatus: 200 });
  t.observe({ structureHash: 'H', routePath: '/-1', httpStatus: 200 }); // consecutive=1
  const v = t.observe({ structureHash: 'H', routePath: '/x', httpStatus: 200 }); // consecutive=2
  assert.equal(v.exhausted, true);
  assert.equal(v.consecutiveErrorStates, 2);
});

check('same template at the SAME route is not a route-collapse (identity handles it)', () => {
  const t = new RouteExhaustionTracker();
  t.observe({ structureHash: 'H', routePath: '/null', httpStatus: 200 });
  const v = t.observe({ structureHash: 'H', routePath: '/null', httpStatus: 200 });
  assert.equal(v.isErrorState, false);
  assert.equal(v.consecutiveErrorStates, 0);
});

check('HTTP >=400 is an error state on the very first observation', () => {
  const t = new RouteExhaustionTracker();
  const v = t.observe({ structureHash: 'A', routePath: '/missing', httpStatus: 404 });
  assert.equal(v.isErrorState, true);
  assert.equal(v.consecutiveErrorStates, 1);
  assert.match(v.reason, /404/);
});

check('two consecutive HTTP >=400 responses exhaust the branch', () => {
  const t = new RouteExhaustionTracker();
  t.observe({ structureHash: 'A', routePath: '/a', httpStatus: 404 });
  const v = t.observe({ structureHash: 'B', routePath: '/b', httpStatus: 500 });
  assert.equal(v.exhausted, true);
});

check('a clean step between errors resets the consecutive run', () => {
  const t = new RouteExhaustionTracker();
  t.observe({ structureHash: 'H', routePath: '/null', httpStatus: 200 });
  const e1 = t.observe({ structureHash: 'H', routePath: '/-1', httpStatus: 200 });
  assert.equal(e1.consecutiveErrorStates, 1);
  const clean = t.observe({ structureHash: 'HOME', routePath: '/dashboard', httpStatus: 200 });
  assert.equal(clean.consecutiveErrorStates, 0);
  // A fresh collapse pair after the reset starts counting from 1 again.
  const e2 = t.observe({ structureHash: 'HOME', routePath: '/settings', httpStatus: 200 });
  assert.equal(e2.isErrorState, true);
  assert.equal(e2.consecutiveErrorStates, 1);
  assert.equal(e2.exhausted, false);
});

check('an empty structure hash never triggers a route-collapse', () => {
  const t = new RouteExhaustionTracker();
  t.observe({ structureHash: '', routePath: '/a', httpStatus: 200 });
  const v = t.observe({ structureHash: '', routePath: '/b', httpStatus: 200 });
  assert.equal(v.isErrorState, false);
});

check('reset() clears the prior-step memory', () => {
  const t = new RouteExhaustionTracker();
  t.observe({ structureHash: 'H', routePath: '/null', httpStatus: 200 });
  t.reset();
  // Without the previous step, an identical structure cannot collapse yet.
  const v = t.observe({ structureHash: 'H', routePath: '/-1', httpStatus: 200 });
  assert.equal(v.isErrorState, false);
  assert.equal(v.consecutiveErrorStates, 0);
});

check('custom threshold of 3 requires three consecutive error states', () => {
  const t = new RouteExhaustionTracker(3);
  t.observe({ structureHash: 'H', routePath: '/1', httpStatus: 200 });
  const a = t.observe({ structureHash: 'H', routePath: '/2', httpStatus: 200 }); // 1
  const b = t.observe({ structureHash: 'H', routePath: '/3', httpStatus: 200 }); // 2
  const c = t.observe({ structureHash: 'H', routePath: '/4', httpStatus: 200 }); // 3
  assert.equal(a.exhausted, false);
  assert.equal(b.exhausted, false);
  assert.equal(c.exhausted, true);
});

console.log(`\nRouteExhaustionTracker: ${passed} checks passed.`);
