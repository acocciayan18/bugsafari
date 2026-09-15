// Self-executing checks for the network-fault reproduction anchor. Run with
// `npx tsx "src/domain/services/telemetry/faultUrlAnchor.test.ts"`.

import assert from 'node:assert/strict';
import { resolveReproFaultUrl } from './faultUrlAnchor.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const START = 'https://app.io/products/p11';
const LAST = 'https://app.io/products/p9';
const PAGE = 'https://app.io/';

console.log('\nfaultUrlAnchor — reproduction anchor precedence\n');

check('the request-start url wins over last-known and page url', () => {
  assert.equal(resolveReproFaultUrl(START, LAST, PAGE), START);
});

check('falls back to last-known when the start url is undefined', () => {
  assert.equal(resolveReproFaultUrl(undefined, LAST, PAGE), LAST);
});

check('falls back to last-known when the start url is empty', () => {
  assert.equal(resolveReproFaultUrl('', LAST, PAGE), LAST);
});

check('falls back to the page url when start and last-known are both empty', () => {
  assert.equal(resolveReproFaultUrl(undefined, '', PAGE), PAGE);
});

check('returns empty when nothing is known', () => {
  assert.equal(resolveReproFaultUrl(undefined, undefined, undefined), '');
});

console.log(`\n${passed} faultUrlAnchor checks passed.`);
