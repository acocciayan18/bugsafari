// Pause/Stop control accuracy + latency guards. Self-executing script (no unit
// runner in this package): `npx tsx src/domain/services/exploration/ExplorationEngine.control.test.ts`.
// Methods are poked via a prototype-bypass instance so the heavy constructor is
// never invoked — only the private fields each method reads are seeded.

import assert from 'node:assert/strict';
import { ExplorationEngine } from './ExplorationEngine.js';
import type { RunResult, StopReason } from './types.js';

let passed = 0;
function check(name: string, fn: () => void | Promise<void>): void {
  void Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ✓ ${name}`);
  });
}

type Bare = Record<string, unknown>;
function bareEngine(fields: Bare): ExplorationEngine {
  return Object.assign(Object.create(ExplorationEngine.prototype), fields) as ExplorationEngine;
}
function resolveTerminationOf(e: ExplorationEngine, result: RunResult | null): { outcome: string; reason: string } {
  return (e as unknown as { resolveTermination(r: RunResult | null): { outcome: string; reason: string } }).resolveTermination(result);
}

console.log('ExplorationEngine — pause/stop control');

// A graceful-shutdown verdict the loop returned WHILE an operator stop was recorded
// is that stop's teardown — must re-attribute to the operator, not stay Halted.
check('graceful-shutdown under an operator stop re-attributes to user-stopped', () => {
  const e = bareEngine({ stopReason: 'operator' as StopReason });
  const out = resolveTerminationOf(e, { completed: false, reason: 'Unrecoverable invalid browser state.', outcome: 'graceful-shutdown' } as RunResult);
  assert.equal(out.outcome, 'user-stopped');
});

check('graceful-shutdown with NO stop recorded stays graceful-shutdown', () => {
  const e = bareEngine({ stopReason: null });
  const out = resolveTerminationOf(e, { completed: false, reason: 'x', outcome: 'graceful-shutdown' } as RunResult);
  assert.equal(out.outcome, 'graceful-shutdown');
});

// The override is scoped to graceful-shutdown only — a real timebox verdict must
// never be masked even when a stop was also recorded.
check('a timebox verdict is never overridden by a recorded stop', () => {
  const e = bareEngine({ stopReason: 'operator' as StopReason });
  const out = resolveTerminationOf(e, { completed: false, reason: 'time up', outcome: 'timebox' } as RunResult);
  assert.equal(out.outcome, 'timebox');
});

// Pause latency: a pure PAUSE must NOT block the settle on reproduction-replay drain.
check('settlePendingTasks on PAUSE skips the reproduction-replay drain', async () => {
  const calls: string[] = [];
  const e = bareEngine({
    isStopRequested: false,
    loopActive: false, // parked already, so the bounded pause-wait exits immediately
    isPaused: true,
    reproductionProbe: { settle: async () => { calls.push('probe.settle'); }, dispose: () => { calls.push('probe.dispose'); } },
    asyncTasks: { settle: async () => { calls.push('async.settle'); } },
  });
  await (e as unknown as { settlePendingTasks(): Promise<void> }).settlePendingTasks();
  assert.ok(!calls.includes('probe.settle'), 'replay drain must be off the pause path');
  assert.ok(!calls.includes('probe.dispose'), 'pause must not dispose the probe');
  assert.ok(calls.includes('async.settle'), 'forensic/DB flush still runs on pause');
});

// A STOP still disposes + drains the probe so no sidecar replay outlives the run.
check('settlePendingTasks on STOP disposes and drains the probe', async () => {
  const calls: string[] = [];
  const e = bareEngine({
    isStopRequested: true,
    reproductionProbe: { settle: async () => { calls.push('probe.settle'); }, dispose: () => { calls.push('probe.dispose'); } },
    asyncTasks: { settle: async () => { calls.push('async.settle'); } },
  });
  await (e as unknown as { settlePendingTasks(): Promise<void> }).settlePendingTasks();
  assert.deepEqual(calls.sort(), ['async.settle', 'probe.dispose', 'probe.settle']);
});

// ── Timebox boundary: isTimeboxExceeded across every selectable duration ──────
// Seeds only the fields the method reads (elapsedActiveTimeMs / timeboxMs / isPaused)
// via the prototype-bypass, so each preset's exact boundary is exercised cheaply.
function timeboxExceeded(timeboxMs: number, elapsed: number, isPaused = false): boolean {
  const e = bareEngine({ elapsedActiveTimeMs: elapsed, timeboxMs, isPaused });
  return (e as unknown as { isTimeboxExceeded(): boolean }).isTimeboxExceeded();
}

for (const minutes of [5, 10, 20, 30]) {
  const timeboxMs = minutes * 60_000;
  check(`${minutes}m: not exceeded one ms under the limit`, () => {
    assert.equal(timeboxExceeded(timeboxMs, timeboxMs - 1), false);
  });
  check(`${minutes}m: exceeded exactly at the limit`, () => {
    assert.equal(timeboxExceeded(timeboxMs, timeboxMs), true);
  });
  check(`${minutes}m: never exceeded while paused, even past the limit`, () => {
    assert.equal(timeboxExceeded(timeboxMs, timeboxMs + 5_000, true), false);
  });
}

setTimeout(() => console.log(`\n${passed} checks passed.`), 0);
