// A BFS path-replay hop must be named by the control it actually clicks, so the
// reproduction playbook reads `Click the "Settings" link` — never the internal
// `path replay N/M` placeholder that used to leak engine jargon into user-facing
// findings. No unit-test runner is configured in this package, so this is a
// self-executing script: run with
// `npx tsx src/domain/services/exploration/StateRestorer.replayLabel.test.ts`.

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { StateRestorer } from './StateRestorer.js';
import type { StateRestorerDeps, CleanActionStep } from './types.js';
import type { NavigationStep } from '../DIrectedPathFinder.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const ORIGIN = 'https://app.example.com';
const TO_HASH = 'HASH1';

function makeDeps(captured: Array<CleanActionStep | undefined>): StateRestorerDeps {
  return {
    // Every hop verifies its target fingerprint immediately, so replayPath completes.
    hashManager: { hash: () => Promise.resolve(TO_HASH) } as unknown as StateRestorerDeps['hashManager'],
    telemetry: { emitSystemStatus() {}, emit() {} } as unknown as StateRestorerDeps['telemetry'],
    recordActionTrace: (_trace, clean) => { captured.push(clean); },
    getTargetOrigin: () => ORIGIN,
    getReentryUrl: () => ORIGIN,
  };
}

// Fake page: evaluate() ignores the pageFunction and returns a preset label source
// (the browser DOM cannot run in this harness — same limitation as the sibling tests),
// so the assertions exercise the label/noun RESOLUTION the fix added.
function makePage(source: unknown): Page {
  return {
    isClosed: () => false,
    url: () => `${ORIGIN}/network-errors`,
    click: () => Promise.resolve(),
    evaluate: () => Promise.resolve(source),
  } as unknown as Page;
}

const step = (): NavigationStep => ({ selector: '#hop', fromHash: 'H0', toHash: TO_HASH } as NavigationStep);

async function run(): Promise<void> {
  console.log('StateRestorer — path-replay hop naming');

  await check('a hop is named by its control, never "path replay N/M"', async () => {
    const captured: Array<CleanActionStep | undefined> = [];
    const restorer = new StateRestorer(makeDeps(captured));
    const source = { tagName: 'A', innerText: 'Settings', href: `${ORIGIN}/settings` };
    const ok = await restorer.replayPath(makePage(source), [step()]);
    assert.equal(ok, true);
    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.humanIdentifier, 'Settings');
    assert.equal(captured[0]?.elementKind, 'link');
    assert.doesNotMatch(captured[0]?.humanIdentifier ?? '', /path replay/);
  });

  await check('a root brand link resolves to a home link with its visible name', async () => {
    const captured: Array<CleanActionStep | undefined> = [];
    const restorer = new StateRestorer(makeDeps(captured));
    const source = { tagName: 'A', innerText: '🦁 BugSafari Target', href: `${ORIGIN}/` };
    await restorer.replayPath(makePage(source), [step()]);
    assert.equal(captured[0]?.humanIdentifier, '🦁 BugSafari Target');
    assert.equal(captured[0]?.elementKind, 'home link');
  });

  await check('an unnamed control drops the tag-noun label so narration reads the bare noun', async () => {
    const captured: Array<CleanActionStep | undefined> = [];
    const restorer = new StateRestorer(makeDeps(captured));
    // No text/aria/name → resolveElementLabel returns the generic "button"; the fix drops
    // it so the step reads "Click the button", not the doubled `the "button" button`.
    const ok = await restorer.replayPath(makePage({ tagName: 'BUTTON' }), [step()]);
    assert.equal(ok, true);
    assert.equal(captured[0]?.humanIdentifier, undefined);
    assert.equal(captured[0]?.elementKind, 'button');
  });

  await check('an unreadable element yields no label and no jargon', async () => {
    const captured: Array<CleanActionStep | undefined> = [];
    const restorer = new StateRestorer(makeDeps(captured));
    const ok = await restorer.replayPath(makePage(null), [step()]);
    assert.equal(ok, true);
    assert.equal(captured[0]?.humanIdentifier, undefined);
    assert.equal(captured[0]?.elementKind, undefined);
  });

  console.log(`\n${passed} checks passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
