// Navigation-replay tests: a recorded `navigation` step must LOAD its destination URL,
// not click it (its selector is the URL, which resolves to zero elements otherwise).
// Run: npx tsx src/domain/services/regression/ReplayActionRunner.test.ts
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import type { ActionStepTrace } from '../../../infrastructure/database/models/SessionModel.js';
import { ReplayActionRunner } from './ReplayActionRunner.js';

let passed = 0;
function check(name: string, fn: () => Promise<void>): Promise<void> {
  return fn().then(() => { passed += 1; console.log(`  ✓ ${name}`); });
}

interface Calls { gotos: string[]; clicks: string[]; }

function fakePage(currentUrl: string): { page: Page; calls: Calls } {
  const calls: Calls = { gotos: [], clicks: [] };
  let url = currentUrl;
  const page = {
    url: () => url,
    goto: async (to: string) => { calls.gotos.push(to); url = to; return null; },
    waitForLoadState: async () => undefined,
    locator: (selector: string) => ({
      first: () => ({ click: async () => { calls.clicks.push(selector); } }),
    }),
  } as unknown as Page;
  return { page, calls };
}

const navStep = (over: Partial<ActionStepTrace>): ActionStepTrace => ({
  stepNumber: 1, timestamp: '', actionType: 'navigation', selector: '', resultingStateHash: '', ...over,
} as ActionStepTrace);

console.log('ReplayActionRunner — navigation steps LOAD the URL, never click it');

await check('URL-valued selector → page.goto(url), not a click', async () => {
  const { page, calls } = fakePage('https://app.test/');
  const runner = new ReplayActionRunner(page, 'https://app.test/');
  const out = await runner.replay(navStep({ selector: 'https://app.test/checkout' }));
  assert.equal(out.status, 'ok');
  assert.deepEqual(calls.gotos, ['https://app.test/checkout']);
  assert.equal(calls.clicks.length, 0, 'a navigation must not be replayed as a click');
});

await check('already on the destination → no redundant reload', async () => {
  const { page, calls } = fakePage('https://app.test/checkout');
  const runner = new ReplayActionRunner(page, 'https://app.test/');
  const out = await runner.replay(navStep({ selector: 'https://app.test/checkout?ref=x' }));
  assert.equal(out.status, 'ok');
  assert.equal(calls.gotos.length, 0, 'same origin+path must not re-navigate');
});

await check('blank selector but url field → navigate by url', async () => {
  const { page, calls } = fakePage('https://app.test/');
  const runner = new ReplayActionRunner(page, 'https://app.test/');
  const out = await runner.replay(navStep({ selector: 'N/A', url: 'https://app.test/cart' }));
  assert.equal(out.status, 'ok');
  assert.deepEqual(calls.gotos, ['https://app.test/cart']);
});

await check('element-selector navigation (link click that caused nav) → clicks it', async () => {
  const { page, calls } = fakePage('https://app.test/');
  const runner = new ReplayActionRunner(page, 'https://app.test/');
  const out = await runner.replay(navStep({ selector: 'a#next', url: '' }));
  assert.equal(out.status, 'ok');
  assert.deepEqual(calls.clicks, ['a#next']);
  assert.equal(calls.gotos.length, 0);
});

console.log(`\n${passed} passed`);
