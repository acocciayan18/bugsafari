// Self-executing checks for deferred network-fault promotion and the finding
// evidence contract. Run with
// `npx tsx "src/domain/services/verification/networkFaultArbiter.test.ts"`.

import assert from 'node:assert/strict';
import { NetworkFaultArbiter } from './networkFaultArbiter.js';
import { ensureFindingEvidence } from '../../../bugs/knowledgeBase/findingEvidence.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('\nNetwork fault arbiter + finding evidence contract\n');

const API = 'https://app.io/api/orders?page=2';

check('a runtime fault inside the window claims the parked failure', () => {
  const arbiter = new NetworkFaultArbiter<string>(2500);
  arbiter.hold(API, 'refused', 1000);
  assert.deepEqual(arbiter.claimCausedBy(2000), ['refused']);
});

check('a fault outside the window claims nothing', () => {
  const arbiter = new NetworkFaultArbiter<string>(2500);
  arbiter.hold(API, 'refused', 1000);
  assert.deepEqual(arbiter.claimCausedBy(9000), []);
  assert.equal(arbiter.size, 0, 'expired entries are dropped');
});

check('a fault BEFORE the failure never claims it', () => {
  const arbiter = new NetworkFaultArbiter<string>(2500);
  arbiter.hold(API, 'refused', 5000);
  assert.deepEqual(arbiter.claimCausedBy(4000), []);
});

check('a claimed failure is promoted once, never twice', () => {
  const arbiter = new NetworkFaultArbiter<string>(2500);
  arbiter.hold(API, 'refused', 1000);
  assert.equal(arbiter.claimCausedBy(1500).length, 1);
  assert.equal(arbiter.claimCausedBy(1600).length, 0);
});

check('multiple failures in the window are all claimed, oldest first', () => {
  const arbiter = new NetworkFaultArbiter<string>(2500);
  arbiter.hold(API, 'first', 1000);
  arbiter.hold(API, 'second', 1200);
  assert.deepEqual(arbiter.claimCausedBy(1800), ['first', 'second']);
});

check('the parked set is bounded', () => {
  const arbiter = new NetworkFaultArbiter<number>(60_000);
  for (let i = 0; i < 100; i += 1) arbiter.hold(API, i, 1000 + i);
  assert.ok(arbiter.size <= 24, `expected a bounded set, got ${arbiter.size}`);
});

// ── Evidence contract ─────────────────────────────────────────

check('missing CWE and remediation are filled from the knowledge base', () => {
  const result = ensureFindingEvidence({
    attribution: { bugClass: 'BOUNDARY_STRESS_FAILURE' },
    reproductionPlaybook: ['Step 1. Click the "Pay" button'],
  });
  assert.ok(result.attribution.cwe, 'a CWE is always present');
  assert.ok(result.advice.length > 0, 'remediation is always present');
  assert.deepEqual(result.filled, ['cwe', 'advice']);
});

check('an empty playbook is replaced with an actionable line', () => {
  const result = ensureFindingEvidence({
    attribution: { bugClass: 'BOUNDARY_STRESS_FAILURE', cwe: 'CWE-703' },
    advice: '// fix it',
    reproductionPlaybook: [],
    context: 'POST /api/orders',
  });
  assert.equal(result.reproductionPlaybook.length, 1);
  assert.match(result.reproductionPlaybook[0], /POST \/api\/orders/);
  assert.deepEqual(result.filled, ['reproductionPlaybook']);
});

check('a complete finding is passed through untouched', () => {
  const input = {
    attribution: { bugClass: 'NOSQL_INJECTION', cwe: 'CWE-943' },
    advice: '// parameterize the query',
    reproductionPlaybook: ['Step 1. Type "\' OR 1=1 --" into the "Email" field'],
  };
  const result = ensureFindingEvidence(input);
  assert.deepEqual(result.filled, []);
  assert.equal(result.advice, input.advice);
  assert.deepEqual(result.reproductionPlaybook, input.reproductionPlaybook);
  assert.equal(result.attribution.cwe, 'CWE-943');
});

check('an unknown bug class still yields CWE + remediation', () => {
  const result = ensureFindingEvidence({ attribution: { bugClass: '' }, reproductionPlaybook: ['Step 1. x'] });
  assert.ok(result.attribution.bugClass);
  assert.ok(result.attribution.cwe);
  assert.ok(result.advice.length > 0);
});

console.log(`\n${passed} arbiter/evidence checks passed.`);
