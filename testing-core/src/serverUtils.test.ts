// Self-check for the shared target-URL resolver that the dashboard and the API
// both use, so a typed host and the tested address never diverge.
// Run with `npx tsx src/serverUtils.test.ts`. Exits non-zero on first failure.

import assert from 'node:assert/strict';
import { normalizeTargetUrl, isLocalTargetUrl } from '../../shared/url.js';
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

check('local and LAN targets are flagged for rejection', () => {
  for (const host of [
    'localhost:3000', 'http://localhost/app', '127.0.0.1:8080', 'http://127.1.2.3/',
    '0.0.0.0:3000', 'http://[::1]:5173/', 'http://dev.local/', '10.0.0.5',
    '192.168.1.50:4200', '172.16.0.9', '169.254.1.1', 'http://[fe80::1]/',
  ]) {
    assert.equal(isLocalTargetUrl(host), true, `expected local: ${host}`);
  }
});

check('public targets are not flagged', () => {
  for (const host of [
    'example.com', 'https://app.example.com/x', 'https://a.ngrok-free.app',
    'https://x.trycloudflare.com', '8.8.8.8', 'https://172.15.0.1', 'https://192.169.1.1',
  ]) {
    assert.equal(isLocalTargetUrl(host), false, `expected public: ${host}`);
  }
});

check('a local target is never rewritten — the URL is preserved verbatim', () => {
  const typed = 'http://localhost:3000/app?x=1';
  assert.equal(normalizeTargetUrl(typed), typed);
  assert.equal(parseTargetUrl({ url: typed }), typed);
  assert.equal(isLocalTargetUrl(typed), true);
});

console.log(`\nserverUtils: ${passed} checks passed.`);
