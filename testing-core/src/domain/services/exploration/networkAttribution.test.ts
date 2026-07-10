// Standalone deterministic tests for the pure network-signal attribution gate.
// Run via `npm test` or `npx tsx .../networkAttribution.test.ts`.

import assert from 'node:assert/strict';
import { shouldAttributeNetworkSignal } from './networkAttribution.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('networkAttribution — causal xhr/fetch reward gate');

const base = { windowMs: 2000, maxPerAction: 3 };

check('attributes a prompt request under the cap', () => {
  assert.equal(shouldAttributeNetworkSignal({ ...base, msSinceAction: 250, rewardsThisAction: 0 }), true);
});

check('attributes at the window edge', () => {
  assert.equal(shouldAttributeNetworkSignal({ ...base, msSinceAction: 2000, rewardsThisAction: 1 }), true);
});

check('rejects a request past the causal window (background chatter)', () => {
  assert.equal(shouldAttributeNetworkSignal({ ...base, msSinceAction: 2001, rewardsThisAction: 0 }), false);
});

check('rejects once the per-action cap is reached', () => {
  assert.equal(shouldAttributeNetworkSignal({ ...base, msSinceAction: 100, rewardsThisAction: 3 }), false);
});

check('rejects a long-idle target (stale acted element across steps)', () => {
  // socket.io keeps polling long after the click — never re-attribute to it.
  assert.equal(shouldAttributeNetworkSignal({ ...base, msSinceAction: 60000, rewardsThisAction: 0 }), false);
});

console.log(`\nnetworkAttribution: ${passed} checks passed.`);
