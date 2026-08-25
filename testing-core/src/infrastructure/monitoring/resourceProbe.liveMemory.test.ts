// sampleLiveMemory — proactive watchdog reads live cgroup usage (current, not peak) and
// flags overThreshold vs the env-tunable watchdog ratio. Self-executing (node:assert).
// Run: npx tsx src/infrastructure/monitoring/resourceProbe.liveMemory.test.ts

import assert from 'node:assert/strict';
import { sampleLiveMemory } from './resourceProbe.js';

const CGROUP = '/sys/fs/cgroup';
const reader = (used: number, limit: number) => (path: string): number | null => {
  if (path === `${CGROUP}/memory.max`) return limit;
  if (path === `${CGROUP}/memory.current`) return used;
  return null;
};

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('resourceProbe — sampleLiveMemory');

check('flags overThreshold at/above the default 0.85 ratio', () => {
  delete process.env.BUGSAFARI_HARNESS_MEM_WATCHDOG_RATIO;
  const mem = sampleLiveMemory(reader(900, 1000)); // 90%
  assert.equal(mem.overThreshold, true);
  assert.ok(Math.abs(mem.usedRatio - 0.9) < 1e-9);
  assert.match(mem.detail, /container memory/);
});

check('stays under threshold below the ratio', () => {
  delete process.env.BUGSAFARI_HARNESS_MEM_WATCHDOG_RATIO;
  const mem = sampleLiveMemory(reader(700, 1000)); // 70%
  assert.equal(mem.overThreshold, false);
});

check('honors the env ratio override', () => {
  process.env.BUGSAFARI_HARNESS_MEM_WATCHDOG_RATIO = '0.5';
  const mem = sampleLiveMemory(reader(600, 1000)); // 60% >= 50%
  assert.equal(mem.overThreshold, true);
  delete process.env.BUGSAFARI_HARNESS_MEM_WATCHDOG_RATIO;
});

check('falls back to host memory when no cgroup limit', () => {
  const mem = sampleLiveMemory(() => null);
  assert.match(mem.detail, /host memory/);
  assert.equal(typeof mem.overThreshold, 'boolean');
});

console.log(`\n${passed}/4 assertions passed.`);
