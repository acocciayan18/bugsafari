// Self-executing tests for the reload-stability oracle. Browser-free.
// Run: `npx tsx src/bugs/finders/metamorphic/reloadStabilityOracle.test.ts`.

import assert from 'node:assert/strict';
import type { BugContext } from '../../types.js';
import type { CompoundObservation } from './relations.js';
import { evaluateReloadStability, reloadStabilityOracle } from './reloadStabilityOracle.js';
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
// Capture stub: returns fresh, reload1, reload2 in order.
const sequence = (...states: CompoundObservation[]) => {
  let i = 0;
  return async (): Promise<CompoundObservation> => states[Math.min(i++, states.length - 1)];
};

function page(url: string) {
  const noop = async (): Promise<void> => undefined;
  return { url: () => url, goto: noop, reload: noop } as unknown as BugContext['page'];
}
// step 4 satisfies step % 8 === 4 (the reload oracle's sampling offset).
function ctx(url: string, step = 4): BugContext {
  return { page: page(url), targetUrl: url, step, stateHash: 'sh', crashHalted: false, rankedTargets: [] } as BugContext;
}

async function main(): Promise<void> {
  console.log('metamorphic/reloadStabilityOracle — a reload must reproduce the fresh load');

  await check('reload reproduces the fresh load → no finding', async () => {
    VolatilityModel.reset();
    const findings = await evaluateReloadStability(ctx('https://app.test/cart'), sequence(obs('a'), obs('a'), obs('a')));
    assert.equal(findings.length, 0);
  });

  await check('reload changes the page (lost/duplicated state) → RELOAD_STATE_CORRUPTION', async () => {
    VolatilityModel.reset();
    const findings = await evaluateReloadStability(ctx('https://app.test/cart'), sequence(obs('a'), obs('a+dup'), obs('a+dup')));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].bugClass, 'RELOAD_STATE_CORRUPTION');
  });

  await check('a non-http route is skipped', async () => {
    VolatilityModel.reset();
    const findings = await evaluateReloadStability(ctx('about:blank'), sequence(obs('a'), obs('b'), obs('b')));
    assert.equal(findings.length, 0);
  });

  await check('isApplicable samples at the offset step (% 8 === 4), off idempotence', async () => {
    assert.equal(reloadStabilityOracle.isApplicable(ctx('https://app.test/cart', 4)), true);
    assert.equal(reloadStabilityOracle.isApplicable(ctx('https://app.test/cart', 8)), false);
    assert.equal(reloadStabilityOracle.isApplicable(ctx('about:blank', 4)), false);
  });

  await check('a per-load token that churns every reload → suppressed (no finding)', async () => {
    VolatilityModel.reset();
    const findings = await evaluateReloadStability(
      ctx('https://app.test/cart'),
      sequence(
        obs('load', { 'body#value': 'AAAAAAAAAAAAAAAAAAAAAAAA' }),
        obs('load2', { 'body#value': 'BBBBBBBBBBBBBBBBBBBBBBBB' }),
        obs('load3', { 'body#value': 'CCCCCCCCCCCCCCCCCCCCCCCC' }),
      ),
    );
    assert.equal(findings.length, 0);
  });

  await check('a duplicated row alongside a churning token still → RELOAD_STATE_CORRUPTION', async () => {
    VolatilityModel.reset();
    const findings = await evaluateReloadStability(
      ctx('https://app.test/cart'),
      sequence(
        obs('load', { 'body#value': 'AAAAAAAAAAAAAAAAAAAAAAAA', 'row#t': '1' }),
        obs('load2', { 'body#value': 'BBBBBBBBBBBBBBBBBBBBBBBB', 'row#t': '1, 1' }),
        obs('load3', { 'body#value': 'CCCCCCCCCCCCCCCCCCCCCCCC', 'row#t': '1, 1' }),
      ),
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].bugClass, 'RELOAD_STATE_CORRUPTION');
  });

  console.log(`\nreloadStabilityOracle: ${passed} checks passed.`);
}

void main();
