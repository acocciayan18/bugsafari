// Standalone deterministic test for the reflection-oracle decision core.
// Run: `npx tsx src/bugs/finders/reflectionOracle.test.ts` — exits non-zero on failure.

import assert from 'node:assert/strict';
import { classifyReflection, buildXssProbe, makeNonce } from './reflectionOracle.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('reflectionOracle — payload-correlated XSS confirmation');

check('executed payload ⇒ CONFIRMED (strongest proof)', () => {
  assert.equal(classifyReflection({ rawHtml: '', payload: '<script>x</script>', executed: true }), 'CONFIRMED');
});

check('raw unescaped reflection ⇒ CONFIRMED', () => {
  const payload = '<script>alert(1)</script>';
  const rawHtml = `<div>echo: ${payload}</div>`;
  assert.equal(classifyReflection({ rawHtml, payload, executed: false }), 'CONFIRMED');
});

check('HTML-encoded reflection ⇒ SANITIZED (no false positive)', () => {
  const payload = '<script>alert(1)</script>';
  const rawHtml = '<div>echo: &lt;script&gt;alert(1)&lt;/script&gt;</div>';
  assert.equal(classifyReflection({ rawHtml, payload, executed: false }), 'SANITIZED');
});

check('payload absent from page ⇒ ABSENT', () => {
  assert.equal(classifyReflection({ rawHtml: '<div>nothing here</div>', payload: '<script>x</script>', executed: false }), 'ABSENT');
});

check('ambient <iframe>/<script> without the injected payload ⇒ NOT flagged', () => {
  // The exact tag-presence false positive this oracle exists to kill.
  const rawHtml = '<iframe src="ad"></iframe><script src="analytics.js"></script>';
  const payload = '<img src=x onerror="alert(1)">';
  assert.equal(classifyReflection({ rawHtml, payload, executed: false }), 'ABSENT');
});

check('plain-text payload reflected (no markup) ⇒ NOT a leak', () => {
  // Harmless text echoed back is not XSS — the dangerous-markup guard prevents a
  // raw-reflection false positive.
  const payload = 'hello world 12345';
  assert.equal(classifyReflection({ rawHtml: `<div>${payload}</div>`, payload, executed: false }), 'ABSENT');
});

check('reflected but browser-normalized (quotes/void-tag added) ⇒ CONFIRMED', () => {
  // The exact bug: injected `<video><source onerror=alert(1)>` reflects via innerHTML
  // and the browser re-serializes it with quotes + a void-tag boundary, breaking an
  // exact substring match. Normalization tolerance must still confirm it.
  const payload = '<video><source onerror=alert(1)>';
  const rawHtml = '<div id="results"><video><source onerror="alert(1)"></video></div>';
  assert.equal(classifyReflection({ rawHtml, payload, executed: false }), 'CONFIRMED');
});

check('normalized escaped output still ⇒ SANITIZED (no false positive)', () => {
  // Even after normalization, entity-encoded angle brackets must NOT read as raw.
  const payload = '<img src=x onerror=alert(1)>';
  const rawHtml = '<div>echo: &lt;img src=x onerror=alert(1)&gt;</div>';
  assert.equal(classifyReflection({ rawHtml, payload, executed: false }), 'SANITIZED');
});

check('probe embeds the nonce and makeNonce is unique-ish', () => {
  const n = makeNonce(7);
  assert.ok(buildXssProbe(n).includes(n), 'probe must carry its nonce');
  assert.notEqual(makeNonce(7), makeNonce(7));
});

console.log(`\nAll ${passed} assertions passed.`);
