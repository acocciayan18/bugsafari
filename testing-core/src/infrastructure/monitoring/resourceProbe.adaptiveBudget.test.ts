// resolveRunMemoryBudget / sampleAdaptiveMemory — adaptive per-run ceiling. Idle box ⇒
// budget ≈ cgroup (lone run gets room); busy peers / low host free ⇒ shrunk ⇒ abort.
// Self-executing (node:assert). Run: npx tsx src/infrastructure/monitoring/resourceProbe.adaptiveBudget.test.ts

import assert from 'node:assert/strict';
import { resolveRunMemoryBudget, sampleAdaptiveMemory } from './resourceProbe.js';

const MB = 1024 * 1024;
// cgroup reader: fixed used + limit in MB.
const cg = (usedMb: number, limitMb: number) => (p: string): number | null =>
  p.endsWith('memory.max') ? limitMb * MB : p.endsWith('memory.current') ? usedMb * MB : null;
// No cgroup limit, but a fixed used (memory.current) so thisRunUsed is deterministic.
const noLimit = (usedMb: number) => (p: string): number | null =>
  p.endsWith('memory.current') ? usedMb * MB : null;
const free = (mb: number) => (): number => mb * MB;

const MEM_ENV = [
  'BUGSAFARI_MEM_RESERVE_SYSTEM_MB',
  'BUGSAFARI_MEM_PER_WORKER_FLOOR_MB',
  'BUGSAFARI_MEM_SAFETY_RATIO',
  'BUGSAFARI_MEM_DEGRADE_RATIO',
  'BUGSAFARI_MEM_HOST_FREE_FLOOR_MB',
  'BUGSAFARI_HARNESS_MEM_WATCHDOG_RATIO',
];
const clearMemEnv = (): void => { for (const k of MEM_ENV) delete process.env[k]; };

let passed = 0;
function check(name: string, fn: () => void): void {
  clearMemEnv();
  fn();
  clearMemEnv();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('resourceProbe — adaptive per-run memory budget');

check('idle box: effective budget ≈ cgroup ceiling, tier ok', () => {
  const b = resolveRunMemoryBudget({ read: cg(400, 1600), hostFree: free(2500), activeRuns: 1 });
  assert.equal(b.tier, 'ok');
  assert.equal(b.cgroupLimitBytes, 1600 * MB);
  assert.equal(b.effectiveBudgetBytes, 1600 * MB); // min(cgroup, huge hostAware) == cgroup
  assert.ok(b.usedOfBudgetRatio < 0.5);
});

check('busy peers shrink the budget below the cgroup ceiling → abort', () => {
  // activeRuns 2 reserves an extra PER_WORKER_FLOOR; hostFree kept above the floor so
  // this isolates the peer-shrink path from the host-pressure override.
  const b = resolveRunMemoryBudget({ read: cg(1000, 1600), hostFree: free(500), activeRuns: 2 });
  assert.equal(b.hostPressure, false);
  assert.ok(b.effectiveBudgetBytes < 1600 * MB); // shrunk well under the ceiling
  assert.ok(b.usedOfBudgetRatio >= 0.85);
  assert.equal(b.tier, 'abort');
});

check('degrade band between DEGRADE_RATIO and abort ratio', () => {
  const b = resolveRunMemoryBudget({ read: cg(1280, 1600), hostFree: free(2000), activeRuns: 1 }); // 1280/1600 = 0.8
  assert.equal(b.tier, 'degrade');
  assert.ok(b.usedOfBudgetRatio >= 0.75 && b.usedOfBudgetRatio < 0.85);
});

check('host-pressure override aborts despite a low usage ratio', () => {
  // Zero the system reserve so hostAware stays large (low ratio), then starve host free
  // below the floor — only the override can force the abort here.
  process.env.BUGSAFARI_MEM_RESERVE_SYSTEM_MB = '0';
  const b = resolveRunMemoryBudget({ read: cg(400, 1600), hostFree: free(340), activeRuns: 1 });
  assert.equal(b.hostPressure, true);
  assert.ok(b.usedOfBudgetRatio < 0.85);
  assert.equal(b.tier, 'abort');
});

check('no cgroup limit: host-fallback still yields a valid tier', () => {
  const b = resolveRunMemoryBudget({ read: () => null, hostFree: free(4000), activeRuns: 1 });
  assert.equal(b.cgroupLimitBytes, null);
  assert.ok(Number.isFinite(b.effectiveBudgetBytes));
  assert.equal(b.tier, 'ok');
});

check('env override shifts the budget (safety ratio)', () => {
  const base = resolveRunMemoryBudget({ read: noLimit(400), hostFree: free(2000), activeRuns: 1 });
  process.env.BUGSAFARI_MEM_SAFETY_RATIO = '0.5';
  const tightened = resolveRunMemoryBudget({ read: noLimit(400), hostFree: free(2000), activeRuns: 1 });
  assert.ok(tightened.effectiveBudgetBytes < base.effectiveBudgetBytes);
});

check('more active runs → smaller budget at the same host free', () => {
  const lone = resolveRunMemoryBudget({ read: noLimit(400), hostFree: free(2000), activeRuns: 1 });
  const pair = resolveRunMemoryBudget({ read: noLimit(400), hostFree: free(2000), activeRuns: 2 });
  assert.ok(lone.effectiveBudgetBytes > pair.effectiveBudgetBytes);
});

check('sampleAdaptiveMemory maps abort tier to overThreshold', () => {
  const over = sampleAdaptiveMemory({ read: cg(1000, 1600), hostFree: free(500), activeRuns: 2 });
  assert.equal(over.tier, 'abort');
  assert.equal(over.overThreshold, true);
  const ok = sampleAdaptiveMemory({ read: cg(400, 1600), hostFree: free(2500), activeRuns: 1 });
  assert.equal(ok.overThreshold, false);
});

check('abort/degrade/ok tiers follow the configured cgroup limit (1600/2600/3600)', () => {
  // Lone run + huge host free ⇒ the cgroup ceiling binds, so the tier is purely ratio-of-limit.
  for (const L of [1600, 2600, 3600]) {
    const abort = resolveRunMemoryBudget({ read: cg(Math.round(0.86 * L), L), hostFree: free(8000), activeRuns: 1 });
    assert.equal(abort.tier, 'abort', `L=${L} @0.86`);
    assert.equal(abort.cgroupLimitBytes, L * MB, `L=${L} ceiling`);
    const degrade = resolveRunMemoryBudget({ read: cg(Math.round(0.8 * L), L), hostFree: free(8000), activeRuns: 1 });
    assert.equal(degrade.tier, 'degrade', `L=${L} @0.80`);
    const ok = resolveRunMemoryBudget({ read: cg(Math.round(0.5 * L), L), hostFree: free(8000), activeRuns: 1 });
    assert.equal(ok.tier, 'ok', `L=${L} @0.50`);
  }
});

console.log(`\n${passed}/9 assertions passed.`);
