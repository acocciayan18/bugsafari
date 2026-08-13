// Self-executing checks for reproduction-step minimization: burst scoping + culprit
// anchoring drop unrelated exploration, and a timeline with no match is left intact.
// No runner configured here; the package runner (scripts/run-tests.mjs) discovers it.
// Run directly: `npx tsx "src/domain/services/forensics/stepMinimizer.test.ts"`.

import assert from 'node:assert/strict';
import type { ActionRecord } from '../../../../../shared/types.js';
import { minimizeActionRecords } from './stepMinimizer.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const rec = (over: Partial<ActionRecord>): ActionRecord =>
  ({ timestamp: '2020-01-01T00:00:00.000Z', type: 'CLICK', selector: '', url: 'http://app.test/page', ...over });

check('burstId scoping keeps only the burst actions plus an opening navigation', () => {
  const out = minimizeActionRecords(
    [
      rec({ type: 'NAVIGATE', url: 'http://app.test/home' }),
      rec({ selector: '#explore', url: 'http://app.test/home' }), // unrelated exploration
      rec({ selector: '#buy', url: 'http://app.test/cart', burstId: 'b1' }),
      rec({ selector: '#buy', url: 'http://app.test/cart', burstId: 'b1' }),
    ],
    { burstId: 'b1' },
  );
  assert.equal(out.every((r) => r.type === 'NAVIGATE' || r.burstId === 'b1'), true);
  assert.equal(out.some((r) => r.selector === '#explore'), false, 'unrelated click dropped');
  assert.equal(out[0].type, 'NAVIGATE', 'opens with a navigation');
});

check('culpritSelector anchoring drops an interior exploration navigation before the culprit', () => {
  const out = minimizeActionRecords(
    [
      rec({ type: 'NAVIGATE', url: 'http://app.test/form' }),
      // exploration hop: a click that navigated away and back is traversal, not setup
      rec({ selector: '#nav-away', url: 'http://app.test/form', outcome: { navigatedTo: 'http://app.test/other' } }),
      rec({ type: 'NAVIGATE', url: 'http://app.test/form' }),
      rec({ type: 'TYPE', selector: '#email', url: 'http://app.test/form', payload: 'a@b.c' }), // real setup
      rec({ type: 'SUBMIT', selector: '#submit', url: 'http://app.test/form' }), // culprit
    ],
    { faultUrl: 'http://app.test/form', culpritSelector: '#submit' },
  );
  assert.equal(out.some((r) => r.selector === '#nav-away'), false, 'traversal click dropped');
  assert.equal(out.some((r) => r.selector === '#email'), true, 'setup input kept');
  assert.equal(out.some((r) => r.selector === '#submit'), true, 'culprit kept');
});

check('culpritSelector drops simultaneous burst siblings on other controls', () => {
  const out = minimizeActionRecords(
    [
      rec({ type: 'NAVIGATE', url: 'http://app.test/race' }),
      rec({ selector: '#start', url: 'http://app.test/race', burstId: 'b9' }), // culprit
      rec({ selector: '#reset', url: 'http://app.test/race', burstId: 'b9' }), // simultaneous sibling
      rec({ selector: '#other', url: 'http://app.test/race', burstId: 'b9' }), // simultaneous sibling
    ],
    { faultUrl: 'http://app.test/race', culpritSelector: '#start' },
  );
  assert.equal(out.some((r) => r.selector === '#reset'), false, 'sibling #reset dropped');
  assert.equal(out.some((r) => r.selector === '#other'), false, 'sibling #other dropped');
  assert.equal(out.some((r) => r.selector === '#start'), true, 'culprit kept');
});

check('culpritSelector keeps genuine non-burst setup while dropping burst siblings', () => {
  const out = minimizeActionRecords(
    [
      rec({ type: 'NAVIGATE', url: 'http://app.test/race' }),
      rec({ type: 'TYPE', selector: '#name', url: 'http://app.test/race', payload: 'x' }), // real setup, no burst
      rec({ selector: '#start', url: 'http://app.test/race', burstId: 'b9' }), // culprit
      rec({ selector: '#reset', url: 'http://app.test/race', burstId: 'b9' }), // simultaneous sibling
    ],
    { faultUrl: 'http://app.test/race', culpritSelector: '#start' },
  );
  assert.equal(out.some((r) => r.selector === '#name'), true, 'non-burst setup kept');
  assert.equal(out.some((r) => r.selector === '#reset'), false, 'burst sibling dropped');
  assert.equal(out.some((r) => r.selector === '#start'), true, 'culprit kept');
});

check('a timeline with no culprit match is left exactly as page/time scoping produced it', () => {
  const records = [
    rec({ type: 'NAVIGATE', url: 'http://app.test/form' }),
    rec({ selector: '#a', url: 'http://app.test/form' }),
    rec({ selector: '#b', url: 'http://app.test/form' }),
  ];
  const withCulprit = minimizeActionRecords(records, { faultUrl: 'http://app.test/form', culpritSelector: '#missing' });
  const without = minimizeActionRecords(records, { faultUrl: 'http://app.test/form' });
  assert.deepEqual(withCulprit.map((r) => r.selector), without.map((r) => r.selector));
});

console.log(`\n${passed} assertions passed.`);
