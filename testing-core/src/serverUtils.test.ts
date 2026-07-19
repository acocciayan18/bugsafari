// Self-check for the shared target-URL resolver that the dashboard and the API
// both use, so a typed host and the tested address never diverge.
// Run with `npx tsx src/serverUtils.test.ts`. Exits non-zero on first failure.

import assert from 'node:assert/strict';
import { normalizeTargetUrl } from '../../shared/url.js';
import { parseTargetUrl } from './serverUtils.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('serverUtils — target URL resolution');

check('bare host gains https and a trailing slash', () => {
  assert.equal(normalizeTargetUrl('example.com'), 'https://example.com/');
});

check('explicit scheme and path are preserved', () => {
  assert.equal(normalizeTargetUrl('http://localhost:3000/app'), 'http://localhost:3000/app');
});

check('surrounding whitespace is trimmed', () => {
  assert.equal(normalizeTargetUrl('  example.com/x  '), 'https://example.com/x');
});

check('non-web protocols are rejected', () => {
  assert.equal(normalizeTargetUrl('javascript:alert(1)'), null);
  assert.equal(normalizeTargetUrl('file:///etc/passwd'), null);
  assert.equal(normalizeTargetUrl('data:text/html,<script>'), null);
  assert.equal(normalizeTargetUrl('FILE:///etc/passwd'), null);
});

check('a bare host:port is not mistaken for a scheme', () => {
  assert.equal(normalizeTargetUrl('localhost:3000'), 'https://localhost:3000/');
  assert.equal(normalizeTargetUrl('localhost:3000/app'), 'https://localhost:3000/app');
});

check('empty and non-string input is rejected', () => {
  assert.equal(normalizeTargetUrl(''), null);
  assert.equal(normalizeTargetUrl('   '), null);
  assert.equal(normalizeTargetUrl(undefined), null);
  assert.equal(normalizeTargetUrl(42), null);
});

check('normalizing an already-resolved URL is a no-op', () => {
  const once = normalizeTargetUrl('example.com/a?b=1');
  assert.equal(normalizeTargetUrl(once), once);
});

check('parseTargetUrl resolves the body url through the shared rule', () => {
  assert.equal(parseTargetUrl({ url: 'example.com' }), 'https://example.com/');
  assert.equal(parseTargetUrl({ url: '' }), null);
  assert.equal(parseTargetUrl({}), null);
  assert.equal(parseTargetUrl(null), null);
});

console.log(`\nserverUtils: ${passed} checks passed.`);
