import assert from 'node:assert/strict';
import { setScrubValues, clearScrubValues, scrubCredentials } from './credentialScrub.js';

// Self-executing script (no runner). Locks the ≥4-char scrub floor as an INTENTIONAL
// tradeoff at the boundary: a 1-3 char literal is not registered (it would rewrite
// ordinary prose everywhere and destroy telemetry); 4+ chars are scrubbed. Visual
// mask + no-value-recording remain the primary controls for short credentials.

let passed = 0;
function check(name: string, fn: () => void): void { clearScrubValues(); fn(); passed += 1; console.log(`  ✓ ${name}`); }

console.log('credentialScrub short-value floor — boundary');

check('3-char value is NOT registered (below floor)', () => {
  setScrubValues(['abc']);
  assert.equal(scrubCredentials('abc appears in abcdef'), 'abc appears in abcdef');
});

check('4-char value IS scrubbed (at floor)', () => {
  setScrubValues(['w0rd']);
  assert.equal(scrubCredentials('pass=w0rd'), 'pass=[REDACTED_CREDENTIAL]');
});

check('mixed list registers only the values meeting the floor', () => {
  setScrubValues(['ab', 'longenoughsecret']);
  const out = scrubCredentials('ab and longenoughsecret');
  assert.equal(out, 'ab and [REDACTED_CREDENTIAL]');
});

console.log(`\ncredentialScrub short-value floor: ${passed} checks passed.`);
