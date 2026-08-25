// detectClientErrorView — sampleView's page.evaluate is Node-side bounded, so a wedged
// renderer can't park the step. On timeout the view is treated as non-error.
// Self-executing (node:assert). Run: npx tsx src/domain/services/exploration/clientErrorOracle.bounded.test.ts

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { detectClientErrorView } from './clientErrorOracle.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('clientErrorOracle — bounded sampleView');

async function main(): Promise<void> {
  process.env.BUGSAFARI_CLIENT_ERROR_EVAL_DEADLINE_MS = '50';

  await check('returns NOT_AN_ERROR without hanging when evaluate never returns', async () => {
    const page = { evaluate: () => new Promise(() => {}) } as unknown as Page;
    const started = Date.now();
    const verdict = await detectClientErrorView(page);
    const elapsed = Date.now() - started;
    assert.equal(verdict.isErrorView, false);
    assert.ok(elapsed < 1000, `expected fast deadline resolution, took ${elapsed}ms`);
  });

  await check('still detects a real error view', async () => {
    const page = {
      evaluate: async () => ({ text: '404 page not found', textLength: 18, controlCount: 0 }),
    } as unknown as Page;
    const verdict = await detectClientErrorView(page);
    assert.equal(verdict.isErrorView, true);
  });

  delete process.env.BUGSAFARI_CLIENT_ERROR_EVAL_DEADLINE_MS;
  console.log(`\n${passed}/2 assertions passed.`);
}

void main();
