// Self-executing checks for the fuzz-leak reproduction builder.
// Run: `npx tsx src/domain/services/exploration/fuzzReproduction.test.ts`.
import assert from 'node:assert/strict';
import { buildFuzzReproductionActions } from './fuzzReproduction.js';
import { narrateActionRecords } from '../../../../../shared/reproduction.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const input = {
  timestamp: '2026-08-20T00:00:00.000Z',
  pageUrl: 'https://app.test/xss-injection',
  selector: '#q',
  payload: '<script>alert(1)</script>',
  elementLabel: 'input field',
  elementKind: 'field',
  redactValue: false,
};

check('reproduction is navigate → type → submit (the submit that sends the payload is present)', () => {
  const actions = buildFuzzReproductionActions(input);
  assert.deepEqual(actions.map((a) => a.type), ['NAVIGATE', 'INPUT', 'FORM_SUBMIT']);
  assert.equal(actions[2].selector, '#q');
});

check('narration includes an explicit submit line, not just navigate + type', () => {
  const steps = narrateActionRecords(buildFuzzReproductionActions(input));
  assert.match(steps[0], /^Step 1\. Navigate to \/xss-injection/);
  assert.match(steps[1], /^Step 2\. Type ".+" into the input field$/); // generic label reads plainly
  assert.match(steps[2], /^Step 3\. Submit the form$/);
});

console.log(`\nAll ${passed} assertions passed.`);
