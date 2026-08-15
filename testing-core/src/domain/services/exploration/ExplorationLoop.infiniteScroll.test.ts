// Infinite-scroll frontier reveal must judge novelty by control CLASS, not selector
// string: a feed mints a fresh selector per streamed card, so a selector test always
// looked "productive" and trapped exploration on the feed. Repeated card classes now
// don't count, so the scroll unwinds (returns null → caller backtracks) and stays
// bounded by MAX_FRONTIER_SCROLLS; a genuinely new control class still returns the
// enlarged parse. Self-executing (no runner): `npx tsx
// src/domain/services/exploration/ExplorationLoop.infiniteScroll.test.ts`.

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { ExplorationLoop } from './ExplorationLoop.js';
import type { ExplorationLoopDeps } from './types.js';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Feed-card control: shared class (tag|type|role|label) across instances, unique
// selector/id per card — exactly the shape that fooled the selector-based test.
function mkEl(selector: string, label: string): InteractiveElement {
  return {
    selector,
    id: selector,
    className: 'card',
    innerText: label,
    type: 'button',
    tagName: 'button',
    isVisible: true,
    isPointer: true,
    featureVector: {},
    riskScore: 0,
    role: 'button',
  };
}

// Page stub: scroll probe (contains 'scrollBy') returns atBottom; settle's evaluate
// (MutationObserver) resolves to undefined. Both funnel through page.evaluate.
function makePage(atBottom: boolean): Page {
  return {
    evaluate: async (fn: unknown) => (String(fn).includes('scrollBy') ? atBottom : undefined),
    isClosed: () => false,
  } as unknown as Page;
}

// parser.parse yields successive reparse results; isSelectorTriggered=false so class
// novelty is the sole gate. Returns the loop plus the parse-call counter.
function makeLoop(parses: InteractiveElement[][]): { loop: ExplorationLoop; parseCalls: () => number } {
  let calls = 0;
  const deps = {
    parser: {
      parse: async () => {
        const out = parses[Math.min(calls, parses.length - 1)] ?? [];
        calls += 1;
        return out;
      },
    },
    clusterRegistry: { isSelectorTriggered: () => false },
    telemetry: { emitMilestone: () => {} },
  } as unknown as ExplorationLoopDeps;
  return { loop: new ExplorationLoop(deps), parseCalls: () => calls };
}

type ScrollFn = (page: Page, seen: InteractiveElement[], shell: string) => Promise<InteractiveElement[] | null>;
const reveal = (loop: ExplorationLoop): ScrollFn =>
  (loop as unknown as { scrollToRevealNewControls: ScrollFn }).scrollToRevealNewControls.bind(loop);

console.log('ExplorationLoop — infinite-scroll frontier reveal');

await check('repeating feed (new selectors, same class) returns null, bounded by MAX_FRONTIER_SCROLLS', async () => {
  // Every scroll surfaces more feed cards with fresh selectors but the SAME class.
  const feed = [
    [mkEl('#c2', 'post'), mkEl('#c3', 'post')],
    [mkEl('#c4', 'post'), mkEl('#c5', 'post')],
    [mkEl('#c6', 'post'), mkEl('#c7', 'post')],
    [mkEl('#c8', 'post')],
    [mkEl('#c9', 'post')],
    [mkEl('#c10', 'post')],
    [mkEl('#c11', 'post')], // beyond the cap; should never be reached
  ];
  const { loop, parseCalls } = makeLoop(feed);
  const seen = [mkEl('#c1', 'post')]; // frontier already all one card class
  const result = await reveal(loop)(makePage(false), seen, 'shellX'); // atBottom never true
  assert.equal(result, null); // repetitive feed → backtrack, not endless "new content"
  assert.equal(parseCalls(), 6); // MAX_FRONTIER_SCROLLS — no infinite loop
});

await check('a genuinely new control class returns the enlarged parse', async () => {
  const feed = [[mkEl('#c2', 'post'), mkEl('#filter', 'sort by newest')]]; // distinct class
  const { loop, parseCalls } = makeLoop(feed);
  const seen = [mkEl('#c1', 'post')];
  const result = await reveal(loop)(makePage(false), seen, 'shellX');
  assert.notEqual(result, null);
  assert.equal(result!.length, 2);
  assert.equal(parseCalls(), 1); // stopped as soon as new content appeared
});

await check('stops at document bottom even before the scroll cap', async () => {
  const feed = [[mkEl('#c2', 'post')]]; // same class, but page reports atBottom
  const { loop, parseCalls } = makeLoop(feed);
  const result = await reveal(loop)(makePage(true), [mkEl('#c1', 'post')], 'shellX');
  assert.equal(result, null);
  assert.equal(parseCalls(), 1); // one reparse, then bottom → stop
});

console.log(`\nExplorationLoop infinite-scroll: ${passed} checks passed.`);
