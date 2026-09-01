# How BugSafari's Perceptron Scores Elements

Plain-english walkthrough of how the scoring brain works, grounded in the real code:
`testing-core/src/ml/perceptron.ts` and `testing-core/src/domain/services/RiskScorer.ts`.

---

## 1. How the perceptron works and how a risk score is built

The perceptron is a **single-layer perceptron** (`SingleLayerPerceptron`). It is simple math:

1. Turn an element into a list of numbers (a **feature vector**).
2. Multiply each feature by its **weight** and add them all up, plus a fixed **bias**.
3. Push that sum through a **sigmoid** so the result is always between 0 and 1.

```
raw   = bias + Σ (weight[feature] × value[feature])
ml    = 1 / (1 + e^(-raw))        // 0..1 confidence
```

But the perceptron is only **part** of the final score. The `RiskScorer` blends two things:

```
finalScore = heuristicScore × 0.6  +  mlScore × 0.4
```

- **Heuristic score** = hand-tuned points for tags, input types, and risky keywords.
- **ML score** = the perceptron sigmoid, scaled to 0-100.

So 60% comes from fixed expert rules and 40% comes from the learning model. After blending, the scorer also subtracts **penalties** (for dead or looping controls) and a big **suppression floor** for controls that lead to already-explored dead ends.

---

## 2. How different element types get scored

The type of element pushes the score up or down in two places.

**In the heuristic rules** (`RiskScorer`):

| Kind | Points |
|------|--------|
| button / input tag | +18 each |
| textarea | +16 |
| select (dropdown) | +12 |
| link (`a`) | +8 |
| password input type | +42 |
| email type | +34 |
| submit type | +30 |

Then risky **keywords** add a lot on top: `delete` +86, `pay` +78, `login` +82, `checkout` +74, `submit` +54, etc. A "Delete account" button therefore ranks far above a plain link.

**In the perceptron** the same idea lives as weights: `isButton` and `isInput` carry 0.45, `isSelect` 0.30, `isLink` 0.20, and keyword features like `kwPay` 1.8, `kwDelete` 1.9, `kwLogin` 1.7.

Net effect: **forms, inputs, and buttons that touch auth, money, or deletion score highest; plain links and decorative elements score lowest.**

---

## 3. How a brand-new element gets a score instantly

The perceptron does **not** remember individual elements. It scores by **features, not identity**. A "Delete" button it has never seen still has the features `isButton = 1` and `kwDelete = 1`, and those features already carry weights from `DEFAULT_WEIGHTS`.

So the model starts warm: the default weights are **built-in prior knowledge**. Any new element is scored immediately from its shape and words. No per-element training or first-visit warm-up is needed. This is the "cold-start" fix the code comments call out.

---

## 4. What features the perceptron reads

From `buildFeatureVectorFromElement`. Every feature is 0/1 or a normalized 0-1 number:

**Structure / identity**
- `hasId`, `hasClass`
- `isInput`, `isButton`, `isLink`, `isSelect`, `isDisabled`
- `roleInteractive` (ARIA role is button/link/menuitem/tab/checkbox/switch)
- `hasPlaceholder`, `hasAriaLabel`, `opensLayer` (opens a menu/modal)

**Keywords** (word-boundary matched over id + class + type + text + placeholder + aria-label + name + role)
- `kwLogin`, `kwSubmit`, `kwPay`, `kwCheckout`, `kwDelete`, `kwRegister`, `kwPassword`, `kwEmail`, `kwSearch`, `kwDropdown`

**Layout** (normalized so geometry matters but can't dominate)
- `areaNorm` (bigger control = more important)
- `yNorm` (near top of page scores higher, weight is negative)
- `textLenNorm` (longer visible label)

Bad or missing data is safe: non-finite values are skipped so one broken read can never poison the score with `NaN`.

---

## 5. How the score attaches to the DOM element

It does **not** get written onto the real DOM node. The score lives on BugSafari's own in-memory object:

```ts
return { ...element, featureVector, riskScore: combinedScore - penalty - suppression };
```

Each element is an `InteractiveElement` object that also holds a CSS `selector`. The `riskScore` is a field on that object. When BugSafari acts, it finds the real page node again through the `selector`, not through a stored attribute.

(The only `data-bugsafari-*` attributes written to the DOM are temporary click tags for dynamic dropdown options and siblings — they are cleaned up right after, and have nothing to do with scoring.)

---

## 6. What the score actually means

It is the **priority for exploration**, driven by estimated bug-risk. It answers "which control should I click next?"

The name `riskScore` reflects that high-risk surfaces (login, payment, delete, forms) are both more likely to hide bugs and more valuable to test. But the final number is not pure element risk — it also folds in learning and is adjusted down by penalties and dead-end suppression. So read it as: **risk-weighted exploration priority.** Highest score gets picked first each pass.

---

## 7. Before, during, and after exploration

**Before** — the perceptron is seeded. Either from `DEFAULT_WEIGHTS`, or warm-started from a saved "brain" for that URL via `importBrainState` (`loadState`). Saved weights are layered on top of the defaults, so features added since an old snapshot keep their default prior.

**During** — every ranking pass:
- score all visible elements, sort by `riskScore`, pick the top one;
- after acting, feed the outcome back as a **reward signal** and nudge the weights;
- decay penalties one step so old nudges fade over ~10-20 steps.

**After** — the learned state is saved with `exportBrainState` (current weights + bias), so the next run on the same app starts smarter.

---

## 8. Does it learn during a session, or is it fixed?

It **learns online, live, during the run.** It is not a frozen pre-trained model. Updates use the **delta rule with momentum**:

```
error     = target - prediction
velocity  = 0.9 × velocity + lr × error × featureValue
weight    = weight × (1 - lr×L2) + velocity   // then clamped to [-6, 6]
```

Reward targets come from what the action caused (`applyReward`):
- fault detected → strongest positive (+0.5)
- network activity → +0.3, structural DOM change → +0.2
- revisit an old state → −0.4, no-op dead control → −0.25, landed on a saturated dead page → −0.5

Guardrails keep it stable: **learning-rate decay** (late updates refine, not swing), **L2 weight decay** and a **hard clamp** (no single weight runs away), and **momentum** (consistent signals build up, one stray penalty can't flip a strong weight). Weights persist between runs; the momentum/velocity state is transient and reset on load.

---

## 9. Elements it has never seen or can't confidently score

There is no "refuse to score" path — the model **always** returns a number.

- **Never seen** is a non-issue: scoring is feature-based, so an unknown element is scored from its features and the bias right away (see #3).
- **Unknown feature** (a feature name with no weight) falls back to weight `0` — it simply adds nothing rather than erroring.
- **Missing geometry / bad data** → those features are `0` or skipped; the rest still score.
- **Low confidence** still produces a value near the sigmoid midpoint. Confidence itself is exposed separately via `getConfidence` (the raw sigmoid) for telemetry, but it does not block selection.

So uncertainty lowers a score, it never removes the element from the ranking.

---

## 10. Is a score only good for that one element?

The **number** is per-element and per-pass. `riskScore` is attached to one `InteractiveElement`, and it is recomputed from scratch every ranking pass — it is not a permanent label.

But the **learning generalizes.** Weights are attached to *features*, not to individual elements. Teaching the model that a `kwDelete` button caused a fault raises the score of **every** delete-like control across the app, not just that one. Penalties are the exception: they are keyed to `(structural shell + selector)`, so penalizing `#email` on the login screen does not sink `#email` on the profile screen — different controls, different penalty.

**Summary:** each score is specific to one element at one moment, but the knowledge behind it is shared across all elements with similar features.
