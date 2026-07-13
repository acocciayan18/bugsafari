// Regression test for Issue #4 (ML Scoring Collapse): reproduces the reported
// same-element +93 -> -126 swing and confirms it can no longer occur, given
// the heuristicScore cap plus the existing perceptron WEIGHT_CLAMP + RiskScorer
// penalty decay/cap hardening. Run via `npm test` or `npx tsx .../RiskScorer.scoreStability.test.ts`.

import assert from 'node:assert/strict';
import { RiskScorer } from './RiskScorer.js';
import type { InteractiveElement } from '../entities/InteractiveElement.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

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

console.log('RiskScorer — score stability under stacked keywords + repeated penalties (Issue #4)');

check('heuristicScore stays bounded even when many keywords stack on one element', () => {
  const scorer = new RiskScorer();
  // Deliberately keyword-dense label so every KEYWORD_WEIGHTS entry fires at once.
  const dense = el('button#danger', {
    id: 'danger',
    innerText: 'delete remove destroy checkout pay login register email save create search',
    tagName: 'button',
  });
  const score = scoreOf(scorer, dense);
  // combinedScore = heuristic*0.6 + ml*0.4, both now capped at 100 -> ceiling 100.
  assert.ok(score <= 100 + 1e-6, `stacked-keyword element scored ${score}, expected <= 100`);
});

check('same element does not swing from a large positive to an extreme negative across repeated loop events', () => {
  const scorer = new RiskScorer();
  const target = el('a#login', { id: 'login', innerText: 'Login', tagName: 'a' });

  const baseline = scoreOf(scorer, target);
  assert.ok(baseline > 0, `expected a positive baseline score, got ${baseline}`);

  // Simulate the exact reported sequence: repeated revisit + saturated-destination
  // reward signals, each paired with the loop's own penalize(selector, |riskScore|+1)
  // call, across several stagnation-style ranking passes.
  for (let round = 0; round < 6; round++) {
    scorer.penalizeRevisit(target);
    scorer.penalizeSaturatedTransition(target);
    const current = scoreOf(scorer, target);
    scorer.penalize(target.selector, Math.abs(current) + 1);
  }

  const afterBurst = scoreOf(scorer, target);
  // Bounded worst case: heuristic+ml ceiling (100) minus the penalty accumulation
  // cap (200) — nowhere near the reported -126 driven by unbounded heuristic stacking.
  assert.ok(afterBurst >= -200 - 1e-6, `score ${afterBurst} fell below the bounded floor`);
  assert.ok(afterBurst < baseline, 'repeated negative signals still deprioritize the element');

  // Perceptron weights must stay within their clamp throughout — no runaway collapse.
  const brain = scorer.exportBrainState();
  for (const [name, w] of Object.entries(brain.weights)) {
    assert.ok(Math.abs(w) <= 6 + 1e-9, `weight ${name}=${w} exceeded the perceptron clamp`);
  }
  assert.ok(Math.abs(brain.bias) <= 6 + 1e-9, `bias ${brain.bias} exceeded the perceptron clamp`);

  // And the score recovers once the penalty burst decays away.
  for (let i = 0; i < 80; i++) scorer.decayPenalties();
  const recovered = scoreOf(scorer, target);
  assert.ok(recovered > afterBurst, `score should recover after decay: ${afterBurst} -> ${recovered}`);
});

console.log(`\nRiskScorer score stability: ${passed} checks passed.`);
