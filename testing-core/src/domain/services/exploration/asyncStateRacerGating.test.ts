// Standalone deterministic tests for the pure AsyncStateRacer async-behavior gate.
// Run via `npm test` or `npx tsx .../asyncStateRacerGating.test.ts`.

import assert from 'node:assert/strict';
import { shouldAsyncRace } from './asyncStateRacerGating.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('asyncStateRacerGating — AsyncStateRacer fires only on controls with async behavior');

// Submit buttons always trigger async flows
check('accepts a form submit button', () => {
  assert.equal(shouldAsyncRace({ tagName: 'button', type: 'submit', role: '', source: 'button[type="submit"]' }), true);
});

check('accepts an input type=submit', () => {
  assert.equal(shouldAsyncRace({ tagName: 'input', type: 'submit', role: '', source: 'input[type="submit"]' }), true);
});

// Links and anchors often trigger async navigation
check('accepts an anchor tag', () => {
  assert.equal(shouldAsyncRace({ tagName: 'a', type: '', role: '', source: 'a.fetch-data' }), true);
});

check('accepts an element with role=link', () => {
  assert.equal(
    shouldAsyncRace({ tagName: 'span', type: '', role: 'link', source: 'span.async-trigger' }),
    true,
  );
});

// Buttons with explicit onclick handlers
check('accepts a button with onclick handler', () => {
  assert.equal(
    shouldAsyncRace({ tagName: 'button', type: '', role: '', source: 'button onclick="loadData()"' }),
    true,
  );
});

check('accepts a button with Angular (click) handler', () => {
  assert.equal(
    shouldAsyncRace({ tagName: 'button', type: '', role: '', source: 'button (click)="save()"' }),
    true,
  );
});

// Buttons with async behavior keywords
check('accepts a button with "submit" in text/id/class', () => {
  assert.equal(
    shouldAsyncRace({ tagName: 'button', type: 'button', role: '', source: 'button#submit-form' }),
    true,
  );
});

check('accepts a button with "save" in id', () => {
  assert.equal(
    shouldAsyncRace({ tagName: 'button', type: 'button', role: '', source: 'button#save-button' }),
    true,
  );
});

check('accepts a button with "upload" in class', () => {
  assert.equal(
    shouldAsyncRace({ tagName: 'button', type: 'button', role: '', source: 'button.upload-file' }),
    true,
  );
});

check('accepts a button with "fetch" in selector', () => {
  assert.equal(
    shouldAsyncRace({ tagName: 'button', type: 'button', role: '', source: '[data-action="fetch"]' }),
    true,
  );
});

// Reject buttons with no async indicators (plain DOM toggles)
check('rejects a plain language toggle button (no async signals)', () => {
  assert.equal(
    shouldAsyncRace({ tagName: 'button', type: 'button', role: 'button', source: '#navbarlanguagebutton language en' }),
    false,
  );
});

check('rejects a plain toggle menu button', () => {
  assert.equal(
    shouldAsyncRace({ tagName: 'button', type: 'button', role: '', source: 'button.toggle-menu' }),
    false,
  );
});

check('rejects a plain DOM manipulation button', () => {
  assert.equal(
    shouldAsyncRace({ tagName: 'button', type: 'button', role: '', source: 'button.show-modal' }),
    false,
  );
});

check('rejects a plain visibility toggle', () => {
  assert.equal(
    shouldAsyncRace({ tagName: 'button', type: 'button', role: '', source: 'button#expand-section' }),
    false,
  );
});

console.log(`\nasyncStateRacerGating: ${passed} checks passed.`);
