// Self-executing deterministic tests for the cross-cutting unicode-chaos layer.
// No unit runner is configured, so run via:
//   npx tsx src/domain/scenarios/fuzzing/payloadEscalator.test.ts

import assert from 'node:assert/strict';
import { synthesizeEscalatedPayload, deriveFuzzSeed } from './payloadEscalator.js';
import { getUnicodeChaosTokens } from './strategies/chaosFallbackStrategy.js';
import type { FieldCategory } from './elementClassifier.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const CHAOS = getUnicodeChaosTokens();
const seedFor = (cat: FieldCategory) => deriveFuzzSeed('#field', cat);

console.log('payloadEscalator — cross-cutting unicode-chaos layer');

check('L0 TEXT_SEARCH carries no unicode-chaos layer (L0 stays clean)', () => {
  const p = synthesizeEscalatedPayload('TEXT_SEARCH', 0, seedFor('TEXT_SEARCH'));
  assert.ok(!p.description.includes('unicode-chaos'), 'L0 must not inject chaos');
  assert.ok(!CHAOS.some((t) => t.length > 0 && p.value.startsWith(t)), 'L0 has no chaos prefix');
});

check('L1 prepends a unicode-chaos token for every TEXT_ACCEPTING category', () => {
  for (const cat of ['TEXT_SEARCH', 'DATABASE_AUTH', 'EMAIL', 'JSON'] as FieldCategory[]) {
    const p = synthesizeEscalatedPayload(cat, 1, seedFor(cat));
    assert.ok(p.description.includes('unicode-chaos'), `${cat} L1 missing unicode-chaos layer`);
    assert.ok(CHAOS.some((t) => t.length > 0 && p.value.startsWith(t)), `${cat} L1 not chaos-prefixed`);
  }
});

check('NUMERIC and DATE carry no unicode-chaos layer at L1', () => {
  for (const cat of ['NUMERIC', 'DATE'] as FieldCategory[]) {
    const p = synthesizeEscalatedPayload(cat, 1, seedFor(cat));
    assert.ok(!p.description.includes('unicode-chaos'), `${cat} must not receive chaos`);
  }
});

check('CHAOS_FALLBACK is not double-dosed (chaos is its base, not an added layer)', () => {
  const p = synthesizeEscalatedPayload('CHAOS_FALLBACK', 1, seedFor('CHAOS_FALLBACK'));
  assert.ok(!p.description.includes('unicode-chaos'), 'fallback already draws chaos as base');
});

check('identical (category, level, seed, cursor) replays byte-for-byte', () => {
  const seed = seedFor('EMAIL');
  const a = synthesizeEscalatedPayload('EMAIL', 2, seed, 3);
  const b = synthesizeEscalatedPayload('EMAIL', 2, seed, 3);
  assert.equal(a.value, b.value);
});

check('advancing the cursor sweeps to a different chaos token', () => {
  const seed = seedFor('TEXT_SEARCH');
  const a = synthesizeEscalatedPayload('TEXT_SEARCH', 1, seed, 0);
  const b = synthesizeEscalatedPayload('TEXT_SEARCH', 1, seed, 1);
  assert.notEqual(a.value, b.value, 'cursor+1 must change the payload');
});

check('cursor sweep covers many distinct base vectors (pool is utilized)', () => {
  const seed = seedFor('DATABASE_AUTH');
  const seen = new Set<string>();
  for (let cursor = 0; cursor < 40; cursor++) {
    seen.add(synthesizeEscalatedPayload('DATABASE_AUTH', 0, seed, cursor).value);
  }
  assert.ok(seen.size >= 20, `expected >=20 distinct SQL/NoSQL vectors, got ${seen.size}`);
});

check('salting the seed varies the vector across runs (run-to-run diversity)', () => {
  const base = deriveFuzzSeed('#login', 'DATABASE_AUTH');
  const values = new Set<string>();
  for (let i = 0; i < 8; i++) {
    const salted = (base ^ (i * 0x9e3779b1)) >>> 0;
    values.add(synthesizeEscalatedPayload('DATABASE_AUTH', 0, salted, 0).value);
  }
  assert.ok(values.size >= 2, `expected varied vectors across salts, got ${values.size}`);
});

console.log(`\npayloadEscalator: ${passed} checks passed.`);
