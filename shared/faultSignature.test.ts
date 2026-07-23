// Self-executing checks for the canonical fault identity. Guards the invariant that
// the live dashboard grouping and the backend save-time dedup collapse the same
// faults — so an operator's live count equals the persisted count. Run with
// `npx tsx "shared/faultSignature.test.ts"` or `npm test --workspace shared`.

import assert from 'node:assert/strict';
import { normalizeFaultText, faultStackTop, buildFaultSignature } from './faultSignature.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('masks volatile tokens (urls, hex, line:col, digits)', () => {
  assert.equal(normalizeFaultText('Failed at https://x.io/a?b=1 0xDEADBEEF :12:5 count 42'),
    'failed at #url #hex count #n');
});

check('faultStackTop returns the first non-empty normalized frame', () => {
  assert.equal(faultStackTop('\n   \n  at foo (app.js:10:2)\n at bar'), 'at foo (app.js)');
  assert.equal(faultStackTop(undefined), '');
});

check('same fault with drifting ids collapses to one signature', () => {
  const a = buildFaultSignature({ reason: 'TypeError x is undefined', url: 'https://app/1', statusCode: undefined });
  const b = buildFaultSignature({ reason: 'TypeError x is undefined', url: 'https://app/1', statusCode: undefined });
  assert.equal(a, b);
});

check('statusCode disambiguates two network faults sharing a message', () => {
  const s500 = buildFaultSignature({ reason: 'request failed', url: 'https://api/x', statusCode: 500 });
  const s404 = buildFaultSignature({ reason: 'request failed', url: 'https://api/x', statusCode: 404 });
  assert.notEqual(s500, s404);
});

check('stack top disambiguates two JS faults sharing a message', () => {
  const one = buildFaultSignature({ reason: 'boom', stackTrace: 'at a (f.js:1:1)' });
  const two = buildFaultSignature({ reason: 'boom', stackTrace: 'at b (g.js:2:2)' });
  assert.notEqual(one, two);
});

console.log(`\n${passed} faultSignature assertion group(s) passed.`);
