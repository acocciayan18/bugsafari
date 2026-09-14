// Self-executing checks: the replay-gate policy truth table and its two exempt
// sub-cases. Each assertion names the recurrence it guards against.
// Run directly: `npx tsx "src/domain/services/verification/reproductionGate.test.ts"`.

import assert from 'node:assert/strict';
import { reproductionStateFor, isExempt } from './reproductionGate.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('a settled rate is authoritative: >0 REPRODUCED, 0 NOT_REPRODUCED', () => {
  assert.equal(reproductionStateFor({ faultType: 'EXCEPTION' }, 1), 'REPRODUCED');
  assert.equal(reproductionStateFor({ faultType: 'EXCEPTION' }, 0.34), 'REPRODUCED');
  assert.equal(reproductionStateFor({ faultType: 'EXCEPTION' }, 0), 'NOT_REPRODUCED');
});

check('an unsettled non-exempt candidate is PENDING (the primary false-CONFIRMED guard)', () => {
  assert.equal(reproductionStateFor({ faultType: 'CONSOLE' }), 'PENDING');
  assert.equal(reproductionStateFor({ faultType: 'FREEZE' }), 'PENDING');
  assert.equal(reproductionStateFor({ faultType: 'EXCEPTION', hasStackTrace: false }), 'PENDING');
});

check('a deterministic crash is EXEMPT: EXCEPTION+stack or NETWORK 5xx', () => {
  assert.equal(reproductionStateFor({ faultType: 'EXCEPTION', hasStackTrace: true }), 'EXEMPT');
  assert.equal(reproductionStateFor({ faultType: 'NETWORK', statusCode: 500 }), 'EXEMPT');
  assert.equal(reproductionStateFor({ faultType: 'NETWORK', statusCode: 503 }), 'EXEMPT');
});

check('a NETWORK non-5xx is not a deterministic crash', () => {
  assert.equal(reproductionStateFor({ faultType: 'NETWORK', statusCode: 404 }), 'PENDING');
  assert.equal(reproductionStateFor({ faultType: 'NETWORK' }), 'PENDING');
});

check('an oracle-proof finding is EXEMPT (guards the recall regression PLAN_01 missed)', () => {
  // Reflected-XSS / behavioral-proof findings never replay, so a naive pending-cap
  // would strand them below CONFIRMED forever. Exemption keeps their verdict.
  assert.equal(reproductionStateFor({ faultType: 'CONSOLE', oracleProof: true }), 'EXEMPT');
  assert.ok(isExempt({ faultType: 'FREEZE', oracleProof: true }));
});

check('a settled negative demotes even an exempt class', () => {
  // Exemption covers only the pending window; a replay that runs and fails still wins.
  assert.equal(reproductionStateFor({ faultType: 'EXCEPTION', hasStackTrace: true }, 0), 'NOT_REPRODUCED');
  assert.equal(reproductionStateFor({ faultType: 'NETWORK', statusCode: 500 }, 0), 'NOT_REPRODUCED');
});

console.log(`\n${passed} assertions passed.`);
