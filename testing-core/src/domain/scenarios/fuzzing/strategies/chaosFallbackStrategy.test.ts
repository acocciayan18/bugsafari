// Self-executing checks for the chaos fallback payload pool.
// Run: `npx tsx src/domain/scenarios/fuzzing/strategies/chaosFallbackStrategy.test.ts`.
import assert from 'node:assert/strict';
import {
  getAllChaosTokens,
  getUnicodeChaosTokens,
  isChaosToken,
  buildZalgo,
} from './chaosFallbackStrategy.js';

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

check('the nonsense "obsLog.error(" script token is gone (internal logger name, not an attack vector)', () => {
  const offenders = getAllChaosTokens().filter((t) => t.includes('obsLog'));
  assert.deepEqual(offenders, [], `stray internal-code tokens: ${offenders.join(', ')}`);
});

check('script tokens are self-contained vectors, not inert bare fragments', () => {
  // A bare `onerror=` / `javascript:` alone reflects as inert text and only produced XSS
  // false positives; the SCRIPT tokens must carry a real, self-contained vector.
  assert.ok(!isChaosToken('onerror='), 'bare onerror= must not be a token');
  assert.ok(isChaosToken('<img src=x onerror=alert(1)>'), 'a complete event-handler vector is present');
});

check('buildZalgo is deterministic for the same (base, depth, seed)', () => {
  assert.equal(buildZalgo('a', 32, 0x1234), buildZalgo('a', 32, 0x1234));
});

check('buildZalgo stacks depth combining marks onto the base', () => {
  const base = 'x';
  const z = buildZalgo(base, 40, 0xabcd);
  assert.equal(z.length, base.length + 40, 'one code unit per mark plus the base');
  assert.ok(z.startsWith(base));
  // Every appended char is in the combining-marks block U+0300..U+036F.
  for (let i = base.length; i < z.length; i++) {
    const cp = z.charCodeAt(i);
    assert.ok(cp >= 0x0300 && cp <= 0x036f, `char at ${i} (U+${cp.toString(16)}) not a combining mark`);
  }
});

check('getUnicodeChaosTokens excludes LEGACY SQL/XSS/script/boundary vectors', () => {
  const unicode = getUnicodeChaosTokens();
  assert.ok(!unicode.includes('$gt'), 'NoSQL token leaked into unicode set');
  assert.ok(!unicode.includes('<script>alert(1)</script>'), 'script token leaked');
  assert.ok(!unicode.includes(' OR 1=1 '), 'SQL token leaked');
  assert.ok(!unicode.includes('--'), 'boundary token leaked');
});

check('getUnicodeChaosTokens includes generated Zalgo and at least one emoji', () => {
  const unicode = getUnicodeChaosTokens();
  const hasDeepZalgo = unicode.some((t) => t.length > 100);
  assert.ok(hasDeepZalgo, 'no deeply-stacked generated Zalgo present');
  // Family ZWJ sequence contains a Zero-Width Joiner.
  const hasEmojiZwj = unicode.some((t) => t.includes('‍') && /\p{Emoji}/u.test(t));
  assert.ok(hasEmojiZwj, 'no emoji ZWJ sequence present');
});

check('generated Zalgo strings are stable corpus members (isChaosToken)', () => {
  // Same fixed args the module uses for its first GENERATED_ZALGO entry.
  const generated = buildZalgo('a', 24, 0x5a1a0001);
  assert.ok(isChaosToken(generated), 'generated Zalgo not recognized as a chaos token');
  assert.ok(getAllChaosTokens().includes(generated));
});

console.log(`\nAll ${passed} assertions passed.`);
