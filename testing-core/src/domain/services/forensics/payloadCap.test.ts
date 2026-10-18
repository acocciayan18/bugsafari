// Self-executing checks for capPayload — the stored-payload size bound.
// Run: `npx tsx src/domain/services/forensics/payloadCap.test.ts`.

import assert from 'node:assert/strict';
import { capPayload } from './findingProjection.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('payloadCap — bound oversized stored payloads');

check('a small payload passes through verbatim', () => {
  assert.equal(capPayload('A'.repeat(20)), 'A'.repeat(20));
  assert.equal(capPayload('{"a":1}'), '{"a":1}');
});

check('an undefined/empty payload becomes an empty string', () => {
  assert.equal(capPayload(undefined), '');
  assert.equal(capPayload(''), '');
});

check('a payload at the 4096 boundary is still verbatim', () => {
  const atLimit = 'A'.repeat(4096);
  assert.equal(capPayload(atLimit), atLimit);
});

check('the fb-test.txt 1,000,031-char payload is capped to a descriptor with the true length', () => {
  const huge = 'A'.repeat(1_000_031);
  const capped = capPayload(huge);
  assert.ok(capped.length < 1000, 'descriptor is compact');
  assert.match(capped, /^\[payload capped\] len=1000031 hash=[0-9a-z]+ sample="A+…"$/);
  assert.ok(capped.includes('len=1000031'), 'preserves the exact length');
});

check('two runs of the same oversized payload cap to the same descriptor (stable hash)', () => {
  const a = capPayload('B'.repeat(50_000));
  const b = capPayload('B'.repeat(50_000));
  assert.equal(a, b);
  // A different payload of the same length yields a different hash.
  const c = capPayload('C'.repeat(50_000));
  assert.notEqual(a, c);
});

console.log(`\npayloadCap: ${passed} checks passed.`);
