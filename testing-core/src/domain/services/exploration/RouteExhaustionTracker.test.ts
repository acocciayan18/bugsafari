// Standalone deterministic tests for RouteExhaustionTracker's defensive/error-route
// detection: hard HTTP evidence acts immediately, the soft route-collapse signal
// needs corroboration. No unit-test runner is configured in this package, so this is
// a self-executing script: run with
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

console.log('RouteExhaustionTracker — defensive/error-route detection');

check('a lone non-error step is never an error state', () => {
  const t = new RouteExhaustionTracker();
  const v = t.observe({ structureHash: 'A', routePath: '/home', httpStatus: 200 });
  assert.equal(v.isErrorState, false);
  assert.equal(v.signal, 'none');
  assert.equal(v.consecutiveCollapses, 0);
});

check('HTTP >=400 is an error state on the very first observation', () => {
  const t = new RouteExhaustionTracker();
  const v = t.observe({ structureHash: 'A', routePath: '/missing', httpStatus: 404 });
  assert.equal(v.isErrorState, true);
  assert.equal(v.signal, 'http-error');
  assert.match(v.reason, /404/);
});

check('a SINGLE client-rendered route-collapse is tolerated (EX1/EX2 hysteresis)', () => {
  const t = new RouteExhaustionTracker();
  t.observe({ structureHash: 'H', routePath: '/products/1', httpStatus: null });
  const v = t.observe({ structureHash: 'H', routePath: '/products/2', httpStatus: null });
  assert.equal(v.isErrorState, false);
  assert.equal(v.consecutiveCollapses, 1);
});

check('the same shell across THREE client-rendered routes is an error state', () => {
  const t = new RouteExhaustionTracker();
  t.observe({ structureHash: 'H', routePath: '/null', httpStatus: null });
  t.observe({ structureHash: 'H', routePath: '/-1', httpStatus: null }); // collapse 1
  const v = t.observe({ structureHash: 'H', routePath: '/x', httpStatus: null }); // collapse 2
  assert.equal(v.isErrorState, true);
  assert.equal(v.signal, 'route-collapse');
  assert.equal(v.consecutiveCollapses, 2);
});

check('a healthy served status vetoes route-collapse entirely (EX2)', () => {
  const t = new RouteExhaustionTracker();
  t.observe({ structureHash: 'H', routePath: '/products/1', httpStatus: 200 });
  const a = t.observe({ structureHash: 'H', routePath: '/products/2', httpStatus: 200 });
  const b = t.observe({ structureHash: 'H', routePath: '/products/3', httpStatus: 200 });
  assert.equal(a.isErrorState, false);
  assert.equal(b.isErrorState, false);
  assert.equal(b.consecutiveCollapses, 0);
});

check('same template at the SAME route is not a route-collapse (identity handles it)', () => {
  const t = new RouteExhaustionTracker();
  t.observe({ structureHash: 'H', routePath: '/null', httpStatus: null });
  const v = t.observe({ structureHash: 'H', routePath: '/null', httpStatus: null });
  assert.equal(v.isErrorState, false);
  assert.equal(v.consecutiveCollapses, 0);
});

check('two consecutive HTTP >=400 responses both report immediately', () => {
  const t = new RouteExhaustionTracker();
  const a = t.observe({ structureHash: 'A', routePath: '/a', httpStatus: 404 });
  const b = t.observe({ structureHash: 'B', routePath: '/b', httpStatus: 500 });
  assert.equal(a.isErrorState, true);
  assert.equal(b.isErrorState, true);
  assert.equal(b.signal, 'http-error');
});

check('a clean step between collapses resets the consecutive run', () => {
  const t = new RouteExhaustionTracker();
  t.observe({ structureHash: 'H', routePath: '/null', httpStatus: null });
  assert.equal(t.observe({ structureHash: 'H', routePath: '/-1', httpStatus: null }).consecutiveCollapses, 1);
  const clean = t.observe({ structureHash: 'HOME', routePath: '/dashboard', httpStatus: null });
  assert.equal(clean.consecutiveCollapses, 0);
  const next = t.observe({ structureHash: 'HOME', routePath: '/settings', httpStatus: null });
  assert.equal(next.isErrorState, false);
  assert.equal(next.consecutiveCollapses, 1);
});

check('an A→B→A oscillation is a navigable pair, not a parade', () => {
  const t = new RouteExhaustionTracker();
  t.observe({ structureHash: 'H', routePath: '/', httpStatus: null });
  assert.equal(t.observe({ structureHash: 'H', routePath: '/#about', httpStatus: null }).consecutiveCollapses, 1);
  const back = t.observe({ structureHash: 'H', routePath: '/', httpStatus: null });
  assert.equal(back.isErrorState, false);
  assert.equal(back.consecutiveCollapses, 0);
  // The pair keeps ping-ponging without ever being excluded.
  assert.equal(t.observe({ structureHash: 'H', routePath: '/#about', httpStatus: null }).isErrorState, false);
});

check('an empty structure hash never triggers a route-collapse', () => {
  const t = new RouteExhaustionTracker();
  t.observe({ structureHash: '', routePath: '/a', httpStatus: null });
  t.observe({ structureHash: '', routePath: '/b', httpStatus: null });
  const v = t.observe({ structureHash: '', routePath: '/c', httpStatus: null });
  assert.equal(v.isErrorState, false);
});

check('reset() clears the prior-step memory', () => {
  const t = new RouteExhaustionTracker();
  t.observe({ structureHash: 'H', routePath: '/null', httpStatus: null });
  t.reset();
  const v = t.observe({ structureHash: 'H', routePath: '/-1', httpStatus: null });
  assert.equal(v.isErrorState, false);
  assert.equal(v.consecutiveCollapses, 0);
});

check('custom threshold of 3 requires three consecutive collapses', () => {
  const t = new RouteExhaustionTracker(3);
  t.observe({ structureHash: 'H', routePath: '/1', httpStatus: null });
  const a = t.observe({ structureHash: 'H', routePath: '/2', httpStatus: null }); // 1
  const b = t.observe({ structureHash: 'H', routePath: '/3', httpStatus: null }); // 2
  const c = t.observe({ structureHash: 'H', routePath: '/4', httpStatus: null }); // 3
  assert.equal(a.isErrorState, false);
  assert.equal(b.isErrorState, false);
  assert.equal(c.isErrorState, true);
});

console.log(`\nRouteExhaustionTracker: ${passed} checks passed.`);
