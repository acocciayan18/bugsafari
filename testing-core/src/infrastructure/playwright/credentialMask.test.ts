import assert from 'node:assert/strict';
import { MASK_CSS, MASK_ATTRIBUTE } from './credentialMask.js';

// Self-executing script (no runner). Locks FIX-2: the screencast visual mask covers
// password inputs, the explicit tag, AND sensitive-value fields (CVV/SSN/card/OTP…)
// so no sensitive field renders in cleartext in a captured frame.

let passed = 0;
function check(name: string, fn: () => void): void { fn(); passed += 1; console.log(`  ✓ ${name}`); }

console.log('credentialMask CSS — FIX-2');

check('masks password inputs and the explicit tag', () => {
  assert.ok(MASK_CSS.includes('input[type="password"]'), 'password inputs masked');
  assert.ok(MASK_CSS.includes(`[${MASK_ATTRIBUTE}]`), 'tagged element masked');
});

check('applies the disc text-security rule', () => {
  assert.ok(MASK_CSS.includes('-webkit-text-security:disc'), 'bullets rule present');
});

for (const token of ['cvv', 'ssn', 'card', 'otp', 'iban', 'passport', 'securitycode']) {
  check(`masks '${token}' fields by name / id / autocomplete`, () => {
    assert.ok(MASK_CSS.includes(`input[name*="${token}" i]`), `${token} name selector`);
    assert.ok(MASK_CSS.includes(`input[id*="${token}" i]`), `${token} id selector`);
    assert.ok(MASK_CSS.includes(`input[autocomplete*="${token}" i]`), `${token} autocomplete selector`);
  });
}

check('selectors are case-insensitive', () => {
  assert.ok(MASK_CSS.includes(' i]'), 'attribute selectors use the case-insensitive flag');
});

console.log(`\ncredentialMask CSS: ${passed} checks passed.`);
