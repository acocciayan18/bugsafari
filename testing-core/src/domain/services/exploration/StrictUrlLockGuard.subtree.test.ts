// Sub-Tree / Prefix Lock allow rule for StrictUrlLockGuard.isAllowed.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with
// `npx tsx src/domain/services/exploration/StrictUrlLockGuard.subtree.test.ts`.

import assert from 'node:assert/strict';
import { StrictUrlLockGuard } from './StrictUrlLockGuard.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('StrictUrlLockGuard.isAllowed — sub-tree scope');

const target = 'https://app.example.com/history/forensics-history';
const allow = (url: string): boolean => StrictUrlLockGuard.isAllowed(url, target, 'subtree');

check('allows the launch route itself', () => {
  assert.equal(allow('https://app.example.com/history/forensics-history'), true);
  assert.equal(allow('https://app.example.com/history/forensics-history/'), true);
});

check('allows descendant paths', () => {
  assert.equal(allow('https://app.example.com/history/forensics-history/run-123234'), true);
  assert.equal(allow('https://app.example.com/history/forensics-history/run-1/detail'), true);
});

check('allows same-route query variations', () => {
  assert.equal(allow('https://app.example.com/history/forensics-history?tab=raw'), true);
});

check('blocks the parent path', () => {
  assert.equal(allow('https://app.example.com/history'), false);
});

check('blocks sibling-prefix collisions (the / boundary)', () => {
  assert.equal(allow('https://app.example.com/history/forensics-history-2'), false);
});

check('blocks sibling routes and other modules', () => {
  assert.equal(allow('https://app.example.com/settings'), false);
  assert.equal(allow('https://app.example.com/history/other'), false);
});

check('blocks other hosts / external domains', () => {
  assert.equal(allow('https://evil.com/history/forensics-history'), false);
  assert.equal(allow('https://other.example.com/history/forensics-history'), false);
});

check('passes browser-internal / non-http(s) targets through', () => {
  assert.equal(allow('about:blank'), true);
  assert.equal(allow('data:text/html,x'), true);
});

check('auth origins are always allowed', () => {
  assert.equal(
    StrictUrlLockGuard.isAllowed('https://login.idp.com/authorize', target, 'subtree', ['login.idp.com']),
    true,
  );
});

// Root launch: every same-host path is a descendant of '/'.
const rootTarget = 'https://app.example.com/';
check('root launch allows any same-host path but not other hosts', () => {
  assert.equal(StrictUrlLockGuard.isAllowed('https://app.example.com/anything/deep', rootTarget, 'subtree'), true);
  assert.equal(StrictUrlLockGuard.isAllowed('https://evil.com/', rootTarget, 'subtree'), false);
});

console.log(`\n${passed} checks passed.`);
