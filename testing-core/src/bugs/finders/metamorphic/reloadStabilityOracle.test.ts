// Self-executing tests for the reload-stability oracle. Browser-free.
// Run: `npx tsx src/bugs/finders/metamorphic/reloadStabilityOracle.test.ts`.

import assert from 'node:assert/strict';
import type { BugContext } from '../../types.js';
import type { CompoundStateHash } from '../../../ml/domHasher.js';
import { evaluateReloadStability, reloadStabilityOracle } from './reloadStabilityOracle.js';

let passed = 0;
function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ✓ ${name}`);
  });
}

const hash = (s: string): CompoundStateHash => ({ structure: s, interactive: 'i', routePath: '/p', combined: s });
const sequence = (...states: CompoundStateHash[]) => {
  let i = 0;
  return async (): Promise<CompoundStateHash> => states[Math.min(i++, states.length - 1)];
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
    const findings = await evaluateReloadStability(ctx('https://app.test/cart'), sequence(hash('a'), hash('a')));
    assert.equal(findings.length, 0);
  });

  await check('reload changes the page (lost/duplicated state) → RELOAD_STATE_CORRUPTION', async () => {
    const findings = await evaluateReloadStability(ctx('https://app.test/cart'), sequence(hash('a'), hash('a+dup')));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].bugClass, 'RELOAD_STATE_CORRUPTION');
  });

  await check('a non-http route is skipped', async () => {
    const findings = await evaluateReloadStability(ctx('about:blank'), sequence(hash('a'), hash('b')));
    assert.equal(findings.length, 0);
  });

  await check('isApplicable samples at the offset step (% 8 === 4), off idempotence', async () => {
    assert.equal(reloadStabilityOracle.isApplicable(ctx('https://app.test/cart', 4)), true);
    assert.equal(reloadStabilityOracle.isApplicable(ctx('https://app.test/cart', 8)), false);
    assert.equal(reloadStabilityOracle.isApplicable(ctx('about:blank', 4)), false);
  });

  console.log(`\nreloadStabilityOracle: ${passed} checks passed.`);
}

void main();
