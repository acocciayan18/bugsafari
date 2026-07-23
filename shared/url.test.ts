// Self-executing checks for normalizeTargetUrl. No runner framework (per the
// "no external libraries" constraint) — run with `npx tsx "shared/url.test.ts"`
// or `npm test --workspace shared`. Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { normalizeTargetUrl } from './url.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('prefixes https:// on a bare host', () => {
  assert.equal(normalizeTargetUrl('example.com'), 'https://example.com/');
});

check('preserves an explicit http scheme', () => {
  assert.equal(normalizeTargetUrl('http://localhost:3000'), 'http://localhost:3000/');
});

check('keeps a bare host:port from reading as a scheme', () => {
  assert.equal(normalizeTargetUrl('localhost:3000'), 'https://localhost:3000/');
});

check('rejects non-web schemes (protocol-injection guard)', () => {
  assert.equal(normalizeTargetUrl('file:///etc/passwd'), null);
  assert.equal(normalizeTargetUrl('javascript:alert(1)'), null);
  assert.equal(normalizeTargetUrl('ftp://host/x'), null);
});

check('rejects empty / non-string / whitespace input', () => {
  assert.equal(normalizeTargetUrl(''), null);
  assert.equal(normalizeTargetUrl('   '), null);
  assert.equal(normalizeTargetUrl(undefined), null);
  assert.equal(normalizeTargetUrl(42), null);
});

check('trims surrounding whitespace before resolving', () => {
  assert.equal(normalizeTargetUrl('  example.com  '), 'https://example.com/');
});

console.log(`\n${passed} url assertion group(s) passed.`);
