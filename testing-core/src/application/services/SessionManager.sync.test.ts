import assert from 'node:assert';
import type { EngineControl } from './SessionManager.js';

// Short grace so the abandon-teardown path can be exercised in real time. Must be
// set BEFORE the module evaluates its GRACE_MS constant, hence the dynamic import.
process.env.BUGSAFARI_SESSION_GRACE_MS = '40';
const { SessionManager } = await import('./SessionManager.js');

// Verifies the synchronization contract every live client depends on: attach/replay,
// browser-refresh grace + reconnect, abandon teardown, cross-operator ownership
// isolation, worker-failure terminal handshake, and engine→dashboard status/outcome
// mirroring. All DB-free (guest runs / null session ids skip persistStatus).

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

class FakeGateway {
  room: string | null = null;
  recorder: { record(kind: string, payload: unknown): void } | null = null;
  emitted: Array<{ type: string; meta?: Record<string, unknown> }> = [];
  reports: unknown[] = [];
  setRoom(room: string | null): void { this.room = room; }
  setRecorder(rec: FakeGateway['recorder']): void { this.recorder = rec; }
  // Mirror the real gateway: emit ALSO buffers via the recorder for replay.
  emitTelemetry(e: { type: string; meta?: Record<string, unknown> }): void {
    this.emitted.push(e);
    this.recorder?.record('telemetry', e);
  }
  emitForensicReport(r: unknown): void {
    this.reports.push(r);
    this.recorder?.record('forensic-report', r);
  }
}

let socketSeq = 0;
class FakeSocket {
  id = `sock-${++socketSeq}`;
  joined: string[] = [];
  emitted: Array<{ ev: string; payload: unknown }> = [];
  join(room: string): Promise<void> { this.joined.push(room); return Promise.resolve(); }
  emit(ev: string, payload: unknown): void { this.emitted.push({ ev, payload }); }
}

interface EngineCalls { pause: number; resume: number; stop: Array<string | undefined>; }
function fakeEngine(sessionId: string | null = null): EngineControl & { calls: EngineCalls } {
  const calls: EngineCalls = { pause: 0, resume: 0, stop: [] };
  return {
    calls,
    pause() { calls.pause++; },
    resume() { calls.resume++; },
    async stop(reason) { calls.stop.push(reason); },
    async settlePendingTasks() { /* no-op */ },
    getElapsedActiveTimeMs() { return 1234; },
    getLastSessionId() { return sessionId; },
  };
}

function newManager(): { sm: InstanceType<typeof SessionManager>; gw: FakeGateway } {
  const gw = new FakeGateway();
  const sm = new SessionManager();
  sm.initialize(gw as unknown as Parameters<InstanceType<typeof SessionManager>['initialize']>[0]);
  return { sm, gw };
}

// ── S1: attach replays the live buffer (a fresh client mid-run) ────────────────
{
  const { sm, gw } = newManager();
  sm.beginRun({ runToken: 'r1', runCode: 'RUN-000001', userId: null, targetUrl: 'http://t', timeboxMs: 1000, engine: fakeEngine() });
  gw.emitTelemetry({ type: 'ACTION', meta: { actionExecuted: 'CLICK', message: 'clicked' } });
  const sock = new FakeSocket();
  const ack = sm.attach(sock as never, 'r1', null);
  assert.strictEqual(ack.attached, true, 'S1: owner token attaches');
  assert.ok(ack.snapshot && ack.snapshot.telemetry.length >= 1, 'S1: buffered telemetry replayed on attach');
  assert.ok(sock.joined.includes('run:r1'), 'S1: socket joined the run room');
}

// ── S2: browser refresh — disconnect arms grace, reconnect restores RUNNING ────
{
  const { sm } = newManager();
  const engine = fakeEngine();
  sm.beginRun({ runToken: 'r2', runCode: 'RUN-000002', userId: null, targetUrl: 'http://t', timeboxMs: 1000, engine });
  const sock = new FakeSocket();
  sm.attach(sock as never, 'r2', null);
  sm.handleDisconnect(sock.id);
  assert.strictEqual(sm.getSnapshotFor(null, 'r2')?.status, 'INTERRUPTED', 'S2: last owner leaving -> INTERRUPTED');
  const sock2 = new FakeSocket();
  const ack2 = sm.attach(sock2 as never, 'r2', null);
  assert.strictEqual(ack2.snapshot?.status, 'RUNNING', 'S2: reconnect lifts INTERRUPTED back to RUNNING');
  await delay(80);
  assert.strictEqual(engine.calls.stop.length, 0, 'S2: reconnect cancelled the grace teardown (engine not stopped)');
}

