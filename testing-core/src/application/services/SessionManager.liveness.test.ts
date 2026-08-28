// Guards in-process engine-liveness reporting: the signal that tells a dashboard the
// engine went quiet instead of leaving it on a live status with a dead stream.
//
// The sharp edges are both directions of false reporting — announcing a stall for a run
// that is merely paused or just started, and failing to clear one once the engine
// recovers. Env is set before the dynamic import (module-level consts).
// Self-executing: `npx tsx src/application/services/SessionManager.liveness.test.ts`.

import assert from 'node:assert/strict';
import type { EngineControl } from './SessionManager.js';

// Tiny threshold so a real stall can be produced without sleeping for 45s.
process.env.BUGSAFARI_ENGINE_STALE_MS = '30';
const { SessionManager } = await import('./SessionManager.js');

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

interface HealthEvent { runToken: string; phase: string; lastHeartbeatAgeMs: number | null }

class FakeGateway {
  public room: string | null = null;
  public recorder: { record(kind: string, payload: unknown): void } | null = null;
  public readonly health: HealthEvent[] = [];
  public setRoom(room: string | null): void { this.room = room; }
  public setRecorder(rec: FakeGateway['recorder']): void { this.recorder = rec; }
  public emitTelemetry(e: unknown): void { this.recorder?.record('telemetry', e); }
  public emitRunHealth(payload: HealthEvent): void { this.health.push(payload); }
}

function fakeEngine(): EngineControl {
  return {
    pause() { /* no-op */ },
    resume() { /* no-op */ },
    async stop() { /* no-op */ },
    async settlePendingTasks() { /* no-op */ },
    getElapsedActiveTimeMs() { return 0; },
    getLastSessionId() { return null; },
  };
}

function newManager(): { sm: InstanceType<typeof SessionManager>; gw: FakeGateway } {
  const gw = new FakeGateway();
  const sm = new SessionManager();
  sm.initialize(gw as unknown as Parameters<InstanceType<typeof SessionManager>['initialize']>[0]);
  return { sm, gw };
}

function beginRun(sm: InstanceType<typeof SessionManager>, runToken: string): void {
  sm.beginRun({ runToken, runCode: 'RUN-LIVE01', userId: null, targetUrl: 'http://t', timeboxMs: 60_000, engine: fakeEngine() });
}

console.log('SessionManager — engine liveness');

// The common case must be silent. A healthy run that sweeps every 15s for a 10-minute
// timebox would otherwise emit 40 pointless "responding again" notices.
await check('a healthy run announces nothing', async () => {
  const { sm, gw } = newManager();
  beginRun(sm, 'r-live');
  sm.sweepEngineHealth();
  sm.sweepEngineHealth();
  assert.deepStrictEqual(gw.health, [], 'a run that never stopped emitting has no transition to report');
  await sm.stopByOperator('internal-shutdown').catch(() => undefined);
});

await check('a run that goes quiet is reported STALLED exactly once', async () => {
  const { sm, gw } = newManager();
  beginRun(sm, 'r-stall');
  await delay(50); // exceed the 30ms threshold with no emits
  sm.sweepEngineHealth();
  sm.sweepEngineHealth(); // still stalled — must not re-announce
  assert.strictEqual(gw.health.length, 1, 'the stall is an edge, not a repeating alarm');
  assert.strictEqual(gw.health[0].phase, 'stalled');
  assert.strictEqual(gw.health[0].runToken, 'r-stall');
  assert.ok((gw.health[0].lastHeartbeatAgeMs ?? 0) >= 30);
  await sm.stopByOperator('internal-shutdown').catch(() => undefined);
});

// Any engine emit is proof of life, so the banner must clear on the next sweep.
await check('a recovering run clears the stall', async () => {
  const { sm, gw } = newManager();
  beginRun(sm, 'r-recover');
  await delay(50);
  sm.sweepEngineHealth();
  assert.strictEqual(gw.health.at(-1)?.phase, 'stalled');

  sm.record('telemetry', { timestamp: new Date().toISOString(), type: 'ACTION', meta: { message: 'alive' } });
  sm.sweepEngineHealth();
  assert.strictEqual(gw.health.at(-1)?.phase, 'live', 'an emit is proof of life and must clear the banner');
  assert.strictEqual(gw.health.length, 2);
  await sm.stopByOperator('internal-shutdown').catch(() => undefined);
});

// A paused run is silent BY DESIGN. Reporting it as stalled would tell the operator the
// engine is broken every single time they pause for more than the threshold.
await check('a paused run is never reported stalled', async () => {
  const { sm, gw } = newManager();
  beginRun(sm, 'r-paused');
  await sm.pauseByOperator();
  await delay(50);
  sm.sweepEngineHealth();
  assert.deepStrictEqual(gw.health, [], 'silence while paused is expected, not a fault');
  const snapshot = sm.getActiveSnapshot();
  assert.strictEqual(snapshot?.engineHealth, 'live');
  await sm.stopByOperator('internal-shutdown').catch(() => undefined);
});

// The restore path recomputes liveness, so a refreshed client sees the stall too — it
// does not depend on having been connected when the transition was pushed.
await check('the restore snapshot carries the current liveness', async () => {
  const { sm } = newManager();
  beginRun(sm, 'r-snap');
  assert.strictEqual(sm.getActiveSnapshot()?.engineHealth, 'live');
  await delay(50);
  assert.strictEqual(sm.getActiveSnapshot()?.engineHealth, 'stalled', 'a refreshed client must learn about the stall');
  await sm.stopByOperator('internal-shutdown').catch(() => undefined);
});

await check('a sweep with no active run is a no-op', () => {
  const { sm, gw } = newManager();
  sm.sweepEngineHealth();
  assert.deepStrictEqual(gw.health, []);
});

console.log(`SessionManager.liveness.test.ts: ${passed} checks passed`);
