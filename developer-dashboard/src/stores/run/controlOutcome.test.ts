// Self-check for how a pause/resume/stop outcome is applied.
//
// These controls were fire-and-forget: a refusal was invisible, so the dashboard held an
// optimistic PAUSING/STOPPING forever — the "Pause and Stop do nothing and the UI stays
// stuck" report. The fix has a sharp edge: rolling back on the WRONG signal is just as
// bad, because showing ACTIVE for a run that is really stopping desyncs the operator
// from the engine. The rule under test is therefore narrow — roll back only on an
// explicit server refusal, never on a transport failure.
// Run via `npm test`; exits non-zero on the first failed node:assert.

import assert from 'node:assert/strict';
import type { RunControlOutcome } from '../../application/ports/EngineGateway';
import { canApplyRollback, refusalMessage, shouldRollbackControl } from './controlOutcome.js';

let passed = 0;
function check(name: string, fn: () => void): void {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

console.log('controlOutcome — applying a control verdict');

check('an accepted command never rolls back', () => {
    assert.strictEqual(shouldRollbackControl({ ok: true, via: 'socket' }), false);
    assert.strictEqual(shouldRollbackControl({ ok: true, via: 'http' }), false);
});

// The server saw the command and said no. HTTP would be refused identically, so the
// optimistic state is simply wrong and must be corrected.
check('an explicit refusal rolls back', () => {
    for (const reason of ['not-owner', 'no-active-session', 'rate-limited', 'unsupported'] as const) {
        assert.strictEqual(shouldRollbackControl({ ok: false, via: 'socket', reason }), true, reason);
    }
});

// The critical negative case: a network failure proves nothing about whether the command
// landed. The engine may already be pausing; the re-delivery loop and the engine's own
// telemetry own that outcome.
check('a transport failure does NOT roll back', () => {
    const httpFailure: RunControlOutcome = { ok: false, via: 'http', error: "We couldn't stop the session." };
    assert.strictEqual(shouldRollbackControl(httpFailure), false, 'an unreachable backend is not a refusal');
    assert.strictEqual(shouldRollbackControl({ ok: false, via: 'socket' }), false, 'a missing ack is not a refusal');
});

// A refusal can arrive after the state moved on — the engine settled, the run ended, or
// the operator pressed Stop. Applying it then would resurrect a dead state.
check('a stale rollback is discarded once the status has moved on', () => {
    assert.strictEqual(canApplyRollback('PAUSING', 'PAUSING'), true, 'still in the optimistic state');
    assert.strictEqual(canApplyRollback('PAUSED', 'PAUSING'), false, 'the engine already settled the pause');
    assert.strictEqual(canApplyRollback('STOPPING', 'PAUSING'), false, 'a stop supersedes the pause');
    assert.strictEqual(canApplyRollback('FINISHED', 'STOPPING'), false, 'the run ended');
});

check('each refusal reads as an actionable sentence', () => {
    assert.match(refusalMessage('no-active-session', 'pause'), /no running session to pause/i);
    assert.match(refusalMessage('not-owner', 'stop'), /permission/i);
    assert.match(refusalMessage('rate-limited', 'resume'), /too many requests/i);
    // An unknown/absent code still yields usable copy rather than "undefined".
    assert.match(refusalMessage(undefined, 'pause'), /couldn't pause/i);
    assert.doesNotMatch(refusalMessage('unsupported', 'stop'), /undefined/);
});

console.log(`controlOutcome.test.ts: ${passed} checks passed`);
