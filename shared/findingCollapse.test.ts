// Self-executing checks for the canonical family collapse. Guards the occurrence contract
// "sum within origin, max across origins" that kills the server↔client ×2 doubling while
// preserving distinct within-origin manifestations. Run with `npx tsx "shared/findingCollapse.test.ts"`.

import assert from 'node:assert/strict';
import { collapseFindings, type CollapseAdapter } from './findingCollapse.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

interface F {
  sig: string;
  origin: 'server' | 'client';
  occ: number;
  steps?: string[];
  ts?: number;
  report?: boolean;
}

const adapter: CollapseAdapter<F> = {
  signatureInput: (f) => ({ reason: f.sig }),
  representative: (f) => ({ reproductionSteps: f.steps, timestamp: f.ts }),
  origin: (f) => f.origin,
  occurrences: (f) => f.occ,
  withOccurrences: (f, occ) => ({ ...f, occ }),
  reportable: (f) => f.report !== false,
};

check('a server family + its client twin -> max across origins, never summed (no ×2)', () => {
  const out = collapseFindings<F>([
    { sig: 'x', origin: 'server', occ: 1 },
    { sig: 'x', origin: 'server', occ: 1 },
    { sig: 'x', origin: 'server', occ: 1 },
    { sig: 'x', origin: 'client', occ: 3 },
  ], adapter);
  assert.equal(out.length, 1, 'one family');
  assert.equal(out[0].occ, 3, 'sum within origin = 3 on each side, max across = 3 (not 6)');
});

check('a server-only family sums its distinct within-origin manifestations', () => {
  const out = collapseFindings<F>([
    { sig: 'y', origin: 'server', occ: 5 },
    { sig: 'y', origin: 'server', occ: 10 },
  ], adapter);
  assert.equal(out[0].occ, 15, '15 identical 500s stay ×15');
});

check('a client-only family keeps its client total', () => {
  const out = collapseFindings<F>([{ sig: 'z', origin: 'client', occ: 4 }], adapter);
  assert.equal(out[0].occ, 4);
});

check('reportability drops noise before grouping', () => {
  const out = collapseFindings<F>([
    { sig: 'ok', origin: 'server', occ: 1 },
    { sig: 'noise', origin: 'server', occ: 1, report: false },
  ], adapter);
  assert.deepEqual(out.map((f) => f.sig), ['ok']);
});

check('first-seen family order is preserved for stable repeated saves', () => {
  const out = collapseFindings<F>([
    { sig: 'b', origin: 'server', occ: 1 },
    { sig: 'a', origin: 'server', occ: 1 },
    { sig: 'b', origin: 'server', occ: 1 },
  ], adapter);
  assert.deepEqual(out.map((f) => f.sig), ['b', 'a']);
});

check('the representative is the content-richest member, order-independent', () => {
  const forward = collapseFindings<F>([
    { sig: 'r', origin: 'server', occ: 1, steps: ['one'] },
    { sig: 'r', origin: 'server', occ: 1, steps: ['one', 'two', 'three'] },
  ], adapter);
  const reverse = collapseFindings<F>([
    { sig: 'r', origin: 'server', occ: 1, steps: ['one', 'two', 'three'] },
    { sig: 'r', origin: 'server', occ: 1, steps: ['one'] },
  ], adapter);
  assert.deepEqual(forward[0].steps, ['one', 'two', 'three']);
  assert.deepEqual(reverse[0].steps, ['one', 'two', 'three']);
});

console.log(`\nfindingCollapse.test.ts: ${passed} checks passed`);
