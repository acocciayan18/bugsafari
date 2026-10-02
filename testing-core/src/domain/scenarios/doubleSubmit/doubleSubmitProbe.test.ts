// Self-executing tests for the DoubleSubmitProbe scenario (no runner configured).
// Run with `npx tsx src/domain/scenarios/doubleSubmit/doubleSubmitProbe.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import { doubleSubmitProbe } from './doubleSubmitProbe.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Fake locator that counts clicks and rejects on the configured attempt indexes.
function fakePage(rejectOn: Set<number> = new Set()): { page: Page; clicks: () => number } {
  let count = 0;
  const locator = {
    first() {
      return {
        async click(): Promise<void> {
          count += 1;
          if (rejectOn.has(count)) throw new Error('not actionable');
        },
      };
    },
  };
  const page = {
    isClosed: () => false,
    url: () => 'https://app.test/duplicate-actions',
    locator: () => locator,
  } as unknown as Page;
  return { page, clicks: () => count };
}

function button(selector = '#pay'): InteractiveElement {
  return { tagName: 'button', type: 'button', selector, innerText: 'Pay now', id: '', className: '' } as unknown as InteractiveElement;
}

console.log('DoubleSubmitProbe — two genuine clicks, guard-aware');

await check('an unguarded control receives exactly two clicks', async () => {
  const { page, clicks } = fakePage();
  await doubleSubmitProbe.execute(page, button());
  assert.equal(clicks(), 2, 'both clicks must fire on an unguarded control');
});

await check('a first click that cannot actuate aborts the probe', async () => {
  const { page, clicks } = fakePage(new Set([1]));
  await doubleSubmitProbe.execute(page, button());
  assert.equal(clicks(), 1, 'no second click after the first could not actuate');
});

await check('a guarded control (second click blocked) is swallowed, no throw', async () => {
  const { page, clicks } = fakePage(new Set([2]));
  await doubleSubmitProbe.execute(page, button()); // must not reject
  assert.equal(clicks(), 2, 'the second click is attempted; its failure is the guard signal');
});

await check('no target selector means no interaction', async () => {
  const { page, clicks } = fakePage();
  await doubleSubmitProbe.execute(page, undefined);
  assert.equal(clicks(), 0, 'nothing to probe without a selector');
});

await check('a closed page is a no-op', async () => {
  const { clicks } = fakePage();
  const closed = { isClosed: () => true, url: () => 'x', locator: () => { throw new Error('should not reach'); } } as unknown as Page;
  await doubleSubmitProbe.execute(closed, button());
  assert.equal(clicks(), 0);
});

console.log(`\nAll ${passed} checks passed.`);
