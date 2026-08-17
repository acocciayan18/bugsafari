// Self-executing checks for the JSON.parse contract fault → offending endpoint correlator.
// Run with `npx tsx "src/domain/services/telemetry/contractCorrelation.test.ts"`.

import assert from 'node:assert/strict';
import { ContractResponseCorrelator, looksNonJsonBody } from './contractCorrelation.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('\nContract response correlation\n');

const API = 'https://app.io/api/profile';

check('an HTML body is flagged non-JSON; a JSON body is not', () => {
  assert.equal(looksNonJsonBody('<!DOCTYPE html><html>...'), true);
  assert.equal(looksNonJsonBody('  \n  <html>'), true, 'leading whitespace is trimmed');
  assert.equal(looksNonJsonBody('{"ok":true}'), false);
  assert.equal(looksNonJsonBody('[1,2,3]'), false);
  assert.equal(looksNonJsonBody(''), false);
});

check('a JSON.parse fault inside the window is routed to the parked endpoint', () => {
  const c = new ContractResponseCorrelator(5000);
  c.record(API, 'GET', 1000);
  assert.deepEqual(c.correlate(2000), { url: API, method: 'GET' });
});

check('a fault outside the window correlates nothing (page url is kept)', () => {
  const c = new ContractResponseCorrelator(5000);
  c.record(API, 'GET', 1000);
  assert.equal(c.correlate(9000), undefined);
});

check('a response that settled AFTER the fault is never blamed', () => {
  const c = new ContractResponseCorrelator(5000);
  c.record(API, 'GET', 3000);
  assert.equal(c.correlate(2000), undefined);
});

check('the newest in-window endpoint wins when several are parked', () => {
  const c = new ContractResponseCorrelator(5000);
  c.record('https://app.io/api/old', 'GET', 1000);
  c.record(API, 'POST', 1800);
  assert.deepEqual(c.correlate(2000), { url: API, method: 'POST' });
});

check('the buffer is bounded — a storm cannot grow memory', () => {
  const c = new ContractResponseCorrelator(5000, 3);
  for (let i = 0; i < 10; i += 1) c.record(`${API}/${i}`, 'GET', 1000 + i);
  assert.equal(c.size, 3);
  // Only the 3 most-recent survive; the oldest kept is index 7.
  assert.deepEqual(c.correlate(1009), { url: `${API}/9`, method: 'GET' });
});

console.log(`\n${passed} checks passed\n`);
