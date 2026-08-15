// Standalone deterministic test for flushSnapshot's burst inference.
// Run with `npx tsx src/infrastructure/monitoring/activeScenarioTracker.test.ts`.

import assert from 'node:assert/strict';
import { ActiveScenarioTracker } from './activeScenarioTracker.js';
import { ReproductionPlaybookStore } from './reproductionPlaybookStore.js';
import type { ActionRecord } from '../../../../shared/types.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const PAGE = 'https://target.test/dashboard';
function rec(ms: number, selector: string, url: string, burstId?: string): ActionRecord {
  return { timestamp: new Date(ms).toISOString(), type: 'CLICK', selector, url, burstId } as ActionRecord;
}

console.log('activeScenarioTracker — flushSnapshot burst inference');

check('a fault with no culprit scopes the replay to the in-progress burst only', () => {
  ReproductionPlaybookStore.reset();
  ActiveScenarioTracker.reset();
  // Unrelated exploration before the burst, then a 3-control concurrent burst.
  ReproductionPlaybookStore.push(rec(1000, '#nav-a', 'https://target.test/home'));
  ReproductionPlaybookStore.push(rec(2000, '#nav-b', PAGE));
  ReproductionPlaybookStore.push(rec(3000, '#save', PAGE, 'burst-1'));
  ReproductionPlaybookStore.push(rec(3001, '#cancel', PAGE, 'burst-1'));
  ReproductionPlaybookStore.push(rec(3002, '#email', PAGE, 'burst-1'));

  const snap = ActiveScenarioTracker.flushSnapshot({ faultUrl: PAGE, faultAtMs: 3500 });
  const acted = snap.actions.filter((a) => a.selector);
  assert.ok(acted.length === 3, 'only the three burst actions remain');
  assert.ok(acted.every((a) => a.burstId === 'burst-1'), 'unrelated exploration is dropped');
});

check('a known culprit selector suppresses burst inference (culprit-anchored trim wins)', () => {
  ReproductionPlaybookStore.reset();
  ActiveScenarioTracker.reset();
  ReproductionPlaybookStore.push(rec(2000, '#nav-b', PAGE));
  ReproductionPlaybookStore.push(rec(3000, '#save', PAGE, 'burst-1'));
  ReproductionPlaybookStore.push(rec(3001, '#cancel', PAGE, 'burst-1'));

  const snap = ActiveScenarioTracker.flushSnapshot({ faultUrl: PAGE, faultAtMs: 3500, culpritSelector: '#save' });
  const acted = snap.actions.filter((a) => a.selector);
  assert.ok(acted.some((a) => a.selector === '#save'), 'the culprit action is kept');
  assert.ok(!acted.some((a) => a.selector === '#cancel'), 'the burst sibling is stripped');
});

console.log(`\nactiveScenarioTracker: ${passed} checks passed.`);
