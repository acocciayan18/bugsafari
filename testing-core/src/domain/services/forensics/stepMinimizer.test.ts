// Self-executing checks for minimizeActionRecords. No runner configured in this package.
// Run with `npx tsx "src/domain/services/forensics/stepMinimizer.test.ts"`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import type { ActionRecord } from '../../../../../shared/types.ts';
import { minimizeActionRecords } from './stepMinimizer.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const at = (secondsFromBase: number): string => new Date(1_000_000 + secondsFromBase * 1000).toISOString();
const rec = (over: Partial<ActionRecord>): ActionRecord => ({
  timestamp: at(0),
  type: 'CLICK',
  selector: 'button',
  url: 'https://app.test/home',
  ...over,
});

check('drops actions recorded after the fault instant', () => {
  const records = [
    rec({ timestamp: at(1), selector: '#a' }),
    rec({ timestamp: at(5), selector: '#after-fault' }),
  ];
  const out = minimizeActionRecords(records, { faultUrl: 'https://app.test/home', faultAtMs: Date.parse(at(2)) });
  assert.ok(!out.some((r) => r.selector === '#after-fault'), 'post-fault action leaked into steps');
});

check('cuts history back to the last entry into the faulting page', () => {
  const records = [
    rec({ type: 'NAVIGATE', selector: '', url: 'https://app.test/list', timestamp: at(1) }),
    rec({ selector: '#unrelated-on-list', url: 'https://app.test/list', timestamp: at(2) }),
    rec({ type: 'NAVIGATE', selector: '', url: 'https://app.test/detail', timestamp: at(3) }),
    rec({ selector: '#trigger', url: 'https://app.test/detail', timestamp: at(4) }),
  ];
  const out = minimizeActionRecords(records, { faultUrl: 'https://app.test/detail', faultAtMs: Date.parse(at(5)) });
  assert.equal(out[0].type, 'NAVIGATE');
  assert.equal(out[0].url, 'https://app.test/detail');
  assert.ok(!out.some((r) => r.selector === '#unrelated-on-list'), 'pre-entry action leaked in');
  assert.equal(out[out.length - 1].selector, '#trigger');
});

check('keeps the one control click that navigated INTO the faulting page', () => {
  const records = [
    rec({ selector: '#open-detail', url: 'https://app.test/list', timestamp: at(1) }),
    rec({ selector: '#trigger', url: 'https://app.test/detail', timestamp: at(2) }),
  ];
  const out = minimizeActionRecords(records, { faultUrl: 'https://app.test/detail', faultAtMs: Date.parse(at(3)) });
  assert.ok(out.some((r) => r.selector === '#open-detail'), 'the entering control click was dropped');
});

check('collapses consecutive identical actions into one repeatCount step', () => {
  const records = [
    rec({ selector: '#spam', url: 'https://app.test/home', timestamp: at(1) }),
    rec({ selector: '#spam', url: 'https://app.test/home', timestamp: at(2) }),
    rec({ selector: '#spam', url: 'https://app.test/home', timestamp: at(3) }),
  ];
  const out = minimizeActionRecords(records, { faultUrl: 'https://app.test/home', faultAtMs: Date.parse(at(4)) });
  const spam = out.filter((r) => r.selector === '#spam');
  assert.equal(spam.length, 1);
  assert.equal(spam[0].repeatCount, 3);
});

check('caps the timeline and keeps the steps closest to the fault', () => {
  const records = Array.from({ length: 30 }, (_, i) =>
    rec({ selector: `#s${i}`, url: 'https://app.test/home', timestamp: at(i + 1) }),
  );
  const out = minimizeActionRecords(records, {
    faultUrl: 'https://app.test/home',
    faultAtMs: Date.parse(at(40)),
    maxSteps: 5,
  });
  assert.ok(out.length <= 6, `expected <=6 steps (incl. synthetic nav), got ${out.length}`);
  assert.equal(out[out.length - 1].selector, '#s29', 'did not keep the action closest to the fault');
});

check('always opens with a navigation for context', () => {
  const records = [rec({ selector: '#only', url: 'https://app.test/home', timestamp: at(1) })];
  const out = minimizeActionRecords(records, { faultUrl: 'https://app.test/home', faultAtMs: Date.parse(at(2)) });
  assert.ok(['NAVIGATE', 'NAVIGATION'].includes(out[0].type), 'timeline did not start with navigation');
});

check('empty buffer yields a single navigation to the fault page', () => {
  const out = minimizeActionRecords([], { faultUrl: 'https://app.test/home', faultAtMs: Date.parse(at(1)) });
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'NAVIGATE');
  assert.equal(out[0].url, 'https://app.test/home');
});

console.log(`\nstepMinimizer: ${passed} checks passed.`);
