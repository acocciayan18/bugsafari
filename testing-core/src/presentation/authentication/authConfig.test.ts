import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import { AUTH_CONFIG, verifyTokenSync } from './authConfig.js';

// BK7: a validly-signed token must still be rejected when its claim shape is wrong,
// so downstream ownership filters never receive an undefined userId.
function sign(payload: object): string {
  return jwt.sign(payload, AUTH_CONFIG.JWT_SECRET);
}

const valid = verifyTokenSync(sign({ userId: 'u1', email: 'a@b.co' }));
assert.deepStrictEqual(valid, { userId: 'u1', email: 'a@b.co' }, 'well-formed token returns exactly the claims');

assert.strictEqual(verifyTokenSync(sign({ email: 'a@b.co' })), null, 'missing userId -> null');
assert.strictEqual(verifyTokenSync(sign({ userId: 'u1' })), null, 'missing email -> null');
assert.strictEqual(verifyTokenSync(sign({ userId: 42, email: 'a@b.co' })), null, 'non-string userId -> null');
assert.strictEqual(verifyTokenSync('garbage'), null, 'unparseable token -> null');
assert.strictEqual(verifyTokenSync(jwt.sign({ userId: 'u1', email: 'a@b.co' }, 'wrong-secret')), null, 'bad signature -> null');

console.log('authConfig.test.ts passed');
