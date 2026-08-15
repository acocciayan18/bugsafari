// Self-executing deterministic tests for field-aware boundary derivation. No unit
// runner is configured, so run via `npx tsx src/domain/scenarios/fuzzing/dataFuzzer.boundary.test.ts`.

import assert from 'node:assert/strict';
import { deriveBoundaryPayload } from './dataFuzzer.js';

// Full InputConstraints shape (the interface is module-private; structural literal).
function constraints(over: Partial<{
  min: number | null;
  max: number | null;
  step: number | null;
  maxLength: number | null;
  minRaw: string | null;
  maxRaw: string | null;
}>) {
  return { min: null, max: null, step: null, maxLength: null, minRaw: null, maxRaw: null, ...over };
}

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('dataFuzzer — field-aware boundary derivation');

check('NUMERIC max yields max+step (out of range)', () => {
  assert.deepEqual(deriveBoundaryPayload('NUMERIC', constraints({ max: 10, step: 2 })), {
    value: '12',
    description: 'max(10)+2',
  });
});

check('NUMERIC without step falls back to +1 (legacy behavior)', () => {
  assert.deepEqual(deriveBoundaryPayload('NUMERIC', constraints({ max: 10 })), {
    value: '11',
    description: 'max(10)+1',
  });
});

check('NUMERIC min-only yields min-step', () => {
  assert.deepEqual(deriveBoundaryPayload('NUMERIC', constraints({ min: 5, step: 5 })), {
    value: '0',
    description: 'min(5)-5',
  });
});

check('DATE with maxRaw yields the day after max', () => {
  assert.deepEqual(deriveBoundaryPayload('DATE', constraints({ maxRaw: '2026-01-31' })), {
    value: '2026-02-01',
    description: 'after max(2026-01-31)',
  });
});

check('DATE with only minRaw yields the day before min', () => {
  assert.deepEqual(deriveBoundaryPayload('DATE', constraints({ minRaw: '2026-03-01' })), {
    value: '2026-02-28',
    description: 'before min(2026-03-01)',
  });
});

check('DATE with an unparseable bound returns null', () => {
  assert.equal(deriveBoundaryPayload('DATE', constraints({ maxRaw: 'not-a-date' })), null);
});

check('unconstrained field returns null (leaves specialized vectors untouched)', () => {
  assert.equal(deriveBoundaryPayload('NUMERIC', constraints({})), null);
  assert.equal(deriveBoundaryPayload('EMAIL', constraints({ max: 10 })), null);
  assert.equal(deriveBoundaryPayload('DATE', constraints({})), null);
});

console.log(`\ndataFuzzer.boundary: ${passed} checks passed.`);
