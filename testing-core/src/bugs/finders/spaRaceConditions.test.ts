// Standalone deterministic test for the SPA race-condition finder's reproduction.
// Run with `npx tsx src/bugs/finders/spaRaceConditions.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { spaRaceConditionsFinder, burstConcurrentStress } from './spaRaceConditions.js';
import { ReproductionPlaybookStore } from '../../infrastructure/monitoring/reproductionPlaybookStore.js';
import { resetBurstCounter } from '../../infrastructure/monitoring/burstCorrelation.js';
import type { BugContext } from '../types.js';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';

let passed = 0;
function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ✓ ${name}`);
  });
}

const targets = [
  { selector: '#save', tagName: 'button' },
  { selector: '#cancel', tagName: 'button' },
  { selector: '#email', tagName: 'input', type: 'email' },
] as unknown as InteractiveElement[];

// A page whose clicks synchronously fire a pageerror — a crash mid-burst.
function crashingPage(handlers: Record<string, (arg: unknown) => void>) {
  const clickable = {
    click: async () => { handlers['pageerror']?.(new Error('Cannot read properties of undefined (crash)')); },
    fill: async () => undefined,
  };
  return {
    url: () => 'https://target.test/checkout',
    isClosed: () => false,
    on: (evt: string, fn: (arg: unknown) => void) => { handlers[evt] = fn; },
    off: () => undefined,
    waitForTimeout: async () => undefined,
    evaluate: async () => false,
    goto: async () => undefined,
    locator: () => ({ first: () => clickable }),
  };
}

// A page that shows a loader after the burst. Each click kicks off a fetch; with
// keepInFlight=false the fetch settles at once (idle network), true leaves it pending
// (slow/3G). evaluate returns false pre-burst, true after — the loader "appeared".
function loaderBurstPage(opts: { keepInFlight: boolean }) {
  const handlers: Record<string, (arg: unknown) => void> = {};
  let evalCalls = 0;
  const fetchReq = { resourceType: () => 'fetch' };
  const clickable = {
    click: async () => {
      handlers['request']?.(fetchReq);
      if (!opts.keepInFlight) handlers['requestfinished']?.(fetchReq);
    },
    fill: async () => undefined,
  };
  return {
    url: () => 'https://target.test/dashboard',
    isClosed: () => false,
    on: (evt: string, fn: (arg: unknown) => void) => { handlers[evt] = fn; },
    off: () => undefined,
    waitForTimeout: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    evaluate: async () => ++evalCalls > 1,
    goto: async () => undefined,
    locator: () => ({ first: () => clickable }),
  };
}

async function main(): Promise<void> {
  console.log('spaRaceConditions — burst pre-recording & finding reproduction');

  await check('the burst pre-records one record per distinct target, all sharing a burstId', async () => {
    ReproductionPlaybookStore.reset();
    resetBurstCounter();
    const page = crashingPage({}) as unknown as BugContext['page'];
    const result = await burstConcurrentStress(page, 1, targets);
    assert.equal(result.attempted, 3, '2 clicks + 1 fill fired');
    assert.ok(result.burstId, 'the burst reports its correlation id');
    const recorded = ReproductionPlaybookStore.snapshot().filter((a) => a.burstId === result.burstId);
    assert.equal(recorded.length, 3, 'every intended action was logged BEFORE firing');
    assert.equal(new Set(recorded.map((a) => a.burstId)).size, 1, 'they share one burst id');
    assert.deepEqual(recorded.map((a) => a.type), ['CLICK', 'CLICK', 'TYPE']);
  });

  await check('a crash mid-burst yields a finding with a non-empty reproduction', async () => {
    ReproductionPlaybookStore.reset();
    resetBurstCounter();
    const handlers: Record<string, (arg: unknown) => void> = {};
    const ctx = {
      page: crashingPage(handlers) as unknown as BugContext['page'],
      targetUrl: 'https://target.test',
      step: 2,
      stateHash: 'state-x',
      crashHalted: false,
      rankedTargets: targets,
    } as BugContext;

    const findings = await spaRaceConditionsFinder.run(ctx);
    assert.equal(findings.length, 1, 'the crash surfaces a race finding');
    const evidence = findings[0].evidence!;
    assert.ok(evidence.reproductionPlaybook && evidence.reproductionPlaybook.length > 0, 'playbook is never empty');
    assert.ok(evidence.reproductionActions && evidence.reproductionActions.length === 3, 'replayable timeline carried');
    assert.equal(new Set(evidence.reproductionActions!.map((a) => a.burstId)).size, 1, 'timeline is one correlated burst');
  });

  await check('an orphaned loader (no requests in flight) after the burst is a stuck-state finding', async () => {
    ReproductionPlaybookStore.reset();
    resetBurstCounter();
    const ctx = {
      page: loaderBurstPage({ keepInFlight: false }) as unknown as BugContext['page'],
      targetUrl: 'https://target.test',
      step: 3,
      stateHash: 'state-y',
      crashHalted: false,
      rankedTargets: targets,
    } as BugContext;

    const findings = await spaRaceConditionsFinder.run(ctx);
    assert.equal(findings.length, 1, 'a loader left up with nothing loading surfaces a race finding');
    assert.equal(findings[0].severity, 'MEDIUM', 'a stuck-state (non-crash) race is MEDIUM');
  });

  await check('a loader still backed by in-flight requests (slow/3G) is NOT flagged', async () => {
    ReproductionPlaybookStore.reset();
    resetBurstCounter();
    const ctx = {
      page: loaderBurstPage({ keepInFlight: true }) as unknown as BugContext['page'],
      targetUrl: 'https://target.test',
      step: 4,
      stateHash: 'state-z',
      crashHalted: false,
      rankedTargets: targets,
    } as BugContext;

    const findings = await spaRaceConditionsFinder.run(ctx);
    assert.equal(findings.length, 0, 'a legitimately-still-loading spinner is not a race (no 3G false positive)');
  });

  console.log(`\nspaRaceConditions: ${passed} checks passed.`);
}

void main();
