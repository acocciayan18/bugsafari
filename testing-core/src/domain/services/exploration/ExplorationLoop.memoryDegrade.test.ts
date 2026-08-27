// Under memory pressure the reveal-scroll is the wrong load to keep paying: it reparses
// the full DOM per scroll and pulls more lazy media into an already-pressured renderer.
// Once the watchdog degrade tier latches isMemoryDegraded, scrollToRevealNewControls must
// short-circuit (return null, zero reparses); with no pressure it stays bounded as before.
// Self-executing: `npx tsx src/domain/services/exploration/ExplorationLoop.memoryDegrade.test.ts`.

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

// Scroll probe (contains 'scrollBy') reports never-at-bottom; settle's evaluate resolves undefined.
function makePage(): Page {
  return {
    evaluate: async (fn: unknown) => (String(fn).includes('scrollBy') ? false : undefined),
    isClosed: () => false,
  } as unknown as Page;
}

// isDegraded absent ⇒ optional getter omitted, exercising the `?.()` no-pressure path.
function makeLoop(isDegraded?: boolean): { loop: ExplorationLoop; parseCalls: () => number } {
  let calls = 0;
  const deps = {
    parser: {
      parse: async () => {
        calls += 1;
        return [mkEl(`#c${calls}`, 'post')]; // same class every scroll → repetitive feed
      },
    },
    clusterRegistry: { isSelectorTriggered: () => false },
    telemetry: { emitMilestone: () => {} },
    ...(isDegraded === undefined ? {} : { isMemoryDegraded: () => isDegraded }),
  } as unknown as ExplorationLoopDeps;
  return { loop: new ExplorationLoop(deps), parseCalls: () => calls };
}

type ScrollFn = (page: Page, seen: InteractiveElement[], shell: string) => Promise<InteractiveElement[] | null>;
const reveal = (loop: ExplorationLoop): ScrollFn =>
  (loop as unknown as { scrollToRevealNewControls: ScrollFn }).scrollToRevealNewControls.bind(loop);

console.log('ExplorationLoop — memory-degrade gates reveal-scroll');

await check('degraded: returns null with zero reparses (no scroll under pressure)', async () => {
  const { loop, parseCalls } = makeLoop(true);
  const result = await reveal(loop)(makePage(), [mkEl('#c0', 'post')], 'shellX');
  assert.equal(result, null);
  assert.equal(parseCalls(), 0); // short-circuited before any scroll/reparse
});

await check('not degraded: unchanged bounded behavior (MAX_FRONTIER_SCROLLS reparses)', async () => {
  const { loop, parseCalls } = makeLoop(false);
  const result = await reveal(loop)(makePage(), [mkEl('#c0', 'post')], 'shellX');
  assert.equal(result, null); // repetitive feed → backtrack
  assert.equal(parseCalls(), 6); // MAX_FRONTIER_SCROLLS — gate off, normal bound
});

await check('getter absent: behaves as no-pressure (optional dep stays back-compatible)', async () => {
  const { loop, parseCalls } = makeLoop(undefined);
  const result = await reveal(loop)(makePage(), [mkEl('#c0', 'post')], 'shellX');
  assert.equal(result, null);
  assert.equal(parseCalls(), 6);
});

console.log(`\nExplorationLoop memory-degrade: ${passed} checks passed.`);
