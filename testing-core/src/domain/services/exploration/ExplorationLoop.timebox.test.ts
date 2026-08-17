// Timebox mid-step termination — the "stop immediately when the timer reaches zero"
// guarantee. The timebox is enforced at the top of every iteration AND around the
// action, so an expiry that lands DURING a step halts the run before any further
// target-facing work (finder sweep, parent restore, novelty, live frame) runs. This
// script proves a session ends with outcome:'timebox' the instant active time hits the
// limit mid-step, and that NO new interaction/finder sweep runs after expiry.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with
// `npx tsx src/domain/services/exploration/ExplorationLoop.timebox.test.ts`.

import assert from 'node:assert/strict';
import { ExplorationLoop } from './ExplorationLoop.js';
import type { ExplorationLoopDeps } from './types.js';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { Page } from 'playwright';

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('ExplorationLoop — timebox mid-step termination');

// One benign, fully-actuatable control so the loop reaches the action phase.
function element(): InteractiveElement {
  return {
    selector: '#go',
    id: 'go',
    className: 'btn',
    innerText: 'Go',
    type: 'button',
    tagName: 'button',
    isVisible: true,
    isPointer: true,
    featureVector: {},
    riskScore: 1,
    href: '',
  };
}

// Minimal fake Page: url()/isClosed() are the only synchronous reads the loop makes,
// and every page.evaluate (reveal/settle) resolves immediately so the step never parks.
function fakePage(): Page {
  return {
    url: () => 'https://t.example/',
    isClosed: () => false,
    context: () => ({}),
    evaluate: async () => ({}),
  } as unknown as Page;
}

// Assemble a deps object that walks one full step. `trip` flips the timebox the moment
// the action executes, simulating the clock reaching zero mid-step. `sweeps` counts
// bug-finder sweeps so the test can prove none run after expiry.
function makeDeps(over: Partial<ExplorationLoopDeps> = {}): {
  deps: ExplorationLoopDeps;
  state: { timebox: boolean; stop: boolean; stopReason: string | null; sweeps: number };
} {
  const state = { timebox: false, stop: false, stopReason: null as string | null, sweeps: 0 };
  const noop = (): void => {};
  const hash = { structure: 's', interactive: 'i', routePath: '/', combined: 'c' };
  const telemetry = {
    emit: noop,
    emitMilestone: noop,
    emitSystemStatus: noop,
    emitAccessibility: noop,
    async emitLiveFrame() {},
    gateway: { emitTargets: noop },
  };
  const deps = {
    parser: { parse: async () => [element()], scanHealth: () => 'ok' },
    scorer: {
      setScope: noop,
      decayPenalties: noop,
      setSuppressedSelectors: noop,
      score: (els: InteractiveElement[]) => els,
      penalize: noop,
    },
    hashManager: { hashCompound: async () => hash },
    pathNavigator: {
      isNavDestinationSaturated: () => false,
      ancestorUrls: () => [],
      registerStateAndDecide: () => ({ kind: 'explore-edge', selector: '#go', score: 1 }),
    },
    clusterRegistry: {
      isSaturatedForRoute: () => false,
      isSelectorTriggered: () => false,
      isSelectorTriggeredAnywhere: () => false,
      observe: noop,
      stepsSinceCoverageGain: () => 0,
    },
    routeExhaustion: { observe: () => ({ isErrorState: false, reason: '' }) },
    edgeRepeat: { isExhausted: () => false },
    formFuzz: { isExhausted: () => false },
    gate: { isEnabled: () => false },
    escalationTracker: { setScope: noop },
    accessibilityAuditor: { totalFound: () => 0, audit: async () => [] },
    visitedUrls: new Set<string>(),
    visitedHashes: new Set<string>(),
    visitedStructures: new Set<string>(),
    actionExecutor: {
      logHighImpact: noop,
      // The clock reaches zero exactly as the action fires.
      executeWeightedAction: async () => {
        state.timebox = true;
        return { interacted: true };
      },
    },
    stateRestorer: {
      probeStaticTarget: async () => ({ href: null, deadEnd: false, newTab: false }),
      verifyTraversal: async () => ({ ok: true, childHash: 'c2', childStructure: 's2' }),
    },
    tabs: { canExploreSecondary: () => false },
    bugFinderRunner: {
      sweep: async () => {
        state.sweeps += 1;
      },
    },
    runtimeMetrics: { interactionCount: 0, failureCount: 0 },
    telemetry,
    setLoopActivity: noop,
    isStopRequested: () => state.stop,
    getStopReason: () => state.stopReason,
    isPaused: () => false,
    checkTimebox: () => state.timebox,
    isTimeboxExceeded: () => state.timebox,
    getTimeboxMs: () => 600000,
    getLastKnownUrl: () => 'https://t.example/',
    getMainFrameStatus: () => 200,
    noteActedTarget: noop,
    getTargetOrigin: () => 'https://t.example',
    getTargetUrl: () => 'https://t.example/',
    authOrigins: [] as string[],
    persistBrainSnapshot: async () => {},
    setFreeze: noop,
    ensureDomReady: async () => {},
    ensurePageHealth: async (p: Page) => ({ page: p, status: 'healthy' as const }),
    boundaryScope: 'site' as const,
    transitionRepeatBudget: 0,
    navigationFinder: { observeInteraction: () => [], noteEngineNavigation: noop },
    reportNavigationDefects: noop,
    hadNetworkActivitySinceAction: () => false,
    registerConfirmedBug: noop,
    sessionGuardActive: false,
    ...over,
  } as unknown as ExplorationLoopDeps;
  return { deps, state };
}

async function run(): Promise<void> {
  await check('timebox reaching zero mid-step ends the run with outcome:timebox', async () => {
    const { deps } = makeDeps();
    const result = await new ExplorationLoop(deps).execute(fakePage(), 5);
    assert.equal(result.outcome, 'timebox');
    assert.equal(result.completed, false);
  });

  await check('no bug-finder sweep runs after the timebox expires mid-step', async () => {
    const { deps, state } = makeDeps();
    await new ExplorationLoop(deps).execute(fakePage(), 5);
    // The action tripped the clock; the post-action gate must halt BEFORE the sweep.
    assert.equal(state.sweeps, 0);
  });

  await check('an operator stop landing mid-step ends the run as user-stopped', async () => {
    const { deps, state } = makeDeps({
      actionExecutor: {
        logHighImpact: () => {},
        executeWeightedAction: async () => {
          state.stop = true;
          state.stopReason = 'operator';
          return { interacted: true };
        },
      } as unknown as ExplorationLoopDeps['actionExecutor'],
    });
    const result = await new ExplorationLoop(deps).execute(fakePage(), 5);
    assert.equal(result.outcome, 'user-stopped');
    assert.equal(state.sweeps, 0);
  });

  // terminationGate precedence: a stop already latched by the timing interval reports
  // its own reason; the loop's one-shot checkTimebox is the fallback terminator.
  await check('terminationGate: stop wins first, else checkTimebox, else proceed', () => {
    const gateOf = (over: Partial<ExplorationLoopDeps>) =>
      (new ExplorationLoop({ ...makeDeps().deps, ...over }) as unknown as {
        terminationGate(): { outcome: string } | null;
      }).terminationGate();

    assert.equal(gateOf({ isStopRequested: () => true, getStopReason: () => 'timebox' })?.outcome, 'timebox');
    assert.equal(gateOf({ isStopRequested: () => false, checkTimebox: () => true })?.outcome, 'timebox');
    assert.equal(gateOf({ isStopRequested: () => false, checkTimebox: () => false }), null);
  });

  console.log(`\n${passed} checks passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
