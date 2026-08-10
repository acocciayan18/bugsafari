// Self-executing checks for the centralized bug-category policy (resolveCategory).
// Run with `npx tsx "shared/bugCategory.test.ts"` or `npm test -w shared`.

import assert from 'node:assert/strict';
import {
  resolveCategory,
  CATEGORY_BY_BUGCLASS,
  BUG_CATEGORY_META,
  BUG_CATEGORY_ORDER,
  DEFAULT_CATEGORY,
} from './bugCategory.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('bugCategory — centralized family policy');

check('resolveCategory maps a known bug class to its family', () => {
  assert.equal(resolveCategory('SQL_INJECTION'), 'SECURITY');
  assert.equal(resolveCategory('CLIENT_TRUST_BOUNDARY_VIOLATION'), 'ACCESS_CONTROL');
  assert.equal(resolveCategory('SPA_STATE_RACE_CONDITION'), 'NAVIGATION_STATE');
});

check('resolveCategory falls back to DEFAULT_CATEGORY for unknown/empty input', () => {
  assert.equal(resolveCategory('A_BRAND_NEW_UNMAPPED_CLASS'), DEFAULT_CATEGORY);
  assert.equal(resolveCategory(''), DEFAULT_CATEGORY);
  assert.equal(resolveCategory(undefined), DEFAULT_CATEGORY);
  assert.equal(resolveCategory(null), DEFAULT_CATEGORY);
});

check('every mapped family resolves to one declared in BUG_CATEGORY_META/ORDER', () => {
  for (const family of Object.values(CATEGORY_BY_BUGCLASS)) {
    assert.ok(BUG_CATEGORY_META[family], `family ${family} missing meta`);
    assert.ok(BUG_CATEGORY_ORDER.includes(family), `family ${family} missing from order`);
  }
});

check('BUG_CATEGORY_ORDER and BUG_CATEGORY_META cover the same families exactly', () => {
  const metaKeys = Object.keys(BUG_CATEGORY_META).sort().join('|');
  const orderKeys = [...BUG_CATEGORY_ORDER].sort().join('|');
  assert.equal(orderKeys, metaKeys);
});

console.log(`\nAll ${passed} assertions passed.`);
