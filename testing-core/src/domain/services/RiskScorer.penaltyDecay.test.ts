// Standalone deterministic tests for RiskScorer penalty decay + cap (audit A1:
// penalties were only ever incremented, never decayed, so one stagnation event
// drove the whole frontier permanently negative and forced premature exhaustion).
// Run via `npm test` or `npx tsx .../RiskScorer.penaltyDecay.test.ts`.

import assert from 'node:assert/strict';
import { RiskScorer } from './RiskScorer.js';
import type { InteractiveElement } from '../entities/InteractiveElement.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Minimal fixture — score() (re)computes featureVector/riskScore itself.
function el(selector: string, over: Partial<InteractiveElement> = {}): InteractiveElement {
  return {
    selector,
    id: over.id ?? '',
    className: over.className ?? '',
    innerText: over.innerText ?? '',
    type: over.type ?? '',
    tagName: over.tagName ?? 'button',
    isVisible: true,
    isPointer: true,
    featureVector: {},
    riskScore: 0,
    ...over,
  };
}

function scoreOf(scorer: RiskScorer, element: InteractiveElement): number {
  return scorer.score([element])[0].riskScore;
}

console.log('RiskScorer — penalty decay + cap (A1 fix)');

check('a single penalize() call is capped (cannot exceed the accumulation cap)', () => {
  const scorer = new RiskScorer();
  const login = el('a#login', { id: 'login', innerText: 'Login', tagName: 'a' });
  const base = scoreOf(scorer, login);
  scorer.penalize('a#login', 100000); // absurd magnitude
  const penalized = scoreOf(scorer, login);
  // Drop is bounded — nowhere near the 100000 requested.
  assert.ok(base - penalized <= 200 + 1e-6, `drop ${base - penalized} should be capped ~200`);
  assert.ok(penalized < base, 'still meaningfully penalized');
});

check('penalties decay toward zero over successive steps and the score recovers', () => {
  const scorer = new RiskScorer();
  const login = el('a#login', { id: 'login', innerText: 'Login', tagName: 'a' });
  const base = scoreOf(scorer, login);

  scorer.penalize('a#login', 200); // heavy hit (e.g. stagnation event)
  assert.ok(scoreOf(scorer, login) < base, 'penalized immediately after the hit');

  // Simulate steps passing with no further penalty on this control.
  for (let i = 0; i < 80; i++) scorer.decayPenalties();

  const recovered = scoreOf(scorer, login);
  assert.equal(recovered, base, 'penalty fully faded — score returns to baseline');
});

check('a stagnation event does not permanently lock out a high-value control', () => {
  const scorer = new RiskScorer();
  const login = el('a#login', { id: 'login', innerText: 'Login', tagName: 'a' });
  const generic = el('a#footer', { id: 'footer', innerText: 'about', tagName: 'a' });

  const loginBase = scoreOf(scorer, login);
  const genericBase = scoreOf(scorer, generic);
  assert.ok(loginBase > genericBase, 'login outranks a generic link on a cold start');

  // Stagnation penalizes EVERY ranked element (as the loop does).
  scorer.penalize('a#login', loginBase + 1);
  scorer.penalize('a#footer', genericBase + 1);

  // A handful of steps later, with stagnation cleared, login must be selectable
  // (positive score) and still outrank the generic link.
  for (let i = 0; i < 40; i++) scorer.decayPenalties();
  const loginAfter = scoreOf(scorer, login);
  const genericAfter = scoreOf(scorer, generic);
  assert.ok(loginAfter > 0, 'high-value control recovered a positive score');
  assert.ok(loginAfter > genericAfter, 'ranking priority restored after stagnation cleared');
});

check('decayPenalties on an empty penalty map is a no-op', () => {
  const scorer = new RiskScorer();
  scorer.decayPenalties();
  const button = el('button#x');
  assert.equal(scoreOf(scorer, button), scoreOf(scorer, button), 'stable, no throw');
});

console.log(`\nRiskScorer penalty decay: ${passed} checks passed.`);
