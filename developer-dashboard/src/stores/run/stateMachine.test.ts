// Self-check for the deterministic control-state machine that kills the
// Queued→Starting→Running flicker. No framework — run via `npm test`.
// Exits non-zero on the first failed node:assert.

import assert from 'node:assert/strict';
import { resolveStatus } from './types.js';
import { STOP_REASON_OUTCOME } from '../../../../shared/types.js';

// The flicker root cause: an optimistic-ACTIVE run must never regress to QUEUED.
assert.equal(resolveStatus('ACTIVE', 'QUEUED'), 'ACTIVE', 'ACTIVE must not regress to QUEUED');
assert.equal(resolveStatus('ACTIVE', 'STARTING'), 'ACTIVE', 'ACTIVE must not regress to STARTING');
assert.equal(resolveStatus('QUEUED', 'STARTING'), 'QUEUED', 'QUEUED must not regress to STARTING');

// The intended forward path stays valid.
assert.equal(resolveStatus('STARTING', 'QUEUED'), 'QUEUED');
assert.equal(resolveStatus('STARTING', 'ACTIVE'), 'ACTIVE');
assert.equal(resolveStatus('QUEUED', 'ACTIVE'), 'ACTIVE');
assert.equal(resolveStatus('PAUSED', 'ACTIVE'), 'ACTIVE', 'resume must be allowed');

// Optimistic control transitions (MF-transition-lock): the targets runCommands sets
// on click must be valid so the button locks immediately instead of flickering.
assert.equal(resolveStatus('ACTIVE', 'PAUSING'), 'PAUSING', 'optimistic pause must be allowed');
assert.equal(resolveStatus('ACTIVE', 'STOPPING'), 'STOPPING', 'optimistic stop must be allowed');
assert.equal(resolveStatus('PAUSED', 'STOPPING'), 'STOPPING', 'optimistic stop from paused must be allowed');
assert.equal(resolveStatus('STARTING', 'STOPPING'), 'STOPPING', 'optimistic stop during startup must be allowed');

// Terminal is always reachable from a live state.
assert.equal(resolveStatus('ACTIVE', 'FINISHED'), 'FINISHED');
assert.equal(resolveStatus('STARTING', 'STOPPED'), 'STOPPED');

// Same-state is a no-op, not a rejection.
assert.equal(resolveStatus('ACTIVE', 'ACTIVE'), 'ACTIVE');

// A client-issued timebox stop must resolve to the timebox outcome, not user-stopped.
assert.equal(STOP_REASON_OUTCOME.timebox, 'timebox', 'timebox stop must map to the timebox outcome');
assert.equal(STOP_REASON_OUTCOME.operator, 'user-stopped');

console.log('stateMachine.test.ts: all assertions passed');
