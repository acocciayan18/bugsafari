// A known dead-end route must skip the DOM-ready wait (ensureDomReady) so the
// engine stops re-paying the ~5s interactive-selector timeout on a page proven
// empty — the core recovery-loop time sink. A first-seen empty route still runs
// the wait. Self-executing script (no runner configured): run with
// `npx tsx src/domain/services/exploration/ExplorationLoop.deadEnd.test.ts`.

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { ExplorationLoop } from './ExplorationLoop.js';
import type { ExplorationLoopDeps } from './types.js';
import { routeKey } from '../../../ml/domHasher.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

interface Harness {
  loop: ExplorationLoop;
  ensureCalls: number;
}

// Minimal deps: parse always returns an empty DOM, so the loop takes the
// no-interactive-elements path. ensureDomReady is a counting spy.
function makeHarness(): Harness {
  let ensureCalls = 0;
  const deps = {
    ensureDomReady: async () => { ensureCalls += 1; },
    parser: { parse: async () => [], scanHealth: () => 'ok' },
    telemetry: {
      emitSystemStatus: () => {},
      emit: () => {},
      emitMilestone: () => {},
    },
    pathNavigator: { markRouteDeadEnd: () => {}, clearRouteDeadEnd: () => {} },
  } as unknown as ExplorationLoopDeps;
  const loop = new ExplorationLoop(deps);
  return { get loop() { return loop; }, get ensureCalls() { return ensureCalls; } };
}

const pageAt = (url: string): Page => ({ url: () => url }) as unknown as Page;

// Reach into the private step for a focused unit test (mirrors the cast style used
// by ExplorationLoop.boundary.test.ts for completionResult()).
type ParseFn = (page: Page, ctx: unknown) => Promise<{ kind: string }>;
const parse = (loop: ExplorationLoop): ParseFn =>
  (loop as unknown as { parseDomAndScore: ParseFn }).parseDomAndScore.bind(loop);

console.log('ExplorationLoop — known dead-end skips the DOM-ready wait');

await check('known dead-end route returns deadend WITHOUT calling ensureDomReady', async () => {
  const h = makeHarness();
  const url = 'http://x/dead';
  const ctx = {
    deadEndUrls: new Set<string>([routeKey(url)]),
    emptyCheckUrl: '',
    emptyCheckCount: 0,
  };
  const result = await parse(h.loop)(pageAt(url), ctx);
  assert.equal(result.kind, 'deadend');
  assert.equal(h.ensureCalls, 0); // the ~5s wait was skipped
});

await check('first-seen empty route DOES run ensureDomReady (the delayed-render wait)', async () => {
  const h = makeHarness();
  const url = 'http://x/fresh';
  // Pre-seed the empty-check counter at the retry limit (EMPTY_RETRY_LIMIT=2) so the
  // 3rd check classifies a dead end immediately — no 1s retry sleep in the test.
  const ctx = {
    deadEndUrls: new Set<string>(),
    emptyCheckUrl: url,
    emptyCheckCount: 2,
  };
  const result = await parse(h.loop)(pageAt(url), ctx);
  assert.equal(result.kind, 'deadend');
  assert.equal(h.ensureCalls, 1); // an unproven route still waits for a delayed render
});

console.log(`\nExplorationLoop dead-end: ${passed} checks passed.`);
