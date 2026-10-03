# BugSafari — Additional Capability Proposals

Analysis-only. Nothing here is implemented. This document is an **addendum** to `FEATURE_IDEAS.md`: it deliberately avoids repeating the 15 proposals already listed there (replay, overlay, learning cards, analytics, run diff, coverage map, export, test generation, issue tracker, share links, NL config, CI runs, annotations, a11y panel, guided debugging).

The additions below target gaps that doc did not cover: **model/scoring transparency, negative-result teaching, differential ground-truth validation, determinism/flakiness, and goal-directed exploration**. Each is grounded in modules that already exist, so the lift is mostly surfacing data the engine already computes.

---

## Why these, and not more of the same

BugSafari already does the hard part: it explores, scores with a single-layer perceptron blended 60/40 with heuristics (`RiskScorer.ts`), gates security findings on behavioral proof (`securityEvidenceGate.ts`), and produces forensic reports. For a **student**, the untapped teaching value is not another report view. It is making the *decision process* legible: why the engine clicked here, why it learned to stop clicking there, and why a suspicious thing was correctly **not** reported. For **automated testing**, the untapped value is **ground truth**: proving the engine catches a real bug and clears a fixed one.

---

## Model & Scoring Transparency

### A1. Brain Inspector (perceptron weight viewer)
- **Purpose:** Live panel showing the perceptron's current `bias` and per-feature `weights`, plus how they shift as the run learns.
- **Student value:** The Delta Rule becomes concrete. A student watches `hasId`, keyword, and semantic-role weights rise or fall and sees the model "learn what to click" in real time. This is the single best in-product explanation of the ML claim.
- **Fits architecture:** `RiskScorer.exportBrainState()` already returns `{ bias, weights }`, and `perceptron.ts` already applies bounded updates (L2 decay, momentum, weight clamp). Emit a brain snapshot on an interval or per N actions over the existing socket; render a horizontal bar chart (reuse the `dataviz` palette). No engine change, read-only export.
- **Priority:** High

### A2. "Why this target won" score breakdown
- **Purpose:** Per-action explanation: the chosen element's heuristic score, ML sigmoid confidence, the 60/40 blend, and the top feature contributions.
- **Student value:** Connects abstract scoring to a concrete click. Answers "why did it pick the Submit button over the nav link" with numbers, not prose.
- **Fits architecture:** `RiskScorer.score()` already builds a `featureVector` and computes `mlScore` + heuristic score per element. Attach a compact `scoreTrace` (top 3 weighted features + blend components) to each action event already streamed to the dashboard. Pairs naturally with `FEATURE_IDEAS.md` #2 (element overlay): show the badge, click it, see the breakdown.
- **Priority:** High

### A3. Reward-signal timeline
- **Purpose:** Timeline of the contrastive learning signals the engine observed: `structuralChange`, `networkActivity`, `faultDetected`, `revisit`, `saturatedDestination`, `noOp`.
- **Student value:** Shows *reinforcement in action*: a fault-detected reward spikes a weight, a saturated-destination penalty suppresses one. Teaches why the agent stops wasting clicks on dead regions.
- **Fits architecture:** `RewardSignals` is already the exact interface fed to `applyReward()` in `perceptron.ts`. Emit each signal alongside its action; render as a lane in the existing action timeline.
- **Priority:** Medium

---

## Teaching with Negative Results

### A4. "Near-miss" ledger (why something was NOT reported)
- **Purpose:** A view of candidate faults that were observed but **rejected** by the evidence gate, with the specific reason (missing behavioral proof, 2xx-only acceptance, superseded-by-navigation, maxlength-cap false positive).
- **Student value:** Teaches the hardest QA lesson: *precision over recall*. A student sees that a 999999 input accepted with 200 is not a bug without a proven adverse effect, and learns what real evidence looks like. This directly counters the "every anomaly is a bug" instinct.
- **Fits architecture:** `securityEvidenceGate.ts` and `constraintBypass` effect gate already make these drop decisions with structured reasons; `nav-superseded` routing already classifies self-caused cancellations. Record the rejection reason instead of silently dropping, expose a read-only "filtered" list. Keep it opt-in so it never pollutes the real findings count.
- **Priority:** High

### A5. Confidence score on each finding
- **Purpose:** Surface a 0-100 confidence per finding derived from how many independent evidence markers fired (status code + signal + endpoint + bypass effect).
- **Student value:** Teaches that findings are not binary. A student learns to triage high-confidence crashes before speculative ones.
- **Fits architecture:** The evidence markers are already counted at the promotion chokepoints (`securityEvidenceGate.ts`, `findingEvidence.ts`). Map marker count/strength to a confidence band; render as a chip on `FindingCard`. No new detection, pure aggregation of existing gate inputs.
- **Priority:** Medium

