// Self-executing checks for the saved-session importance gate. Run with
// `npx tsx "shared/session.test.ts"` or `npm test -w shared`.
//
// isImportantSession decides whether permanent deletion demands typed confirmation,
// so its threshold is a destructive-action guard and is pinned here against drift.

import assert from 'node:assert/strict';
import {
  isImportantSession,
  IMPORTANT_FINDING_THRESHOLD,
  RUN_HEALTH_EVENT,
  SESSION_ATTACH_EVENT,
  SESSION_SNAPSHOT_EVENT,
  TIME_SYNC_EVENT,
  type EngineHealthPhase,
  type RunControlAck,
  type RunHealthPayload,
} from './types/session.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('session — importance gate for permanent deletion');

check('the threshold is the CRITICAL-badge count (3)', () => {
  assert.equal(IMPORTANT_FINDING_THRESHOLD, 3);
});

check('below the threshold is not important', () => {
  assert.equal(isImportantSession(0), false);
  assert.equal(isImportantSession(2), false);
});

check('at or above the threshold is important', () => {
  assert.equal(isImportantSession(3), true);
  assert.equal(isImportantSession(50), true);
});

// ── Resilience contracts ─────────────────────────────────────────────────────
// These names are the wire itself: client and server look them up from here, so a
// silent rename would leave one side emitting into a channel nobody listens on.
console.log('session — resilience wire contracts');

check('the socket event names are stable', () => {
  assert.equal(SESSION_ATTACH_EVENT, 'session-attach');
  assert.equal(SESSION_SNAPSHOT_EVENT, 'session-snapshot');
  assert.equal(TIME_SYNC_EVENT, 'time-sync');
  assert.equal(RUN_HEALTH_EVENT, 'run-health');
});

// Engine liveness is deliberately NOT a RunLifecycleStatus member: a status says what
// the run is meant to be doing, this says whether the engine is still turning. Keeping
// them separate is what lets a stalled run remain stoppable.
check('run health carries a phase and the heartbeat age', () => {
  const stalled: RunHealthPayload = { runToken: 't1', phase: 'stalled', lastHeartbeatAgeMs: 61_000 };
  assert.equal(stalled.phase, 'stalled');
  // Null is a real case — a run that has not stamped a heartbeat yet, which must never
  // be read as evidence of a stall.
  const booting: RunHealthPayload = { runToken: 't1', phase: 'live', lastHeartbeatAgeMs: null };
  assert.equal(booting.lastHeartbeatAgeMs, null);
  const phases: EngineHealthPhase[] = ['live', 'stalled'];
  assert.equal(phases.length, 2);
});

// A control ack must be able to say WHY it refused, or the client cannot tell a
// permission failure from a rate limit and has nothing useful to show the operator.
check('a control ack can carry a refusal reason', () => {
  const accepted: RunControlAck = { accepted: true };
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.reason, undefined);
  const refused: RunControlAck = { accepted: false, reason: 'not-owner' };
  assert.equal(refused.reason, 'not-owner');
});

console.log(`\nsession: ${passed} checks passed.`);
