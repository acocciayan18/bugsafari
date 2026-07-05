// Standalone deterministic tests for the perceptron learning core + feature vector.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with `npx tsx src/ml/perceptron.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { SingleLayerPerceptron, buildFeatureVectorFromElement } from './perceptron.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Perceptron — bounded contrastive learning + feature extraction');

check('revisit signal drives the prediction down (contrastive signal works)', () => {
  const p = new SingleLayerPerceptron();
  const v = buildFeatureVectorFromElement({
    tagName: 'button', id: 'go', className: 'btn', type: 'button', text: 'Login', disabled: false,
  });
  const before = p.sigmoidScore(v);
  for (let i = 0; i < 20; i += 1) p.applyReward(v, { revisit: true });
  const after = p.sigmoidScore(v);
  assert.ok(after < before, `expected prediction to fall: before=${before}, after=${after}`);
});

check('repeated compound reward stays bounded — no runaway saturation', () => {
  const p = new SingleLayerPerceptron();
  const v = buildFeatureVectorFromElement({
    tagName: 'button', id: 'pay', className: 'checkout', type: 'submit', text: 'Pay now', disabled: false,
  });
  for (let i = 0; i < 500; i += 1) p.applyReward(v, { faultDetected: true });
  const weights = p.exportWeights();
  for (const [name, w] of Object.entries(weights)) {
    assert.ok(Math.abs(w) <= 6 + 1e-9, `weight ${name}=${w} exceeded clamp`);
  }
  assert.ok(Math.abs(p.getBias()) <= 6 + 1e-9, `bias ${p.getBias()} exceeded clamp`);
  assert.ok(p.sigmoidScore(v) < 1, 'sigmoid must not reach exactly 1.0');
});

check('compound target is monotonic: fault > network > structural > revisit', () => {
  const mk = () => new SingleLayerPerceptron();
  const v = buildFeatureVectorFromElement({
    tagName: 'button', id: 'b', className: '', type: 'button', text: 'x', disabled: false,
  });
  const delta = (signals: Parameters<SingleLayerPerceptron['applyReward']>[1]) => {
    const p = mk(); const before = p.sigmoidScore(v); p.applyReward(v, signals); return p.sigmoidScore(v) - before;
  };
  const fault = delta({ faultDetected: true });
  const net = delta({ networkActivity: true });
  const struct = delta({ structuralChange: true });
  const revisit = delta({ revisit: true });
  assert.ok(fault > net && net > struct && struct > 0, `positive ordering: fault=${fault} net=${net} struct=${struct}`);
  assert.ok(revisit < 0, `revisit should push down: ${revisit}`);
});

check('momentum: consistent rewards accelerate; a lone opposite penalty does not flip a high-velocity weight', () => {
  const p = new SingleLayerPerceptron();
  const v = buildFeatureVectorFromElement({
    tagName: 'button', id: 'k', className: '', type: 'button', text: 'delete', disabled: false,
  });
  // Build strong positive velocity on kwDelete via repeated fault rewards.
  const w0 = p.exportWeights().kwDelete;
  for (let i = 0; i < 8; i += 1) p.applyReward(v, { faultDetected: true });
  const wHigh = p.exportWeights().kwDelete;
  assert.ok(wHigh > w0, `consistent rewards should raise weight: ${w0} → ${wHigh}`);
  // A single revisit must not drop it below where one plain penalty from baseline would.
  p.applyReward(v, { revisit: true });
  const wAfter = p.exportWeights().kwDelete;
  assert.ok(wAfter > w0, `momentum should keep a high-velocity weight elevated after one penalty: ${wAfter} vs baseline ${w0}`);
});

