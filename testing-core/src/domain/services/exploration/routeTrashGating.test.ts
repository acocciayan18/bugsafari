// Standalone deterministic tests for the pure RouteTrasher navigation-control gate.
// Run via `npm test` or `npx tsx .../routeTrashGating.test.ts`.

import assert from 'node:assert/strict';
import { shouldRouteTrash } from './routeTrashGating.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('routeTrashGating — RouteTrasher fires only on route-owning controls');

check('attributes an anchor', () => {
  assert.equal(shouldRouteTrash({ tagName: 'a', role: '', source: 'a.product-link' }), true);
});

check('attributes an ARIA link role on a non-anchor', () => {
  assert.equal(shouldRouteTrash({ tagName: 'span', role: 'link', source: 'span.menu-entry' }), true);
});

check('attributes an explicit Angular routerLink binding', () => {
  assert.equal(shouldRouteTrash({ tagName: 'button', role: '', source: 'button[routerlink="/basket"]' }), true);
});

check('rejects the navbar language toggle (owns no route despite "navbar" in id)', () => {
  // The exact control that stalled Juice Shop: a button that only opens a menu.
  assert.equal(
    shouldRouteTrash({ tagName: 'button', role: 'button', source: '#navbarlanguagebutton language en' }),
    false,
  );
});

check('rejects a plain button', () => {
  assert.equal(shouldRouteTrash({ tagName: 'button', role: '', source: 'button.mat-paginator-navigation-next' }), false);
});

console.log(`\nrouteTrashGating: ${passed} checks passed.`);
