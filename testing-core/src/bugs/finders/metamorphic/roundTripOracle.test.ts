// Self-executing tests for the round-trip (reversibility) oracle. Browser-free: the
// page is a duck-typed mock and the compound-capture is injected.
// Run: `npx tsx src/bugs/finders/metamorphic/roundTripOracle.test.ts`.

import assert from 'node:assert/strict';
import type { BugContext } from '../../types.js';
import type { InteractiveElement } from '../../../domain/entities/InteractiveElement.js';
import type { CompoundObservation } from './relations.js';
import { evaluateRoundTrip, roundTripOracle } from './roundTripOracle.js';
import { VolatilityModel } from '../../../domain/services/baseline/volatilityModel.js';

let passed = 0;
function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ✓ ${name}`);
  });
}

// An observation: compound hash plus a field-level DOM path map.
const obs = (s: string, i: string, paths: Record<string, string> = {}): CompoundObservation => ({
  hash: { structure: s, interactive: i, routePath: '/m', combined: `${s}:${i}` },
  paths: new Map(Object.entries(paths)),
});

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

// Capture stub: returns baseline, baseline2, opened, closed in order.
const sequence = (...states: CompoundObservation[]) => {
  let i = 0;
  return async (): Promise<CompoundObservation> => states[Math.min(i++, states.length - 1)];
};

async function main(): Promise<void> {
  console.log('metamorphic/roundTripOracle — reversibility');

  await check('a modal that closes cleanly (state restored) → no finding', async () => {
    VolatilityModel.reset();
    const capture = sequence(obs('base', 'i'), obs('base', 'i'), obs('open', 'i'), obs('base', 'i'));
    const findings = await evaluateRoundTrip(ctxWith(modalPage(), opener), capture);
    assert.equal(findings.length, 0);
  });

  await check('a modal that leaks state after close → METAMORPHIC_STATE_LEAK', async () => {
    VolatilityModel.reset();
    const capture = sequence(obs('base', 'i'), obs('base', 'i'), obs('open', 'i'), obs('base+leftover', 'i'));
    const findings = await evaluateRoundTrip(ctxWith(modalPage(), opener), capture);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].bugClass, 'METAMORPHIC_STATE_LEAK');
    assert.ok((findings[0].evidence?.reproductionPlaybook?.length ?? 0) >= 3);
  });

  await check('a click that opened nothing (state unchanged) → no finding', async () => {
    VolatilityModel.reset();
    const capture = sequence(obs('base', 'i'), obs('base', 'i'), obs('base', 'i'), obs('base', 'i'));
    const findings = await evaluateRoundTrip(ctxWith(modalPage(), opener), capture);
    assert.equal(findings.length, 0);
  });

  await check('no layer-opener in ranked targets → not applicable, no finding', async () => {
    VolatilityModel.reset();
    assert.equal(roundTripOracle.isApplicable(ctxWith(modalPage(), [])), false);
    const findings = await evaluateRoundTrip(ctxWith(modalPage(), []), sequence(obs('a', 'b')));
    assert.equal(findings.length, 0);
  });

  await check('a leak whose only field change is a ticking clock → suppressed (no finding)', async () => {
    VolatilityModel.reset();
    const capture = sequence(
      obs('base', 'i', { 'body#t': '10:00:00' }),
      obs('base', 'i', { 'body#t': '10:00:01' }),
      obs('open', 'i'),
      obs('base2', 'i', { 'body#t': '10:00:05' }),
    );
    const findings = await evaluateRoundTrip(ctxWith(modalPage(), opener), capture);
    assert.equal(findings.length, 0);
  });

  await check('a real leftover alongside a ticking clock still → METAMORPHIC_STATE_LEAK', async () => {
    VolatilityModel.reset();
    const capture = sequence(
      obs('base', 'i', { 'body#t': '10:00:00', 'x#t': 'A' }),
      obs('base', 'i', { 'body#t': '10:00:01', 'x#t': 'A' }),
      obs('open', 'i'),
      obs('base2', 'i', { 'body#t': '10:00:05', 'x#t': 'B' }),
    );
    const findings = await evaluateRoundTrip(ctxWith(modalPage(), opener), capture);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].bugClass, 'METAMORPHIC_STATE_LEAK');
  });

  // ── Two-cycle corroboration (fb-test.txt #4: a single-cycle residue was 75% and weak) ──

  await check('a residue that self-heals on the second open/close cycle → no finding', async () => {
    VolatilityModel.reset();
    // base, base2, open1, closed1(leftover), open2, closed2(restored)
    const capture = sequence(
      obs('base', 'i'), obs('base', 'i'), obs('open', 'i'), obs('base+leftover', 'i'), obs('open', 'i'), obs('base', 'i'),
    );
    const findings = await evaluateRoundTrip(ctxWith(modalPage(), opener), capture);
    assert.equal(findings.length, 0, 'a residue reconciled by the next interaction is not a leak');
  });

  await check('a stable leftover that PERSISTS across both cycles → METAMORPHIC_STATE_LEAK', async () => {
    VolatilityModel.reset();
    // x#t is stable (unchanged across the two action-free baselines) and stays leaked (A→B) after both closes.
    const capture = sequence(
      obs('base', 'i', { 'x#t': 'A' }), obs('base', 'i', { 'x#t': 'A' }),
      obs('open', 'i'), obs('base2', 'i', { 'x#t': 'B' }),
      obs('open', 'i'), obs('base2', 'i', { 'x#t': 'B' }),
    );
    const findings = await evaluateRoundTrip(ctxWith(modalPage(), opener), capture);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].bugClass, 'METAMORPHIC_STATE_LEAK');
    assert.ok((findings[0].evidence?.reproductionPlaybook?.length ?? 0) >= 4, 'repro guide names the second cycle');
  });

  await check('a residue that SHIFTS to a different field on cycle 2 → no finding', async () => {
    VolatilityModel.reset();
    // x#t leaks on cycle 1, y#t on cycle 2 — the leftover is not the same, so it is not corroborated.
    const capture = sequence(
      obs('base', 'i', { 'x#t': 'A', 'y#t': 'A' }), obs('base', 'i', { 'x#t': 'A', 'y#t': 'A' }),
      obs('open', 'i'), obs('base2', 'i', { 'x#t': 'B', 'y#t': 'A' }),
      obs('open', 'i'), obs('base3', 'i', { 'x#t': 'A', 'y#t': 'B' }),
    );
    const findings = await evaluateRoundTrip(ctxWith(modalPage(), opener), capture);
    assert.equal(findings.length, 0, 'a non-repeating residue is not a persistent leak');
  });

  console.log(`\nroundTripOracle: ${passed} checks passed.`);
}

void main();
