import assert from 'node:assert';
import {
  validatePasswordComplexity,
  requireNonEmptyString,
  maskEmail,
  validateEmail,
  validateToken,
  validateName,
  isPasswordTooLong,
  MAX_PASSWORD_LENGTH,
} from './authValidation.js';

// Password complexity is the server-side mirror enforced on signup and password
// reset; a regression here would let a weak password through either flow.
assert.strictEqual(validatePasswordComplexity('Str0ng$pass'), null, 'a fully-compliant password passes');
assert.match(validatePasswordComplexity('short1$') ?? '', /8 characters/, 'too short rejected');
assert.match(validatePasswordComplexity('lowercase1$') ?? '', /uppercase/, 'missing uppercase rejected');
assert.match(validatePasswordComplexity('NoNumbers$') ?? '', /numeric/, 'missing number rejected');
assert.match(validatePasswordComplexity('NoSpecial1') ?? '', /special/, 'missing special char rejected');
// A `$`-bearing password must NOT be rejected (regression: the old NoSQL guard
// false-rejected legitimate passwords like "Str0ng$pass").
assert.strictEqual(validatePasswordComplexity('An0ther$Ok'), null, 'special char in password is allowed');

// A password past bcrypt's 72-byte ceiling is rejected before any hashing runs.
const longPassword = `${'A1a$'.repeat(20)}`; // 80 chars > 72
assert.strictEqual(isPasswordTooLong(longPassword), true, 'over-72-byte password flagged');
assert.match(validatePasswordComplexity(longPassword) ?? '', /at most 72/, 'over-length password rejected by complexity');
assert.strictEqual(isPasswordTooLong('Str0ng$pass'), false, 'normal-length password not flagged');

// validateEmail normalizes (trim + lowercase) and enforces format + length bounds.
assert.strictEqual(validateEmail('  User@Example.COM '), 'user@example.com', 'trims and lowercases a valid email');
assert.strictEqual(validateEmail('not-an-email'), null, 'missing @ rejected');
assert.strictEqual(validateEmail('a@b'), null, 'missing TLD rejected');
assert.strictEqual(validateEmail('a@b.c'), 'a@b.c', 'minimal 5-char address accepted');
assert.strictEqual(validateEmail(`${'x'.repeat(250)}@e.co`), null, 'over-254-char email rejected');
assert.strictEqual(validateEmail({ $gt: '' }), null, 'operator object rejected (NoSQL guard)');

// validateToken accepts only fixed-length hex; anything else is malformed.
const goodToken = 'a'.repeat(64);
assert.strictEqual(validateToken(`  ${goodToken}  `), goodToken, 'trims a valid 64-hex token');
assert.strictEqual(validateToken('a'.repeat(63)), null, 'wrong-length token rejected');
assert.strictEqual(validateToken(`${'g'.repeat(64)}`), null, 'non-hex token rejected');
assert.strictEqual(validateToken({ $ne: null }), null, 'operator object rejected');

// validateName strips control chars, trims, and enforces the length ceiling.
assert.strictEqual(validateName('  Ada Lovelace  '), 'Ada Lovelace', 'trims a valid name');
assert.strictEqual(validateName('Ada\x00\x07Lovelace'), 'AdaLovelace', 'control chars stripped');
assert.strictEqual(validateName('x'.repeat(101)), null, 'over-100-char name rejected');
assert.strictEqual(validateName(42), null, 'non-string name rejected');
assert.strictEqual(MAX_PASSWORD_LENGTH, 72, 'password ceiling is bcrypt-aligned');

// requireNonEmptyString is the real NoSQL-injection defense on email/token fields:
// a Mongo operator object must never survive as a query value.
assert.strictEqual(requireNonEmptyString('user@example.com', 'email'), 'user@example.com', 'plain string passes through unchanged');
assert.strictEqual(requireNonEmptyString({ $gt: '' }, 'email'), null, 'operator object rejected');
assert.strictEqual(requireNonEmptyString('   ', 'email'), null, 'whitespace-only rejected');
assert.strictEqual(requireNonEmptyString(undefined, 'token'), null, 'undefined rejected');

// maskEmail keeps full addresses out of logs (PII), the identity for correlation
// is the ObjectId, not the email.
assert.strictEqual(maskEmail('alice@example.com'), 'a***@example.com', 'local part masked to first char');
assert.strictEqual(maskEmail('not-an-email'), '[redacted-email]', 'non-address input fully redacted');
assert.strictEqual(maskEmail(42), '[redacted-email]', 'non-string input fully redacted');

console.log('authValidation.test.ts passed');
