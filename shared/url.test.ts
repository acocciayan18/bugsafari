// Self-executing checks for normalizeTargetUrl. No runner framework (per the
// "no external libraries" constraint) — run with `npx tsx "shared/url.test.ts"`
// or `npm test --workspace shared`. Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { normalizeTargetUrl, isPrivateTargetHost, isPrivateTargetUrl } from './url.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('prefixes https:// on a bare host', () => {
  assert.equal(normalizeTargetUrl('example.com'), 'https://example.com');
});

check('preserves an explicit scheme, path and query byte-for-byte', () => {
  assert.equal(normalizeTargetUrl('http://example.com:3000'), 'http://example.com:3000');
  assert.equal(normalizeTargetUrl('https://example.com/a/b?c=1&d=2#e'), 'https://example.com/a/b?c=1&d=2#e');
});

check('keeps a bare host:port from reading as a scheme', () => {
  assert.equal(normalizeTargetUrl('example.com:3000'), 'https://example.com:3000');
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
  assert.equal(normalizeTargetUrl('  example.com  '), 'https://example.com');
});

check('resolution is idempotent', () => {
  const once = normalizeTargetUrl('example.com/a?b=1');
  assert.equal(normalizeTargetUrl(once), once);
});

check('a local target is never rewritten to a bridge host', () => {
  assert.equal(normalizeTargetUrl('http://localhost:3000/app'), 'http://localhost:3000/app');
  assert.equal(normalizeTargetUrl('http://127.0.0.1:5173'), 'http://127.0.0.1:5173');
});

check('private and loopback hosts are detected', () => {
  for (const host of ['localhost', 'app.localhost', '127.0.0.1', '127.5.5.5', '0.0.0.0', '[::1]',
    'host.docker.internal', 'dev.local', '10.0.0.4', '192.168.1.50', '172.16.9.9', '169.254.1.1', 'fe80::1']) {
    assert.equal(isPrivateTargetHost(host), true, host);
  }
});

check('public hosts are not flagged', () => {
  for (const host of ['example.com', 'localhost.example.com', '8.8.8.8', '172.15.0.1', '11.0.0.1']) {
    assert.equal(isPrivateTargetHost(host), false, host);
  }
});

check('isPrivateTargetUrl only fires on a parseable local target', () => {
  assert.equal(isPrivateTargetUrl('localhost:3000'), true);
  assert.equal(isPrivateTargetUrl('http://127.0.0.1/app'), true);
  assert.equal(isPrivateTargetUrl('https://example.com'), false);
  assert.equal(isPrivateTargetUrl(''), false);
  assert.equal(isPrivateTargetUrl('file:///etc/passwd'), false);
});

console.log(`\n${passed} url assertion group(s) passed.`);
