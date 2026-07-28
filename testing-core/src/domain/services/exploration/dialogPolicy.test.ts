// Deterministic tests for the native-dialog policy (audit P3-03: every dialog was
// dismissed, so confirm-gated destructive branches never executed). Run via `npm test`.

import assert from 'node:assert/strict';
import { decideDialog, promptPayloadFor } from './dialogPolicy.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('dialogPolicy — dialogs are answered, not blanket-cancelled (P3-03 fix)');

check('confirm is accepted so the destructive branch behind it runs', () => {
  const verdict = decideDialog('confirm', 'Delete this account?', false);
  assert.equal(verdict.decision, 'accept');
  assert.equal(verdict.promptText, '');
});

check('alert is accepted', () => {
  assert.equal(decideDialog('alert', 'Saved', false).decision, 'accept');
});

check('prompt is accepted WITH a payload — it is a real input surface', () => {
  const verdict = decideDialog('prompt', 'New name?', false);
  assert.equal(verdict.decision, 'accept');
  assert.ok(verdict.promptText.length > 0, 'an accepted prompt must carry a value');
});

check('the prompt payload is deterministic for a given message', () => {
  assert.equal(promptPayloadFor('New name?'), promptPayloadFor('New name?'));
  assert.notEqual(promptPayloadFor('New name?'), promptPayloadFor('Enter quantity'));
});

check('beforeunload is still dismissed — accepting it abandons the run state', () => {
  assert.equal(decideDialog('beforeunload', '', false).decision, 'dismiss');
});

check('read-only mode restores cancel-everything for shared environments', () => {
  assert.equal(decideDialog('confirm', 'Delete this account?', true).decision, 'dismiss');
  assert.equal(decideDialog('prompt', 'New name?', true).decision, 'dismiss');
  assert.equal(decideDialog('prompt', 'New name?', true).promptText, '');
});

check('read-only does not change beforeunload handling', () => {
  assert.equal(decideDialog('beforeunload', '', true).decision, 'dismiss');
});

console.log(`\ndialogPolicy: ${passed} checks passed.`);
