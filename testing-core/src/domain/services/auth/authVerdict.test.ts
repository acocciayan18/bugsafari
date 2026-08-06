// Deterministic tests for the credentials-login verdict policy. Self-executing:
// run with `npx tsx src/domain/services/auth/authVerdict.test.ts`. Exits non-zero
// on the first failed assertion.
//
// Guards the decision table: decisive-negative signals outrank a cleared form,
// and the ambiguous case is retryable once before reading as rejected credentials.

import assert from 'node:assert/strict';
import { isRetryableAuthFailure } from '../../../../../shared/types.js';
import { classifyCredentialVerdict, type CredentialVerifySignals } from './authVerdict.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const NONE: CredentialVerifySignals = {
  hasCaptcha: false,
  hasMfa: false,
  hasLockout: false,
  hasAuthError: false,
  passwordGone: false,
  urlMoved: false,
};
const sig = (over: Partial<CredentialVerifySignals>): CredentialVerifySignals => ({ ...NONE, ...over });

console.log('authVerdict — success signals');

check('a cleared password field is authenticated', () => {
  const v = classifyCredentialVerdict(sig({ passwordGone: true }), false);
  assert.equal(v.status, 'authenticated');
});

check('navigating off the login page is authenticated', () => {
  const v = classifyCredentialVerdict(sig({ urlMoved: true }), false);
  assert.equal(v.status, 'authenticated');
});

console.log('\nauthVerdict — decisive-negative signals outrank a cleared form');

for (const [label, over, category] of [
  ['CAPTCHA', { hasCaptcha: true, passwordGone: true }, 'captcha'],
  ['MFA', { hasMfa: true, passwordGone: true }, 'mfa-required'],
  ['lockout', { hasLockout: true, passwordGone: true }, 'account-locked'],
  ['auth error', { hasAuthError: true, passwordGone: true }, 'invalid-credentials'],
] as const) {
  check(`${label} fails even when the form cleared`, () => {
    const v = classifyCredentialVerdict(sig(over), false);
    assert.equal(v.status, 'failed');
    assert.equal(v.category, category);
    assert.equal(isRetryableAuthFailure(v.category), false);
  });
}

check('CAPTCHA and MFA reasons point the operator at session-state mode', () => {
  const captcha = classifyCredentialVerdict(sig({ hasCaptcha: true }), true);
  const mfa = classifyCredentialVerdict(sig({ hasMfa: true }), true);
  assert.ok(captcha.reason.includes('session-state'));
  assert.ok(mfa.reason.includes('session-state'));
});

console.log('\nauthVerdict — the ambiguous case retries once, then reads as rejected');

check('form still present, no signal, first attempt is a retryable transient', () => {
  const v = classifyCredentialVerdict(NONE, false);
  assert.equal(v.status, 'failed');
  assert.equal(v.category, 'transient');
  assert.equal(isRetryableAuthFailure(v.category), true);
});

check('form still present, no signal, final attempt is invalid-credentials', () => {
  const v = classifyCredentialVerdict(NONE, true);
  assert.equal(v.status, 'failed');
  assert.equal(v.category, 'invalid-credentials');
  assert.equal(isRetryableAuthFailure(v.category), false);
});

check('the two invalid-credentials reasons read differently', () => {
  const viaError = classifyCredentialVerdict(sig({ hasAuthError: true }), true);
  const viaRepeat = classifyCredentialVerdict(NONE, true);
  assert.equal(viaError.category, viaRepeat.category);
  assert.notEqual(viaError.reason, viaRepeat.reason);
});

check('no reason carries a credential-shaped quoted token', () => {
  const samples = [
    classifyCredentialVerdict(sig({ hasCaptcha: true }), true),
    classifyCredentialVerdict(sig({ hasMfa: true }), true),
    classifyCredentialVerdict(sig({ hasLockout: true }), true),
    classifyCredentialVerdict(sig({ hasAuthError: true }), true),
    classifyCredentialVerdict(NONE, false),
    classifyCredentialVerdict(NONE, true),
  ];
  for (const v of samples) assert.equal(/["']\S+["']/.test(v.reason), false, `reason should carry no quoted value: ${v.reason}`);
});

console.log(`\n${passed} checks passed`);
