// Self-executing checks for the chaos fallback payload pool.
// Run: `npx tsx src/domain/scenarios/fuzzing/strategies/chaosFallbackStrategy.test.ts`.
import assert from 'node:assert/strict';
import { getAllChaosTokens, isChaosToken } from './chaosFallbackStrategy.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('the malformed "<<SCRIPT>" junk token is gone', () => {
  // It carried no testing value and tripped the XSS reflection oracle's markup heuristic
  // (the accidental "<SCRIPT" substring), fabricating a confirmed reflected-XSS finding.
  assert.ok(!isChaosToken('<<SCRIPT>'));
});

check('no chaos token is a malformed doubled-angle-bracket tag', () => {
  const offenders = getAllChaosTokens().filter((t) => /<</.test(t));
  assert.deepEqual(offenders, [], `unexpected malformed tokens: ${offenders.join(', ')}`);
});

console.log(`\nAll ${passed} assertions passed.`);
