import assert from 'node:assert/strict';
import { ownsRun } from './runOwnership.js';

const TOKEN_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const TOKEN_B = 'bbbbbbbb-1111-2222-3333-444444444444';
const USER_A = '507f1f77bcf86cd799439011';
const USER_B = '507f1f77bcf86cd799439022';

// ── Authenticated run: identity is required, the token alone is not enough ────
const authRun = { runToken: TOKEN_A, userId: USER_A };

assert.equal(ownsRun(authRun, TOKEN_A, USER_A), true, 'the owner attaches with token + identity');
assert.equal(ownsRun(authRun, undefined, USER_A), true, 'the owner attaches on identity alone (fresh tab, no stored token)');

// The reported leak: account B opens the same browser after A, so a stale
// bugsafari:runId from A is still in localStorage and gets presented on attach.
assert.equal(ownsRun(authRun, TOKEN_A, USER_B), false, "another account's stale run token must not attach");
assert.equal(ownsRun(authRun, TOKEN_A, null), false, 'an unauthenticated socket must not attach to an authenticated run');
assert.equal(ownsRun(authRun, TOKEN_B, USER_B), false, 'a wrong token and wrong identity is rejected');
assert.equal(ownsRun(authRun, undefined, null), false, 'no proof at all is rejected');

// ── Guest run: no identity exists, so token possession is the only proof ──────
const guestRun = { runToken: TOKEN_A, userId: null };

assert.equal(ownsRun(guestRun, TOKEN_A, null), true, 'a refreshed guest tab recovers its own run by token');
assert.equal(ownsRun(guestRun, TOKEN_B, null), false, 'a foreign token cannot claim a guest run');
assert.equal(ownsRun(guestRun, undefined, null), false, 'a guest with no token owns nothing');
// An authenticated visitor holding no token gets nothing: identity cannot match null.
assert.equal(ownsRun(guestRun, undefined, USER_A), false, 'identity alone never claims a guest run');

// ── Same account, multiple tabs/devices all stay owners (per-run ownership) ───
assert.equal(ownsRun(authRun, TOKEN_A, USER_A), true);
assert.equal(ownsRun(authRun, undefined, USER_A), true);
assert.equal(ownsRun(authRun, TOKEN_B, USER_A), true, 'a stale token from a PRIOR run of the same account still resolves by identity');

console.log('✓ runOwnership — identity required for authenticated runs, token-only for guests');