check('non-finite feature values are skipped (no NaN propagation)', () => {
  const p = new SingleLayerPerceptron();
  const poisoned = { isButton: 1, bad: Number.NaN, worse: Infinity } as Record<string, number>;
  const s = p.sigmoidScore(poisoned);
  assert.ok(Number.isFinite(s) && s > 0 && s < 1, `score must stay finite/bounded: ${s}`);
  p.applyReward(poisoned, { faultDetected: true }); // must not throw or write NaN
  for (const w of Object.values(p.exportWeights())) assert.ok(Number.isFinite(w), 'weights stay finite');
});

check('richer features present and finite (placeholder / aria / role / select / search)', () => {
  const v = buildFeatureVectorFromElement({
    tagName: 'select', id: '', className: '', type: '', text: '', disabled: false,
    placeholder: 'Search products', ariaLabel: 'Filter', role: 'menuitem', name: 'q',
  });
  for (const k of ['hasPlaceholder', 'hasAriaLabel', 'isSelect', 'roleInteractive', 'kwSearch']) {
    assert.ok(Number.isFinite(v[k]), `${k} must be finite`);
  }
  assert.equal(v.isSelect, 1);
  assert.equal(v.hasPlaceholder, 1);
  assert.equal(v.roleInteractive, 1);
  assert.equal(v.kwSearch, 1);
});

check('word-boundary matching: "blogger" does NOT trigger kwLogin', () => {
  const v = buildFeatureVectorFromElement({
    tagName: 'a', id: '', className: 'blogger-link', type: '', text: 'blogger', disabled: false,
  });
  assert.equal(v.kwLogin, 0);
});

check('word-boundary matching: "please login" DOES trigger kwLogin', () => {
  const v = buildFeatureVectorFromElement({
    tagName: 'button', id: '', className: '', type: '', text: 'Please login', disabled: false,
  });
  assert.equal(v.kwLogin, 1);
});

check('layout features are normalized into [0,1] when geometry is present', () => {
  const v = buildFeatureVectorFromElement({
    tagName: 'button', id: 'x', className: '', type: 'button', text: 'ok', disabled: false,
    boundingBox: { y: 450, width: 300, height: 200 },
  });
  assert.ok(v.areaNorm! >= 0 && v.areaNorm! <= 1, `areaNorm out of range: ${v.areaNorm}`);
  assert.ok(v.yNorm! >= 0 && v.yNorm! <= 1, `yNorm out of range: ${v.yNorm}`);
  assert.ok(v.textLenNorm! >= 0 && v.textLenNorm! <= 1, `textLenNorm out of range: ${v.textLenNorm}`);
});

check('missing geometry yields zeroed layout features (no NaN)', () => {
  const v = buildFeatureVectorFromElement({
    tagName: 'input', id: '', className: '', type: 'text', text: '', disabled: false,
  });
  assert.equal(v.areaNorm, 0);
  assert.equal(v.yNorm, 0);
});

check('loadState overrides saved keys + bias and reflects them in the score', () => {
  const p = new SingleLayerPerceptron();
  const v = buildFeatureVectorFromElement({
    tagName: 'button', id: '', className: '', type: 'button', text: 'ok', disabled: false,
  });
  const before = p.sigmoidScore(v);
  // Seed a brain that strongly favors buttons (isButton weight up) with a high bias.
  p.loadState({ isButton: 5 }, 3);
  assert.equal(p.getBias(), 3);
  assert.equal(p.exportWeights().isButton, 5);
  assert.ok(p.sigmoidScore(v) > before, 'loaded brain should raise the score for a button');
});

check('loadState overlays DEFAULT_WEIGHTS so keys absent from the snapshot keep their prior', () => {
  const p = new SingleLayerPerceptron();
  const defaultKwPay = p.exportWeights().kwPay; // 1.8 by default
  // Snapshot only carries isButton — kwPay is absent and must fall back to its default.
  p.loadState({ isButton: 0.5 }, -0.35);
  assert.equal(p.exportWeights().kwPay, defaultKwPay);
  assert.equal(p.exportWeights().isButton, 0.5);
});

console.log(`\nPerceptron: ${passed} checks passed.`);
