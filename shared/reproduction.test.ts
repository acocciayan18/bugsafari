// Self-executing checks for the centralized element-naming layer:
// semanticFallbackFromSelector (last-resort name), resolveControlName (THE
// user-facing namer) and scrubSelectors (the wire-boundary net). None of them
// may ever emit a full DOM path.
// Run with `npx tsx "shared/reproduction.test.ts"` or `npm test -w shared`.

import assert from 'node:assert/strict';
import { resolveControlName, scrubSelectors, semanticFallbackFromSelector } from './reproduction.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('collapses a full nth-of-type DOM path to its final control', () => {
  assert.equal(
    semanticFallbackFromSelector('body > div:nth-of-type(1) > main > button:nth-of-type(2)'),
    '<button>',
  );
});

check('keeps a meaningful id', () => {
  assert.equal(semanticFallbackFromSelector('button#submit'), '<button#submit>');
  assert.equal(semanticFallbackFromSelector('#register-btn'), '<#register-btn>');
});

check('keeps a class when no id', () => {
  assert.equal(semanticFallbackFromSelector('input.email-field'), '<input.email-field>');
});

check('keeps a name attribute when no id/class', () => {
  assert.equal(semanticFallbackFromSelector('input[name="email"]'), '<input[email]>');
});

check('never leaks the > path separator', () => {
  const out = semanticFallbackFromSelector('a > b > c:nth-child(3)');
  assert.ok(!out.includes('>') || out.startsWith('<'), out);
  assert.ok(!out.includes(' > '), out);
});

check('empty selector yields a generic fallback', () => {
  assert.equal(semanticFallbackFromSelector(''), '<element>');
  assert.equal(semanticFallbackFromSelector(undefined), '<element>');
});

check('resolveControlName prefers a human label', () => {
  assert.equal(
    resolveControlName({ label: 'Register', selector: 'body > div:nth-of-type(1) > a:nth-of-type(1)' }),
    'Register',
  );
});

check('resolveControlName rejects a selector masquerading as a label', () => {
  assert.equal(resolveControlName({ label: 'body > div > a', selector: 'a.nav-link' }), '<a.nav-link>');
});

check('resolveControlName falls back to the tag when nothing else is known', () => {
  assert.equal(resolveControlName({ tagName: 'BUTTON' }), '<button>');
  assert.equal(resolveControlName({}), '<element>');
});

check('scrubSelectors rewrites the reported dead-navigation DOM path', () => {
  const leaked =
    'Dead navigation control "body > div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(2) > a:nth-of-type(1)" — links to /pages/2.html';
  const out = scrubSelectors(leaked);
  assert.ok(!out.includes('nth-of-type'), out);
  assert.ok(!out.includes('body >'), out);
  assert.ok(out.includes('<a>'), out);
  assert.ok(out.includes('/pages/2.html'), out);
});

check('scrubSelectors catches a lone positional token', () => {
  assert.equal(scrubSelectors('stuck on li:nth-child(4) still'), 'stuck on <li> still');
});

check('scrubSelectors leaves ordinary prose and URLs untouched', () => {
  const prose = 'Route /a → /b returned HTTP 500 at http://app.test/pages/2.html; Step 1 > Step 2 skipped';
  assert.equal(scrubSelectors(prose), prose);
});

console.log(`\n${passed} checks passed`);
