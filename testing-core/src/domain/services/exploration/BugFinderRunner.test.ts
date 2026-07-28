// Standalone deterministic test for the bug-finder runner.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with `npx tsx src/domain/services/exploration/BugFinderRunner.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { BugFinderRunner } from './BugFinderRunner.js';
import { ScenarioGate } from '../scenarioGate.js';
import type { BugContext, BugFinder, BugFinding } from '../../../bugs/types.js';
import type { ConfirmedBug } from './types.js';
import type { TelemetryEmitter } from '../telemetry/TelemetryEmitter.js';

let passed = 0;
function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ✓ ${name}`);
  });
}

// captureStateFingerprint touches the page; a stub that rejects proves the runner
// degrades to a fingerprint-less finding rather than dropping it.
function fakeContext(overrides: Partial<BugContext> = {}): BugContext {
  const page = {
    url: () => 'https://target.test/orders',
    isClosed: () => false,
    context: () => { throw new Error('no context in test'); },
    evaluate: async () => { throw new Error('no page in test'); },
  };
  return {
    page: page as unknown as BugContext['page'],
    targetUrl: 'https://target.test',
    step: 1,
    stateHash: 'state-a',
    crashHalted: false,
    ...overrides,
  };
}

function finding(over: Partial<BugFinding> = {}): BugFinding {
  return {
    bugClass: 'ROUTE_MUTATION_FAILURE',
    title: 'Infinite Redirect Loop Detected',
    severity: 'CRITICAL',
    evidence: { selector: '#nav', message: 'loop', actionExecuted: 'probe' },
    ...over,
  };
}

const silentTelemetry = {
  emit: () => undefined,
  emitMilestone: () => undefined,
} as unknown as TelemetryEmitter;

function makeRunner(finders: BugFinder[], opts: { cadence?: number; budget?: number; gate?: ScenarioGate } = {}) {
  const registered: ConfirmedBug[] = [];
  const runner = new BugFinderRunner({
    finders,
    gate: opts.gate ?? new ScenarioGate(),
    telemetry: silentTelemetry,
    registerConfirmedBug: (bug) => registered.push(bug),
    cadence: opts.cadence ?? 1,
    findingBudget: opts.budget ?? 25,
  });
  return { runner, registered };
}

const alwaysFinder = (over: Partial<BugFinder> = {}): BugFinder => ({
  bugClass: 'ROUTE_MUTATION_FAILURE',
  frequency: 'transactional',
  isApplicable: () => true,
  run: async () => [finding()],
  ...over,
});

async function main(): Promise<void> {
  console.log('BugFinderRunner — gating, isolation, budget, dedup identity');

  await check('the same defect on the same state yields a stable bugId across sweeps', async () => {
    const { runner, registered } = makeRunner([alwaysFinder()]);
    await runner.sweep(fakeContext());
    await runner.sweep(fakeContext({ step: 2 }));
    await runner.sweep(fakeContext({ step: 3 }));
    assert.equal(registered.length, 3, 'runner registers each observation');
    // Identity is what registerConfirmedBug dedups on — it must not vary by step.
    assert.equal(new Set(registered.map((b) => b.bugId)).size, 1);
  });

  await check('a different state produces a distinct bugId', async () => {
    const { runner, registered } = makeRunner([alwaysFinder()]);
    await runner.sweep(fakeContext({ stateHash: 'state-a' }));
    await runner.sweep(fakeContext({ stateHash: 'state-b' }));
    assert.equal(new Set(registered.map((b) => b.bugId)).size, 2);
  });

  await check('isApplicable is honored and receives no crashHalted field', async () => {
    let sawCrashHaltedKey = true;
    let calls = 0;
    const { runner, registered } = makeRunner([
      alwaysFinder({
        isApplicable: (ctx) => {
          calls += 1;
          sawCrashHaltedKey = 'crashHalted' in ctx;
          return false;
        },
      }),
    ]);
    await runner.sweep(fakeContext());
    assert.equal(calls, 1, 'the predicate actually runs');
    assert.equal(sawCrashHaltedKey, false, 'crashHalted is stripped for the gate');
    assert.equal(registered.length, 0, 'an inapplicable finder registers nothing');
  });

  await check('a deterministically failing finder is quarantined after N strikes', async () => {
    // Audit P3-11: quarantine used to fire on the FIRST throw. Finders that drive
    // the page throw routinely on ordinary mid-flight navigation, so one transient
    // permanently disabled that bug class for the rest of the run.
    let runs = 0;
    const { runner, registered } = makeRunner([
      alwaysFinder({
        run: async () => {
          runs += 1;
          throw new Error('boom');
        },
      }),
    ]);
    await runner.sweep(fakeContext());
    await runner.sweep(fakeContext());
    await runner.sweep(fakeContext());
    await runner.sweep(fakeContext());
    assert.equal(runs, 3, 'retried until the failure proves deterministic, then quarantined');
    assert.equal(registered.length, 0);
  });

  await check('a transient page-lifecycle error is retried every sweep, never quarantined', async () => {
    let runs = 0;
    const { runner } = makeRunner([
      alwaysFinder({
        run: async () => {
          runs += 1;
          throw new Error('Execution context was destroyed, most likely because of a navigation');
        },
      }),
    ]);
    for (let i = 0; i < 5; i++) await runner.sweep(fakeContext());
    assert.equal(runs, 5, 'a navigation-timing error must not disable the bug class');
  });

  await check('a throwing isApplicable is also isolated', async () => {
    const { runner, registered } = makeRunner([
      alwaysFinder({ isApplicable: () => { throw new Error('predicate boom'); } }),
    ]);
    await runner.sweep(fakeContext());
    assert.equal(registered.length, 0, 'the sweep survives');
  });

  await check('the finding budget is a hard ceiling', async () => {
    const { runner, registered } = makeRunner([alwaysFinder()], { budget: 2 });
    for (let i = 0; i < 6; i += 1) await runner.sweep(fakeContext({ stateHash: `s${i}` }));
    assert.equal(registered.length, 2);
  });

  await check('a chatty finder exhausts only its OWN class, never the others', async () => {
    // Audit P3-11: the budget was global, so whichever detector was noisiest consumed
    // it and silently switched every other one off for the rest of the run.
    const chatty = alwaysFinder({
      bugClass: 'RUNTIME_STABILITY_EXCEPTION',
      run: async () => [finding({ bugClass: 'RUNTIME_STABILITY_EXCEPTION' })],
    });
    const quiet = alwaysFinder({
      bugClass: 'NOSQL_INJECTION',
      run: async () => [finding({ bugClass: 'NOSQL_INJECTION' })],
    });
    const { runner, registered } = makeRunner([chatty, quiet], { budget: 2 });
    for (let i = 0; i < 6; i += 1) await runner.sweep(fakeContext({ stateHash: `s${i}` }));

    const perClass = registered.reduce<Record<string, number>>((acc, bug) => {
      const key = bug.attribution?.bugClass ?? 'unknown';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    assert.equal(perClass.RUNTIME_STABILITY_EXCEPTION, 2, 'chatty class capped at its own budget');
    assert.equal(perClass.NOSQL_INJECTION, 2, 'the quiet class still got its full budget');
    assert.deepEqual(
      runner.coverageReport().truncatedClasses.sort(),
      ['NOSQL_INJECTION', 'RUNTIME_STABILITY_EXCEPTION'],
      'truncation is reported, not silent',
    );
  });

  await check('a budget of 0 disables the runner entirely', async () => {
    const { runner, registered } = makeRunner([alwaysFinder()], { budget: 0 });
    await runner.sweep(fakeContext());
    assert.equal(registered.length, 0);
  });

  await check('a disabled testing type suppresses the finder', async () => {
    const gate = new ScenarioGate(['navigation']);
    const { runner, registered } = makeRunner(
      [alwaysFinder({ testingType: 'concurrency' })],
      { gate },
    );
    await runner.sweep(fakeContext());
    assert.equal(registered.length, 0);
  });

  await check('an enabled testing type lets the finder through', async () => {
    const gate = new ScenarioGate(['navigation']);
    const { runner, registered } = makeRunner(
      [alwaysFinder({ testingType: 'navigation' })],
      { gate },
    );
    await runner.sweep(fakeContext());
    assert.equal(registered.length, 1);
  });

  await check('cadenced finders are sampled, transactional ones are not', async () => {
    const { runner, registered } = makeRunner(
      [
        alwaysFinder({
          frequency: 'cadenced',
          bugClass: 'SPA_STATE_RACE_CONDITION',
          run: async () => [finding({ bugClass: 'SPA_STATE_RACE_CONDITION', title: 'race' })],
        }),
        alwaysFinder({ frequency: 'transactional' }),
      ],
      { cadence: 3 },
    );
    for (let i = 0; i < 6; i += 1) await runner.sweep(fakeContext({ stateHash: `s${i}` }));
    const cadenced = registered.filter((b) => b.attribution?.bugClass === 'SPA_STATE_RACE_CONDITION');
    const transactional = registered.filter((b) => b.attribution?.bugClass === 'ROUTE_MUTATION_FAILURE');
    assert.equal(transactional.length, 6, 'transactional runs every sweep');
    assert.equal(cadenced.length, 2, 'cadenced runs on sweeps 3 and 6');
  });

  await check('findings carry catalog attribution and the finder sink label', async () => {
    const { runner, registered } = makeRunner([alwaysFinder()]);
    await runner.sweep(fakeContext());
    const bug = registered[0];
    assert.equal(bug.type, 'FINDER');
    assert.equal(bug.severity, 'CRITICAL');
    assert.equal(bug.attribution?.bugClass, 'ROUTE_MUTATION_FAILURE');
    assert.ok(bug.attribution?.cwe, 'CWE comes from the bug catalog');
    assert.ok(bug.advice.length > 0, 'remediation comes from the bug catalog');
    assert.ok(bug.bugId.startsWith('finder-ROUTE_MUTATION_FAILURE-'));
  });

  console.log(`\nBugFinderRunner: ${passed} checks passed.`);
}

void main();
