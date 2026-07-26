// Standalone deterministic tests for the SessionPreservationGuard. No unit-test
// runner is configured in this package, so this is a self-executing script: run
// with `npx tsx src/domain/services/exploration/SessionPreservationGuard.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import {
  isSessionDestroyingControl,
  shouldVetoExecution,
  isAuthPage,
  shouldTriggerSessionLoss,
  classifySessionLoss,
  SessionRestoreCoordinator,
  SESSION_EXIT_DEMOTION,
} from './SessionPreservationGuard.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
async function checkAsync(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const fakePage = {} as unknown as Page;

console.log('SessionPreservationGuard — authenticated session preservation policy');

check('flags every session-destroying control', () => {
  const destructive = [
    'Log out', 'Sign Out', 'log-off', 'End Session', 'Log in', 'Sign In',
    'Sign up', 'Register', 'Create Account', 'Switch account', 'Change Account',
    'Delete account', 'Deactivate my account', 'Close profile', 'Remove account',
    'Reset password', 'Change Password', 'Forgot password', 'Revoke session token',
    'Revoke API key', 'Token revocation',
  ];
  for (const text of destructive) {
    assert.equal(isSessionDestroyingControl({ innerText: text }), true, `should flag: ${text}`);
  }
});

check('matches on id and className too', () => {
  assert.equal(isSessionDestroyingControl({ id: 'logout-btn' }), true);
  assert.equal(isSessionDestroyingControl({ className: 'btn nav-signout' }), true);
});

check('leaves benign CRUD and generic controls explorable', () => {
  const benign = [
    'Delete item', 'Remove row', 'Save', 'Submit', 'Add to cart', 'Search',
    'Delete comment', 'Edit profile picture', 'Next', 'Registered users: 42',
  ];
  for (const text of benign) {
    assert.equal(isSessionDestroyingControl({ innerText: text }), false, `should NOT flag: ${text}`);
  }
});

check('shouldVetoExecution mirrors the classifier', () => {
  assert.equal(shouldVetoExecution({ innerText: 'Logout' }), true);
  assert.equal(shouldVetoExecution({ innerText: 'Save changes' }), false);
});

check('isAuthPage detects auth routes by path only', () => {
  for (const url of [
    'https://app.test/login', 'https://app.test/signin', 'https://app.test/sign-in',
    'https://app.test/signup', 'https://app.test/register', 'https://app.test/logout',
    'https://app.test/auth', 'https://app.test/auth/callback', 'https://app.test/sso',
  ]) {
    assert.equal(isAuthPage(url), true, `auth: ${url}`);
  }
  for (const url of [
    'https://app.test/dashboard', 'https://app.test/products', 'https://app.test/author',
    'https://app.test/registration-desk', 'https://app.test/', 'https://app.test/settings?tab=login',
  ]) {
    assert.equal(isAuthPage(url), false, `not auth: ${url}`);
  }
});

check('shouldTriggerSessionLoss fires only on a genuine authed->auth-page bounce', () => {
  const app = 'https://app.test/orders';
  const login = 'https://app.test/login';
  // Fires: authenticated, not restoring, moved from app surface to a login page.
  assert.equal(shouldTriggerSessionLoss(true, false, app, login), true);
  // Inert on a guest/unauthenticated run.
  assert.equal(shouldTriggerSessionLoss(false, false, app, login), false);
  // Inert while a restore is already in flight (no self-retrigger).
  assert.equal(shouldTriggerSessionLoss(true, true, app, login), false);
  // Inert when the destination is not an auth page.
  assert.equal(shouldTriggerSessionLoss(true, false, app, 'https://app.test/cart'), false);
  // Inert when already on an auth page (no new loss).
  assert.equal(shouldTriggerSessionLoss(true, false, login, login), false);
});

check('classifySessionLoss carries the transition', () => {
  const d = classifySessionLoss('https://app.test/orders', 'https://app.test/login');
  assert.equal(d.from, 'https://app.test/orders');
  assert.equal(d.to, 'https://app.test/login');
  assert.match(d.reason, /session lost/i);
});

check('demotion constant dominates every other rank margin', () => {
  assert.ok(SESSION_EXIT_DEMOTION >= 2000);
});

await checkAsync('coordinator returns the restore result', async () => {
  const ok = new SessionRestoreCoordinator(async () => true);
  assert.equal(await ok.restore(fakePage), true);
  const bad = new SessionRestoreCoordinator(async () => false);
  assert.equal(await bad.restore(fakePage), false);
});

await checkAsync('coordinator with no callback is inert', async () => {
  const none = new SessionRestoreCoordinator(null);
  assert.equal(none.canRestore(), false);
  assert.equal(await none.restore(fakePage), false);
});

await checkAsync('coordinator swallows a throwing restore', async () => {
  const boom = new SessionRestoreCoordinator(async () => { throw new Error('nope'); });
  assert.equal(await boom.restore(fakePage), false);
});

await checkAsync('coordinator debounces concurrent restores', async () => {
  let calls = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => { release = r; });
  const coord = new SessionRestoreCoordinator(async () => { calls += 1; await gate; return true; });
  const first = coord.restore(fakePage);
  assert.equal(coord.isRestoring, true);
  const second = await coord.restore(fakePage); // rejected while first is in flight
  assert.equal(second, false);
  release();
  assert.equal(await first, true);
  assert.equal(calls, 1);
  assert.equal(coord.isRestoring, false);
});

console.log(`\n${passed} passed`);
