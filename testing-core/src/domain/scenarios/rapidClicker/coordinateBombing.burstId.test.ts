// Regression test: coordinate bombing must tag its reproduction MACRO with a burstId,
// so stepMinimizer can prune the grid dump from a finding anchored on a DIFFERENT
// culprit (the selector-based spammers already do this; the MACRO used to leak in as
// fake "setup"). No unit runner is configured, so run via:
//   npx tsx src/domain/scenarios/rapidClicker/coordinateBombing.burstId.test.ts

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { coordinateBombing } from './coordinateBombing.js';
import { ActionRecorder } from '../../../infrastructure/monitoring/actionBuffer.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Minimal fake Page: viewport + url are sync literals, the mouse is a no-op, every
// other method resolves undefined. The grid clicks hit nothing, which is fine — the
// MACRO step is recorded before the click loop.
function fakePage(): Page {
  const mouse = { click: async () => undefined, move: async () => undefined, down: async () => undefined, up: async () => undefined };
  return new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'viewportSize') return () => ({ width: 1440, height: 900 });
        if (prop === 'url') return () => 'http://app.test/x';
        if (prop === 'mouse') return mouse;
        if (prop === 'then') return undefined;
        return async () => undefined;
      },
    },
  ) as unknown as Page;
}

console.log('coordinateBombing — reproduction MACRO carries a burstId');

await check('the CoordinateBombing MACRO step is tagged with a non-empty burstId', async () => {
  await coordinateBombing.execute(fakePage());
  const macro = ActionRecorder.getInstance()
    .snapshot()
    .find((r) => r.type === 'MACRO' && r.macro?.scenario === 'CoordinateBombing');
  assert.ok(macro, 'a CoordinateBombing MACRO step was recorded');
  assert.ok(
    typeof macro!.burstId === 'string' && macro!.burstId.length > 0,
    'the MACRO must carry a burstId so stepMinimizer can prune it from unrelated findings',
  );
});

console.log(`\nAll ${passed} checks passed.`);
