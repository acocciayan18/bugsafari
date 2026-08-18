// Standalone tests for the runtime-fault culprit resolver (pure, browser-free).
// Run: `npx tsx src/domain/services/telemetry/runtimeCulprit.test.ts`.

import assert from 'node:assert/strict';
import { resolveRuntimeCulprit } from './runtimeCulprit.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('runtimeCulprit — culprit resolution / burst decline');

check('a descriptive acted control wins with its selector', () => {
  const r = resolveRuntimeCulprit({ burstAmbiguous: false, descriptiveLabel: 'RangeError', selector: '#range', stackCulprit: 'onClickRange' });
  assert.deepEqual(r, { culpritLabel: 'RangeError', culpritSelector: '#range' });
});

check('no descriptive control falls back to the stack handler with NO selector', () => {
  const r = resolveRuntimeCulprit({ burstAmbiguous: false, descriptiveLabel: undefined, selector: '#incidental', stackCulprit: 'renderRow' });
  assert.deepEqual(r, { culpritLabel: 'renderRow', culpritSelector: undefined });
});

check('a concurrent burst declines both label and selector even with a descriptive control', () => {
  const r = resolveRuntimeCulprit({ burstAmbiguous: true, descriptiveLabel: 'Null property', selector: '#null', stackCulprit: 'onClickNull' });
  assert.deepEqual(r, {});
});

check('a burst with no descriptive control and no stack still declines', () => {
  const r = resolveRuntimeCulprit({ burstAmbiguous: true });
  assert.deepEqual(r, {});
});

console.log(`\n${passed} passed`);
