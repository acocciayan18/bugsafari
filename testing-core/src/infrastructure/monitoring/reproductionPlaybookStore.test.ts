// Standalone tests for the reproduction playbook store's narrative generation:
// it must ALWAYS open with a navigation (the reachable starting URL) and collapse
// consecutive identical actions (rapid clicks) into one burst step.
// Run with `npx tsx src/infrastructure/monitoring/reproductionPlaybookStore.test.ts`.

import assert from 'node:assert/strict';
import type { ActionRecord } from '../../../../shared/types.js';
import { ReproductionPlaybookStore } from './reproductionPlaybookStore.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const click = (over: Partial<ActionRecord> = {}): ActionRecord => ({
  timestamp: '2026-01-01T00:00:00.000Z',
  type: 'CLICK',
  selector: '#save',
  url: 'http://app.test/orders',
  elementLabel: 'Save',
  elementKind: 'button',
  ...over,
});

console.log('ReproductionPlaybookStore — narrative always opens with a route + collapses rapid clicks');

check('rapid identical clicks collapse to one burst and the playbook opens with a navigation', () => {
  ReproductionPlaybookStore.reset();
  ReproductionPlaybookStore.push(click());
  ReproductionPlaybookStore.push(click());
  ReproductionPlaybookStore.push(click());

  const steps = ReproductionPlaybookStore.getNarrativeSteps();
  assert.equal(steps[0], 'Step 1. Navigate to /orders', steps.join('\n'));
  assert.equal(steps.length, 2, steps.join('\n'));
  assert.ok(steps[1].includes('repeated 3 times in quick succession'), steps[1]);
  ReproductionPlaybookStore.reset();
});

check('an empty store yields no steps (nothing to reproduce)', () => {
  ReproductionPlaybookStore.reset();
  assert.deepEqual(ReproductionPlaybookStore.getNarrativeSteps(), []);
});

console.log(`\n${passed} passed`);
