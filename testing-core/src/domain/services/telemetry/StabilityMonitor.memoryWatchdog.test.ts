// StabilityMonitor.armMemoryWatchdog — proactive poll that stops the run gracefully once
// live memory crosses the watchdog ratio, BEFORE the container OOM-kills the renderer.
// Fires exactly once (latch) and never fires below the threshold. Self-executing.
// Run: npx tsx src/domain/services/telemetry/StabilityMonitor.memoryWatchdog.test.ts

import assert from 'node:assert/strict';
import { StabilityMonitor } from './StabilityMonitor.js';
import type { StabilityMonitorDeps } from '../exploration/types.js';
import type { LiveMemory } from '../../../infrastructure/monitoring/resourceProbe.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Recorder {
  aborts: Array<{ kind: string; detail: string }>;
  actions: string[];
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

const over: LiveMemory = { overThreshold: true, usedRatio: 0.9, detail: 'container memory 990MB/1100MB (90%), worker RSS 800MB' };
const under: LiveMemory = { overThreshold: false, usedRatio: 0.5, detail: 'container memory 550MB/1100MB (50%), worker RSS 400MB' };

async function main(): Promise<void> {
  await check('fires exactly one memory abort when over threshold', async () => {
    const rec: Recorder = { aborts: [], actions: [], stopping: false };
    const monitor = build(rec);
    monitor.armMemoryWatchdog(10, () => over);
    await sleep(60); // several ticks — the latch must keep it to one
    monitor.disposeMemoryWatchdog();
    assert.equal(rec.aborts.length, 1);
    assert.equal(rec.aborts[0].kind, 'memory');
    assert.ok(rec.actions.includes('harness-resource-abort'));
  });

  await check('never fires below the threshold', async () => {
    const rec: Recorder = { aborts: [], actions: [], stopping: false };
    const monitor = build(rec);
    monitor.armMemoryWatchdog(10, () => under);
    await sleep(40);
    monitor.disposeMemoryWatchdog();
    assert.equal(rec.aborts.length, 0);
  });

  await check('suppressed while the engine is already stopping', async () => {
    const rec: Recorder = { aborts: [], actions: [], stopping: true };
    const monitor = build(rec);
    monitor.armMemoryWatchdog(10, () => over);
    await sleep(40);
    monitor.disposeMemoryWatchdog();
    assert.equal(rec.aborts.length, 0);
  });

  console.log(`\n${passed}/3 assertions passed.`);
}

void main();
