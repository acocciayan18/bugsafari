// Self-check for the startup gating predicates — the guards against the two
// startup console faults: a bare GET /api/history/sessions returning 401, and a
// SESSION_ATTACH that can only ever answer `no-active-session`.
// Run via `npm test`; exits non-zero on the first failed node:assert.

import assert from 'node:assert/strict';
import { identityKey, isIdentitySwitch, shouldFetchHistory, shouldRestoreSession, type SessionBootstrap } from './sessionBootstrap.js';
import { canAttach } from '../../infrastructure/engine/gateway/attachEligibility.js';
import { RUN_SCOPED_STORAGE_KEYS, RUN_ID_STORAGE_KEY, RUN_CODE_STORAGE_KEY, JOB_ID_STORAGE_KEY } from './types.js';

const guest: SessionBootstrap = { authToken: null, isAuthenticated: false };
const signedIn: SessionBootstrap = { authToken: 'jwt', isAuthenticated: true };
// A stored token whose user has not been restored yet — auth is still settling.
const settling: SessionBootstrap = { authToken: 'jwt', isAuthenticated: false };

let passed = 0;
function check(name: string, fn: () => void): void {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

console.log('startup gating — protected reads wait for a real session');

check('a guest never requests authenticated history', () => {
    // /api/history/sessions is requireAuth + rejects guests behind it: a 401 by construction.
    assert.equal(shouldFetchHistory(guest), false);
});

check('history is not requested while auth is still initializing', () => {
    assert.equal(shouldFetchHistory(settling), false);
});

check('a fully signed-in session does request history', () => {
    assert.equal(shouldFetchHistory(signedIn), true);
});

check('a claimed-authenticated session with no token is still refused', () => {
    assert.equal(shouldFetchHistory({ authToken: null, isAuthenticated: true }), false);
});

console.log('\nstartup gating — session restore only when something can be restored');

check('a fresh guest load skips the restore probe entirely', () => {
    assert.equal(shouldRestoreSession(guest, null), false);
});

check('a guest holding a run token from a prior load does restore', () => {
    assert.equal(shouldRestoreSession(guest, 'run-token'), true);
});

check('a signed-in operator restores by identity even with no stored token', () => {
    assert.equal(shouldRestoreSession(signedIn, null), true);
});

console.log('\nstartup gating — socket attaches only when ownership is provable');

check('no run token and no identity never emits an attach', () => {
    // This is the ordinary fresh page load that logged `Attach rejected: no-active-session`.
    assert.equal(canAttach(null, null), false);
});

check('a held run token is proof of ownership', () => {
    assert.equal(canAttach('run-token', null), true);
});

check('an authenticated identity can claim its own run without a stored token', () => {
    assert.equal(canAttach(null, 'jwt'), true);
});

console.log('\nsession isolation — an identity switch invalidates all run-scoped state');

const userA = { id: 'user-a' };
const userB = { id: 'user-b' };

check('a token rotation for the SAME user is not an identity switch', () => {
    // Rotation changes the JWT mid-run. Treating that as a switch would wipe a live
    // session, which is why the trigger keys on identity rather than on the token.
    assert.equal(isIdentitySwitch(identityKey(userA, false), identityKey(userA, false)), false);
});

check('logging in as a different account IS an identity switch', () => {
    assert.equal(isIdentitySwitch(identityKey(userA, false), identityKey(userB, false)), true);
});

check('logout and login are both identity switches', () => {
    assert.equal(isIdentitySwitch(identityKey(userA, false), identityKey(null, false)), true);
    assert.equal(isIdentitySwitch(identityKey(null, false), identityKey(userA, false)), true);
});

check('guest and signed-out are distinct identities', () => {
    assert.equal(isIdentitySwitch(identityKey(null, true), identityKey(null, false)), true);
    assert.equal(isIdentitySwitch(identityKey(null, true), identityKey(null, true)), false);
});

check('a guest becoming authenticated is an identity switch', () => {
    assert.equal(isIdentitySwitch(identityKey(null, true), identityKey(userA, false)), true);
});

check('every run-scoped storage key is covered by the teardown set', () => {
    // A key omitted here survives logout and lets the next account present it on
    // attach, or save its own findings over the previous account's document.
    const keys = [...RUN_SCOPED_STORAGE_KEYS];
    for (const key of [RUN_ID_STORAGE_KEY, RUN_CODE_STORAGE_KEY, JOB_ID_STORAGE_KEY]) {
        assert.ok(keys.includes(key), `${key} must be dropped on identity change`);
    }
    assert.equal(new Set(keys).size, keys.length, 'no duplicate keys');
});

console.log(`\n${passed} checks passed`);
