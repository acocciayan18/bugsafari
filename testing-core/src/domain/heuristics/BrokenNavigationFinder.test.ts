// Standalone tests for BrokenNavigationFinder's detection rules and dedup
// accounting (pure, browser-free). Run with:
// `npx tsx src/domain/heuristics/BrokenNavigationFinder.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import {
  BrokenNavigationFinder,
  type InteractionObservation,
} from './BrokenNavigationFinder.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const ORIGIN = 'http://app.test';

const deadClick = (over: Partial<InteractionObservation> = {}): InteractionObservation => ({
  selector: '#nav-a',
  fromStructure: 'structAAAA',
  fromRoute: '/home',
  toRoute: '/home',
  probedRoute: null,
  semanticRole: 'NAVIGATE',
  traversalOk: false,
  landedInvalid: false,
  actionThrew: false,
  networkActivity: false,
  url: `${ORIGIN}/home`,
  timestampMs: 1000,
  ...over,
});

console.log('BrokenNavigationFinder — DEAD_INTERACTION');

check('two consecutive no-ops on a nav control report exactly one defect', () => {
  const f = new BrokenNavigationFinder();
  assert.equal(f.observeInteraction(deadClick()).length, 0);
  const defects = f.observeInteraction(deadClick());
  assert.equal(defects.length, 1);
  assert.equal(defects[0].kind, 'DEAD_INTERACTION');
  assert.equal(defects[0].bugId, 'nav-dead-structAA-#nav-a');
});

check('a third no-op never re-reports the same control', () => {
  const f = new BrokenNavigationFinder();
  f.observeInteraction(deadClick());
  f.observeInteraction(deadClick());
  assert.equal(f.observeInteraction(deadClick()).length, 0);
  assert.equal(f.totalFound(), 1);
});

check('declared-destination mismatch reports on the first strike', () => {
  const f = new BrokenNavigationFinder();
  const defects = f.observeInteraction(deadClick({ probedRoute: '/about' }));
  assert.equal(defects.length, 1);
  assert.ok(defects[0].message.includes('/about'));
});

check('self-link no-op never reports', () => {
  const f = new BrokenNavigationFinder();
  for (let i = 0; i < 4; i++) {
    assert.equal(f.observeInteraction(deadClick({ probedRoute: '/home' })).length, 0);
  }
});

check('non-nav-intent control never reports', () => {
  const f = new BrokenNavigationFinder();
  for (let i = 0; i < 4; i++) {
    assert.equal(f.observeInteraction(deadClick({ semanticRole: 'TOGGLE' })).length, 0);
  }
});

check('networkActivity / traversalOk / route change / throw / invalid all block', () => {
  const f = new BrokenNavigationFinder();
  f.observeInteraction(deadClick());
  assert.equal(f.observeInteraction(deadClick({ networkActivity: true })).length, 0);
  assert.equal(f.observeInteraction(deadClick({ traversalOk: true })).length, 0);
  assert.equal(f.observeInteraction(deadClick({ toRoute: '/other' })).length, 0);
  assert.equal(f.observeInteraction(deadClick({ actionThrew: true })).length, 0);
  assert.equal(f.observeInteraction(deadClick({ landedInvalid: true })).length, 0);
});

check('a successful outcome clears accumulated strikes', () => {
  const f = new BrokenNavigationFinder();
  f.observeInteraction(deadClick());
  f.observeInteraction(deadClick({ traversalOk: true }));
  assert.equal(f.observeInteraction(deadClick()).length, 0);
  assert.equal(f.observeInteraction(deadClick()).length, 1);
});

console.log('\nBrokenNavigationFinder — BROKEN_ROUTE');

const err404 = { route: '/missing', url: `${ORIGIN}/missing`, statusCode: 404, reason: 'HTTP 404' };

check('interaction followed by a 404 error state reports with the triggering selector', () => {
  const f = new BrokenNavigationFinder();
  f.observeInteraction(deadClick({ toRoute: '/missing', traversalOk: true }));
  const defects = f.observeErrorState(err404);
  assert.equal(defects.length, 1);
  assert.equal(defects[0].kind, 'BROKEN_ROUTE');
  assert.equal(defects[0].selector, '#nav-a');
  assert.equal(defects[0].severity, 'MEDIUM');
});

check('error state after an engine navigation never reports', () => {
  const f = new BrokenNavigationFinder();
  f.observeInteraction(deadClick());
  f.noteEngineNavigation();
  assert.equal(f.observeErrorState(err404).length, 0);
});

check('soft route collapse (statusCode null) never reports', () => {
  const f = new BrokenNavigationFinder();
  f.observeInteraction(deadClick());
  assert.equal(f.observeErrorState({ ...err404, statusCode: null }).length, 0);
});

check('same route+status dedups; 500 is HIGH', () => {
  const f = new BrokenNavigationFinder();
  f.observeInteraction(deadClick());
  assert.equal(f.observeErrorState(err404).length, 1);
  f.observeInteraction(deadClick());
  assert.equal(f.observeErrorState(err404).length, 0);
  const boom = f.observeErrorState({ route: '/api-page', url: `${ORIGIN}/api-page`, statusCode: 500, reason: 'HTTP 500' });
  assert.equal(boom[0].severity, 'HIGH');
});

