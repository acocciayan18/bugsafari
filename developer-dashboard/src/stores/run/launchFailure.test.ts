// Guards that no failed start stays silent: every start-test rejection resolves to a
// non-empty message, and the auth-on-queue case is rewritten to operator prose. Run via
// `npm test`; exits non-zero on the first failed node:assert.

import assert from 'node:assert/strict';
import { resolveLaunchFailure } from './launchFailure.js';

function makeErr(message: string, extra: Record<string, unknown> = {}): Error {
    return Object.assign(new Error(message), extra);
}

// Auth-on-queue is rewritten and flagged for the deployment-misconfig log.
{
    const r = resolveLaunchFailure(makeErr('AUTH_UNSUPPORTED_ON_QUEUE'));
    assert.equal(r.authOnQueue, true, 'auth-on-queue is flagged');
    assert.match(r.message, /Authenticated runs aren't available/, 'auth-on-queue message is rewritten');
}

// Fleet 503s carry the server's own prose verbatim.
{
    const r = resolveLaunchFailure(makeErr('No test worker is connected right now.', { code: 'FLEET_UNAVAILABLE' }));
    assert.equal(r.authOnQueue, false, 'fleet rejection is not auth-on-queue');
    assert.equal(r.message, 'No test worker is connected right now.', 'fleet prose passes through');
}
{
    const r = resolveLaunchFailure(makeErr('The worker backlog is full.', { code: 'QUEUE_FULL' }));
    assert.equal(r.message, 'The worker backlog is full.', 'queue-full prose passes through');
}

// Every remaining failure path yields a non-empty message — the silence this closes.
for (const err of [
    makeErr('A BugSafari run is already active.', { status: 429 }),
    makeErr('Failed to enqueue the run on the worker fleet.', { status: 502 }),
    makeErr("We can't reach BugSafari right now. Check your connection and try again."),
]) {
    const r = resolveLaunchFailure(err);
    assert.ok(r.message.length > 0, `non-empty message for: ${err.message}`);
}

// A non-Error rejection still resolves to a stringified, non-empty message.
{
    const r = resolveLaunchFailure('raw string failure');
    assert.equal(r.message, 'raw string failure', 'non-Error rejection is stringified');
}

console.log('✓ launchFailure: no failed start resolves to a silent message');
