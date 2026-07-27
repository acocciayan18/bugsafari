// Standalone deterministic tests for the target-auth narration. Self-executing:
// run with `npx tsx src/domain/services/auth/authNarration.test.ts`.
// Exits non-zero on the first failed assertion.
//
// These guard the two properties the login stream depends on: no credential
// material in any message, and no two phases reading alike (the socket gateway's
// deduper drops consecutive events sharing type|actionExecuted|message).

import assert from 'node:assert/strict';
import { scrubSelectors } from '../../../../../shared/reproduction.js';
import {
  AUTH_ACTION,
  controlPhrase,
  describeAffordanceClick,
  describeAuthFailed,
  describeAuthStart,
  describeAuthSucceeded,
  describeCredentialsEntered,
  describeDiscovering,
  describeFormDetected,
  describeNavigating,
  describeRouteProbe,
  describeSubmitted,
  describeVerifying,
  safeUrl,
} from './authNarration.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const APP = 'https://app.test/account/login';

// One message per phase, in the order a credentials login emits them.
const sequence = [
  describeAuthStart('credentials'),
  describeNavigating(APP),
  describeDiscovering(APP),
  describeAffordanceClick('Sign In', APP),
  describeRouteProbe('https://app.test/login'),
  describeFormDetected(APP),
  describeCredentialsEntered(),
  describeSubmitted('Log in'),
  describeVerifying(),
  describeAuthSucceeded('https://app.test/dashboard'),
  describeAuthFailed('the login form reported invalid credentials'),
];

console.log('authNarration — the login reads as a sequence, not a repeated line');

check('every phase produces a distinct message', () => {
  assert.equal(new Set(sequence).size, sequence.length);
});

check('every phase has its own action code', () => {
  const codes = Object.values(AUTH_ACTION);
  assert.equal(new Set(codes).size, codes.length);
});

check('no auth code is empty or collides with an engine lifecycle code', () => {
  const reserved = new Set(['system-status', 'engine-milestone', 'engine-status', 'engine-stopped']);
  for (const code of Object.values(AUTH_ACTION)) {
    assert.ok(code.startsWith('auth-'), `should be namespaced: ${code}`);
    assert.equal(reserved.has(code), false, `should not collide: ${code}`);
  }
});

check('probing two routes reads differently, so neither is deduped away', () => {
  assert.notEqual(describeRouteProbe('https://app.test/login'), describeRouteProbe('https://app.test/signin'));
});

console.log('\nauthNarration — nothing confidential reaches an operator surface');

check('a URL is reduced to origin and path, dropping any token in the query', () => {
  assert.equal(safeUrl('https://idp.test/authorize?token=SECRET123&state=x#frag'), 'https://idp.test/authorize');
  for (const message of sequence) {
    assert.equal(message.includes('SECRET123'), false);
    assert.equal(message.includes('?'), false, `should carry no query string: ${message}`);
  }
});

check('an unparseable URL degrades instead of throwing', () => {
  assert.equal(safeUrl('about:blank'), 'about:blank');
  assert.equal(safeUrl(''), '');
});

check('the credential-entry line states masking and carries no value', () => {
  const message = describeCredentialsEntered();
  assert.ok(message.includes('masked'));
  assert.equal(/["']\S+["']/.test(message), false);
});

check('no message carries a structural DOM path', () => {
  for (const message of sequence) {
    assert.equal(message.includes(' > '), false, `should carry no DOM path: ${message}`);
    assert.equal(message.includes('nth-of-type'), false, `should carry no positional selector: ${message}`);
    // The wire-level scrubber must find nothing left to rewrite.
    assert.equal(scrubSelectors(message), message, `should already be selector-free: ${message}`);
  }
});

check('the two auth modes are told apart in the opening line', () => {
  assert.notEqual(describeAuthStart('credentials'), describeAuthStart('storageState'));
});

console.log('\nauthNarration — control naming');

check('a real label is quoted, a semantic fallback is not', () => {
  assert.equal(controlPhrase('Log in'), 'the "Log in" control');
  // resolveControlName yields <button#submit> when the control has no text; quoting
  // that would read as if it were the button's label.
  assert.equal(controlPhrase('<button#submit>'), 'the <button#submit> control');
});

check('a form with no submit control narrates the Enter fallback', () => {
  const enter = describeSubmitted(null);
  assert.ok(enter.includes('Enter'));
  assert.notEqual(enter, describeSubmitted('Log in'));
  assert.equal(enter.includes('"'), false);
});

check('two clicks on same-named controls at different URLs stay distinct', () => {
  assert.notEqual(
    describeAffordanceClick('Sign In', 'https://app.test/'),
    describeAffordanceClick('Sign In', 'https://idp.test/authorize'),
  );
});

console.log(`\n${passed} checks passed`);
