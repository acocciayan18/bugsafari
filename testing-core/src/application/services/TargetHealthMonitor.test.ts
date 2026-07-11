// Deterministic self-check for the reachability state machine: a transient miss
// below the threshold must NOT pause; only a sustained outage does; recovery
// fires once and only after a real outage. No unit-test runner is configured, so
// run with `npx tsx src/application/services/TargetHealthMonitor.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { TargetHealthMonitor } from './TargetHealthMonitor.js';

let passed = 0;
function check(name: string, fn: () => Promise<void>): Promise<void> {
  return fn().then(() => { passed += 1; console.log(`  ✓ ${name}`); });
}

// Drives probe verdicts from a queue instead of the network. `false` = network
// failure (fetch throws), `true` = reachable (HTTP 200).
function withProbes(verdicts: boolean[]): { restore: () => void } {
  const realFetch = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async () => {
    const ok = verdicts[Math.min(i, verdicts.length - 1)];
    i += 1;
    if (!ok) throw new Error('ECONNREFUSED');
    return { status: 200 } as Response;
  }) as typeof globalThis.fetch;
  return { restore: () => { globalThis.fetch = realFetch; } };
}

// Manually pump ticks (bypassing the interval timer) for deterministic control.
async function pump(m: TargetHealthMonitor, times: number): Promise<void> {
  for (let n = 0; n < times; n += 1) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (m as any).tick();
  }
}

console.log('TargetHealthMonitor — transient vs genuine outage');

async function run(): Promise<void> {
  await check('single transient miss does NOT pause (threshold 2)', async () => {
    const probes = withProbes([false, true, true]);
    let unreachable = 0, recovered = 0;
    const m = new TargetHealthMonitor('http://t', 10, 5, {
      onUnreachable: () => { unreachable += 1; },
      onRecovered: () => { recovered += 1; },
    }, 2);
    await pump(m, 3); // fail, then two successes
    probes.restore();
    assert.equal(unreachable, 0, 'lone blip must not report an outage');
    assert.equal(recovered, 0, 'no recovery without a prior outage');
    assert.equal(m.isHealthy(), true);
  });

  await check('sustained failures pause after threshold, recover once', async () => {
    const probes = withProbes([false, false, false, true]);
    let unreachable = 0, recovered = 0, lastFailures = 0;
    const m = new TargetHealthMonitor('http://t', 10, 5, {
      onUnreachable: () => { unreachable += 1; },
      onRecovered: (f) => { recovered += 1; lastFailures = f; },
    }, 2);
    await pump(m, 4); // 3 fails (pause at 2nd, keep firing), then success
    probes.restore();
    assert.equal(unreachable, 2, 'fires each tick once threshold crossed');
    assert.equal(recovered, 1, 'recovery fires exactly once');
    assert.equal(lastFailures, 3, 'reports total consecutive misses');
    assert.equal(m.isHealthy(), true);
  });
}

run().then(() => console.log(`\n${passed} checks passed`)).catch((e) => { console.error(e); process.exit(1); });
