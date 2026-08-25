// DomHasher.hashCompound — a wedged renderer leaves page.evaluate un-resolving; the
// Node-side deadline abandons it and degrades to the deterministic sentinel instead of
// parking the step loop past the timebox. Self-executing (node:assert).
// Run: npx tsx src/ml/domHasher.boundedEvaluate.test.ts

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { DomHasher } from './domHasher.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('DomHasher — bounded hashCompound evaluate');

async function main(): Promise<void> {
  // Tight deadline so the test is fast; the production default is 3000ms.
  process.env.BUGSAFARI_HASH_EVAL_DEADLINE_MS = '50';

  await check('resolves to the sentinel when evaluate never returns', async () => {
    // page.evaluate returns a promise that never settles — a wedged main thread.
    const page = {
      url: () => 'http://target.test/',
      evaluate: () => new Promise(() => {}),
    } as unknown as Page;

    const started = Date.now();
    const result = await new DomHasher().hashCompound(page);
    const elapsed = Date.now() - started;

    // Degraded path yields identical structure+interactive sentinels; a real hash would differ.
    assert.equal(result.structure, result.interactive);
    assert.ok(result.combined.length > 0);
    // Completed via the deadline, not by hanging (well under the 3s default).
    assert.ok(elapsed < 1000, `expected fast deadline resolution, took ${elapsed}ms`);
  });

  await check('still returns a real (non-sentinel) hash when evaluate resolves', async () => {
    const page = {
      url: () => 'http://target.test/',
      evaluate: async () => ({ structure: '<main></main>', interactive: 'button|||' }),
    } as unknown as Page;
    const result = await new DomHasher().hashCompound(page);
    assert.notEqual(result.structure, result.interactive);
  });

  delete process.env.BUGSAFARI_HASH_EVAL_DEADLINE_MS;
  console.log(`\n${passed}/2 assertions passed.`);
}

void main();
