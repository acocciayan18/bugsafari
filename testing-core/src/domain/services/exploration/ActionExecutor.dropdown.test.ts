// Deterministic tests for ActionExecutor.actuateDropdown's live-feed dwell. No unit
// runner is configured in this package, so this is a self-executing script:
// `npx tsx src/domain/services/exploration/ActionExecutor.dropdown.test.ts`.
// Exits non-zero on the first failed assertion.
//
// A native <select> popup is rendered by Chromium in an OS layer the CDP screencast
// never captures, so the collapsed value repaint is the operator's ONLY visible cue.
// The dwell (re-highlight as input + waitForTimeout) is what keeps that cue from being
// raced away by the next step — these tests pin it so it can't silently regress.

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { ActionExecutor } from './ActionExecutor.js';
import type { ActionExecutorDeps } from './types.js';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';

let passed = 0;
async function checkAsync(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

interface Recorder {
  highlights: { selector: string; action: string }[];
  waits: number[];
}

// Minimal <select> page stub. `$eval` stands in for resolveSampledOption (the sampled
// option value, or null when nothing is selectable); `selectOption` resolves so
// setSelectValue reports success without the native-setter fallback.
function fakeSelectPage(optionValue: string | null, rec: Recorder): Page {
  return {
    isClosed: () => false,
    url: () => 'https://app.test/form',
    evaluate: async () => undefined,
    $eval: async () => optionValue,
    locator: () => ({ first: () => ({ selectOption: async () => undefined }) }),
    waitForTimeout: async (ms: number) => {
      rec.waits.push(ms);
    },
  } as unknown as Page;
}

function makeExecutor(rec: Recorder): ActionExecutor {
  const deps = {
    highlighter: {
      moveHighlight: async (_p: Page, selector: string, action: string) => {
        rec.highlights.push({ selector, action });
      },
    },
    recordActionTrace: () => {},
    telemetry: { emit() {} },
  } as unknown as ActionExecutorDeps;
  return new ActionExecutor(deps);
}

function selectEl(selector = '#country'): InteractiveElement {
  return {
    tagName: 'select',
    type: '',
    id: 'country',
    className: '',
    innerText: 'Country',
    selector,
    riskScore: 0.12,
  } as unknown as InteractiveElement;
}

function actuate(exec: ActionExecutor, page: Page, el: InteractiveElement): Promise<boolean> {
  return (exec as unknown as {
    actuateDropdown(p: Page, t: InteractiveElement): Promise<boolean>;
  }).actuateDropdown(page, el);
}

console.log('ActionExecutor — <select> live-feed commit dwell');

await checkAsync('a committed option re-highlights as input and dwells so the feed captures it', async () => {
  const rec: Recorder = { highlights: [], waits: [] };
  const exec = makeExecutor(rec);
  const ok = await actuate(exec, fakeSelectPage('US', rec), selectEl());

  assert.equal(ok, true, 'a resolvable option must report a successful selection');
  assert.equal(rec.highlights.length, 1, 'exactly one re-highlight on the committed control');
  assert.equal(rec.highlights[0].action, 'input', 'the committed control is highlighted amber (value entered)');
  assert.deepEqual(rec.waits, [200], 'the commit is held for the dwell so a frame lands');
});

await checkAsync('no selectable option skips the dwell entirely (nothing to show)', async () => {
  const rec: Recorder = { highlights: [], waits: [] };
  const exec = makeExecutor(rec);
  const ok = await actuate(exec, fakeSelectPage(null, rec), selectEl());

  assert.equal(ok, false, 'an empty <select> reports no selection');
  assert.equal(rec.highlights.length, 0, 'no committed value → no re-highlight');
  assert.deepEqual(rec.waits, [], 'no committed value → no wasted dwell');
});

console.log(`\nAll ${passed} checks passed.`);
