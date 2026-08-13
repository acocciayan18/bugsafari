// Standalone deterministic test for the injection-suitability scorer.
// Run with `npx tsx src/bugs/finders/injectionSuitability.test.ts`.

import assert from 'node:assert/strict';
import {
  scoreInjectionSuitability,
  isInjectableTarget,
  INJECTION_CONFIDENCE_THRESHOLD,
} from './injectionSuitability.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('injectionSuitability — context-aware injection targeting');

check('a username text field is a strong target', () => {
  assert.equal(isInjectableTarget({ tagName: 'input', type: 'text', id: 'username', name: 'username' }), true);
});

check('a password field is a strong target (NoSQL auth bypass)', () => {
  assert.equal(isInjectableTarget({ tagName: 'input', type: 'password', name: 'password' }), true);
});

check('an ARIA-only search box on a custom component is targeted', () => {
  // No id/name/placeholder — labelled purely via ARIA, the real-SPA case the old
  // id/name/class regex missed entirely.
  const s = scoreInjectionSuitability({ tagName: 'input', type: 'text', ariaLabel: 'Search products', role: 'searchbox' });
  assert.ok(s >= INJECTION_CONFIDENCE_THRESHOLD, `expected >= threshold, got ${s}`);
});

check('a field labelled only by its surrounding container is targeted', () => {
  assert.equal(isInjectableTarget({ tagName: 'input', type: 'text', contextLabel: 'Account login' }), true);
});

check('a numeric field named userId is NOT probed (wrong input type)', () => {
  // Token 'id' is strong, but a number input cannot carry a string payload — excluded
  // so SQL/NoSQL strings are never wasted on it.
  assert.equal(scoreInjectionSuitability({ tagName: 'input', type: 'number', name: 'userId' }), 0);
});

check('a date / checkbox / range / color field is never probed', () => {
  for (const type of ['date', 'checkbox', 'range', 'color', 'file', 'datetime-local']) {
    assert.equal(scoreInjectionSuitability({ tagName: 'input', type, name: 'search' }), 0, `type=${type}`);
  }
});

check('a generic unlabelled text input is below threshold (not blindly probed)', () => {
  assert.equal(isInjectableTarget({ tagName: 'input', type: 'text' }), false);
});

check('a sort-order dropdown is below threshold', () => {
  assert.equal(isInjectableTarget({ tagName: 'select', name: 'sortby' }), false);
});

check('a query-bearing textarea is targeted', () => {
  assert.equal(isInjectableTarget({ tagName: 'textarea', name: 'searchQuery' }), true);
});

check('a free-text comment textarea stays below threshold (XSS surface, not SQL/NoSQL)', () => {
  assert.equal(isInjectableTarget({ tagName: 'textarea', name: 'comment' }), false);
});

console.log(`\nAll ${passed} assertions passed.`);
