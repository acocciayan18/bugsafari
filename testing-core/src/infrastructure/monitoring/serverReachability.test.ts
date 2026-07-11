// Deterministic self-check for the isolated reachability verdict shared by the
// health monitor and the heartbeat freeze detector. Run with
// `npx tsx src/infrastructure/monitoring/serverReachability.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { isServerReachable } from './serverReachability.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function stubFetch(impl: () => Promise<{ status: number }>): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => impl()) as unknown as typeof globalThis.fetch;
  return () => { globalThis.fetch = real; };
}

console.log('serverReachability — isolated Node HTTP verdict');

async function run(): Promise<void> {
  await check('200 → reachable', async () => {
    const restore = stubFetch(async () => ({ status: 200 }));
    assert.equal(await isServerReachable('http://t', 50), true);
    restore();
  });

  await check('404 → reachable (server answered)', async () => {
    const restore = stubFetch(async () => ({ status: 404 }));
    assert.equal(await isServerReachable('http://t', 50), true);
    restore();
  });

  await check('500 → unreachable (main document erroring)', async () => {
    const restore = stubFetch(async () => ({ status: 500 }));
    assert.equal(await isServerReachable('http://t', 50), false);
    restore();
  });

  await check('network throw → unreachable', async () => {
    const restore = stubFetch(async () => { throw new Error('ECONNREFUSED'); });
    assert.equal(await isServerReachable('http://t', 50), false);
    restore();
  });
}

run().then(() => console.log(`\n${passed} checks passed`)).catch((e) => { console.error(e); process.exit(1); });
