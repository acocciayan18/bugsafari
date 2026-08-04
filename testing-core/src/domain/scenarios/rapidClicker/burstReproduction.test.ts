// Proves concurrent-burst scenarios record their reproduction step BEFORE the burst
// settles, so a crash on the first click still leaves a usable playbook (no more
// "No reproduction steps were recorded for this fault"). Browser-free: a fake Page
// whose click() never resolves keeps the burst pending while we inspect the window.
// Run with `npx tsx src/domain/scenarios/rapidClicker/burstReproduction.test.ts`.

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import { buttonSpammer } from './buttonSpammer.js';
import { InteractionSimulator } from './interactionSimulator.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// A page whose click() never settles — the burst stays in flight so the assertion
// runs while it is pending, exactly the mid-burst-crash window.
const hangingPage = (url: string): Page =>
  ({ url: () => url, click: () => new Promise<void>(() => {}) }) as unknown as Page;

// A page whose every click is rejected (obscured/detached) — the burst settles with
// zero clicks registered (an inert burst that never touched the app).
const inertPage = (url: string): Page =>
  ({ url: () => url, click: () => Promise.reject(new Error('element is not visible')) }) as unknown as Page;

console.log('rapidClicker — reproduction recorded before the burst settles');

check('ButtonSpammer records the burst step before the first click resolves', () => {
  ActiveScenarioTracker.reset();
  ActiveScenarioTracker.begin('ButtonSpammer', 'http://app.test/x');
  const target = { selector: '#save', tagName: 'button', type: '', innerText: 'Save' } as unknown as InteractiveElement;

  // Do NOT await — the burst hangs; the pre-burst records ran synchronously already.
  void buttonSpammer.execute(hangingPage('http://app.test/x'), target, null);

  const narrative = ActiveScenarioTracker.flushSnapshot().narrative;
  assert.ok(
    narrative.some((s) => s.includes('Click the "Save" button 15 times as fast as possible')),
    narrative.join('\n'),
  );
  ActiveScenarioTracker.reset();
});

check('ConcurrentClicker records the sibling burst step before the burst resolves', () => {
  ActiveScenarioTracker.reset();
  ActiveScenarioTracker.begin('ConcurrentClicker', 'http://app.test/y');
  const elements = [
    { selector: '#a', tagName: 'button', type: '', innerText: 'Save' },
    { selector: '#b', tagName: 'button', type: '', innerText: 'Cancel' },
  ] as unknown as InteractiveElement[];

  void new InteractionSimulator().concurrentClicker(hangingPage('http://app.test/y'), elements, null);

  const narrative = ActiveScenarioTracker.flushSnapshot().narrative;
  assert.ok(
    narrative.some((s) => s.includes('Click 2 controls at the same time')),
    narrative.join('\n'),
  );
  ActiveScenarioTracker.reset();
});

// Async check (top-level await): every click rejects, so the burst settles with
// completed === 0 and the outcome must be flagged invalid, not "clicked 15 times".
await (async () => {
  ActiveScenarioTracker.reset();
  ActiveScenarioTracker.begin('ButtonSpammer', 'http://app.test/z');
  const target = { selector: '#save', tagName: 'button', type: '', innerText: 'Save' } as unknown as InteractiveElement;

  await buttonSpammer.execute(inertPage('http://app.test/z'), target, null);

  const narrative = ActiveScenarioTracker.flushSnapshot().narrative;
  assert.ok(
    narrative.some((s) => s.includes('Invalid: 0 of 15 clicks registered')),
    narrative.join('\n'),
  );
  ActiveScenarioTracker.reset();
  passed += 1;
  console.log('  ✓ ButtonSpammer flags an inert burst (0 clicks registered) as invalid');
})();

console.log(`\n${passed} checks passed`);
