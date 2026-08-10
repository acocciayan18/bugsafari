// Guards the shared category table against drift from the knowledge-base catalog.
// Every BugClass in BUG_CATALOG must have a family in CATEGORY_BY_BUGCLASS, so a
// newly added bug class is forced to declare a category (or fail here).
// Run with `npx tsx src/bugs/knowledgeBase/categoryPolicy.test.ts`.

import assert from 'node:assert/strict';
import { BUG_CATALOG } from './bugCatalog.js';
import { CATEGORY_BY_BUGCLASS } from '../../../../shared/types.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('categoryPolicy — shared table ↔ knowledge-base catalog');

check('every BugClass has a family in CATEGORY_BY_BUGCLASS', () => {
  for (const bugClass of Object.keys(BUG_CATALOG)) {
    assert.ok(
      CATEGORY_BY_BUGCLASS[bugClass],
      `missing category for ${bugClass}`,
    );
  }
});

check('CATEGORY_BY_BUGCLASS has no stale keys', () => {
  for (const bugClass of Object.keys(CATEGORY_BY_BUGCLASS)) {
    assert.ok(bugClass in BUG_CATALOG, `stale category key not in catalog: ${bugClass}`);
  }
});

console.log(`\nAll ${passed} assertions passed.`);
