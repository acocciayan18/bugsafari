// Deterministic tests for the framework-safe input ladder (audit P3-02: direct
// `.value` assignment is discarded by controlled React/Vue inputs). Playwright is
// stubbed — only rung selection and the delivered verdict are under test.
// Run via `npm test`.

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { setFieldValue, setSelectValue, setToggleChecked } from './frameworkInput.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// `trusted` drives fill/check/selectOption; `native` is the in-page setter rung.
function makePage(trusted: boolean, native: boolean): { page: Page; calls: string[] } {
  const calls: string[] = [];
  const reject = async (): Promise<void> => {
    throw new Error('control not editable');
  };
  const accept = async (): Promise<void> => undefined;
  const page = {
    locator: () => ({
      first: () => ({
        fill: (): Promise<void> => {
          calls.push('fill');
          return trusted ? accept() : reject();
        },
        check: (): Promise<void> => {
          calls.push('check');
          return trusted ? accept() : reject();
        },
        selectOption: (): Promise<void> => {
          calls.push('selectOption');
          return trusted ? accept() : reject();
        },
      }),
    }),
    evaluate: async (): Promise<boolean> => {
      calls.push('native');
      return native;
    },
  } as unknown as Page;
  return { page, calls };
}

console.log('frameworkInput — trusted-first actuation with a native-setter fallback (P3-02 fix)');

await check('a text field is filled through the trusted path first', async () => {
  const { page, calls } = makePage(true, true);
  assert.deepEqual(await setFieldValue(page, '#q', 'payload'), { method: 'fill', delivered: true });
  assert.deepEqual(calls, ['fill'], 'no raw in-page write when fill() succeeds');
});

await check('a field Playwright refuses falls to the native prototype setter', async () => {
  const { page, calls } = makePage(false, true);
  assert.deepEqual(await setFieldValue(page, '#q', 'payload'), { method: 'native-setter', delivered: true });
  assert.deepEqual(calls, ['fill', 'native']);
});

await check('a field that discards the value reports delivered: false', async () => {
  // e.g. input[type=number] given a text payload — the old code reported success
  // unconditionally and the escalation oracle then read the DOM back as "accepted".
  const { page } = makePage(false, false);
  assert.deepEqual(await setFieldValue(page, '#age', 'DROP TABLE'), { method: 'none', delivered: false });
});

await check('toggles and selects use the same trusted-then-native ladder', async () => {
  const trusted = makePage(true, false);
  assert.equal(await setToggleChecked(trusted.page, '#tos', true), true);
  assert.deepEqual(trusted.calls, ['check']);

  const fallback = makePage(false, true);
  assert.equal(await setSelectValue(fallback.page, '#country', 'MX'), true);
  assert.deepEqual(fallback.calls, ['selectOption', 'native']);
});

console.log(`\nframeworkInput: ${passed} checks passed.`);
