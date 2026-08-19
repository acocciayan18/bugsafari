// Tests for the non-semantic interactive classifier. No unit-test runner is
// configured in this package, so this is a self-executing script: run with
// `npx tsx src/domain/heuristics/nonSemanticInteractive.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { isNonSemanticInteractive } from './nonSemanticInteractive.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('nonSemanticInteractive — hand-rolled control classifier');

check('a <div> with onclick is a non-semantic control', () => {
  assert.equal(isNonSemanticInteractive({ tagName: 'div', hasOnClick: true }), true);
});

check('a <span> with onclick is a non-semantic control', () => {
  assert.equal(isNonSemanticInteractive({ tagName: 'span', hasOnClick: true }), true);
});

check('a focusable <div> (tabindex="0") is a non-semantic control', () => {
  assert.equal(isNonSemanticInteractive({ tagName: 'div', tabIndex: 0 }), true);
});

check('tabindex="-1" alone is not interactive (not user-focusable)', () => {
  assert.equal(isNonSemanticInteractive({ tagName: 'div', tabIndex: -1 }), false);
});

check('a <div role="button"> is already semantic-via-role, not flagged', () => {
  assert.equal(isNonSemanticInteractive({ tagName: 'div', role: 'button', hasOnClick: true }), false);
});

check('a plain container <div> is not interactive', () => {
  assert.equal(isNonSemanticInteractive({ tagName: 'div' }), false);
});

check('a real <button> is excluded (semantic tag)', () => {
  assert.equal(isNonSemanticInteractive({ tagName: 'button', hasOnClick: true }), false);
});

check('an <a> is excluded (semantic tag)', () => {
  assert.equal(isNonSemanticInteractive({ tagName: 'a', hasOnClick: true }), false);
});

check('role match is case-insensitive', () => {
  assert.equal(isNonSemanticInteractive({ tagName: 'div', role: 'BUTTON', hasOnClick: true }), false);
});

check('missing/undefined optionals are safe (no hook → false)', () => {
  assert.equal(isNonSemanticInteractive({ tagName: 'div', tabIndex: null }), false);
  assert.equal(isNonSemanticInteractive({ tagName: 'DIV' }), false);
});

console.log(`\nAll ${passed} checks passed.`);
