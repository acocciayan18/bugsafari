// Self-check for the engine-liveness decision layer — the guard against the
// false "No live frame received after 30 seconds" failure. The invariant under
// test: a run the BACKEND still reports as live can never be released, no matter
// how long its first frame takes. Run via `npm test`; exits non-zero on the first
// failed node:assert.

import assert from 'node:assert/strict';
import type { ActiveSessionSnapshot, RunLifecycleStatus } from '../../types';
import { classifyProbe, decideProbeAction, nextMissCount, MISSES_BEFORE_RELEASE, type LocalRunView } from './engineLiveness.js';

// The dashboard as the operator sees it while waiting on the first frame.
const booting: LocalRunView = { status: 'STARTING', hasLiveFrame: false };

const snapshot = (status: RunLifecycleStatus): ActiveSessionSnapshot => ({
    runId: 'RUN-TEST',
    runToken: 'token-1',
    ownerType: 'guest',
    targetUrl: 'https://app.test',
    currentUrl: 'https://app.test',
    status,
    terminationOutcome: null,
    terminationReason: null,
    startedAt: new Date(0).toISOString(),
    elapsedTimeMs: 0,
    timeboxMs: 600000,
    telemetry: [],
    reports: [],
    incidents: [],
    accessibility: [],
    browserConsole: [],
    lastFrame: null,
});

let passed = 0;
function check(name: string, fn: () => void): void {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

console.log('engineLiveness — the backend owns every failure verdict');

// The reported bug: a booting engine (STARTING, no frame yet) must never be
// declared failed, however many times we probe it.
check('a booting run is never released, however long it boots', () => {
    let misses = 0;
    for (let i = 0; i < 50; i++) {
        const outcome = classifyProbe(snapshot('STARTING'));
        misses = nextMissCount(outcome, misses);
        // Never 'release' — the dashboard simply keeps waiting on the backend.
        assert.notEqual(decideProbeAction(outcome, misses, booting), 'release');
    }
    assert.equal(misses, 0, 'a live answer must never accumulate misses');
});

check('every live lifecycle is classified alive and never released', () => {
    const live: RunLifecycleStatus[] = ['QUEUED', 'STARTING', 'RUNNING', 'PAUSING', 'PAUSED', 'STOPPING', 'INTERRUPTED'];
    for (const status of live) {
        const outcome = classifyProbe(snapshot(status));
        assert.equal(outcome.kind, 'alive', status);
        assert.notEqual(decideProbeAction(outcome, 99, booting), 'release', status);
    }
});

check('a backend-reported terminal state hydrates (never a client-invented one)', () => {
    const terminal: RunLifecycleStatus[] = ['COMPLETED', 'CRASHED', 'CRASH_COMPLETED', 'DISCONNECTED'];
    for (const status of terminal) {
        const outcome = classifyProbe(snapshot(status));
        assert.equal(outcome.kind, 'terminal', status);
        assert.equal(decideProbeAction(outcome, 0, booting), 'hydrate', status);
    }
});

console.log('\nengineLiveness — hydrate only when it corrects the dashboard');

check('a live run the dashboard already agrees with is left untouched', () => {
    const outcome = classifyProbe(snapshot('STARTING'));
    assert.equal(decideProbeAction(outcome, 0, booting), 'wait', 'must not clobber live socket buffers');
});

check('backend status drift is corrected', () => {
    // Backend advanced to RUNNING (→ ACTIVE) while the dashboard still shows STARTING.
    const outcome = classifyProbe(snapshot('RUNNING'));
    assert.equal(decideProbeAction(outcome, 0, booting), 'hydrate');
});

check('a buffered frame the live feed never received is recovered', () => {
    const withFrame = { ...snapshot('STARTING'), lastFrame: 'AAAA' };
    const outcome = classifyProbe(withFrame);
    assert.equal(decideProbeAction(outcome, 0, booting), 'hydrate');
    // Already showing a frame ⇒ nothing to correct.
    assert.equal(
        decideProbeAction(outcome, 0, { status: 'STARTING', hasLiveFrame: true }),
        'wait',
    );
});

console.log('\nengineLiveness — confirmed absence is the only release path');

check('a single missing snapshot waits (transient API blip is not a failure)', () => {
    const outcome = classifyProbe(null);
    const misses = nextMissCount(outcome, 0);
    assert.equal(misses, 1);
    assert.equal(decideProbeAction(outcome, misses, booting), 'wait');
});

check('release only after MISSES_BEFORE_RELEASE consecutive absences', () => {
    let misses = 0;
    let action: string = 'wait';
    for (let i = 0; i < MISSES_BEFORE_RELEASE; i++) {
        const outcome = classifyProbe(null);
        misses = nextMissCount(outcome, misses);
        action = decideProbeAction(outcome, misses, booting);
    }
    assert.equal(action, 'release');
});

check('one live answer resets an in-progress miss streak', () => {
    let misses = nextMissCount(classifyProbe(null), 0);
    assert.equal(misses, 1);
    misses = nextMissCount(classifyProbe(snapshot('RUNNING')), misses);
    assert.equal(misses, 0, 'a reachable live run must clear the streak');
    // The next absence therefore starts over and still cannot release on its own.
    misses = nextMissCount(classifyProbe(null), misses);
    assert.equal(decideProbeAction(classifyProbe(null), misses, booting), 'wait');
});

console.log(`\n${passed} checks passed`);
