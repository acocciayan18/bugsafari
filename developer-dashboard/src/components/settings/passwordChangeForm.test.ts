// Self-executing checks for the Change Password form logic. No test framework
// (per the "no external libraries" rule) — run via `npm test --workspace bugsafaridashboard`.
// Guards the validation gate that fronts the password-change request and forced sign-out.

import assert from 'node:assert/strict';
import {
  validatePasswordChange,
  hasPasswordErrors,
  PASSWORD_MIN_LENGTH,
  SIGNOUT_COUNTDOWN_SECONDS,
} from './passwordChangeForm.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('password change form — validation gate');

check('a fully valid form yields no errors', () => {
  const errors = validatePasswordChange('oldpass1', 'brandnew123', 'brandnew123');
  assert.deepEqual(errors, {});
  assert.equal(hasPasswordErrors(errors), false);
});

check('missing current password is flagged', () => {
  const errors = validatePasswordChange('', 'brandnew123', 'brandnew123');
  assert.equal(errors.current, 'Current password is required');
  assert.equal(hasPasswordErrors(errors), true);
});

check('missing new password is flagged', () => {
  const errors = validatePasswordChange('oldpass1', '', '');
  assert.equal(errors.new, 'New password is required');
});

check('new password under the minimum length is flagged', () => {
  const short = 'a'.repeat(PASSWORD_MIN_LENGTH - 1);
  const errors = validatePasswordChange('oldpass1', short, short);
  assert.equal(errors.new, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
});

check('exactly the minimum length is accepted', () => {
  const min = 'a'.repeat(PASSWORD_MIN_LENGTH);
  const errors = validatePasswordChange('oldpass1', min, min);
  assert.equal(errors.new, undefined);
});

check('reusing the current password is rejected', () => {
  const errors = validatePasswordChange('samepass1', 'samepass1', 'samepass1');
  assert.equal(errors.new, 'New password must differ from the current one');
});

check('missing confirmation is flagged', () => {
  const errors = validatePasswordChange('oldpass1', 'brandnew123', '');
  assert.equal(errors.confirm, 'Please confirm your new password');
});

check('mismatched confirmation is flagged', () => {
  const errors = validatePasswordChange('oldpass1', 'brandnew123', 'brandnew124');
  assert.equal(errors.confirm, 'Passwords do not match');
});

check('multiple problems are reported together', () => {
  const errors = validatePasswordChange('', 'short', 'nope');
  assert.equal(errors.current, 'Current password is required');
  assert.equal(errors.new, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  assert.equal(errors.confirm, 'Passwords do not match');
});

check('length check precedes the same-as-current check', () => {
  // A short password equal to the current one reports the length problem first.
  const errors = validatePasswordChange('abc', 'abc', 'abc');
  assert.equal(errors.new, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
});

check('the sign-out read window is a positive whole number of seconds', () => {
  assert.ok(Number.isInteger(SIGNOUT_COUNTDOWN_SECONDS));
  assert.ok(SIGNOUT_COUNTDOWN_SECONDS > 0);
});

console.log(`\nAll ${passed} assertions passed.`);
