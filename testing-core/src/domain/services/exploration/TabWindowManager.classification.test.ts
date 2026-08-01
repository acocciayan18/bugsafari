// Tab approval rule — the origin gate every app-opened tab passes through.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with
// `npx tsx src/domain/services/exploration/TabWindowManager.classification.test.ts`.

import assert from 'node:assert/strict';
import { TabWindowManager, type TabWindowManagerDeps } from './TabWindowManager.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('TabWindowManager — tab classification');

function makeManager(authOrigins: readonly string[] = []): TabWindowManager {
  return new TabWindowManager({
    getTargetOrigin: () => 'https://app.example.com',
    authOrigins,
  } as unknown as TabWindowManagerDeps);
}

const plain = makeManager();

check('exact same host is approved', () => {
  assert.equal(plain.classify('https://app.example.com/checkout?id=9#top'), 'approved');
});

// Site confinement is host-based (like isProtectedTargetHost): port and scheme
// don't change the site, so the same host over another port/scheme stays in scope.
check('same host on a different port is approved', () => {
  assert.equal(plain.classify('https://app.example.com:8443/checkout'), 'approved');
});

check('same host on a different scheme is approved', () => {
  assert.equal(plain.classify('http://app.example.com/checkout'), 'approved');
});

check('a subdomain of the target IS in scope and is approved', () => {
  assert.equal(plain.classify('https://cdn.app.example.com/asset'), 'approved');
});

check('an unrelated site is blocked', () => {
  assert.equal(plain.classify('https://github.com/some/repo'), 'blocked');
});

check('non-navigational schemes are blocked', () => {
  assert.equal(plain.classify('mailto:support@example.com'), 'blocked');
  assert.equal(plain.classify('tel:+15550100'), 'blocked');
  assert.equal(plain.classify('javascript:void(0)'), 'blocked');
  assert.equal(plain.classify('data:text/html,<b>x</b>'), 'blocked');
});

check('a blank / never-navigated tab is blocked', () => {
  assert.equal(plain.classify('about:blank'), 'blocked');
  assert.equal(plain.classify(''), 'blocked');
});

// Deliberately the opposite of ExplorationLoop.leavesTargetOrigin, which fails OPEN:
// an href is a click handed to the browser, but a tab is a live resource we own.
check('an unparseable URL fails CLOSED', () => {
  assert.equal(plain.classify('not a url'), 'blocked');
  assert.equal(plain.classify('///'), 'blocked');
});

const withAuth = makeManager(['https://login.idp.example']);

check('a configured auth origin is approved so an SSO popup can complete', () => {
  assert.equal(withAuth.classify('https://login.idp.example/authorize?client_id=1'), 'approved');
});

check('an auth origin does not approve its siblings', () => {
  assert.equal(withAuth.classify('https://other.idp.example/authorize'), 'blocked');
});

check('an unparseable target origin blocks everything rather than throwing', () => {
  const broken = new TabWindowManager({
    getTargetOrigin: () => '',
    authOrigins: [],
  } as unknown as TabWindowManagerDeps);
  assert.equal(broken.classify('https://app.example.com/'), 'blocked');
});

console.log(`\n${passed} checks passed.`);