// ── S3: abandoned refresh — grace expiry terminates the engine ─────────────────
{
  const { sm } = newManager();
  const engine = fakeEngine();
  sm.beginRun({ runToken: 'r3', runCode: 'RUN-000003', userId: null, targetUrl: 'http://t', timeboxMs: 1000, engine });
  const sock = new FakeSocket();
  sm.attach(sock as never, 'r3', null);
  sm.handleDisconnect(sock.id);
  await delay(90);
  assert.ok(engine.calls.stop.includes('disconnect-grace'), 'S3: grace expiry stopped the engine with disconnect-grace');
}

// ── S4: concurrent operators — ownership isolation ─────────────────────────────
{
  const { sm } = newManager();
  sm.beginRun({ runToken: 'r4', runCode: 'RUN-000004', userId: 'userA', targetUrl: 'http://t', timeboxMs: 1000, engine: fakeEngine(null) });
  // A foreign socket with the wrong token and no identity is rejected.
  const bad = sm.attach(new FakeSocket() as never, 'wrong-token', null);
  assert.ok(!bad.attached && bad.reason === 'not-owner', 'S4: wrong token cannot attach');
  // Ownership of an AUTHENTICATED run requires the identity to match. A run token
  // alone is no longer accepted: it outlives its run in the client's localStorage,
  // and a second account in the same browser would otherwise replay userA's run.
  assert.strictEqual(sm.ownsActiveRun('userB', undefined), false, 'S4: a different operator does not own the run');
  assert.strictEqual(sm.ownsActiveRun('userA', undefined), true, 'S4: owner by identity');
  assert.strictEqual(sm.ownsActiveRun('userA', 'r4'), true, 'S4: owner by identity + token');
  assert.strictEqual(sm.ownsActiveRun(null, 'r4'), false, 'S4: token alone cannot claim an authenticated run');
  assert.strictEqual(sm.ownsActiveRun('userB', 'r4'), false, "S4: userB cannot claim userA's run with a leaked token");
  const stolen = sm.attach(new FakeSocket() as never, 'r4', 'userB');
  assert.ok(!stolen.attached && stolen.reason === 'not-owner', "S4: userB cannot attach with userA's run token");
  // Two guests are never conflated by null===null.
  const { sm: sm2 } = newManager();
  sm2.beginRun({ runToken: 'g1', runCode: 'RUN-0000A1', userId: null, targetUrl: 'http://t', timeboxMs: 1000, engine: fakeEngine() });
  assert.strictEqual(sm2.ownsActiveRun(null, 'g2'), false, 'S4: a second guest (different token) is not the owner');
}

// ── S5: worker failure — terminal handshake + restorable terminal state ────────
{
  const { sm, gw } = newManager();
  sm.beginRun({ runToken: 'r5', runCode: 'RUN-000005', userId: null, targetUrl: 'http://t', timeboxMs: 1000, engine: fakeEngine() });
  gw.emitted.length = 0;
  sm.failRun('the worker executing this run stopped responding');
  assert.ok(gw.emitted.some((e) => e.type === 'EXCEPTION'), 'S5: EXCEPTION emitted on failure');
  assert.ok(
    gw.emitted.some((e) => e.meta?.actionExecuted === 'engine-status' && e.meta?.message === 'IDLE'),
    'S5: terminal IDLE handshake emitted so no client waits on a dead stream',
  );
  assert.strictEqual(sm.hasActiveRun(), false, 'S5: run released after failure');
  const term = sm.getSnapshotFor(null, 'r5');
  assert.strictEqual(term?.status, 'CRASHED', 'S5: terminal state restorable by a post-failure refresh');
}

