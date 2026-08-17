// Auth-aware re-entry: invalid-context recovery must escalate to the authenticated
// landing (getReentryUrl), never the bare origin login page.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with
// `npx tsx src/domain/services/exploration/PageHealthGuard.reentry.test.ts`.

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { PageHealthGuard } from './PageHealthGuard.js';
import type { PageHealthGuardDeps } from './types.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const ORIGIN = 'https://app.example.com';
const CANONICAL = 'https://app.example.com/dashboard'; // authenticated landing
const REENTRY = CANONICAL; // auth run: re-entry == canonical landing, not bare origin

// Fake page pinned to about:blank so it stays invalid across rungs, driving the
// escalation ladder while recording each recovery target.
function makePage(): Page {
  return {
    isClosed: () => false,
    url: () => 'about:blank',
    reload: () => Promise.resolve(null),
    goto: () => Promise.resolve(null),
  } as unknown as Page;
}

type Recovery = { url: string; strategy: string };

// Drive `rounds` invalid recovery rungs and return the ordered recovery targets.
async function driveRecovery(
  boundaryScope: PageHealthGuardDeps['boundaryScope'],
  reentry: string,
  rounds: number,
): Promise<Recovery[]> {
  const recoveries: Recovery[] = [];
  const deps: PageHealthGuardDeps = {
    telemetry: { emit() {}, emitMilestone() {}, emitSystemStatus() {} } as unknown as PageHealthGuardDeps['telemetry'],
    getTargetUrl: () => CANONICAL,
    getTargetOrigin: () => ORIGIN,
    getReentryUrl: () => reentry,
    boundaryScope,
    authOrigins: [],
    recreatePage: () => Promise.resolve(null),
    recordRecovery: (url, strategy) => { recoveries.push({ url, strategy }); },
  };
  const guard = new PageHealthGuard(deps);
  const page = makePage();
  for (let i = 0; i < rounds; i++) await guard.ensureHealthy(page);
  return recoveries;
}

async function run(): Promise<void> {
  console.log('PageHealthGuard — auth-aware re-entry recovery');

  await check('subtree rung 2 goto-origin recovers to the re-entry URL, never the bare origin', async () => {
    const recoveries = await driveRecovery('subtree', REENTRY, 3);
    const origin = recoveries.find((r) => r.strategy === 'goto-origin');
    assert.ok(origin, 'expected a goto-origin recovery at rung 2');
    assert.equal(origin.url, REENTRY);
    assert.notEqual(origin.url, ORIGIN);

    const target = recoveries.find((r) => r.strategy === 'goto-target');
    assert.ok(target, 'expected a goto-target recovery at rung 1');
    assert.equal(target.url, CANONICAL); // subtree rung 1 pins the locked URL
  });

  await check('site-scope rung 1 recovers to the re-entry URL, not the bare origin', async () => {
    const recoveries = await driveRecovery('site', REENTRY, 2);
    const target = recoveries.find((r) => r.strategy === 'goto-target');
    assert.ok(target, 'expected a goto-target recovery at rung 1');
    assert.equal(target.url, REENTRY); // site scope: primaryUrl == re-entry
    assert.notEqual(target.url, ORIGIN);
  });

  // Regression guard: an unauthenticated run has getReentryUrl() === origin, so the
  // recovery ladder lands on the bare origin exactly as before — the fix is auth-only.
  await check('unauthenticated run (re-entry === origin) still recovers to the origin', async () => {
    const recoveries = await driveRecovery('subtree', ORIGIN, 3);
    const origin = recoveries.find((r) => r.strategy === 'goto-origin');
    assert.ok(origin, 'expected a goto-origin recovery at rung 2');
    assert.equal(origin.url, ORIGIN);
  });

  console.log(`\n${passed} checks passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
