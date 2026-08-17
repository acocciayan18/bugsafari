// Deterministic test for fuzzGuard's XSS finding wording.
// Run: `npx tsx src/bugs/finders/fuzzGuard.test.ts` — exits non-zero on failure.

import assert from 'node:assert/strict';
import { describeXssFinding } from './fuzzGuard.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('fuzzGuard — reflected-XSS finding wording');

check('executed ⇒ title/message assert the payload RAN', () => {
  const { title, message } = describeXssFinding(true);
  assert.match(title, /ran on the page/);
  assert.match(message, /executed as code/);
});

check('raw reflection ⇒ title/message say CAN run, never "ran"', () => {
  // The overclaim guard: a reflected-but-not-executed payload must not read as "ran".
  const { title, message } = describeXssFinding(false);
  assert.doesNotMatch(title, /\bran\b/);
  assert.match(title, /reflected unescaped/);
  assert.match(message, /can run as code/);
  assert.doesNotMatch(message, /executed as code/);
});

check('both variants tag the finding as reflected XSS', () => {
  assert.match(describeXssFinding(true).title, /reflected XSS/);
  assert.match(describeXssFinding(false).title, /reflected XSS/);
});

console.log(`\nAll ${passed} assertions passed.`);
