// Request-boundary parsing for the /api/start-test config: target-auth extraction
// and infiltration-profile resolution. These are the gate that keeps a partial or
// malformed auth config from ever reaching a browser, and that keeps the operator's
// selected scenarios in sync between the sync and queued paths. Self-executing tsx
// script; run with `npx tsx src/presentation/api/authRequest.test.ts`.

import assert from 'node:assert/strict';
import { parseTargetAuth, parseSelectedScenarios } from './registerRoutes.js';
import { ALL_TESTING_TYPE_IDS } from '../../../../shared/types.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('parseTargetAuth — credential/state extraction & validation');

check('no targetAuth on the body → undefined (auth off)', () => {
  assert.equal(parseTargetAuth({}), undefined);
  assert.equal(parseTargetAuth({ targetAuth: null }), undefined);
  assert.equal(parseTargetAuth(undefined), undefined);
});

check('valid credentials → config with username trimmed, password verbatim', () => {
  const result = parseTargetAuth({
    targetAuth: { mode: 'credentials', username: '  tester@example.com  ', password: '  spaced pw  ' },
  });
  assert.deepEqual(result, {
    mode: 'credentials',
    username: 'tester@example.com',
    password: '  spaced pw  ',
    loginUrl: undefined,
    usernameSelector: undefined,
    passwordSelector: undefined,
    submitSelector: undefined,
    successIndicator: undefined,
  });
});

check('optional selector/url fields trim to undefined when blank, pass through when set', () => {
  const result = parseTargetAuth({
    targetAuth: {
      mode: 'credentials', username: 'u', password: 'p',
      loginUrl: '  https://t/login ', usernameSelector: '  ', passwordSelector: '#pw', submitSelector: '', successIndicator: '.ok',
    },
  });
  assert.equal((result as { loginUrl?: string }).loginUrl, 'https://t/login');
  assert.equal((result as { usernameSelector?: string }).usernameSelector, undefined);
  assert.equal((result as { passwordSelector?: string }).passwordSelector, '#pw');
  assert.equal((result as { submitSelector?: string }).submitSelector, undefined);
  assert.equal((result as { successIndicator?: string }).successIndicator, '.ok');
});

check('missing password → invalid', () => {
  assert.equal(parseTargetAuth({ targetAuth: { mode: 'credentials', username: 'u', password: '' } }), 'invalid');
});

check('whitespace-only username → invalid (never sent to guarantee a failed login)', () => {
  assert.equal(parseTargetAuth({ targetAuth: { mode: 'credentials', username: '   ', password: 'p' } }), 'invalid');
});

check('non-string username/password → invalid', () => {
  assert.equal(parseTargetAuth({ targetAuth: { mode: 'credentials', username: 123, password: 'p' } }), 'invalid');
  assert.equal(parseTargetAuth({ targetAuth: { mode: 'credentials', username: 'u', password: { a: 1 } } }), 'invalid');
});

check('absent or unknown mode → invalid (no silent fall-through to credentials)', () => {
  assert.equal(parseTargetAuth({ targetAuth: { username: 'u', password: 'p' } }), 'invalid');
  assert.equal(parseTargetAuth({ targetAuth: { mode: 'token', username: 'u', password: 'p' } }), 'invalid');
});

check('valid storageState → config', () => {
  const raw = '{"cookies":[{"name":"s"}],"origins":[]}';
  assert.deepEqual(parseTargetAuth({ targetAuth: { mode: 'storageState', storageState: raw } }), {
    mode: 'storageState', storageState: raw, successIndicator: undefined,
  });
});

check('empty / structurally invalid storageState → invalid', () => {
  assert.equal(parseTargetAuth({ targetAuth: { mode: 'storageState', storageState: '' } }), 'invalid');
  assert.equal(parseTargetAuth({ targetAuth: { mode: 'storageState', storageState: 'not json' } }), 'invalid');
  assert.equal(parseTargetAuth({ targetAuth: { mode: 'storageState', storageState: '{"cookies":[],"origins":[]}' } }), 'invalid');
});

console.log('parseSelectedScenarios — infiltration-profile resolution');

check('absent infiltration → all testing types (backward-compatible default)', () => {
  assert.deepEqual(parseSelectedScenarios({}).sort(), [...ALL_TESTING_TYPE_IDS].sort());
});

check('unknown profile → all testing types', () => {
  assert.deepEqual(parseSelectedScenarios({ infiltration: { profile: 'NOPE' } }).sort(), [...ALL_TESTING_TYPE_IDS].sort());
});

check('AUTH_STATE_SUBVERSION resolves to only the authState type', () => {
  assert.deepEqual(parseSelectedScenarios({ infiltration: { profile: 'AUTH_STATE_SUBVERSION' } }), ['authState']);
});

check('DEEP_SEMANTIC_DATA_ATTACK resolves to dataFuzzing + formBypass', () => {
  assert.deepEqual(parseSelectedScenarios({ infiltration: { profile: 'DEEP_SEMANTIC_DATA_ATTACK' } }).sort(), ['dataFuzzing', 'formBypass'].sort());
});

console.log(`\n${passed} assertion group(s) passed.`);
