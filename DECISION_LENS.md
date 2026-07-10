# 🔬 Decision Lens — Glass-Box ML Explainability

> New BugSafari feature. Turns the autonomous agent from a black box into a
> **glass box**: every element the engine chooses to interact with now ships an
> **exact, per-feature explanation** of *why* it was chosen — streamed live to the
> Watchtower dashboard and replayed on reconnect.

---

## 1. The problem it solves

BugSafari already scores every interactive element with a **Single-Layer
Perceptron** (Delta Rule) blended with keyword heuristics, then clicks the
highest-ranked one. Until now that scoring was opaque: the operator saw *what*
the engine clicked and its final number, but never *why* — which features drove
the score, how much the learned brain had drifted from its cold-start priors, or
why the runner-up lost.

Every other autonomous / monkey-testing agent has this same black-box problem.
Decision Lens closes it **without duplicating** any existing capability (fuzzing,
telemetry, replay verification, route exploration, forensic reports).

## 2. The key idea (and why it's academically strong)

The risk model is a **single-layer perceptron**, so its pre-activation logit is
**linear**:

```
z = bias + Σ (weightᵢ × valueᵢ)
confidence = σ(z) = 1 / (1 + e^−z)
```

Because it is linear, each feature's contribution to the decision is **exactly**
`weightᵢ × valueᵢ`. This is an **exact decomposition** — not a SHAP / LIME-style
*approximation* like you'd need for a deep network. Decision Lens exposes that
exact attribution in real time.

That is the academic contribution: **an autonomous exploratory tester that is
interpretable by construction.** Three things fall out of the linear model for
free, all shown in the UI:

1. **Exact feature attribution** — the signed contribution of every active
   feature (`kwLogin`, `isButton`, `areaNorm`, …) to the pick.
2. **Online-learning transparency** — each feature's current weight vs. its
   cold-start prior (`drift = weight − prior`), so you watch the Delta Rule
   actually *learn* across a run and across warm-started sessions.
3. **Counterfactual** — "why this element and not the runner-up", derived from
   the paired per-feature contribution deltas.

## 3. What the operator sees

A new **`decision lens`** tab in the Watchtower terminal (next to
telemetry / errors / network / console). For the current decision it renders:

- **Chosen element header** — selector, tag, semantic role, step, final risk score.
- **ML confidence gauge** — `σ(z)` as a 0–100 % bar.
- **The exact math** — score blend (`heuristic×0.6 + ML×0.4`) and the perceptron
  logit (`bias → z → σ(z)`).
- **Attribution waterfall** — one diverging bar per active feature (green = pushes
  toward clicking, red = pushes away), sorted by impact, each annotated with its
  exact `weight × value` term and a ▲/▼ badge showing weight drift from prior.
- **Runner-up counterfactual** — the second-best element and the top features that
  decided the winner over it.
- **Recent-decision scrubber** — click any of the last 10 decisions to pin and
  inspect it; "Follow live" returns to streaming the latest.

## 4. Architecture & data flow

```
ExplorationLoop (per committed decision)
   └─ RiskScorer.explainDecision(target, runnerUp, …)
        └─ SingleLayerPerceptron.explain(vector)   ← exact linear decomposition
        └─ DecisionExplainer.buildDecisionRationale(…)   ← labels · sort · drift · counterfactual
   └─ TelemetryEmitter.emitDecisionRationale(rationale)
        └─ SocketTelemetryGateway  → socket 'decision-rationale'  (+ buffered for replay)
                                        │
        SessionManager ring buffer (60) ┘ → included in ActiveSessionSnapshot
                                        │
Dashboard  SocketConnectionManager 'decision-rationale'
   └─ useDashboardController  (state, bounded to 50, hydrated from snapshot)
        └─ ClinicalForensicsDashboard → DecisionLensPanel
```

### Files

**shared/** (contracts)
- `types/explainability.ts` — `DecisionRationale`, `FeatureContribution`,
  `DecisionCounterfactual`, `DECISION_RATIONALE_EVENT`.
- `types/session.ts` — `ActiveSessionSnapshot.rationales` (reconnect replay).
- `types.ts` — barrel re-export.

**testing-core/** (engine)
- `ml/perceptron.ts` — `explain()` returns the exact linear terms; `DEFAULT_WEIGHTS`
  exported as the prior baseline.
- `domain/services/explainability/DecisionExplainer.ts` — pure assembly:
  human labels, sorting, drift, runner-up counterfactual.
- `domain/services/RiskScorer.ts` — `explainDecision()` ties the perceptron +
  heuristic + priors together into a wire-ready rationale.
- `domain/services/exploration/ExplorationLoop.ts` — emits the rationale at the
  decision seam (fully failure-isolated: an explain error never disrupts the run).
- Transport: `TelemetryGateway` port, `TelemetryEmitter`, `SocketTelemetryGateway`,
  `socketServer`, `SessionManager` (bounded 60-item replay buffer).

**developer-dashboard/** (Watchtower)
- `components/telemetry/DecisionLensPanel.tsx` — the visualization (memoized).
- `application/useCases/useDashboardController.ts` — bounded state + snapshot hydrate.
- Gateway plumbing: `EngineGateway`, `SocketHttpEngineGateway`,
  `SocketConnectionManager`, `types.ts` re-exports.
- `components/forensics/ClinicalForensicsDashboard.tsx` — new `decision lens` tab.

## 5. Compatibility & safety

- **Additive & non-breaking.** The new gateway method is optional (`?`), matching
  the existing `emitLiveFrameBinary` / `emitBrowserConsole` idiom — no existing
  telemetry sink or mock has to change.
- **Failure-isolated.** Rationale construction is wrapped and defensive: a null
  feature vector returns `null`, and any throw is caught and logged so the
  exploration step proceeds untouched (honours the project's failure-isolation rule).
- **Reuses the real model.** Attribution is computed from the *same* perceptron the
  engine ranked on — the lens can never disagree with the actual decision.
- **Performance.** One small structured event per committed step; both server
  (60) and client (50) buffers are bounded; the panel is `memo`-ised and pins by a
  stable key so a live burst of decisions can't cause render thrash or a view jump.
- **Survives reconnects.** Rationales ride in `ActiveSessionSnapshot`, so a refresh
  or dropped socket replays the Decision Lens exactly like telemetry and findings.
- **Session-scoped.** Guest and authenticated runs both stream it; nothing new is
  persisted to MongoDB (least-privilege — it's a live/observability artifact,
  not a stored finding).

## 6. How to try it

1. Start a run from the dashboard as usual.
2. Open the **`decision lens`** tab in the right-hand terminal.
3. Watch each pick decompose live; click a `#step` chip to freeze and study one
   decision, and hover any drift badge to see how far online learning moved that
   weight from its prior.
