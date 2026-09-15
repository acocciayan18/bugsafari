// Self-executing tests for the read-idempotence oracle. Browser-free.
// Run: `npx tsx src/bugs/finders/metamorphic/idempotenceOracle.test.ts`.

import assert from 'node:assert/strict';
import type { BugContext } from '../../types.js';
import type { CompoundObservation } from './relations.js';
import { evaluateIdempotence, idempotenceOracle } from './idempotenceOracle.js';
import { VolatilityModel } from '../../../domain/services/baseline/volatilityModel.js';

let passed = 0;
function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ✓ ${name}`);
  });
}

const obs = (s: string, paths: Record<string, string> = {}): CompoundObservation => ({
  hash: { structure: s, interactive: 'i', routePath: '/p', combined: s },
  paths: new Map(Object.entries(paths)),
});
// Capture stub: returns first, second, third load in order.
const sequence = (...states: CompoundObservation[]) => {
  let i = 0;
  return async (): Promise<CompoundObservation> => states[Math.min(i++, states.length - 1)];
};

function page(url: string) {
  const noop = async (): Promise<void> => undefined;
  return { url: () => url, goto: noop, reload: noop } as unknown as BugContext['page'];
}
function ctx(url: string, step = 8): BugContext {
  return { page: page(url), targetUrl: url, step, stateHash: 'sh', crashHalted: false, rankedTargets: [] } as BugContext;
}

async function main(): Promise<void> {
  console.log('metamorphic/idempotenceOracle — two fresh loads must agree');

  await check('two identical fresh loads → no finding', async () => {
    VolatilityModel.reset();
    const findings = await evaluateIdempotence(ctx('https://app.test/list'), sequence(obs('a'), obs('a'), obs('a')));
    assert.equal(findings.length, 0);
  });

  await check('two diverging fresh loads → NON_IDEMPOTENT_ACTION', async () => {
    VolatilityModel.reset();
    const findings = await evaluateIdempotence(ctx('https://app.test/list'), sequence(obs('a'), obs('b'), obs('b')));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].bugClass, 'NON_IDEMPOTENT_ACTION');
  });

  await check('a non-http route is skipped', async () => {
    VolatilityModel.reset();
    const findings = await evaluateIdempotence(ctx('about:blank'), sequence(obs('a'), obs('b'), obs('b')));
    assert.equal(findings.length, 0);
  });

  await check('isApplicable samples sparsely (step % 8) and only on http routes', async () => {
    assert.equal(idempotenceOracle.isApplicable(ctx('https://app.test/list', 8)), true);
    assert.equal(idempotenceOracle.isApplicable(ctx('https://app.test/list', 9)), false);
    assert.equal(idempotenceOracle.isApplicable(ctx('about:blank', 8)), false);
  });

  await check('two loads differing only by a per-load nonce → suppressed (no finding)', async () => {
    VolatilityModel.reset();
    const findings = await evaluateIdempotence(
      ctx('https://app.test/list'),
      sequence(
        obs('load', { 'body#value': 'AAAAAAAAAAAAAAAAAAAAAAAA' }),
        obs('load2', { 'body#value': 'BBBBBBBBBBBBBBBBBBBBBBBB' }),
        obs('load3', { 'body#value': 'CCCCCCCCCCCCCCCCCCCCCCCC' }),
      ),
    );
    assert.equal(findings.length, 0);
  });

  console.log(`\nidempotenceOracle: ${passed} checks passed.`);
}

void main();
