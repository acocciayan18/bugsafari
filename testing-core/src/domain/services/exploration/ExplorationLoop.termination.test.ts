// Termination attribution — a stop is only "the operator" when the operator asked.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with
// `npx tsx src/domain/services/exploration/ExplorationLoop.termination.test.ts`.

import assert from 'node:assert/strict';
import { ExplorationLoop } from './ExplorationLoop.js';
import type { ExplorationLoopDeps, RunResult, StopReason } from './types.js';

let passed = 0;
function check(name: string, fn: () => void | Promise<void>): void {
  void Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ✓ ${name}`);
  });
}

console.log('ExplorationLoop — termination attribution');

const milestones: string[] = [];

function makeLoop(stopReason: StopReason | null, stopRequested = stopReason !== null): ExplorationLoop {
  return new ExplorationLoop({
    isStopRequested: () => stopRequested,
    getStopReason: () => stopReason,
    telemetry: { emitMilestone: (m: string) => { milestones.push(m); }, emit: () => {} },
    runtimeMetrics: { failureCount: 0 },
    getLastKnownUrl: () => 'https://example.test',
    setFreeze: () => {},
    persistBrainSnapshot: async () => {},
  } as unknown as ExplorationLoopDeps);
}

function stopResultOf(loop: ExplorationLoop): RunResult {
  return (loop as unknown as { stopResult(): RunResult }).stopResult();
}

check('operator stop reports user-stopped', () => {
  const result = stopResultOf(makeLoop('operator'));
  assert.equal(result.outcome, 'user-stopped');
  assert.match(result.reason, /stopped by the operator/);
});

check('target crash is NOT attributed to the operator', () => {
  const result = stopResultOf(makeLoop('target-crash'));
  assert.equal(result.outcome, 'target-crash');
  assert.doesNotMatch(result.reason, /operator/);
});

check('grace-expiry stop reports abandoned', () => {
  const result = stopResultOf(makeLoop('disconnect-grace'));
  assert.equal(result.outcome, 'abandoned');
});

check('unattributed stop falls back to internal shutdown, never operator intent', () => {
  const result = stopResultOf(makeLoop(null, true));
  assert.equal(result.outcome, 'graceful-shutdown');
  assert.doesNotMatch(result.reason, /operator/);
});

// The regression this whole change exists to prevent: a browser that closed on its
// own is a genuine fault, not a clean operator stop.
check('browser-closed error with no stop requested stays an exception', async () => {
  const loop = makeLoop(null, false);
  const closedErr = new Error('Target page, context or browser has been closed');
  const page = { url: () => 'https://example.test' } as never;
  const result = await (loop as unknown as {
    handleIterationError(e: unknown, p: never, a: string | null, b: string | null): Promise<RunResult>;
  }).handleIterationError(closedErr, page, null, null);
  assert.equal(result.outcome, 'exception');
});

function iterationErrorOutcome(loop: ExplorationLoop, err: unknown): Promise<RunResult> {
  const page = { url: () => 'https://example.test' } as never;
  return (loop as unknown as {
    handleIterationError(e: unknown, p: never, a: string | null, b: string | null): Promise<RunResult>;
  }).handleIterationError(err, page, null, null);
}

// The false positive this fix targets: newPage-closed thrown as stop() tears the
// browser down must settle as a clean operator stop, never an exception finding.
check('browserContext.newPage closed during an operator stop settles clean, not an exception', async () => {
  const err = new Error('browserContext.newPage: Target page, context or browser has been closed');
  const result = await iterationErrorOutcome(makeLoop('operator'), err);
  assert.equal(result.outcome, 'user-stopped');
});

// "Execution context was destroyed" has no "closed" token — it used to leak through
// the old guard and be reported as an engine exception on stop.
check('execution-context-destroyed during a stop is suppressed, not an exception', async () => {
  const err = new Error('Execution context was destroyed, most likely because of a navigation');
  const result = await iterationErrorOutcome(makeLoop('disconnect-grace'), err);
  assert.equal(result.outcome, 'abandoned');
});

// A genuine target-app exception during a stop is NOT a lifecycle artifact and must
// still surface — the stop-guard must not swallow real crashes that race the stop.
check('a real app exception during a stop still reports as an exception', async () => {
  const err = new TypeError("Cannot read properties of undefined (reading 'id')");
  const result = await iterationErrorOutcome(makeLoop('operator'), err);
  assert.equal(result.outcome, 'exception');
});

// Client Render Freeze (CWE-835) must never fire from an intentional shutdown: a
// Stop/Pause aborts the bounded DOM scan mid-flight, so the resulting timeout/unsettled
// scan is a teardown artifact, not a target render loop. A genuine freeze while the
// session is actively running must still be reported.
interface FreezeCapture {
  loop: ExplorationLoop;
  registered: Array<{ attribution?: { bugClass?: string } }>;
  actions: string[];
}

function makeFreezeLoop(opts: { stopRequested?: boolean; paused?: boolean }): FreezeCapture {
  const registered: Array<{ attribution?: { bugClass?: string } }> = [];
  const actions: string[] = [];
  const loop = new ExplorationLoop({
    isStopRequested: () => opts.stopRequested ?? false,
    isPaused: () => opts.paused ?? false,
    getStopReason: () => null,
    registerConfirmedBug: (b: { attribution?: { bugClass?: string } }) => { registered.push(b); },
    telemetry: {
      emit: (_t: string, meta: { actionExecuted?: string }) => { if (meta?.actionExecuted) actions.push(meta.actionExecuted); },
      emitMilestone: () => {},
    },
  } as unknown as ExplorationLoopDeps);
  return { loop, registered, actions };
}

function reportFreeze(loop: ExplorationLoop): Promise<void> {
  const page = { url: () => 'https://example.test/dashboard', isClosed: () => false } as never;
  const ctx = { freezeReported: new Set<string>() } as never;
  return (loop as unknown as {
    reportClientFreeze(p: never, h: 'unsettled' | 'timeout', c: never): Promise<void>;
  }).reportClientFreeze(page, 'timeout', ctx);
}

check('render freeze during an operator stop is suppressed, not a finding', async () => {
  const cap = makeFreezeLoop({ stopRequested: true });
  await reportFreeze(cap.loop);
  assert.equal(cap.registered.length, 0);
  assert.ok(cap.actions.includes('render-freeze-suppressed-teardown'));
});

check('render freeze while paused is suppressed, not a finding', async () => {
  const cap = makeFreezeLoop({ paused: true });
  await reportFreeze(cap.loop);
  assert.equal(cap.registered.length, 0);
  assert.ok(cap.actions.includes('render-freeze-suppressed-teardown'));
});

check('a genuine render freeze while actively running still reports', async () => {
  const cap = makeFreezeLoop({});
  await reportFreeze(cap.loop);
  assert.equal(cap.registered.length, 1);
  assert.equal(cap.registered[0].attribution?.bugClass, 'CLIENT_RENDER_FREEZE');
});

setTimeout(() => console.log(`\n${passed} checks passed.`), 0);
