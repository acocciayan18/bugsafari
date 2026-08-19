// Standalone test for the noSqlInjection finder's pure payload-descriptor helper.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with `npx tsx src/bugs/finders/noSqlInjection.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { describeInjectedValue, isNosqlInjectionConfirmed } from './noSqlInjection.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('noSqlInjection — describeInjectedValue names the payload by shape, not vuln class');

check('a bare quote is a SQL metacharacter, NOT a NoSQL operator', () => {
  assert.equal(describeInjectedValue("'"), 'a SQL metacharacter');
  assert.equal(describeInjectedValue("' OR '1'='1"), 'a SQL metacharacter');
});

check('an HTML/script fragment is named as such', () => {
  assert.equal(describeInjectedValue('<<SCRIPT>'), 'an HTML/script fragment');
  assert.equal(describeInjectedValue('<img src=x onerror=1>'), 'an HTML/script fragment');
});

check('a genuine Mongo operator is a NoSQL operator', () => {
  assert.equal(describeInjectedValue('{"$ne":null}'), 'a NoSQL operator');
  assert.equal(describeInjectedValue('{"$gt":""}'), 'a NoSQL operator');
});

check('a plain value is an unexpected value', () => {
  assert.equal(describeInjectedValue('9999999'), 'an unexpected value');
});

console.log('\nnoSqlInjection — only a genuine driver-error confirms injection, never a bare 5xx');

check('a leaked Mongo driver error confirms the injection', () => {
  assert.equal(isNosqlInjectionConfirmed({ operatorLeak: 'MongoError: unknown operator: $where' }), true);
});

check('a bare 5xx with no driver error is NOT injection (leaves it to SERVER_API_FAILURE)', () => {
  assert.equal(isNosqlInjectionConfirmed({ operatorLeak: undefined }), false);
  assert.equal(isNosqlInjectionConfirmed({}), false);
});

console.log(`\nAll ${passed} assertions passed.`);
