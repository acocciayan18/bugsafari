// Guards the shared severity table against drift from the knowledge-base catalog.
// Every BugClass default in BUG_CATALOG must match SEVERITY_BY_BUGCLASS, so a newly
// added bug class is forced to declare a default in both places (or fail here).
// Run with `npx tsx src/bugs/knowledgeBase/severityPolicy.test.ts`.

import assert from 'node:assert/strict';
import { BUG_CATALOG } from './bugCatalog.js';
import { SEVERITY_BY_BUGCLASS } from '../../../../shared/types.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('severityPolicy — shared table ↔ knowledge-base catalog');

check('every BugClass default is mirrored in SEVERITY_BY_BUGCLASS', () => {
  for (const [bugClass, def] of Object.entries(BUG_CATALOG)) {
    assert.equal(
      SEVERITY_BY_BUGCLASS[bugClass],
      def.defaultSeverity,
      `severity drift for ${bugClass}: catalog=${def.defaultSeverity} shared=${SEVERITY_BY_BUGCLASS[bugClass]}`,
    );
  }
});

check('SEVERITY_BY_BUGCLASS has no stale keys', () => {
  for (const bugClass of Object.keys(SEVERITY_BY_BUGCLASS)) {
    assert.ok(bugClass in BUG_CATALOG, `stale severity key not in catalog: ${bugClass}`);
  }
});

console.log(`\nAll ${passed} assertions passed.`);
