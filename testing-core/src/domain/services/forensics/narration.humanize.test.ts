// Self-executing check for humanizeElement. No runner configured in this package.
// Run with `npx tsx "src/domain/services/forensics/narration.humanize.test.ts"`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { humanizeElement, humanizeSelector } from './narration.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('button with text + id', () => {
  assert.equal(
    humanizeElement({ tagName: 'button', innerText: 'Register', id: 'register-btn' }),
    'Button: "Register" (id: #register-btn)',
  );
});

check('input falls back to placeholder, no id', () => {
  assert.equal(
    humanizeElement({ tagName: 'input', placeholder: 'Email' }),
    'Input: "Email"',
  );
});

check('label order prefers innerText over aria/placeholder/name', () => {
  assert.equal(
    humanizeElement({ tagName: 'a', innerText: 'Home', ariaLabel: 'nav-home', name: 'home' }),
    'Link: "Home"',
  );
});

check('no label yields kind only (with id when present)', () => {
  assert.equal(humanizeElement({ tagName: 'div', id: 'root' }), 'Div (id: #root)');
  assert.equal(humanizeElement({ tagName: 'button' }), 'Button');
});

check('type=submit resolves to Button', () => {
  assert.equal(humanizeElement({ tagName: 'input', type: 'submit', name: 'go' }), 'Button: "go"');
});

check('selector chain reduces to last-segment semantic name', () => {
  assert.equal(humanizeSelector('div.app > form#login button#submit'), '<button#submit>');
});

check('attribute selector reads the attribute label', () => {
  assert.equal(humanizeSelector('input[name="user"]'), 'the "user" input field');
});

check('class-only and tag-only selectors stay readable', () => {
  assert.equal(humanizeSelector('button.btn-primary'), '<button.btn-primary>');
  assert.equal(humanizeSelector('nav > a'), 'link');
});

check('empty / N-A selector falls back to generic element', () => {
  assert.equal(humanizeSelector(''), 'element');
  assert.equal(humanizeSelector('N/A'), 'element');
});

console.log(`\n${passed} narration checks passed.`);
