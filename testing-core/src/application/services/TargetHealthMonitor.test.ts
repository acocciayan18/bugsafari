// Deterministic self-check for the crash-escalation state machine: transient
// misses are absorbed (counter resets on any reachable probe); only a sustained
// outage of `crashThreshold` consecutive failures escalates, exactly once. No
// unit-test runner is configured, so run with
// `npx tsx src/application/services/TargetHealthMonitor.test.ts`.
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

console.log('TargetHealthMonitor — crash escalation only (no pause notification)');

async function run(): Promise<void> {
  await check('intermittent misses never crash (counter resets on recovery)', async () => {
    const probes = withProbes([false, true, false, true, false, true]);
    let crashed = 0;
    const m = new TargetHealthMonitor('http://t', 10, 5, {
      onCrash: () => { crashed += 1; },
    }, 3);
    await pump(m, 6);
    probes.restore();
    assert.equal(crashed, 0, 'a reachable probe between failures must reset the streak');
  });

  await check('sustained outage escalates to crash after 3 probes, once', async () => {
    const probes = withProbes([false, false, false, false, false]);
    let crashed = 0, crashFailures = 0;
    const m = new TargetHealthMonitor('http://t', 10, 5, {
      onCrash: (f) => { crashed += 1; crashFailures = f; },
    }, 3);
    await pump(m, 5); // extra pumps prove probing stopped after the crash
    probes.restore();
    assert.equal(crashed, 1, 'crash fires exactly once');
    assert.equal(crashFailures, 3, 'crash reported at the crash threshold');
  });
}

run().then(() => console.log(`\n${passed} checks passed`)).catch((e) => { console.error(e); process.exit(1); });
