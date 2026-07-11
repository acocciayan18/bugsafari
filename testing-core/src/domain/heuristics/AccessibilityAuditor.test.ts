// Standalone tests for AccessibilityAuditor's dedup accounting (the DOM scan
// itself runs in a browser via page.evaluate and is exercised end-to-end by a
// real run). Run with:
// `npx tsx src/domain/heuristics/AccessibilityAuditor.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { AccessibilityAuditor, type A11yViolation } from './AccessibilityAuditor.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const v = (rule: string, selector: string): A11yViolation => ({
  rule,
  selector,
  wcag: '4.1.2',
  impact: 'serious',
  message: 'test',
});

console.log('AccessibilityAuditor — dedup accounting');

check('first sighting of each (rule, selector) is returned as fresh', () => {
  const a = new AccessibilityAuditor();
  const fresh = a.recordNew([v('image-alt', '#a'), v('form-label', '#b')]);
  assert.equal(fresh.length, 2);
  assert.equal(a.totalFound(), 2);
});

check('a repeated (rule, selector) is suppressed across calls', () => {
  const a = new AccessibilityAuditor();
  a.recordNew([v('image-alt', '#a')]);
  const second = a.recordNew([v('image-alt', '#a')]);
  assert.equal(second.length, 0);
  assert.equal(a.totalFound(), 1);
});

check('same rule on a different selector is a distinct violation', () => {
  const a = new AccessibilityAuditor();
  a.recordNew([v('image-alt', '#a')]);
  const fresh = a.recordNew([v('image-alt', '#c')]);
  assert.equal(fresh.length, 1);
  assert.equal(a.totalFound(), 2);
});

check('same selector under a different rule is a distinct violation', () => {
  const a = new AccessibilityAuditor();
  a.recordNew([v('image-alt', '#a')]);
  const fresh = a.recordNew([v('control-name', '#a')]);
  assert.equal(fresh.length, 1);
  assert.equal(a.totalFound(), 2);
});

check('within one batch, duplicates collapse to a single record', () => {
  const a = new AccessibilityAuditor();
  const fresh = a.recordNew([v('html-lang', 'html'), v('html-lang', 'html'), v('html-lang', 'html')]);
  assert.equal(fresh.length, 1);
  assert.equal(a.totalFound(), 1);
});

console.log(`\n${passed} passed`);
