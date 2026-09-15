// Self-executing tests for the volatility model. Run: `npx tsx src/domain/services/baseline/volatilityModel.test.ts`.

import assert from 'node:assert/strict';
import { VolatilityModel } from './volatilityModel.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const map = (o: Record<string, string>) => new Map(Object.entries(o));

console.log('baseline/volatilityModel — learn, seed, stableDiff');

check('a path differing across two action-free samples becomes volatile', () => {
  VolatilityModel.reset();
  VolatilityModel.record('r1', map({ counter: 'a1', title: 'Home' }), map({ counter: 'a2', title: 'Home' }));
  const stable = VolatilityModel.stableDiff('r1', map({ counter: 'a1', title: 'Home' }), map({ counter: 'a9', title: 'Dashboard' }));
  assert.equal(stable.has('counter'), false); // learned volatile
  assert.equal(stable.has('title'), true); // real change survives
  assert.equal(stable.size, 1);
});

check('a path that only differs after an action stays stable (never recorded)', () => {
  VolatilityModel.reset();
  const stable = VolatilityModel.stableDiff('r2', map({ btn: 'A' }), map({ btn: 'B' }));
  assert.equal(stable.has('btn'), true);
});

check('seeded dynamic formats are volatile without any learning', () => {
  VolatilityModel.reset();
  const stable = VolatilityModel.stableDiff('r3', map({ t: '10:00:00' }), map({ t: '10:00:05' }));
  assert.equal(stable.size, 0);
});

check('reset clears learned volatility', () => {
  VolatilityModel.reset();
  VolatilityModel.record('r4', map({ x: 'p' }), map({ x: 'q' }));
  assert.equal(VolatilityModel.isVolatile('r4', 'x'), true);
  VolatilityModel.reset();
  assert.equal(VolatilityModel.isVolatile('r4', 'x'), false);
});

check('per-key volatile paths are capped (LRU eviction of oldest)', () => {
  VolatilityModel.reset();
  const a: Record<string, string> = {};
  const b: Record<string, string> = {};
  for (let i = 0; i < 600; i++) {
    a[`p${i}`] = 'x';
    b[`p${i}`] = 'y';
  }
  VolatilityModel.record('r5', map(a), map(b));
  assert.equal(VolatilityModel.isVolatile('r5', 'p0'), false); // oldest evicted past the 512 cap
  assert.equal(VolatilityModel.isVolatile('r5', 'p599'), true); // newest retained
});

console.log(`\nvolatilityModel: ${passed} checks passed.`);
