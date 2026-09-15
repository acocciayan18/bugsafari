// Self-executing tests for jsonPaths (pure). Run: `npx tsx src/domain/services/baseline/jsonPaths.test.ts`.

import assert from 'node:assert/strict';
import { flatten, changedPaths } from './jsonPaths.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('baseline/jsonPaths — flatten + diff');

check('flatten nests objects and arrays into dotted/indexed paths', () => {
  const m = flatten({ a: 1, b: { c: 'x' }, d: [10, 20] });
  assert.equal(m.get('a'), '1');
  assert.equal(m.get('b.c'), 'x');
  assert.equal(m.get('d[0]'), '10');
  assert.equal(m.get('d[1]'), '20');
});

check('flatten stringifies null and booleans', () => {
  const m = flatten({ n: null, t: true });
  assert.equal(m.get('n'), 'null');
  assert.equal(m.get('t'), 'true');
});

check('changedPaths reports differing and one-sided paths', () => {
  const a = flatten({ x: 1, y: 2, only_a: 9 });
  const b = flatten({ x: 1, y: 3, only_b: 9 });
  const changed = changedPaths(a, b);
  assert.equal(changed.has('x'), false);
  assert.equal(changed.has('y'), true);
  assert.equal(changed.has('only_a'), true);
  assert.equal(changed.has('only_b'), true);
});

check('identical maps → no changed paths', () => {
  const a = flatten({ x: 1, nested: { z: 'q' } });
  const b = flatten({ x: 1, nested: { z: 'q' } });
  assert.equal(changedPaths(a, b).size, 0);
});

console.log(`\njsonPaths: ${passed} checks passed.`);
