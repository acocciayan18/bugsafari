// Self-executing checks for the run-scoped network buffer's global dedup — the same
// method+url+status collapse the live tab and buildSavedNetworkRows apply, so the
// saved report's repeat counts match what the operator watched live.
// Run with `npx tsx "src/infrastructure/monitoring/NetworkLogStore.test.ts"`.

import assert from 'node:assert/strict';
import { NetworkLogStore } from './NetworkLogStore.js';
import type { NetworkLogEntry } from '../../../../shared/types.js';

const row = (url: string, statusCode?: number, durationMs?: number): NetworkLogEntry =>
  ({ timestamp: '2026-08-13T00:00:00.000Z', method: 'GET', url, statusCode, durationMs, ok: false });

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('identical rows interleaved with others still collapse to one repeatCount', () => {
  NetworkLogStore.reset();
  NetworkLogStore.push(row('https://app.io/api/a', 500));
  NetworkLogStore.push(row('https://app.io/api/b', 404));
  NetworkLogStore.push(row('https://app.io/api/a', 500, 42)); // non-consecutive repeat
  const snap = NetworkLogStore.snapshot();
  assert.equal(snap.length, 2);
  const a = snap.find((e) => e.url.endsWith('/a'))!;
  assert.equal(a.repeatCount, 2);
  assert.equal(a.durationMs, 42, 'latest duration wins');
});

check('a different status for the same url is a distinct row', () => {
  NetworkLogStore.reset();
  NetworkLogStore.push(row('https://app.io/r2', 200));
  NetworkLogStore.push(row('https://app.io/r2', undefined));
  assert.equal(NetworkLogStore.snapshot().length, 2);
});

NetworkLogStore.reset();
console.log(`\n${passed} NetworkLogStore checks passed.`);
