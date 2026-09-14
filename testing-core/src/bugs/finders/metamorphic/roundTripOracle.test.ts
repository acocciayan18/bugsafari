// Self-executing tests for the round-trip (reversibility) oracle. Browser-free: the
// page is a duck-typed mock and the compound-capture is injected.
// Run: `npx tsx src/bugs/finders/metamorphic/roundTripOracle.test.ts`.

import assert from 'node:assert/strict';
import type { BugContext } from '../../types.js';
import type { InteractiveElement } from '../../../domain/entities/InteractiveElement.js';
import type { CompoundStateHash } from '../../../ml/domHasher.js';
import { evaluateRoundTrip, roundTripOracle } from './roundTripOracle.js';

let passed = 0;
function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ✓ ${name}`);
  });
}

const hash = (s: string, i: string): CompoundStateHash => ({ structure: s, interactive: i, routePath: '/m', combined: `${s}:${i}` });

// A page whose URL never changes (a layer toggle, not a navigation); close falls back
// to Escape because the close-selector locator reports zero matches.
function modalPage() {
  const noop = async (): Promise<void> => undefined;
  const locator = () => ({ first: () => ({ click: noop, count: async (): Promise<number> => 0 }) });
  return {
    url: () => 'https://app.test/dashboard',
    locator,
    keyboard: { press: noop },
    goto: noop,
  } as unknown as BugContext['page'];
}

const opener = [{ selector: '#open', opensLayer: true, isVisible: true, innerText: 'Details' }] as unknown as InteractiveElement[];

function ctxWith(page: BugContext['page'], rankedTargets: readonly InteractiveElement[]): BugContext {
  return { page, targetUrl: 'https://app.test', step: 3, stateHash: 'sh', crashHalted: false, rankedTargets } as BugContext;
}

// A capture stub that returns a fixed before/opened/closed sequence.
const sequence = (...states: CompoundStateHash[]) => {
  let i = 0;
  return async (): Promise<CompoundStateHash> => states[Math.min(i++, states.length - 1)];
};

async function main(): Promise<void> {
  console.log('metamorphic/roundTripOracle — reversibility');

  await check('a modal that closes cleanly (state restored) → no finding', async () => {
    const capture = sequence(hash('base', 'i'), hash('open', 'i'), hash('base', 'i'));
    const findings = await evaluateRoundTrip(ctxWith(modalPage(), opener), capture);
    assert.equal(findings.length, 0);
  });

  await check('a modal that leaks state after close → METAMORPHIC_STATE_LEAK', async () => {
    const capture = sequence(hash('base', 'i'), hash('open', 'i'), hash('base+leftover', 'i'));
    const findings = await evaluateRoundTrip(ctxWith(modalPage(), opener), capture);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].bugClass, 'METAMORPHIC_STATE_LEAK');
    assert.ok((findings[0].evidence?.reproductionPlaybook?.length ?? 0) >= 3);
  });

  await check('a click that opened nothing (state unchanged) → no finding', async () => {
    const capture = sequence(hash('base', 'i'), hash('base', 'i'), hash('base', 'i'));
    const findings = await evaluateRoundTrip(ctxWith(modalPage(), opener), capture);
    assert.equal(findings.length, 0);
  });

  await check('no layer-opener in ranked targets → not applicable, no finding', async () => {
    assert.equal(roundTripOracle.isApplicable(ctxWith(modalPage(), [])), false);
    const findings = await evaluateRoundTrip(ctxWith(modalPage(), []), sequence(hash('a', 'b')));
    assert.equal(findings.length, 0);
  });

  console.log(`\nroundTripOracle: ${passed} checks passed.`);
}

void main();
