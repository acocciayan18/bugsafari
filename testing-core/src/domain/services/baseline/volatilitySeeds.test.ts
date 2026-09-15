// Self-executing tests for volatilitySeeds (pure). Run: `npx tsx src/domain/services/baseline/volatilitySeeds.test.ts`.

import assert from 'node:assert/strict';
import { isSeededVolatile } from './volatilitySeeds.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('baseline/volatilitySeeds — format-based cold-start detectors');

check('ISO timestamps are seeded volatile', () => {
  assert.equal(isSeededVolatile('2026-09-15T10:00:00Z'), true);
  assert.equal(isSeededVolatile('2026-09-15 10:00'), true);
});

check('unix epoch (s and ms) is seeded volatile', () => {
  assert.equal(isSeededVolatile('1757930400'), true);
  assert.equal(isSeededVolatile('1757930400123'), true);
});

check('UUID / JWT / long opaque tokens are seeded volatile', () => {
  assert.equal(isSeededVolatile('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.equal(isSeededVolatile('aaa.bbb.ccc'), true);
  assert.equal(isSeededVolatile('abcdefghijklmnopqrstuvwx'), true);
});

check('a clock time embedded in text is seeded volatile', () => {
  assert.equal(isSeededVolatile('Last updated 10:05'), true);
});

check('ordinary short/stable content is not seeded volatile', () => {
  assert.equal(isSeededVolatile('Add to cart'), false);
  assert.equal(isSeededVolatile('42'), false);
  assert.equal(isSeededVolatile(''), false);
  assert.equal(isSeededVolatile('Product name'), false);
});

console.log(`\nvolatilitySeeds: ${passed} checks passed.`);
