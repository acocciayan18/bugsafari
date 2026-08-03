import assert from 'node:assert';
import { validatePasswordComplexity, requireNonEmptyString, maskEmail } from './authValidation.js';

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
