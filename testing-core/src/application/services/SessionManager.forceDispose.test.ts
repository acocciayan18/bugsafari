// SessionManager.forceRelease must hard-abort the browser via engine.forceDispose — a stop
// that never settled leaves run() wedged in an un-timeouted evaluate, so freeing only the
// admission slot would leak the browser (and its memory-buffering media) to the OOM cap.
// Self-executing (node:assert). Run: npx tsx src/application/services/SessionManager.forceDispose.test.ts

import assert from 'node:assert/strict';
import { SessionManager, type EngineControl } from './SessionManager.js';

class FakeGateway {
  room: string | null = null;
  recorder: { record(kind: string, payload: unknown): void } | null = null;
  setRoom(room: string | null): void { this.room = room; }
  setRecorder(rec: FakeGateway['recorder']): void { this.recorder = rec; }
  emitTelemetry(_e: unknown): void { /* no-op */ }
  emitForensicReport(_r: unknown): void { /* no-op */ }
}

function fakeEngine(): EngineControl & { forceDisposeCalls: number } {
  const state = { forceDisposeCalls: 0 } as EngineControl & { forceDisposeCalls: number };
  state.stop = async () => { /* never settles cleanly in the wedged case */ };
  state.settlePendingTasks = async () => { /* no-op */ };
  state.getElapsedActiveTimeMs = () => 1234;
  state.getLastSessionId = () => null;
  state.forceDispose = async () => { state.forceDisposeCalls += 1; };
  return state;
}

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('SessionManager — forceRelease hard-aborts the browser');

check('forceRelease invokes engine.forceDispose', () => {
  const gw = new FakeGateway();
  const sm = new SessionManager();
  sm.initialize(gw as unknown as Parameters<InstanceType<typeof SessionManager>['initialize']>[0]);
  const engine = fakeEngine();
  sm.beginRun({ runToken: 'rF', runCode: 'RUN-0000FD', userId: null, targetUrl: 'http://t', timeboxMs: 1000, engine });

  sm.forceRelease('stop did not settle', 'rF');

  assert.equal(engine.forceDisposeCalls, 1);
  assert.equal(sm.getActiveRunId(), null); // run torn down
});

console.log(`\n${passed}/1 assertions passed.`);
