// StabilityMonitor.armMemoryWatchdog — proactive poll that stops the run gracefully once
// the adaptive budget tier reaches 'abort', BEFORE the container OOM-kills the renderer.
// A lower 'degrade' tier sheds reclaimable load first (independent latch) and can recover.
// Fires each latch exactly once. Self-executing.
// Run: npx tsx src/domain/services/telemetry/StabilityMonitor.memoryWatchdog.test.ts

import assert from 'node:assert/strict';
import { StabilityMonitor } from './StabilityMonitor.js';
import type { StabilityMonitorDeps } from '../exploration/types.js';
import type { AdaptiveMemory } from '../../../infrastructure/monitoring/resourceProbe.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Recorder {
  aborts: Array<{ kind: string; detail: string }>;
  actions: string[];
  degrades: string[];
  stopping: boolean;
}

function build(rec: Recorder): StabilityMonitor {
  const deps = {
    telemetry: {
      emit: (_type: string, meta: { actionExecuted?: string }) => {
        if (meta.actionExecuted) rec.actions.push(meta.actionExecuted);
      },
    },
    isEngineStopping: () => rec.stopping,
    abortForHarnessFault: (kind: 'memory' | 'environment', detail: string) => {
      rec.aborts.push({ kind, detail });
    },
    onMemoryDegrade: (detail: string) => {
      rec.degrades.push(detail);
    },
  } as unknown as StabilityMonitorDeps;
  return new StabilityMonitor(deps);
}

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('StabilityMonitor — proactive memory watchdog');

const abort: AdaptiveMemory = { overThreshold: true, usedRatio: 0.9, tier: 'abort', detail: 'container memory 1450MB/1600MB (90%), budget 1600MB, activeRuns=1' };
const ok: AdaptiveMemory = { overThreshold: false, usedRatio: 0.5, tier: 'ok', detail: 'container memory 800MB/1600MB (50%), budget 1600MB, activeRuns=1' };
const degrade: AdaptiveMemory = { overThreshold: false, usedRatio: 0.8, tier: 'degrade', detail: 'container memory 1280MB/1600MB (80%), budget 1600MB, activeRuns=1' };
// Host-pressure abort: usage ratio is low, but the budget resolver already set tier=abort.
const hostAbort: AdaptiveMemory = { overThreshold: true, usedRatio: 0.4, tier: 'abort', detail: 'host-pressure — hostFree 340MB' };

const newRec = (): Recorder => ({ aborts: [], actions: [], degrades: [], stopping: false });

async function main(): Promise<void> {
  await check('fires exactly one memory abort when tier is abort', async () => {
    const rec = newRec();
    const monitor = build(rec);
    monitor.armMemoryWatchdog(10, () => abort);
    await sleep(60); // several ticks — the latch must keep it to one
    monitor.disposeMemoryWatchdog();
    assert.equal(rec.aborts.length, 1);
    assert.equal(rec.aborts[0].kind, 'memory');
    assert.ok(rec.actions.includes('harness-resource-abort'));
  });

  await check('never fires below the threshold (tier ok)', async () => {
    const rec = newRec();
    const monitor = build(rec);
    monitor.armMemoryWatchdog(10, () => ok);
    await sleep(40);
    monitor.disposeMemoryWatchdog();
    assert.equal(rec.aborts.length, 0);
    assert.equal(rec.degrades.length, 0);
  });

  await check('suppressed while the engine is already stopping', async () => {
    const rec = newRec();
    rec.stopping = true;
    const monitor = build(rec);
    monitor.armMemoryWatchdog(10, () => abort);
    await sleep(40);
    monitor.disposeMemoryWatchdog();
    assert.equal(rec.aborts.length, 0);
  });

  await check('degrade tier fires onMemoryDegrade once and does NOT abort', async () => {
    const rec = newRec();
    const monitor = build(rec);
    monitor.armMemoryWatchdog(10, () => degrade);
    await sleep(60); // many ticks — latch keeps degrade to one, never abort
    monitor.disposeMemoryWatchdog();
    assert.equal(rec.degrades.length, 1);
    assert.equal(rec.aborts.length, 0);
    assert.ok(rec.actions.includes('harness-memory-degrade'));
  });

  await check('degrade then abort → still exactly one abort (independent latches)', async () => {
    const rec = newRec();
    const monitor = build(rec);
    const samples = [degrade, degrade, abort, abort, abort];
    let i = 0;
    monitor.armMemoryWatchdog(10, () => samples[Math.min(i++, samples.length - 1)]);
    await sleep(120);
    monitor.disposeMemoryWatchdog();
    assert.equal(rec.degrades.length, 1);
    assert.equal(rec.aborts.length, 1);
  });

  await check('degrade that recovers to ok saves the run (0 aborts, 1 degrade)', async () => {
    const rec = newRec();
    const monitor = build(rec);
    const samples = [degrade, ok, ok, ok, ok];
    let i = 0;
    monitor.armMemoryWatchdog(10, () => samples[Math.min(i++, samples.length - 1)]);
    await sleep(120);
    monitor.disposeMemoryWatchdog();
    assert.equal(rec.degrades.length, 1);
    assert.equal(rec.aborts.length, 0);
  });

  await check('host-pressure abort fires despite a low usage ratio', async () => {
    const rec = newRec();
    const monitor = build(rec);
    monitor.armMemoryWatchdog(10, () => hostAbort);
    await sleep(40);
    monitor.disposeMemoryWatchdog();
    assert.equal(rec.aborts.length, 1);
    assert.equal(rec.aborts[0].kind, 'memory');
  });

  console.log(`\n${passed}/7 assertions passed.`);
}

void main();
