// Self-executing checks for normalizeTargetUrl. No runner framework (per the
// "no external libraries" constraint) — run with `npx tsx "shared/url.test.ts"`
// or `npm test --workspace shared`. Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import {
  normalizeTargetUrl,
  isPrivateTargetHost,
  isPrivateTargetUrl,
  isProtectedTargetHost,
  isProtectedTargetUrl,
  parseProtectedOrigins,
  DEFAULT_PROTECTED_HOSTS,
} from './url.js';

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

check('self-target: BugSafari default host, subdomains, and vercel previews are protected', () => {
  for (const host of [
    'bugsafari.vercel.app',
    'BugSafari.Vercel.App',           // case-insensitive
    'bugsafari.vercel.app.',          // trailing dot
    'www.bugsafari.vercel.app',       // www alias
    'api.bugsafari.vercel.app',       // subdomain
    'bugsafari-git-main-team.vercel.app', // vercel branch preview
    'bugsafari-a1b2c3.vercel.app',    // vercel deploy preview
  ]) {
    assert.equal(isProtectedTargetHost(host), true, host);
  }
});

check('self-target: unrelated hosts are NOT protected', () => {
  for (const host of ['example.com', 'notbugsafari.vercel.app', 'bugsafari.com', 'vercel.app', 'my-bugsafari.com', 'bugsafarivercel.app']) {
    assert.equal(isProtectedTargetHost(host), false, host);
  }
});

check('self-target: port and scheme never change the verdict', () => {
  assert.equal(isProtectedTargetUrl('bugsafari.vercel.app'), true);
  assert.equal(isProtectedTargetUrl('https://bugsafari.vercel.app:8443/dashboard/'), true);
  assert.equal(isProtectedTargetUrl('http://www.bugsafari.vercel.app'), true);
  assert.equal(isProtectedTargetUrl('https://example.com'), false);
  assert.equal(isProtectedTargetUrl(''), false);
  assert.equal(isProtectedTargetUrl('file:///etc/passwd'), false);
});

check('self-target: a configured extra origin (env-style) is protected, default still applies', () => {
  const hosts = [...DEFAULT_PROTECTED_HOSTS, ...parseProtectedOrigins('https://staging.bugsafari.io, bugsafari.internal.example')];
  assert.deepEqual(parseProtectedOrigins('https://staging.bugsafari.io, bugsafari.internal.example'), ['staging.bugsafari.io', 'bugsafari.internal.example']);
  assert.equal(isProtectedTargetHost('staging.bugsafari.io', hosts), true);
  assert.equal(isProtectedTargetHost('www.staging.bugsafari.io', hosts), true); // subdomain of a configured host
  assert.equal(isProtectedTargetHost('bugsafari.vercel.app', hosts), true);     // default preserved
  assert.equal(isProtectedTargetHost('example.com', hosts), false);
  assert.equal(parseProtectedOrigins('').length, 0);
  assert.equal(parseProtectedOrigins(undefined).length, 0);
});

console.log(`\n${passed} url assertion group(s) passed.`);
