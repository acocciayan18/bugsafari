// ChaosInjectionRegistry.hasActiveInjection — time-only correlation for a fault whose
// message doesn't name the sabotaged URL. Run: `npx tsx src/infrastructure/monitoring/chaosInjectionRegistry.test.ts`.

import assert from 'node:assert/strict';
import { ChaosInjectionRegistry } from './chaosInjectionRegistry.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const WINDOW = 30_000;

console.log('ChaosInjectionRegistry.hasActiveInjection');

check('false when nothing was injected', () => {
  ChaosInjectionRegistry.reset();
  assert.equal(ChaosInjectionRegistry.hasActiveInjection(1000), false);
});

check('true within the injection window after a mark', () => {
  ChaosInjectionRegistry.reset();
  ChaosInjectionRegistry.mark('https://app.io/api/products', 'Aborted', 1000);
  assert.equal(ChaosInjectionRegistry.hasActiveInjection(1000), true);
  assert.equal(ChaosInjectionRegistry.hasActiveInjection(1000 + WINDOW), true);
});

check('false once every injection has aged past the window', () => {
  ChaosInjectionRegistry.reset();
  ChaosInjectionRegistry.mark('https://app.io/api/products', 'Aborted', 1000);
  assert.equal(ChaosInjectionRegistry.hasActiveInjection(1000 + WINDOW + 1), false);
  // the aged entry is pruned on read, so a later query is still false
  assert.equal(ChaosInjectionRegistry.hasActiveInjection(1000 + WINDOW + 2), false);
});

check('a fresh mark reactivates after an old one expired', () => {
  ChaosInjectionRegistry.reset();
  ChaosInjectionRegistry.mark('https://app.io/api/a', 'Aborted', 1000);
  assert.equal(ChaosInjectionRegistry.hasActiveInjection(1000 + WINDOW + 1), false);
  ChaosInjectionRegistry.mark('https://app.io/api/b', 'Aborted', 1000 + WINDOW + 1);
  assert.equal(ChaosInjectionRegistry.hasActiveInjection(1000 + WINDOW + 2), true);
});

ChaosInjectionRegistry.reset();
console.log(`\n${passed} passed`);
