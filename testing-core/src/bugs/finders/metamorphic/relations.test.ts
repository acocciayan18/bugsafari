// Self-executing tests for the metamorphic shared primitives (pure, browser-free).
// Run: `npx tsx src/bugs/finders/metamorphic/relations.test.ts`.

import assert from 'node:assert/strict';
import type { CompoundStateHash } from '../../../ml/domHasher.js';
import type { InteractiveElement } from '../../../domain/entities/InteractiveElement.js';
import { equivalent, detectModalOpeners } from './relations.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const hash = (structure: string, interactive: string): CompoundStateHash => ({
  structure,
  interactive,
  routePath: '/x',
  combined: `${structure}:${interactive}`,
});

console.log('metamorphic/relations — equivalence + reversible-pair detection');

check('identical structure + interactive → equivalent', () => {
  assert.equal(equivalent(hash('s1', 'i1'), hash('s1', 'i1')), true);
});

check('a differing structure (leaked/dropped node) → not equivalent', () => {
  assert.equal(equivalent(hash('s1', 'i1'), hash('s2', 'i1')), false);
});

check('a differing interactive signature (un-reverted control state) → not equivalent', () => {
  assert.equal(equivalent(hash('s1', 'i1'), hash('s1', 'i2')), false);
});

check('routePath / combined differences are ignored (before/after diff is DOM-only)', () => {
  const a = { structure: 's', interactive: 'i', routePath: '/a', combined: 'x' };
  const b = { structure: 's', interactive: 'i', routePath: '/b', combined: 'y' };
  assert.equal(equivalent(a, b), true);
});

const el = (over: Partial<InteractiveElement>): InteractiveElement =>
  ({ selector: '#x', isVisible: true, ...over }) as InteractiveElement;

check('a visible layer-opener that is not a dismiss is detected', () => {
  const openers = detectModalOpeners([el({ selector: '#open', opensLayer: true })]);
  assert.equal(openers.length, 1);
  assert.equal(openers[0].selector, '#open');
});

check('a dismiss control, an invisible opener, and a selector-less opener are all skipped', () => {
  const openers = detectModalOpeners([
    el({ selector: '#close', opensLayer: true, isDismiss: true }),
    el({ selector: '#hidden', opensLayer: true, isVisible: false }),
    el({ selector: '', opensLayer: true }),
    el({ selector: '#plain' }), // no opensLayer
  ]);
  assert.equal(openers.length, 0);
});

console.log(`\nrelations: ${passed} checks passed.`);
