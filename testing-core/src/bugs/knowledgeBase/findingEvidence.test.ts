// Self-executing checks for the finding-evidence promotion funnel: student-facing
// advice never leaks a source-code location, and a fault with no recorded interaction
// is marked unverified instead of presenting a fabricated reproduction step.
// Run with `npx tsx "src/bugs/knowledgeBase/findingEvidence.test.ts"`.

import assert from 'node:assert/strict';
import { ensureFindingEvidence } from './findingEvidence.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// A file:line / stack-frame shape that must never reach student-facing advice.
const CODE_LOCATION = /\bcode at\b|[\w./-]+\.(?:tsx?|jsx?|mjs):\d+/i;

console.log('findingEvidence — advice never leaks internal code');

check('specifics fold endpoint/field/payload into advice but never a source location', () => {
  const result = ensureFindingEvidence({
    attribution: { bugClass: 'NOSQL_INJECTION', cwe: 'CWE-943' },
    advice: 'Suggested fix: stop query operators from reaching the database',
    reproductionPlaybook: ['Step 1. Type "{\"$ne\":null}" into the "Email" field'],
    specifics: { method: 'POST', endpoint: '/api/login-nosql', statusCode: 200, field: 'email', payload: '{"$ne":null}' },
  });
  // Target-facing facts belong in the advice.
  assert.match(result.advice, /POST \/api\/login-nosql/);
  assert.match(result.advice, /email/);
  // The target app's own source location must not.
  assert.ok(!CODE_LOCATION.test(result.advice), `advice leaked a code location: ${result.advice}`);
  assert.ok(!/Starts in the code/i.test(result.advice));
});

console.log('\nfindingEvidence — no fabricated reproduction step');

check('a fault with no recorded interaction yields a single, explicitly unverified step', () => {
  const result = ensureFindingEvidence({
    attribution: { bugClass: 'RUNTIME_STABILITY_EXCEPTION', cwe: 'CWE-703' },
    advice: '// handle the exception',
    reproductionPlaybook: [],
    context: 'the /dashboard page',
  });
  assert.equal(result.reproductionPlaybook.length, 1, 'exactly one placeholder step');
  const step = result.reproductionPlaybook[0];
  assert.match(step, /Unverified/i, 'the step is clearly marked unverified');
  assert.match(step, /no interaction was recorded/i);
  assert.match(step, /the \/dashboard page/);
  assert.deepEqual(result.filled, ['reproductionPlaybook']);
});

check('with no context the unverified step falls back to the affected page', () => {
  const result = ensureFindingEvidence({
    attribution: { bugClass: 'RUNTIME_STABILITY_EXCEPTION', cwe: 'CWE-703' },
    reproductionPlaybook: [],
  });
  assert.match(result.reproductionPlaybook[0], /Unverified/i);
  assert.match(result.reproductionPlaybook[0], /the affected page/);
});

check('a recorded playbook is passed through untouched (no placeholder appended)', () => {
  const steps = ['Step 1. Navigate to /nosql-injection', 'Step 2. Type "x" into the input field'];
  const result = ensureFindingEvidence({
    attribution: { bugClass: 'NOSQL_INJECTION', cwe: 'CWE-943' },
    advice: 'Suggested fix: parameterize the query',
    reproductionPlaybook: steps,
  });
  assert.deepEqual(result.reproductionPlaybook, steps);
  assert.ok(!result.filled.includes('reproductionPlaybook'), 'nothing was fabricated');
});

console.log(`\n${passed} findingEvidence checks passed`);
