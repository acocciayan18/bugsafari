// PlaywrightBrowserEngine.forceDispose — the hard abort for a stop that can't settle:
// closes page+context+browser directly (no flush) so a wedged run()'s in-flight evaluate
// rejects. Idempotent against the run's own teardown. Self-executing (node:assert).
// Run: npx tsx src/infrastructure/playwright/PlaywrightBrowserEngine.forceDispose.test.ts

import assert from 'node:assert/strict';
import { PlaywrightBrowserEngine } from './PlaywrightBrowserEngine.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('PlaywrightBrowserEngine — forceDispose');

function closable(tag: string, log: string[]) {
  return {
    close: async () => { log.push(tag); },
    isConnected: () => false,
  };
}

async function main(): Promise<void> {
  await check('closes page, context and browser once', async () => {
    const log: string[] = [];
    const engine = new PlaywrightBrowserEngine();
    const anyEngine = engine as unknown as Record<string, unknown>;
    anyEngine.activePage = closable('page', log);
    anyEngine.activeContext = closable('context', log);
    anyEngine.activeBrowser = closable('browser', log);

    await engine.forceDispose();

    assert.deepEqual(log.sort(), ['browser', 'context', 'page']);
    assert.equal(anyEngine.activePage, null);
    assert.equal(anyEngine.activeContext, null);
    assert.equal(anyEngine.activeBrowser, null);
  });

  await check('is idempotent — a second call closes nothing more', async () => {
    const log: string[] = [];
    const engine = new PlaywrightBrowserEngine();
    const anyEngine = engine as unknown as Record<string, unknown>;
    anyEngine.activePage = closable('page', log);
    anyEngine.activeContext = closable('context', log);
    anyEngine.activeBrowser = closable('browser', log);

    await engine.forceDispose();
    await engine.forceDispose();

    assert.equal(log.length, 3); // still just the one teardown
  });

  console.log(`\n${passed}/2 assertions passed.`);
}

void main();
