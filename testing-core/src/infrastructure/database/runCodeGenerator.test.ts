import assert from 'node:assert/strict';
import { RUN_CODE_REGEX } from '../../../../shared/runCode.js';
import { createWithRunCodeRetry, generateRunCode, isDuplicateRunIdError } from './runCodeGenerator.js';

function dupError(): Error & { code: number; keyPattern: Record<string, number> } {
  return Object.assign(new Error('E11000 duplicate key error'), { code: 11000, keyPattern: { runId: 1 } });
}

// Minted codes satisfy the shared contract and carry real entropy.
const codes = new Set(Array.from({ length: 2000 }, generateRunCode));
assert.ok([...codes].every((c) => RUN_CODE_REGEX.test(c)), 'every minted code matches RUN_CODE_REGEX');
assert.ok([...codes].every((c) => c.length === 10), 'every minted code is RUN- plus exactly 6 hex chars');
// 2^24 space: ~0.12 expected collisions per 2000 mints, so 10 is a non-flaky ceiling.
assert.ok(codes.size >= 1990, `2000 mints stayed near-unique (got ${codes.size})`);

// Legacy 5-byte codes still validate; malformed ones do not.
assert.ok(RUN_CODE_REGEX.test('RUN-73412D8043'), 'legacy 10-hex code stays valid');
assert.ok(RUN_CODE_REGEX.test('RUN-A1B2C3'), 'canonical 6-hex code is valid');
assert.ok(!RUN_CODE_REGEX.test('RUN-a1b2c3'), 'lowercase rejected');
assert.ok(!RUN_CODE_REGEX.test('RUN-A1B2C'), 'too short rejected');

// Only a runId duplicate-key error is treated as a collision.
assert.ok(isDuplicateRunIdError(dupError()));
assert.ok(!isDuplicateRunIdError(Object.assign(new Error('dup'), { code: 11000, keyPattern: { userId: 1 } })));
assert.ok(!isDuplicateRunIdError(new Error('boom')));

// A colliding create is retried with a freshly minted code.
const attempted: string[] = [];
const created = await createWithRunCodeRetry(async (code) => {
  attempted.push(code);
  if (attempted.length < 3) throw dupError();
  return code;
}, 'RUN-SEED01');
assert.equal(attempted[0], 'RUN-SEED01', 'first attempt uses the supplied code');
assert.equal(attempted.length, 3);
assert.equal(created, attempted[2]);
assert.equal(new Set(attempted).size, 3, 'each retry mints a distinct code');

// A non-collision failure surfaces immediately, and exhausted retries rethrow.
await assert.rejects(createWithRunCodeRetry(async () => { throw new Error('network down'); }), /network down/);
await assert.rejects(createWithRunCodeRetry(async () => { throw dupError(); }), /E11000/);

console.log('✓ runCodeGenerator');
