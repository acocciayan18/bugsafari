// Self-executing checks for runtime (EXCEPTION/CONSOLE) culprit resolution. This is the
// pure decision the runtime fault path makes AFTER the tighter RUNTIME_CULPRIT_WINDOW_MS
// has (or has not) yielded a descriptive acted control. When the window drops a stale
// persistent control (e.g. a footer newsletter field — the findings.txt phantom), the
// descriptive label is undefined here and attribution falls to the stack, never the
// unrelated last-acted element. Run via `npm test` or `npx tsx .../runtimeCulprit.test.ts`.

import assert from 'node:assert/strict';
import { resolveRuntimeCulprit } from './runtimeCulprit.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('runtimeCulprit — pick a runtime fault culprit, or decline');

check('declines both label and selector under a concurrent burst', () => {
  const out = resolveRuntimeCulprit({ burstAmbiguous: true, descriptiveLabel: 'Add to cart', selector: 'button#add', stackCulprit: 'handleAdd' });
  assert.deepEqual(out, {});
});

check('prefers the descriptive acted control with its selector (in-window fault)', () => {
  const out = resolveRuntimeCulprit({ burstAmbiguous: false, descriptiveLabel: 'Search', selector: 'input[aria-label="Search"]', stackCulprit: 'onInput' });
  assert.deepEqual(out, { culpritLabel: 'Search', culpritSelector: 'input[aria-label="Search"]' });
});

check('falls back to the stack handler (no selector) when the window dropped the control', () => {
  // descriptiveLabel undefined = the tight runtime window rejected the stale persistent
  // control, so a background/async fault attributes to the failing handler, not the footer.
  const out = resolveRuntimeCulprit({ burstAmbiguous: false, descriptiveLabel: undefined, selector: 'input[aria-label="Newsletter email"]', stackCulprit: 'renderRelated' });
  assert.deepEqual(out, { culpritLabel: 'renderRelated', culpritSelector: undefined });
});

check('attributes nothing when neither a descriptive control nor a stack frame is known', () => {
  const out = resolveRuntimeCulprit({ burstAmbiguous: false, descriptiveLabel: undefined, selector: undefined, stackCulprit: undefined });
  assert.deepEqual(out, { culpritLabel: undefined, culpritSelector: undefined });
});

console.log(`\nruntimeCulprit: ${passed} checks passed.`);
