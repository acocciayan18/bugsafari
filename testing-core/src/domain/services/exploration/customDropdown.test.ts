// Deterministic tests for the custom-dropdown selection oracle. No unit runner is
// configured in this package, so this is a self-executing script:
// `npx tsx src/domain/services/exploration/customDropdown.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { comboSelectionChanged } from './customDropdown.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('customDropdown — combo selection oracle');

// A committed-value signature is the joined-pipe string readComboState returns.
const empty = '||||';

check('a changed committed signature is a real selection', () => {
  assert.equal(comboSelectionChanged('Choose|||||', 'United States|opt-1|United States|||true'), true);
});

check('an unchanged signature is not a selection', () => {
  const sig = 'Choose|||||';
  assert.equal(comboSelectionChanged(sig, sig), false);
});

check('an empty after (detached/navigated trigger) is never a selection', () => {
  // Regression: a navigation away must not read as a committed value change even
  // though '' differs from the pre-open signature.
  assert.equal(comboSelectionChanged('Choose|||||', ''), false);
});

check('an always-non-empty joined signature still needs a difference', () => {
  // The joined signature is non-empty even when every field is blank, so the
  // emptiness gate alone cannot substitute for the difference check.
  assert.equal(comboSelectionChanged(empty, empty), false);
  assert.equal(comboSelectionChanged(empty, 'Berlin|||||'), true);
});

check('a commit visible only via aria-selected text (not the trigger label) counts', () => {
  // Widget keeps a static trigger label but marks the chosen listbox option.
  const before = 'Sort|||||false';
  const after = 'Sort|||Price, low to high|true';
  assert.equal(comboSelectionChanged(before, after), true);
});

console.log(`\ncustomDropdown: ${passed} checks passed.`);
