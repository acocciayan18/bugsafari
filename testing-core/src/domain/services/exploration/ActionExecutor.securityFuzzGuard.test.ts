// Regression tests for the security-fuzzer injection guard. FormBypasser also runs
// on buttonLike controls (to force-enable them), so executeSecurityFuzzerPayloads
// used to inject an XSS/SQL text payload into a dismiss '×' or submit button — a
// no-op that mislabeled a non-input as fuzzed. It must now inject ONLY into
// attack-vector fields. No unit runner is configured, so this is a self-executing
// script: `npx tsx src/domain/services/exploration/ActionExecutor.securityFuzzGuard.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { ActionExecutor } from './ActionExecutor.js';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { ActionExecutorDeps } from './types.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const fakePage = (url = 'https://app.test/search'): Page =>
  ({ isClosed: () => false, url: () => url }) as unknown as Page;

// executeSecurityFuzzerPayloads reads deps.escalationTracker/telemetry and calls
// the private injectPayload; everything else is stubbed. injectPayload is replaced
// per-instance so no real page write happens and injections are counted.
function makeExecutor(): { exec: ActionExecutor; injectedSelectors: string[]; emitted: string[] } {
  const injectedSelectors: string[] = [];
  const emitted: string[] = [];
  const deps = {
    escalationTracker: { getLevel: () => 0 },
    telemetry: { emit: (_: string, e: { actionExecuted: string }) => emitted.push(e.actionExecuted) },
  } as unknown as ActionExecutorDeps;
  const exec = new ActionExecutor(deps);
  (exec as unknown as { injectPayload: (p: Page, s: string) => Promise<unknown> }).injectPayload = async (
    _p,
    selector,
  ) => {
    injectedSelectors.push(selector);
    return { method: 'fill', delivered: true };
  };
  return { exec, injectedSelectors, emitted };
}

async function fuzz(exec: ActionExecutor, target: InteractiveElement): Promise<void> {
  await (
    exec as unknown as { executeSecurityFuzzerPayloads(p: Page, t: InteractiveElement): Promise<void> }
  ).executeSecurityFuzzerPayloads(fakePage(), target);
}

const el = (over: Partial<InteractiveElement>): InteractiveElement =>
  ({ id: '', className: '', innerText: '', type: '', ...over }) as InteractiveElement;

console.log('ActionExecutor — security-fuzzer injection guard');

await check('injects into a text input (attack-vector field)', async () => {
  const { exec, injectedSelectors, emitted } = makeExecutor();
  await fuzz(exec, el({ tagName: 'input', type: 'text', selector: '#q' }));
  assert.deepEqual(injectedSelectors, ['#q'], 'a text field must receive the payload');
  assert.ok(emitted.includes('security-fuzzer-injection'), 'a real injection emits its ACTION');
});

await check('injects into a textarea', async () => {
  const { exec, injectedSelectors } = makeExecutor();
  await fuzz(exec, el({ tagName: 'textarea', selector: '#bio' }));
  assert.deepEqual(injectedSelectors, ['#bio']);
});

await check("does NOT inject into a '×' dismiss button (the reported regression)", async () => {
  const { exec, injectedSelectors, emitted } = makeExecutor();
  // Class carries a 'search' token, which misclassifies the field category as
  // TEXT_SEARCH — but the interaction scope is 'clickable', so no injection fires.
  await fuzz(exec, el({ tagName: 'button', className: 'search-clear', innerText: '×', selector: '.search-clear' }));
  assert.deepEqual(injectedSelectors, [], 'a button holds no value — never injected');
  assert.ok(!emitted.includes('security-fuzzer-injection'), 'no misleading injection telemetry for a button');
});

await check('does NOT inject into submit/button/reset/image inputs', async () => {
  for (const type of ['submit', 'button', 'reset', 'image']) {
    const { exec, injectedSelectors } = makeExecutor();
    await fuzz(exec, el({ tagName: 'input', type, selector: `#${type}` }));
    assert.deepEqual(injectedSelectors, [], `input[type=${type}] must be skipped`);
  }
});

await check('does NOT inject into a <select>, checkbox, radio, or hidden input', async () => {
  for (const t of [
    el({ tagName: 'select', selector: '#country' }),
    el({ tagName: 'input', type: 'checkbox', selector: '#agree' }),
    el({ tagName: 'input', type: 'radio', selector: '#opt' }),
    el({ tagName: 'input', type: 'hidden', selector: '#csrf' }),
  ]) {
    const { exec, injectedSelectors } = makeExecutor();
    await fuzz(exec, t);
    assert.deepEqual(injectedSelectors, [], `${t.tagName}[type=${t.type}] must be skipped`);
  }
});

await check('does NOT inject into an anchor or a non-semantic clickable div', async () => {
  for (const t of [
    el({ tagName: 'a', innerText: 'Home', selector: '#home' }),
    el({ tagName: 'div', innerText: 'View', selector: '#card', nonSemanticInteractive: true }),
  ]) {
    const { exec, injectedSelectors } = makeExecutor();
    await fuzz(exec, t);
    assert.deepEqual(injectedSelectors, [], `${t.tagName} control must be skipped`);
  }
});

console.log(`\nAll ${passed} checks passed.`);
