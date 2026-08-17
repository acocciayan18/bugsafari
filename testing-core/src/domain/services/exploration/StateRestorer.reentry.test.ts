// Auth-aware re-entry: the restore ladder's origin-root fallbacks must land on the
// authenticated landing (getReentryUrl), never the bare origin login page.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with
// `npx tsx src/domain/services/exploration/StateRestorer.reentry.test.ts`.

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { StateRestorer } from './StateRestorer.js';
import type { StateRestorerDeps } from './types.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const ORIGIN = 'https://app.example.com';
const REENTRY = 'https://app.example.com/dashboard'; // authenticated landing
const DEEP_LINK = 'https://app.example.com/orders/9';

function makeDeps(reentry: string = REENTRY): StateRestorerDeps {
  return {
    hashManager: {} as unknown as StateRestorerDeps['hashManager'],
    telemetry: { emitSystemStatus() {}, emit() {} } as unknown as StateRestorerDeps['telemetry'],
    recordActionTrace: () => Promise.resolve(),
    getTargetOrigin: () => ORIGIN,
    getReentryUrl: () => reentry,
  };
}

// Fake page: skips Strategy A (empty targetHash), records every goto, and lets a
// chosen URL fail so the ladder falls through to the next rung.
function makePage(failUrl: string | null): { page: Page; gotos: string[] } {
  const gotos: string[] = [];
  let current = 'about:blank';
  const page = {
    isClosed: () => false,
    url: () => current,
    goBack: () => Promise.reject(new Error('no history')),
    goto: (url: string) => {
      gotos.push(url);
      if (url === failUrl) return Promise.reject(new Error('nav failed'));
      current = url;
      return Promise.resolve(null);
    },
    reload: () => Promise.resolve(null),
    evaluate: () => Promise.resolve(null), // captureClientStorage → null, reseed skipped
  } as unknown as Page;
  return { page, gotos };
}

async function run(): Promise<void> {
  console.log('StateRestorer — auth-aware re-entry fallback');

  await check('non-restorable target deep-links to the re-entry URL, not the origin', async () => {
    const restorer = new StateRestorer(makeDeps());
    const { page, gotos } = makePage(null);
    // targetHash '' skips Strategy A; targetUrl '' is non-restorable → safeTargetUrl = reentry.
    const ok = await restorer.restoreToState(page, '', '');
    assert.equal(ok, true);
    assert.equal(gotos[0], REENTRY);
    assert.notEqual(gotos[0], ORIGIN);
  });

  await check('Strategy C root reload targets the re-entry URL, not the bare origin', async () => {
    const restorer = new StateRestorer(makeDeps());
    // Deep-link (Strategy B) fails → ladder falls to Strategy C.
    const { page, gotos } = makePage(DEEP_LINK);
    const ok = await restorer.restoreToState(page, '', DEEP_LINK);
    assert.equal(ok, true);
    assert.equal(gotos[gotos.length - 1], REENTRY);
    assert.equal(gotos.includes(ORIGIN), false);
  });

  await check('a restorable target deep-links to itself, not the re-entry URL', async () => {
    const restorer = new StateRestorer(makeDeps());
    const { page, gotos } = makePage(null);
    const ok = await restorer.restoreToState(page, '', DEEP_LINK);
    assert.equal(ok, true);
    assert.equal(gotos[0], DEEP_LINK); // Strategy B honours the cached node URL
  });

  // Regression guard: an unauthenticated run has getReentryUrl() === origin, so the
  // fallback lands on the bare origin exactly as before — the fix is auth-only.
  await check('unauthenticated run (re-entry === origin) still falls back to the origin', async () => {
    const restorer = new StateRestorer(makeDeps(ORIGIN));
    const { page, gotos } = makePage(DEEP_LINK); // force Strategy C
    const ok = await restorer.restoreToState(page, '', DEEP_LINK);
    assert.equal(ok, true);
    assert.equal(gotos[gotos.length - 1], ORIGIN);
  });

  console.log(`\n${passed} checks passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
