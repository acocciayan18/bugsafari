// Standalone deterministic tests for the interaction-scope classifier. No unit
// runner is configured in this package, so this is a self-executing script:
// `npx tsx src/domain/services/exploration/interactionScope.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import {
  classifyInteractionScope,
  attackTargetBoost,
  ATTACK_TARGET_SCORE_BOOST,
} from './interactionScope.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('interactionScope — coordinated attack-vector / navigation routing');

check('textarea and text-like inputs are attack vectors', () => {
  assert.equal(classifyInteractionScope({ tagName: 'textarea', type: '' }), 'attack-vector');
  for (const type of ['text', 'email', 'password', 'search', 'number', 'url', 'tel', 'date', '']) {
    assert.equal(classifyInteractionScope({ tagName: 'input', type }), 'attack-vector', `input[type=${type}]`);
  }
});

check('range and color are value-controls, not text fuzz targets', () => {
  assert.equal(classifyInteractionScope({ tagName: 'input', type: 'range' }), 'value-control');
  assert.equal(classifyInteractionScope({ tagName: 'input', type: 'color' }), 'value-control');
});

check('unknown input type defaults to attack vector (safe to fuzz)', () => {
  assert.equal(classifyInteractionScope({ tagName: 'input', type: 'custom-widget' }), 'attack-vector');
});

check('checkbox and radio are toggles, not fuzz targets', () => {
  assert.equal(classifyInteractionScope({ tagName: 'input', type: 'checkbox' }), 'toggle');
  assert.equal(classifyInteractionScope({ tagName: 'input', type: 'radio' }), 'toggle');
});

check('select is a dropdown, not a fuzz target', () => {
  assert.equal(classifyInteractionScope({ tagName: 'select', type: '' }), 'dropdown');
});

check('submit/button/reset/image inputs are clickable, not fuzz targets', () => {
  for (const type of ['submit', 'button', 'reset', 'image']) {
    assert.equal(classifyInteractionScope({ tagName: 'input', type }), 'clickable', `input[type=${type}]`);
  }
});

check('file inputs are driven; hidden inputs are inert (skipped)', () => {
  assert.equal(classifyInteractionScope({ tagName: 'input', type: 'file' }), 'file');
  assert.equal(classifyInteractionScope({ tagName: 'input', type: 'hidden' }), 'inert');
});

check('buttons, anchors, and generic elements are clickable', () => {
  assert.equal(classifyInteractionScope({ tagName: 'button', type: '' }), 'clickable');
  assert.equal(classifyInteractionScope({ tagName: 'a', type: '' }), 'clickable');
  assert.equal(classifyInteractionScope({ tagName: 'div', type: '' }), 'clickable');
});

check('classification is case-insensitive and deterministic', () => {
  assert.equal(classifyInteractionScope({ tagName: 'INPUT', type: 'CHECKBOX' }), 'toggle');
  assert.equal(classifyInteractionScope({ tagName: 'SELECT', type: '' }), 'dropdown');
  assert.equal(
    classifyInteractionScope({ tagName: 'input', type: 'text' }),
    classifyInteractionScope({ tagName: 'input', type: 'text' }),
  );
});

check('attack-target boost applies only to fuzzable inputs', () => {
  assert.equal(attackTargetBoost({ tagName: 'input', type: 'text' }), ATTACK_TARGET_SCORE_BOOST);
  assert.equal(attackTargetBoost({ tagName: 'input', type: 'password' }), ATTACK_TARGET_SCORE_BOOST);
  assert.equal(attackTargetBoost({ tagName: 'textarea', type: '' }), ATTACK_TARGET_SCORE_BOOST);
  // Navigation / supporting controls receive no boost.
  for (const el of [
    { tagName: 'button', type: '' },
    { tagName: 'input', type: 'submit' },
    { tagName: 'input', type: 'checkbox' },
    { tagName: 'input', type: 'radio' },
    { tagName: 'input', type: 'range' },
    { tagName: 'input', type: 'color' },
    { tagName: 'select', type: '' },
    { tagName: 'a', type: '' },
  ]) {
    assert.equal(attackTargetBoost(el), 0, `${el.tagName}[type=${el.type}]`);
  }
});

console.log(`\ninteractionScope: ${passed} checks passed.`);
