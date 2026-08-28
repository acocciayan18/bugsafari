// Self-check for the connection-state reducer that drives ConnectionStatusChip.
//
// The chip is the operator's only window onto whether the dashboard is actually being
// fed. It previously rendered NOTHING when healthy, so "no chip" was indistinguishable
// from "connected", and it had no concept of a stalled engine at all — a wedged worker
// left the UI looking perfectly healthy while the stream was dead. These checks pin the
// precedence between the three independent failure axes.
// Run via `npm test`; exits non-zero on the first failed node:assert.

import assert from 'node:assert/strict';
import { resolveConnectionView, isFaultView, type ConnectionInputs } from './connectionState.js';

// A fully healthy dashboard watching a live run.
const healthy: ConnectionInputs = {
    online: true,
    isConnected: true,
    isReconnecting: false,
    reconnectAttempt: 0,
    reconnectGaveUp: false,
    isRestoring: false,
    hasConnectedOnce: true,
    engineHealth: 'live',
    status: 'ACTIVE',
    targetNetworkPhase: 'ONLINE',
    slowLink: false,
};

const view = (over: Partial<ConnectionInputs> = {}) => resolveConnectionView({ ...healthy, ...over });

let passed = 0;
function check(name: string, fn: () => void): void {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

console.log('connectionState — operator-facing connection view');

// The whole point of the persistent pill: healthy must be a POSITIVE statement.
check('a healthy dashboard reports Connected, not nothing', () => {
    const v = view();
    assert.strictEqual(v.phase, 'connected');
    assert.strictEqual(v.label, 'Connected');
    assert.strictEqual(v.severity, 'stable');
    assert.strictEqual(isFaultView(v), false);
});

check('browser offline outranks every other signal', () => {
    const v = view({ online: false, isConnected: false, reconnectGaveUp: true, engineHealth: 'stalled' });
    assert.strictEqual(v.phase, 'disconnected');
    assert.strictEqual(v.label, 'No Internet');
});

// An exhausted budget is the one state the operator must act on — and the copy now
// points at Retry rather than demanding a full page reload.
check('an exhausted reconnect budget is actionable', () => {
    const v = view({ isConnected: false, reconnectGaveUp: true });
    assert.strictEqual(v.phase, 'disconnected');
    assert.strictEqual(v.actionable, true);
    assert.match(v.label, /retry/i);
});

check('an in-flight reconnect reports Recovering with its attempt number', () => {
    const v = view({ isConnected: false, isReconnecting: true, reconnectAttempt: 3 });
    assert.strictEqual(v.phase, 'recovering');
    assert.match(v.label, /attempt 3/);
    assert.strictEqual(v.actionable, false, 'auto-recovery is in progress — nothing to do');
});

// The cold-load path: never flash a loss before the first successful connection.
check('the initial connecting phase is not reported as a loss', () => {
    const v = view({ isConnected: false, hasConnectedOnce: false });
    assert.notStrictEqual(v.phase, 'disconnected');
});

check('a drop after a successful connection IS reported', () => {
    const v = view({ isConnected: false, hasConnectedOnce: true });
    assert.strictEqual(v.phase, 'disconnected');
});

// isRestoring drove no UI at all, so a mid-refresh rebuild was indistinguishable from a
// cold boot — the "refresh resets the UI" complaint.
check('rebuilding after a refresh reports Recovering', () => {
    const v = view({ isRestoring: true });
    assert.strictEqual(v.phase, 'recovering');
    assert.match(v.label, /restoring/i);
});

// The core new state: socket healthy, run live, engine silent.
check('a stalled engine is surfaced even though the socket is fine', () => {
    const v = view({ engineHealth: 'stalled' });
    assert.strictEqual(v.phase, 'stalled');
    assert.strictEqual(v.severity, 'critical');
    assert.strictEqual(v.actionable, true, 'the operator can still stop the session');
});

// Silence after the run ended is expected, not a fault.
check('a terminal run is never reported as stalled', () => {
    for (const status of ['STOPPED', 'FINISHED'] as const) {
        const v = view({ engineHealth: 'stalled', status });
        assert.strictEqual(v.phase, 'stopped', `${status} must report Stopped`);
    }
});

check('an idle dashboard is never reported as stalled', () => {
    const v = view({ engineHealth: 'stalled', status: 'IDLE' });
    assert.strictEqual(v.phase, 'connected');
});

// While the socket is down we cannot know the engine's state, so claiming either
// would be a guess — the transport fault is the honest thing to report.
check('a socket loss masks the engine verdict', () => {
    const v = view({ isConnected: false, hasConnectedOnce: true, engineHealth: 'stalled' });
    assert.strictEqual(v.phase, 'disconnected');
});

check('target-side problems are reported without claiming our own link is down', () => {
    const paused = view({ targetNetworkPhase: 'PAUSED_NETWORK' });
    assert.strictEqual(paused.phase, 'connected');
    assert.strictEqual(paused.severity, 'warning');
    assert.match(paused.label, /target/i);

    const degraded = view({ targetNetworkPhase: 'DEGRADED' });
    assert.strictEqual(degraded.severity, 'warning');
});

check('a slow link is the lowest-priority warning', () => {
    assert.strictEqual(view({ slowLink: true }).severity, 'warning');
    // Anything more serious wins over it.
    assert.strictEqual(view({ slowLink: true, isReconnecting: true, isConnected: false }).phase, 'recovering');
});

console.log(`connectionState.test.ts: ${passed} checks passed`);