console.log('\nBrokenNavigationFinder — REDIRECT_LOOP (HTTP hops)');

const hop = (route: string, timestampMs: number, status = 302) => ({
  url: `${ORIGIN}${route}`,
  route,
  status,
  timestampMs,
});

check('A,B,A,B,A 3xx chain within the window reports one defect with chain evidence', () => {
  const f = new BrokenNavigationFinder();
  f.observeInteraction(deadClick());
  let defects: ReturnType<typeof f.observeRedirectHop> = [];
  const routes = ['/a', '/b', '/a', '/b', '/a'];
  routes.forEach((r, i) => {
    defects = defects.concat(f.observeRedirectHop(hop(r, 1000 + i * 100)));
  });
  assert.equal(defects.length, 1);
  assert.equal(defects[0].kind, 'REDIRECT_LOOP');
  assert.ok(defects[0].evidence[0].includes('/a (302)'));
});

check('the same hops spread beyond the window never report', () => {
  const f = new BrokenNavigationFinder();
  const routes = ['/a', '/b', '/a', '/b', '/a'];
  routes.forEach((r, i) => {
    assert.equal(f.observeRedirectHop(hop(r, 1000 + i * 5000)).length, 0);
  });
});

check('a continuing loop reports once — sibling routes in the chain are suppressed', () => {
  const f = new BrokenNavigationFinder();
  let defects: ReturnType<typeof f.observeRedirectHop> = [];
  ['/a', '/b', '/a', '/b', '/a', '/b', '/a', '/b'].forEach((r, i) => {
    defects = defects.concat(f.observeRedirectHop(hop(r, 1000 + i * 100)));
  });
  assert.equal(defects.length, 1);
  assert.equal(f.totalFound(), 1);
});

check('a single auth redirect never reports; a 200 terminates the chain', () => {
  const f = new BrokenNavigationFinder();
  assert.equal(f.observeRedirectHop(hop('/login', 1000)).length, 0);
  assert.equal(f.observeRedirectHop(hop('/login', 1100, 200)).length, 0);
  assert.equal(f.observeRedirectHop(hop('/login', 1200)).length, 0);
  assert.equal(f.observeRedirectHop(hop('/login', 1300)).length, 0);
});

console.log('\nBrokenNavigationFinder — REDIRECT_LOOP (SPA oscillation)');

const change = (route: string, timestampMs: number) => ({ url: `${ORIGIN}${route}`, timestampMs });

check('rapid A,B,A,B,A oscillation reports one defect', () => {
  const f = new BrokenNavigationFinder();
  f.observeInteraction(deadClick());
  let defects: ReturnType<typeof f.observeUrlChange> = [];
  ['/a', '/b', '/a', '/b', '/a'].forEach((r, i) => {
    defects = defects.concat(f.observeUrlChange(change(r, 1000 + i * 100)));
  });
  assert.equal(defects.length, 1);
  assert.equal(defects[0].kind, 'REDIRECT_LOOP');
});

check('oscillation is suppressed after an engine navigation until the next interaction', () => {
  const f = new BrokenNavigationFinder();
  f.noteEngineNavigation();
  ['/a', '/b', '/a', '/b', '/a'].forEach((r, i) => {
    assert.equal(f.observeUrlChange(change(r, 1000 + i * 100)).length, 0);
  });
  f.observeInteraction(deadClick());
  let defects: ReturnType<typeof f.observeUrlChange> = [];
  ['/a', '/b', '/a', '/b', '/a'].forEach((r, i) => {
    defects = defects.concat(f.observeUrlChange(change(r, 2000 + i * 100)));
  });
  assert.equal(defects.length, 1);
});

check('a gap beyond the oscillation window resets the chain', () => {
  const f = new BrokenNavigationFinder();
  f.observeInteraction(deadClick());
  ['/a', '/b', '/a', '/b', '/a'].forEach((r, i) => {
    assert.equal(f.observeUrlChange(change(r, 1000 + i * 3000)).length, 0);
  });
});

check('repeating a single route without alternation never reports', () => {
  const f = new BrokenNavigationFinder();
  f.observeInteraction(deadClick());
  for (let i = 0; i < 5; i++) {
    assert.equal(f.observeUrlChange(change('/a', 1000 + i * 100)).length, 0);
  }
});

console.log('\nBrokenNavigationFinder — ledger accounting');

check('reported cap bounds the run ledger', () => {
  const f = new BrokenNavigationFinder();
  for (let i = 0; i < 150; i++) {
    f.observeInteraction(deadClick());
    f.observeErrorState({ route: `/r${i}`, url: `${ORIGIN}/r${i}`, statusCode: 404, reason: 'HTTP 404' });
  }
  assert.equal(f.totalFound(), 100);
});

check('totalFound counts distinct defects across kinds', () => {
  const f = new BrokenNavigationFinder();
  f.observeInteraction(deadClick());
  f.observeInteraction(deadClick());
  f.observeInteraction(deadClick({ toRoute: '/missing', traversalOk: true }));
  f.observeErrorState(err404);
  assert.equal(f.totalFound(), 2);
});

console.log(`\n${passed} passed`);
