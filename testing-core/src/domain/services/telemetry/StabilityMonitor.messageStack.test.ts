// Standalone deterministic test for separateMessageAndStack — the runtime-fault
// splitter that keeps a finding's human diagnostic line out of its stack trace.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with `npx tsx "src/domain/services/telemetry/StabilityMonitor.messageStack.test.ts"`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { separateMessageAndStack } from './StabilityMonitor.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('separateMessageAndStack — diagnostic message vs stack trace');

check('pageerror: explicit stack wins, message stays the single reason line', () => {
  const r = separateMessageAndStack('TypeError: x is undefined', 'TypeError: x is undefined\n    at f (app.js:1:1)');
  assert.equal(r.message, 'TypeError: x is undefined');
  assert.equal(r.stackTrace, 'TypeError: x is undefined\n    at f (app.js:1:1)');
});

check('console blob (no explicit stack): V8 frames split off into stackTrace', () => {
  const r = separateMessageAndStack('Error: boom\n    at foo (app.js:10:5)\n    at bar (app.js:20:9)');
  assert.equal(r.message, 'Error: boom');
  assert.equal(r.stackTrace, 'at foo (app.js:10:5)\n    at bar (app.js:20:9)');
});

check('SpiderMonkey frames (fn@url:line:col) are recognised as stack', () => {
  const r = separateMessageAndStack('ReferenceError: y is not defined\nrun@http://app.test/main.js:5:13');
  assert.equal(r.message, 'ReferenceError: y is not defined');
  assert.equal(r.stackTrace, 'run@http://app.test/main.js:5:13');
});

check('plain message with no frames yields an empty stack (no false stack)', () => {
  const r = separateMessageAndStack('Something went wrong in the checkout flow');
  assert.equal(r.message, 'Something went wrong in the checkout flow');
  assert.equal(r.stackTrace, '');
});

check('explicit stack wins even when the message text also carries frames', () => {
  const r = separateMessageAndStack('Error: dupe\n    at a (x.js:1:1)', 'Error: dupe\n    at a (x.js:1:1)\n    at b (x.js:2:2)');
  assert.equal(r.message, 'Error: dupe');
  assert.equal(r.stackTrace, 'Error: dupe\n    at a (x.js:1:1)\n    at b (x.js:2:2)');
});

check('multi-line diagnostic before the first frame is kept whole', () => {
  const r = separateMessageAndStack('Error: failed to render\nComponent: <Checkout>\n    at render (ui.js:3:1)');
  assert.equal(r.message, 'Error: failed to render\nComponent: <Checkout>');
  assert.equal(r.stackTrace, 'at render (ui.js:3:1)');
});

check('empty / whitespace message falls back to a stable label', () => {
  assert.equal(separateMessageAndStack('').message, 'Unknown runtime error');
  assert.equal(separateMessageAndStack('   \n  ').message, 'Unknown runtime error');
});

check('CRLF line endings are normalised before splitting', () => {
  const r = separateMessageAndStack('Error: crlf\r\n    at f (a.js:1:1)\r\n');
  assert.equal(r.message, 'Error: crlf');
  assert.equal(r.stackTrace, 'at f (a.js:1:1)');
});

console.log(`\n${passed} checks passed.`);