---

## Ground-Truth Validation (highest value for automated testing)

### A6. Differential mode: buggy vs fixed target
- **Purpose:** Run the same exploration against a known-buggy build and its fixed twin, then assert the engine flags the bug in one and clears it in the other.
- **Student & dev value:** This is the engine's own **accuracy proof**. It demonstrates true positives and true negatives on controlled ground truth, which is exactly what a thesis defense or a QA sign-off needs. For a student it shows what "the fix worked" means end to end.
- **Fits architecture:** The repo already ships the ground-truth pairs: `bugsafari-shop` vs `bugsafari-shop-fix` and `bugsafari-target-app` vs `bugsafari-target-app-fix`. There is already a `__accuracy__` area under `testing-core/src`. Add a harness that runs both targets and diffs findings by canonical signature (`faultSignature.ts`), reporting detection rate and false-positive rate. Reuses Verify Fix machinery conceptually but at suite scope.
- **Priority:** High

### A7. Determinism / flakiness report
- **Purpose:** Re-run a finding's minimized repro K times and report how often it reproduces, plus whether the per-run fuzz salt changed the path.
- **Student & dev value:** Teaches the difference between a deterministic bug and a race/flaky one, which students routinely confuse. A dev learns whether a finding is CI-safe before writing a regression test.
- **Fits architecture:** Seeding already exists (`seededRandom.ts`, `runFuzzSeed.ts` with per-run salt) and repro is a finding-level literal (per the finding-signature design), so replays are reproducible by construction. Loop the existing regression verifier and report a reproduce-rate. Naturally feeds `FEATURE_IDEAS.md` #11 (test generation): only emit a CI test for findings above a reproduce-rate threshold.
- **Priority:** Medium

---

## Goal-Directed Exploration

### A8. Objective-seeded exploration ("reach the checkout, then stress it")
- **Purpose:** Let the user name a target state or route; the navigator biases the frontier toward reaching it before fuzzing, instead of pure breadth exploration.
- **Student value:** Shows the difference between undirected exploration and directed pathfinding, and lets a student aim the engine at the area their assignment cares about.
- **Fits architecture:** `DIrectedPathFinder.ts` and the `pathfinder/` module already exist alongside `StateGraphNavigator.ts`. Add a frontier bias term keyed to a goal predicate (route match / selector present). This is a scoring nudge, not a new exploration engine. More capable successor to `FEATURE_IDEAS.md` #14 (NL config), which can map plain language onto this predicate.
- **Priority:** Medium

### A9. Metamorphic relation explainer
- **Purpose:** Expose the metamorphic testing already running (`finders/metamorphic/`) as a teachable concept: "same logical input, transformed, must give an equivalent result; it did not."
- **Student value:** Metamorphic testing is advanced and rarely taught hands-on. Surfacing the relation that broke (input transform + expected invariant + observed divergence) is a strong learning artifact.
- **Fits architecture:** The metamorphic finder exists; it already knows the relation it violated. Carry that relation descriptor into the finding evidence and render it in the knowledge-base/learning card for that class.
- **Priority:** Low

---

## Suggested Sequencing

| Wave | Items | Theme |
|------|-------|-------|
| 1 | A1 Brain Inspector, A2 Score breakdown, A6 Differential mode | Prove the ML + prove the accuracy; mostly read-only surfacing |
| 2 | A4 Near-miss ledger, A5 Confidence score, A7 Determinism report | Teach precision and trust in findings |
| 3 | A3 Reward timeline, A8 Objective-seeded exploration | Deeper transparency + directed runs |
| 4 | A9 Metamorphic explainer | Advanced teaching polish |

**Top 3 to build first:** A1 (Brain Inspector), A2 (score breakdown), and A6 (differential buggy-vs-fixed mode). Together they make the two central claims of the system verifiable in-product: *the agent learns* and *it is accurate*. All three mostly expose data the engine already computes, so they are low-risk, high-signal additions.

---

### Items from `FEATURE_IDEAS.md` worth re-checking as possibly shipped
Several baseline proposals appear to have landed since that doc was written and should be marked done rather than re-proposed: **#13 shareable read-only links** (share-link service with idempotent create/reuse) and the **history severity badge** work that supersedes parts of #5. Confirm status before planning a wave.
