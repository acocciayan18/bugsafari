// Standalone deterministic test for the target-app credential scrub.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with `npx tsx src/domain/services/telemetry/credentialScrub.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { setScrubValues, clearScrubValues, scrubCredentials } from './credentialScrub.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  clearScrubValues();
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('credentialScrub — telemetry redaction of target-app credentials');

check('registered values are replaced wherever they appear', () => {
  setScrubValues(['hunter2secret', 'operator@example.com']);
  const out = scrubCredentials('login failed for operator@example.com using hunter2secret');
  assert.equal(out, 'login failed for [REDACTED_CREDENTIAL] using [REDACTED_CREDENTIAL]');
});

check('multiple occurrences of the same value are all replaced', () => {
  setScrubValues(['s3cretpass']);
  assert.equal(scrubCredentials('s3cretpass / s3cretpass'), '[REDACTED_CREDENTIAL] / [REDACTED_CREDENTIAL]');
});

check('regex metacharacters in a credential are treated literally', () => {
  setScrubValues(['a.*b(c)+$']);
  assert.equal(scrubCredentials('value=a.*b(c)+$ end'), 'value=[REDACTED_CREDENTIAL] end');
  // The pattern must NOT behave as a regex against text it would otherwise match.
  setScrubValues(['a.*b(c)+$']);
  assert.equal(scrubCredentials('aXXXbccc'), 'aXXXbccc');
});

check('values below the length floor are never registered', () => {
  // A short password would otherwise rewrite ordinary prose and destroy telemetry.
  setScrubValues(['abc']);
  assert.equal(scrubCredentials('abc is a common substring in abcdef'), 'abc is a common substring in abcdef');
});

check('clearing unregisters everything', () => {
  setScrubValues(['topsecretvalue']);
  clearScrubValues();
  assert.equal(scrubCredentials('topsecretvalue'), 'topsecretvalue');
});

check('empty input and empty registry are passthrough', () => {
  assert.equal(scrubCredentials(''), '');
  assert.equal(scrubCredentials('nothing registered'), 'nothing registered');
});

clearScrubValues();
console.log(`\ncredentialScrub: ${passed} checks passed.`);
