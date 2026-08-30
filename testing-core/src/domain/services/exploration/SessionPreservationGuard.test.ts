import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import {
  isSessionDestroyingControl,
  shouldVetoExecution,
  isAuthPage,
  shouldTriggerSessionLoss,
  SessionRestoreCoordinator,
} from './SessionPreservationGuard.js';

// Self-executing script (no runner). Locks the session-preservation policy that keeps
// an authenticated run from clicking itself back to login/registration, and detects a
// bounce to an auth page as a session loss. Covers the "unexpected logout / navigation
// back to login/registration" scenario.

let passed = 0;
function check(name: string, fn: () => void): void { fn(); passed += 1; console.log(`  ✓ ${name}`); }
async function acheck(name: string, fn: () => Promise<void>): Promise<void> { await fn(); passed += 1; console.log(`  ✓ ${name}`); }

console.log('SessionPreservationGuard — destructive controls');

for (const text of ['Log out', 'Sign Out', 'Log In', 'Sign up', 'Register', 'Create account', 'Switch account', 'Delete account', 'Reset password']) {
  check(`vetoes "${text}"`, () => {
    assert.equal(isSessionDestroyingControl({ innerText: text }), true);
    assert.equal(shouldVetoExecution({ innerText: text }), true);
  });
}

for (const text of ['Delete item', 'Remove row', 'Add to cart', 'Save changes', 'Submit', 'Close dialog']) {
  check(`allows generic CRUD "${text}"`, () => {
    assert.equal(isSessionDestroyingControl({ innerText: text }), false);
  });
}

check('matches on id / className too, not just text', () => {
  assert.equal(isSessionDestroyingControl({ id: 'logout-btn' }), true);
  assert.equal(isSessionDestroyingControl({ className: 'nav__signout' }), true);
});

console.log('\nSessionPreservationGuard — auth-page + session-loss detection');

for (const url of ['https://app.co/login', 'https://app.co/sign-in', 'https://app.co/register', 'https://app.co/auth/callback', 'https://app.co/logout']) {
  check(`${url} is an auth page`, () => assert.equal(isAuthPage(url), true));
}

check('a dashboard with a login query param is NOT an auth page', () => {
  assert.equal(isAuthPage('https://app.co/dashboard?tab=login'), false);
});

check('authenticated run bouncing app→login is a session loss', () => {
  assert.equal(shouldTriggerSessionLoss(true, false, 'https://app.co/dashboard', 'https://app.co/login'), true);
});

check('login→login (already on auth page) is NOT a fresh session loss', () => {
  assert.equal(shouldTriggerSessionLoss(true, false, 'https://app.co/login', 'https://app.co/login'), false);
});

check('mid-restore navigation to login is suppressed', () => {
  assert.equal(shouldTriggerSessionLoss(true, true, 'https://app.co/dashboard', 'https://app.co/login'), false);
});

check('unauthenticated run never triggers session loss', () => {
  assert.equal(shouldTriggerSessionLoss(false, false, 'https://app.co/dashboard', 'https://app.co/login'), false);
});

console.log('\nSessionPreservationGuard — restore coordinator');

await acheck('no restore fn ⇒ cannot restore, restore() returns false', async () => {
  const c = new SessionRestoreCoordinator(null);
  assert.equal(c.canRestore(), false);
  assert.equal(await c.restore({} as unknown as Page), false);
});

await acheck('a second concurrent restore is suppressed (serialized)', async () => {
  let calls = 0;
  const c = new SessionRestoreCoordinator(async () => { calls += 1; await Promise.resolve(); return true; });
  const first = c.restore({} as unknown as Page);
  const second = c.restore({} as unknown as Page); // re-entrant during in-flight restore
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, true);
  assert.equal(b, false, 'the re-entrant restore bails instead of stacking');
  assert.equal(calls, 1);
});

await acheck('a throwing restore fn resolves false and clears the flag', async () => {
  const c = new SessionRestoreCoordinator(async () => { throw new Error('boom'); });
  assert.equal(await c.restore({} as unknown as Page), false);
  assert.equal(c.isRestoring, false);
});

console.log(`\nSessionPreservationGuard: ${passed} checks passed.`);