// ── S6: engine telemetry mirrors termination outcome + pause/resume status ─────
{
  const { sm, gw } = newManager();
  sm.beginRun({ runToken: 'r6', runCode: 'RUN-000006', userId: null, targetUrl: 'http://t', timeboxMs: 1000, engine: fakeEngine() });
  gw.emitTelemetry({ type: 'ACTION', meta: { terminationOutcome: 'timebox', message: 'time budget reached' } });
  gw.emitTelemetry({ type: 'ACTION', meta: { actionExecuted: 'engine-paused', message: 'paused' } });
  let snap = sm.getSnapshotFor(null, 'r6');
  assert.strictEqual(snap?.terminationOutcome, 'timebox', 'S6: first termination outcome pinned');
  assert.strictEqual(snap?.status, 'PAUSED', 'S6: engine-paused mirrored to PAUSED');
  gw.emitTelemetry({ type: 'ACTION', meta: { actionExecuted: 'engine-resumed', message: 'resumed' } });
  snap = sm.getSnapshotFor(null, 'r6');
  assert.strictEqual(snap?.status, 'RUNNING', 'S6: engine-resumed mirrored to RUNNING');
}

// ── S7: operator controls drive the engine + transitional states ───────────────
{
  const { sm } = newManager();
  const engine = fakeEngine();
  sm.beginRun({ runToken: 'r7', runCode: 'RUN-000007', userId: null, targetUrl: 'http://t', timeboxMs: 1000, engine });
  await sm.pauseByOperator();
  assert.strictEqual(engine.calls.pause, 1, 'S7: pause reached the engine');
  assert.strictEqual(sm.getSnapshotFor(null, 'r7')?.status, 'PAUSED', 'S7: settled to PAUSED');
  sm.resumeByOperator();
  assert.strictEqual(engine.calls.resume, 1, 'S7: resume reached the engine');
  await sm.stopByOperator();
  assert.ok(engine.calls.stop.includes('operator'), 'S7: stop reached the engine with operator reason');
}

// ── S8: boot race — client attaches to a reserved room before the engine exists ─
{
  const { sm } = newManager();
  sm.reserveRun({ runToken: 'r8', runCode: 'RUN-000008', userId: null, targetUrl: 'http://t', timeboxMs: 1000 });
  const sock = new FakeSocket();
  const ack = sm.attach(sock as never, 'r8', null);
  assert.ok(ack.attached, 'S8: client attaches to the reserved room before the engine boots');
  sm.beginRun({ runToken: 'r8', runCode: 'RUN-000008', userId: null, targetUrl: 'http://t', timeboxMs: 1000, engine: fakeEngine() });
  assert.strictEqual(sm.getSnapshotFor(null, 'r8')?.status, 'RUNNING', 'S8: reservation upgraded to RUNNING, same room/buffers');
  assert.ok(sock.joined.includes('run:r8'), 'S8: the early socket is in the run room');
}

// ── S9: a late settle from a FINISHED run must not tear down the NEXT one ──────
// onTargetCrash reaches endRun after an await, by which time the operator may
// already have launched another run. Unbinding its room mid-boot left that run
// broadcasting unroutable, unbuffered telemetry for its whole timebox.
{
  const { sm, gw } = newManager();
  sm.beginRun({ runToken: 'r9a', runCode: 'RUN-0000A9', userId: null, targetUrl: 'http://t', timeboxMs: 1000, engine: fakeEngine() });
  assert.strictEqual(gw.room, 'run:r9a', 'S9: run A owns the wire');
  sm.endRun('COMPLETED', 'r9a');
  assert.strictEqual(gw.room, null, 'S9: run A released the wire on its own settle');

  sm.reserveRun({ runToken: 'r9b', runCode: 'RUN-0000B9', userId: null, targetUrl: 'http://t', timeboxMs: 1000 });
  assert.strictEqual(gw.room, 'run:r9b', 'S9: run B owns the wire');

  // The straggler finally lands, naming run A.
  sm.endRun('CRASH_COMPLETED', 'r9a');
  assert.strictEqual(gw.room, 'run:r9b', "S9: a stale settle must not unbind run B's room");
  assert.strictEqual(sm.hasActiveRun(), true, 'S9: run B is still live');
  assert.ok(gw.recorder !== null, 'S9: run B still buffers for reconnect');

  sm.failRun('stale worker notice', 'r9a');
  assert.strictEqual(gw.room, 'run:r9b', 'S9: a stale failRun is ignored too');
  assert.strictEqual(sm.hasActiveRun(), true, 'S9: run B survives a stale failRun');

  // An unscoped settle still works, so callers that cannot name their run are unchanged.
  sm.endRun('COMPLETED');
  assert.strictEqual(gw.room, null, 'S9: an unscoped settle releases the active run');
}

console.log('SessionManager.sync.test.ts passed');
process.exit(0);
