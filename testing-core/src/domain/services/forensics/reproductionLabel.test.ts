// Self-executing checks for the reproduction noun/label clarity rules. No runner
// configured in this package. Run with `npx tsx "src/domain/services/forensics/reproductionLabel.test.ts"`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { elementNoun, resolveElementLabel } from './narration.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('anchor with no context stays "link"', () => {
  assert.equal(elementNoun('a', ''), 'link');
});

check('anchor inside a nav container reads "navigation link"', () => {
  assert.equal(elementNoun('a', '', { containerKind: 'navigation' }), 'navigation link');
});

check('anchor to the site root reads "home link" (absolute + bare "/")', () => {
  assert.equal(elementNoun('a', '', { href: 'https://app.test/' }), 'home link');
  assert.equal(elementNoun('a', '', { href: '/' }), 'home link');
});

check('home takes precedence over nav for a root brand link', () => {
  assert.equal(elementNoun('a', '', { href: 'https://app.test/', containerKind: 'navigation' }), 'home link');
});

check('anchor to a sub-route stays "link"', () => {
  assert.equal(elementNoun('a', '', { href: 'https://app.test/scenarios' }), 'link');
});

check('role="link" element is treated as an anchor', () => {
  assert.equal(elementNoun('span', '', { role: 'link', containerKind: 'navigation' }), 'navigation link');
});

check('non-anchor nouns are unchanged', () => {
  assert.equal(elementNoun('button', ''), 'button');
  assert.equal(elementNoun('input', 'text'), 'field');
  assert.equal(elementNoun('select', ''), 'dropdown');
});

check('accessibleName wins over a long combined innerText', () => {
  assert.equal(
    resolveElementLabel({
      accessibleName: 'NoSQL Injection',
      innerText: 'NoSQL Injection Inject Mongo operators into the login form to bypass authentication entirely',
    }),
    'NoSQL Injection',
  );
});

check('plain link/button keep their visible text when there is no accessible name', () => {
  assert.equal(resolveElementLabel({ innerText: '← all scenarios' }), '← all scenarios');
  assert.equal(resolveElementLabel({ innerText: 'Login' }), 'Login');
});

check('input/textarea never use their live value (innerText) as the label', () => {
  // domParser sets an input's innerText to its value; a just-injected payload must not
  // become the element name — placeholder/name are the real identity.
  assert.equal(
    resolveElementLabel({ tagName: 'input', innerText: '<img src=x onerror=1>', placeholder: 'Search' }),
    'Search',
  );
  assert.equal(
    resolveElementLabel({ tagName: 'textarea', innerText: "'; DROP TABLE users; --", name: 'comment' }),
    'comment',
  );
  // With no stable identity it falls back to the generic noun, never the value.
  assert.equal(resolveElementLabel({ tagName: 'input', innerText: '<script>alert(1)</script>' }), 'input field');
});

console.log(`\n${passed} assertions passed.`);
