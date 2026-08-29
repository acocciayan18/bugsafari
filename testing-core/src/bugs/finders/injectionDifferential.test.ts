// The differential oracle is behavioral: it flags injection ONLY when the operator payload
// CHANGES the server's answer. A form field that merely accepts special characters (baseline
// and operator answer identically) must never be flagged as SQL/NoSQL injection.
// Run with `npx tsx src/bugs/finders/injectionDifferential.test.ts`.

import assert from 'node:assert/strict';
import { isAuthBypass, isDataAmplification, selectOperatorPayloads } from './injectionDifferential.js';
import { carriesAttackSurface } from './noSqlInjection.js';
import { setFuzzRunSeed, resetFuzzRunSeed } from '../../domain/scenarios/fuzzing/runFuzzSeed.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const res = (status: number, bodyLen: number) => ({ status, bodyLen, url: 'http://app.test/api/login', method: 'POST' });

console.log('injectionDifferential — behavioral evidence gate (no differential ⇒ no finding)');

check('a field that merely accepts the operator (same 200, same body) is NOT injection', () => {
  const baseline = res(200, 1024);
  const operator = res(200, 1024);
  assert.equal(isAuthBypass(baseline, operator), false, 'no auth bypass: both accepted');
  assert.equal(isDataAmplification(baseline, operator), false, 'no amplification: same size');
});

check('both rejected identically (400/400) is NOT injection', () => {
  assert.equal(isAuthBypass(res(400, 32), res(400, 32)), false);
  assert.equal(isDataAmplification(res(400, 32), res(400, 32)), false);
});

check('baseline rejected but operator accepted ⇒ auth bypass (behavioral evidence)', () => {
  assert.equal(isAuthBypass(res(401, 20), res(200, 800)), true);
});

check('both accepted but operator returned materially more data ⇒ amplification', () => {
  // >3× AND >512 bytes larger than the baseline.
  assert.equal(isDataAmplification(res(200, 100), res(200, 900)), true);
  // A small growth under the floor is not amplification.
  assert.equal(isDataAmplification(res(200, 100), res(200, 300)), false);
});

check('one SQL + one NoSQL operator picked, each carrying attack surface', () => {
  resetFuzzRunSeed();
  const picks = selectOperatorPayloads('#user');
  assert.equal(picks.length, 2);
  assert.equal(picks[0].bugClass, 'SQL_INJECTION');
  assert.equal(picks[1].bugClass, 'NOSQL_INJECTION');
  for (const p of picks) assert.ok(carriesAttackSurface(p.value), `not attack surface: ${p.value}`);
});

check('selection is deterministic for a fixed run salt (replayable)', () => {
  setFuzzRunSeed(4242);
  const a = selectOperatorPayloads('#user');
  const b = selectOperatorPayloads('#user');
  assert.deepEqual(a, b);
  resetFuzzRunSeed();
});

check('different run salts rotate the operator picked (run-to-run diversity)', () => {
  const sqlSeen = new Set<string>();
  const noSqlSeen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    setFuzzRunSeed(i * 0x9e3779b1);
    const [sql, nosql] = selectOperatorPayloads('#user');
    sqlSeen.add(sql.value);
    noSqlSeen.add(nosql.value);
  }
  resetFuzzRunSeed();
  assert.ok(sqlSeen.size >= 2, `SQL operator never rotated: ${sqlSeen.size}`);
  assert.ok(noSqlSeen.size >= 2, `NoSQL operator never rotated: ${noSqlSeen.size}`);
});

console.log(`\n${passed} passed`);
