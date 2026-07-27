// Deterministic tests for the traversal click ladder (audit P3-01: the baseline
// interaction was an untrusted, ~30x-repeated in-page `node.click()`). Playwright
// is stubbed — only the rung selection and the "could not be clicked" verdict are
// under test. Run via `npm test`.

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { trustedClick } from './trustedClick.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

interface Rungs {
  trusted: boolean;
  forced: boolean;
  dispatched: boolean;
}

function makePage(rungs: Rungs, closed = false): { page: Page; calls: string[] } {
  const calls: string[] = [];
  const page = {
    isClosed: () => closed,
    locator: () => ({
      first: () => ({
        click: async (opts?: { force?: boolean }): Promise<void> => {
          const rung = opts?.force ? 'forced' : 'trusted';
          calls.push(rung);
          if (!rungs[rung as 'trusted' | 'forced']) throw new Error(`${rung} click failed\nstack line`);
        },
      }),
    }),
    evaluate: async (): Promise<boolean> => {
      calls.push('dispatched');
      return rungs.dispatched;
    },
  } as unknown as Page;
  return { page, calls };
}

console.log('trustedClick — traversal actuation ladder (P3-01 fix)');

await check('an actionable control is clicked ONCE through the trusted path', async () => {
  const { page, calls } = makePage({ trusted: true, forced: true, dispatched: true });
  const outcome = await trustedClick(page, '#go');
  assert.deepEqual(outcome, { rung: 'trusted', actuated: true, reason: '' });
  assert.deepEqual(calls, ['trusted'], 'no burst, no fallback when the trusted click works');
});

await check('an obscured control falls to the forced click and reports why', async () => {
  const { page, calls } = makePage({ trusted: false, forced: true, dispatched: true });
  const outcome = await trustedClick(page, '#go');
  assert.equal(outcome.rung, 'forced');
  assert.equal(outcome.actuated, true);
  assert.equal(outcome.reason, 'trusted click failed', 'only the first line of the Playwright error is kept');
  assert.deepEqual(calls, ['trusted', 'forced']);
});

await check('a control Playwright refuses gets a real in-page pointer sequence', async () => {
  const { page, calls } = makePage({ trusted: false, forced: false, dispatched: true });
  const outcome = await trustedClick(page, '#go');
  assert.equal(outcome.rung, 'dispatched');
  assert.equal(outcome.actuated, true);
  assert.deepEqual(calls, ['trusted', 'forced', 'dispatched']);
});

await check('a control that cannot be clicked at all is unresolved, not a silent no-op', async () => {
  const { page } = makePage({ trusted: false, forced: false, dispatched: false });
  const outcome = await trustedClick(page, '#gone');
  assert.equal(outcome.rung, 'unresolved');
  assert.equal(outcome.actuated, false, 'the caller must be able to tell this from "clicked, no effect"');
  assert.ok(outcome.reason.length > 0, 'an unresolved click always carries a reason');
});

await check('a closed page short-circuits the ladder instead of burning its timeouts', async () => {
  const { page, calls } = makePage({ trusted: true, forced: true, dispatched: true }, true);
  const outcome = await trustedClick(page, '#go');
  assert.deepEqual(outcome, { rung: 'unresolved', actuated: false, reason: 'page closed' });
  assert.deepEqual(calls, [], 'operator stop must not wait on three rungs of dead-page timeouts');
});

console.log(`\ntrustedClick: ${passed} checks passed.`);
