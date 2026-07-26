// Self-executing checks for semanticFallbackFromSelector — the last-resort
// element name when no human label exists. Never a full DOM path.
// Run with `npx tsx "shared/reproduction.test.ts"` or `npm test -w shared`.

import assert from 'node:assert/strict';
import { semanticFallbackFromSelector } from './reproduction.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('collapses a full nth-of-type DOM path to its final control', () => {
  assert.equal(
    semanticFallbackFromSelector('body > div:nth-of-type(1) > main > button:nth-of-type(2)'),
    '<button>',
  );
});

check('keeps a meaningful id', () => {
  assert.equal(semanticFallbackFromSelector('button#submit'), '<button#submit>');
  assert.equal(semanticFallbackFromSelector('#register-btn'), '<#register-btn>');
});

check('keeps a class when no id', () => {
  assert.equal(semanticFallbackFromSelector('input.email-field'), '<input.email-field>');
});

check('keeps a name attribute when no id/class', () => {
  assert.equal(semanticFallbackFromSelector('input[name="email"]'), '<input[email]>');
});

check('never leaks the > path separator', () => {
  const out = semanticFallbackFromSelector('a > b > c:nth-child(3)');
  assert.ok(!out.includes('>') || out.startsWith('<'), out);
  assert.ok(!out.includes(' > '), out);
});

check('empty selector yields a generic fallback', () => {
  assert.equal(semanticFallbackFromSelector(''), '<element>');
  assert.equal(semanticFallbackFromSelector(undefined), '<element>');
});

console.log(`\n${passed} checks passed`);
