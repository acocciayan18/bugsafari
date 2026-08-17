// Standalone deterministic test for the constraint-bypass finder's pure gates.
// Run with `npx tsx src/bugs/finders/constraintBypass.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { planFromType, correlatesToSubmission } from './constraintBypass.js';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Only the `type` field is read by planFromType.
const el = (type: string | undefined): InteractiveElement => ({ type }) as unknown as InteractiveElement;

function main(): void {
  console.log('constraintBypass — format-hint exclusion & response correlation');

  // Regression: textual format hints must NOT be reported. A bad email at a login
  // draws a 2xx error body the finder cannot tell from acceptance — the false positive.
  check('type=email is not a reportable constraint (was a CWE-602 false positive)', () => {
    assert.equal(planFromType(el('email')), null);
  });

  check('type=url is not a reportable constraint', () => {
    assert.equal(planFromType(el('url')), null);
  });

  check('the exclusion is case-insensitive', () => {
    assert.equal(planFromType(el('EMAIL')), null);
    assert.equal(planFromType(el('Url')), null);
  });

  // Kept: a numeric field is a data-type contract, not a cosmetic format hint.
  check('type=number stays a reportable data-type contract', () => {
    assert.deepEqual(planFromType(el('number')), { violating: 'x-not-a-number', constraint: 'type=number' });
    assert.deepEqual(planFromType(el('NUMBER')), { violating: 'x-not-a-number', constraint: 'type=number' });
  });

  check('plain text / missing type yields no plan', () => {
    assert.equal(planFromType(el('text')), null);
    assert.equal(planFromType(el(undefined)), null);
    assert.equal(planFromType(el('')), null);
  });

  // correlatesToSubmission gates which 2xx belongs to OUR submission.
  const noTarget = { actionPath: null, fieldName: null };

  check('a response whose body carries the injected payload correlates', () => {
    assert.equal(correlatesToSubmission('user=x-not-a-number', 'https://t/api', 'x-not-a-number', noTarget), true);
  });

  check('a URL-encoded payload in the body still correlates', () => {
    assert.equal(correlatesToSubmission('q=not%20a%20url', 'https://t/api', 'not a url', noTarget), true);
  });

  check('a response carrying the field name correlates', () => {
    assert.equal(correlatesToSubmission('{"quantity":0}', 'https://t/api', 'x-not-a-number', { actionPath: null, fieldName: 'quantity' }), true);
  });

  check('a response to the parent form action correlates', () => {
    assert.equal(correlatesToSubmission('', 'https://t/checkout', 'x-not-a-number', { actionPath: '/checkout', fieldName: null }), true);
  });

  check('unrelated traffic (no payload, no name, wrong path) does not correlate', () => {
    assert.equal(correlatesToSubmission('{"heartbeat":1}', 'https://t/telemetry', 'x-not-a-number', { actionPath: '/checkout', fieldName: 'quantity' }), false);
  });

  check('an empty payload never correlates by payload alone', () => {
    assert.equal(correlatesToSubmission('', 'https://t/api', '', noTarget), false);
  });

  console.log(`\nconstraintBypass: ${passed} checks passed.`);
}

main();
