// Self-executing deterministic tests for the value-control sampler. No unit runner
// is configured, so run via `npx tsx src/domain/services/exploration/valueControlSampler.test.ts`.

import assert from 'node:assert/strict';
import { sampleValueControl } from './valueControlSampler.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('valueControlSampler — deterministic bounded value sampling');

check('range sampling is deterministic for the same inputs/index', () => {
  const c = { min: '0', max: '100', step: '5' };
  assert.equal(sampleValueControl('range', c, 0), sampleValueControl('range', c, 0));
});

check('range sample set includes both declared boundaries', () => {
  const c = { min: '10', max: '20', step: '1' };
  const values = [0, 1, 2, 3].map((i) => sampleValueControl('range', c, i));
  assert.ok(values.includes('10'), 'includes min');
  assert.ok(values.includes('20'), 'includes max');
});

check('range sample set is bounded to <=4 distinct positions and index cycles', () => {
  const c = { min: '0', max: '100', step: '1' };
  const cycle = [0, 1, 2, 3].map((i) => sampleValueControl('range', c, i));
  // Wrapping by the list length yields the same value.
  for (let i = 0; i < 4; i += 1) {
    assert.equal(sampleValueControl('range', c, i + cycle.length), cycle[i], `index ${i} cycles`);
  }
});

check('range defaults to 0/100 when min/max absent', () => {
  const values = [0, 1, 2, 3].map((i) => sampleValueControl('range', {}, i));
  assert.ok(values.includes('0'), 'default min 0');
  assert.ok(values.includes('100'), 'default max 100');
});

check('color sampling yields valid lowercase #rrggbb', () => {
  for (let i = 0; i < 5; i += 1) {
    const value = sampleValueControl('color', {}, i);
    assert.match(value, /^#[0-9a-f]{6}$/, `sample ${i} is a hex color`);
  }
});

check('negative index is handled without throwing', () => {
  assert.match(sampleValueControl('color', {}, -1), /^#[0-9a-f]{6}$/);
  assert.doesNotThrow(() => sampleValueControl('range', { min: '0', max: '10' }, -3));
});

console.log(`\nvalueControlSampler: ${passed} checks passed.`);
