// collapseChildSignatures normalizes a feed's repeated siblings so an infinite
// scroll can't mint a fresh structure hash per streamed card. Identical children
// collapse count-agnostically regardless of interleaving/growth, while first-seen
// order and genuinely distinct sets are preserved. Self-executing (no runner):
// `npx tsx src/ml/domHasher.feed.test.ts`.

import assert from 'node:assert/strict';
import { collapseChildSignatures } from './domHasher.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('domHasher — feed-sibling collapse');

check('interleaved ad card + growing count + shift all hash the same', () => {
  const a = collapseChildSignatures(['A', 'A', 'B', 'A', 'A']); // ad B mid-feed
  const b = collapseChildSignatures(['A', 'A', 'A', 'B']); // ad B at tail
  const c = collapseChildSignatures(['A', 'B', 'A', 'A', 'A', 'A']); // more cards streamed
  assert.equal(a, 'A*B');
  assert.equal(a, b);
  assert.equal(a, c);
});

check('count-agnostic: 2 vs many identical cards collapse identically', () => {
  assert.equal(collapseChildSignatures(['A', 'A']), collapseChildSignatures(['A', 'A', 'A', 'A', 'A']));
  assert.equal(collapseChildSignatures(['A', 'A']), 'A*');
});

check('recurring pair collapses count-agnostically', () => {
  assert.equal(collapseChildSignatures(['A', 'B', 'A', 'B', 'A']), 'A*B*');
  assert.equal(collapseChildSignatures(['A', 'A', 'A', 'B', 'B']), 'A*B*');
});

check('non-adjacent improvement over the old adjacent-only collapse', () => {
  // Old run-length logic yielded 'A*BA*' (feed re-fragmented); new logic is stable.
  assert.equal(collapseChildSignatures(['A', 'A', 'B', 'A', 'A']), 'A*B');
});

check('distinct sets stay distinct; first-seen order and singletons preserved', () => {
  assert.notEqual(collapseChildSignatures(['A', 'B']), collapseChildSignatures(['A', 'A']));
  assert.equal(collapseChildSignatures(['A', 'B']), 'AB');
  assert.equal(collapseChildSignatures(['B', 'A']), 'BA'); // order retained
  assert.equal(collapseChildSignatures(['A']), 'A');
  assert.equal(collapseChildSignatures([]), '');
});

console.log(`\ndomHasher feed-collapse: ${passed} checks passed.`);
