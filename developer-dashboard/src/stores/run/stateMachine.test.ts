// Self-check for the deterministic control-state machine that kills the
// Queued→Starting→Running flicker. No framework — run via `npm test`.
// Exits non-zero on the first failed node:assert.

import assert from 'node:assert/strict';
import { resolveStatus, reconcileHydratedStatus } from './types.js';
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

// Snapshot-hydrate reconcile (the slow-network pause desync): a same-run lagging
// snapshot that reads ACTIVE must not overwrite a held pause/stop intent.
assert.equal(reconcileHydratedStatus('PAUSED', 'ACTIVE', true), 'PAUSED', 'same-run hydrate must not un-pause on a lagging ACTIVE snapshot');
assert.equal(reconcileHydratedStatus('PAUSING', 'ACTIVE', true), 'PAUSING', 'same-run hydrate must not drop PAUSING to ACTIVE');
assert.equal(reconcileHydratedStatus('STOPPING', 'ACTIVE', true), 'STOPPING', 'same-run hydrate must not drop STOPPING to ACTIVE');
// A fresher/authoritative snapshot still wins: pause confirmed, or the run really ended.
assert.equal(reconcileHydratedStatus('PAUSING', 'PAUSED', true), 'PAUSED', 'snapshot confirming the pause is honored');
assert.equal(reconcileHydratedStatus('PAUSED', 'FINISHED', true), 'FINISHED', 'a terminal snapshot is always honored');
assert.equal(reconcileHydratedStatus('PAUSED', 'STOPPED', true), 'STOPPED', 'a terminal snapshot is always honored');
// A fresh restore (different/empty run) hydrates wholesale — no intent to preserve.
assert.equal(reconcileHydratedStatus('PAUSED', 'ACTIVE', false), 'ACTIVE', 'cross-run restore takes the snapshot');
assert.equal(reconcileHydratedStatus('ACTIVE', 'ACTIVE', true), 'ACTIVE', 'a live run stays live');

// A client-issued timebox stop must resolve to the timebox outcome, not user-stopped.
assert.equal(STOP_REASON_OUTCOME.timebox, 'timebox', 'timebox stop must map to the timebox outcome');
assert.equal(STOP_REASON_OUTCOME.operator, 'user-stopped');

console.log('stateMachine.test.ts: all assertions passed');
