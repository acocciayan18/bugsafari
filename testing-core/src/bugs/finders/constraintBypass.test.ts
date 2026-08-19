// Standalone deterministic test for the constraint-bypass finder's pure gates.
// Run with `npx tsx src/bugs/finders/constraintBypass.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { planFromType, planFromSnapshot, snapshotFromElement, correlatesToSubmission } from './constraintBypass.js';
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

  // planFromSnapshot derives the violation without the browser — maxlength no longer
  // depends on checkValidity (which never trips tooLong on a scripted value).

  // Regression: a maxlength-only field must yield a plan. checkValidity dropped it before.
  check('maxlength-only field yields an over-length maxlength plan', () => {
    const plan = planFromSnapshot({ maxLength: 8, pattern: null, required: false });
    assert.deepEqual(plan, { violating: 'A'.repeat(40), constraint: 'maxlength=8' });
    assert.equal(plan?.violating.length, 8 + 32);
  });

  check('required-only field yields an empty-value required plan', () => {
    assert.deepEqual(planFromSnapshot({ maxLength: null, pattern: null, required: true }), {
      violating: '',
      constraint: 'required',
    });
  });

  check('a pattern the canned value violates yields a pattern plan', () => {
    assert.deepEqual(planFromSnapshot({ maxLength: null, pattern: '[0-9]+', required: false }), {
      violating: '!bypass 123!',
      constraint: 'pattern=[0-9]+',
    });
  });

  // A pattern the canned value satisfies must NOT manufacture a false plan.
  check('a pattern the canned value satisfies falls through', () => {
    assert.equal(planFromSnapshot({ maxLength: null, pattern: '.*', required: false }), null);
  });

  check('no constraints yields no plan', () => {
    assert.equal(planFromSnapshot({ maxLength: null, pattern: null, required: false }), null);
    assert.equal(planFromSnapshot(null), null);
  });

  // Priority: pattern outranks maxlength outranks required.
  check('pattern wins when pattern + maxlength + required all present', () => {
    assert.deepEqual(planFromSnapshot({ maxLength: 8, pattern: '[0-9]+', required: true }), {
      violating: '!bypass 123!',
      constraint: 'pattern=[0-9]+',
    });
  });

  // snapshotFromElement reads the PARSE-TIME constraints, so a plan survives a fuzz action
  // that stripped the live DOM before the post-action sweep ran (the real-world miss).
  const withConstraints = (c: Partial<InteractiveElement>): InteractiveElement => c as InteractiveElement;

  check('a parse-time maxlength yields a snapshot even when the live DOM is stripped', () => {
    const snap = snapshotFromElement(withConstraints({ maxLength: 8 }));
    assert.deepEqual(snap, { maxLength: 8, pattern: null, required: false });
    assert.deepEqual(planFromSnapshot(snap), { violating: 'A'.repeat(40), constraint: 'maxlength=8' });
  });

  check('a parse-time required flag yields a required snapshot', () => {
    assert.deepEqual(snapshotFromElement(withConstraints({ required: true })), {
      maxLength: null,
      pattern: null,
      required: true,
    });
  });

  check('a parse-time pattern yields a pattern snapshot', () => {
    assert.deepEqual(snapshotFromElement(withConstraints({ pattern: '[0-9]+' })), {
      maxLength: null,
      pattern: '[0-9]+',
      required: false,
    });
  });

  check('an element with no captured constraint yields null (falls back to live DOM)', () => {
    assert.equal(snapshotFromElement(withConstraints({})), null);
    assert.equal(snapshotFromElement(withConstraints({ maxLength: 0, pattern: '', required: false })), null);
  });

  console.log(`\nconstraintBypass: ${passed} checks passed.`);
}

main();
