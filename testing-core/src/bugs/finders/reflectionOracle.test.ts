// Standalone deterministic test for the reflection-oracle decision core.
// Run: `npx tsx src/bugs/finders/reflectionOracle.test.ts` — exits non-zero on failure.

import assert from 'node:assert/strict';
import { classifyReflection, classifyReflectionDetailed, buildXssProbe, makeNonce } from './reflectionOracle.js';

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

check('detailed: executed payload ⇒ executed:true (payload actually ran)', () => {
  const r = classifyReflectionDetailed({ rawHtml: '', payload: '<img src=x onerror=alert(1)>', executed: true });
  assert.equal(r.verdict, 'CONFIRMED');
  assert.equal(r.executed, true);
});

check('detailed: raw unescaped reflection ⇒ CONFIRMED but executed:false (can run, did not run)', () => {
  // The exact overclaim guard: <embed src=javascript:> reflects unescaped but the
  // browser never auto-runs it, so the finding must say "can run", not "ran".
  const payload = '<embed src="javascript:alert(1)">';
  const rawHtml = `<div>${payload}</div>`;
  const r = classifyReflectionDetailed({ rawHtml, payload, executed: false });
  assert.equal(r.verdict, 'CONFIRMED');
  assert.equal(r.executed, false);
});

check('executed witness but benign (no-markup) payload ⇒ NOT executed, NOT a leak', () => {
  // The page-global witness fires for the app's OWN alert/confirm/prompt or a prior
  // injection. A value that never carried a script/handler cannot have "run", so a
  // fired witness must not label it "executed as code" — the cross-injection / app-dialog
  // false positive this guard exists to kill.
  const r = classifyReflectionDetailed({ rawHtml: '<div>echo: BugSafari</div>', payload: 'BugSafari', executed: true });
  assert.equal(r.verdict, 'ABSENT');
  assert.equal(r.executed, false);
});

check('executed witness + genuinely dangerous payload ⇒ executed:true (attribution holds)', () => {
  const r = classifyReflectionDetailed({ rawHtml: '', payload: '<img src=x onerror=alert(1)>', executed: true });
  assert.equal(r.verdict, 'CONFIRMED');
  assert.equal(r.executed, true);
});

check('detailed: SANITIZED / ABSENT ⇒ executed:false', () => {
  assert.equal(classifyReflectionDetailed({ rawHtml: '<div>&lt;script&gt;</div>', payload: '<script>x</script>', executed: false }).executed, false);
  assert.equal(classifyReflectionDetailed({ rawHtml: '<div>clean</div>', payload: '<script>x</script>', executed: false }).executed, false);
});

check('classifyReflection verdict-only wrapper matches detailed.verdict', () => {
  const params = { rawHtml: '<div><script>x</script></div>', payload: '<script>x</script>', executed: false };
  assert.equal(classifyReflection(params), classifyReflectionDetailed(params).verdict);
});

check('probe embeds the nonce and makeNonce is unique-ish', () => {
  const n = makeNonce(7);
  assert.ok(buildXssProbe(n).includes(n), 'probe must carry its nonce');
  assert.notEqual(makeNonce(7), makeNonce(7));
});

console.log(`\nAll ${passed} assertions passed.`);
