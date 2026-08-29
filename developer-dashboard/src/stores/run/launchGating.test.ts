// Guards the shared Start gate: a blank/whitespace URL, incomplete target-auth, or a
// blocked (local/self) target must each disqualify a launch. Run via `npm test`; exits
// non-zero on the first failed node:assert.

import assert from 'node:assert/strict';
import { isLaunchBlocked } from './launchGating.js';

const ok = { urlInput: 'https://example.com/', authIncomplete: false, isBlockedTarget: false };

assert.equal(isLaunchBlocked(ok), false, 'valid URL with both flags clear is not blocked');

assert.equal(isLaunchBlocked({ ...ok, urlInput: '' }, ), true, 'empty URL is blocked');
assert.equal(isLaunchBlocked({ ...ok, urlInput: '   ' }), true, 'whitespace-only URL is blocked');

assert.equal(isLaunchBlocked({ ...ok, authIncomplete: true }), true, 'incomplete target-auth blocks');
assert.equal(isLaunchBlocked({ ...ok, isBlockedTarget: true }), true, 'blocked (local/self) target blocks');

// A valid URL never rescues an incomplete-auth or blocked-target launch.
assert.equal(isLaunchBlocked({ urlInput: 'https://example.com/', authIncomplete: true, isBlockedTarget: true }), true, 'flags dominate a valid URL');

console.log('✓ launchGating: all Start-gate invariants hold');
