// Self-executing test for the persist-boundary log sanitizer (M-log-redact). A
// tested target can echo a Bearer token / JWT into console or network text; it must
// be redacted and length-capped before it reaches Mongo. Run:
//   npx tsx src/infrastructure/database/logSanitizer.test.ts

import assert from 'node:assert/strict';
import { redactSecrets, capText } from './logSanitizer.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('logSanitizer — redaction + length caps');

check('Bearer tokens are redacted', () => {
  const out = redactSecrets('sent Bearer abc123.def456-GHI to the api');
  assert.ok(!out.includes('abc123.def456-GHI'), 'raw bearer token must not survive');
  assert.ok(out.includes('Bearer [REDACTED]'));
});

check('JWTs are redacted', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF';
  const out = redactSecrets(`response body carried ${jwt} inline`);
  assert.ok(!out.includes(jwt), 'raw JWT must not survive');
  assert.ok(out.includes('[REDACTED_JWT]'));
});

check('key=value secrets are redacted', () => {
  const out = redactSecrets('password=hunter2&user=bob');
  assert.ok(!out.includes('hunter2'), 'raw password must not survive');
  assert.ok(out.includes('[REDACTED]'));
});

check('capText redacts then truncates past the cap', () => {
  const long = 'x'.repeat(50);
  const out = capText(long, 10);
  assert.ok(out!.startsWith('xxxxxxxxxx'));
  assert.ok(out!.includes('truncated'));
  assert.ok(out!.length < long.length);
});

check('capText passes undefined through untouched', () => {
  assert.equal(capText(undefined, 10), undefined);
});

console.log(`\n${passed} assertions passed.`);
