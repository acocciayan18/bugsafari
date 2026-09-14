# Plan 4 — Self-Learned Baseline (Two-Phase Run)

**Attacks:** both FP and FN · **Generalized:** yes (app is its own reference) · **Risk:** high

## Problem

The manifest / golden-version approach only works on apps you own. To generalize
deviation detection to an unfamiliar site, the app must become **its own reference**:
observe its normal behavior, build a model, then flag departures from that model
under stress. This is the centerpiece of generalization and the largest structural
change. Depends on Plan 3 (volatility learning) to avoid false deviations from
dynamic content.

## Design

Split each run into two phases inside the existing `ExplorationLoop`:

### Phase A — Recon / Learn (benign, no injection)

Explore normally and auto-build a baseline model:
- **Endpoint model:** per endpoint key (origin+path+method), the observed status
  distribution and response **schema** (shape, types), modulo volatile paths.
- **DOM/state model:** per route, the stable structural fingerprint and invariant
  set (what always renders, what controls exist).
- **Navigation model:** reuse `StateGraphNavigator`'s graph as the reachability
  baseline.

### Phase B — Attack (fuzz / chaos, existing scenarios)

Run the existing scenarios and flag any **deviation from the app's own learned
normal** that also survives provenance + replay gates:
- endpoint that was reliably `200 JSON shape X` now returns `500` / HTML / a
  different shape under a boundary input,
- route that always rendered control set Y now renders garbage or drops it,
- a benign-phase invariant now violated.

## Current state (already exists)

- `testing-core/src/domain/services/exploration/ExplorationLoop.ts` — single
  `execute(page, maxSteps)` loop (`for (let step = 1; ; step++)`). Phase becomes a
  field on the loop / a two-call structure.
- `testing-core/src/domain/services/exploration/ExplorationEngine.ts` /
  `AutonomousExplorationEngine.ts` — run orchestration entry.
- `NetworkLogStore.ts`, `stateFingerprint.ts` — the observation sources to learn from.
- `volatilityModel.ts` (Plan 3) — the modulo-volatile diff the model depends on.
- `VerificationPipeline` + `ReproductionProbe` (Plan 1) — the gate deviations pass through.

## Files to create

- `testing-core/src/domain/services/baseline/BaselineModel.ts` — the learned model:
  `learnResponse(key, res)`, `learnState(route, fp)`, `deviationFor(observation)`.
- `testing-core/src/domain/services/baseline/schemaInference.ts` — infer a response
  schema from N samples (types, required paths, enum-ish values), pure.
- `testing-core/src/bugs/finders/baselineDeviationOracle.ts` — Phase-B `BugFinder`
  that consumes `BaselineModel` and emits deviation findings.
- Persistence: extend the DB layer under
  `testing-core/src/infrastructure/database` with a `baseline_snapshots` collection
  so a model can be reused across runs of the same target (optional, phase 2).
- Co-located `*.test.ts` for model, inference, oracle.

## Files to modify

- `ExplorationLoop.ts` — introduce `phase: 'RECON' | 'ATTACK'`; gate scenario arming
  and the deviation oracle by phase; split the step budget (e.g. 40% recon / 60%
  attack, tunable).
- `ExplorationEngine.ts` / engine entry — run Phase A then Phase B; hand the model
  from A into B; ensure Phase A performs **no** injection (scenarios disarmed).
- `BugFinderRunner.ts` — allow a finder to declare it is Phase-B-only.
- `shared/types.ts` + `bugCatalog.ts` — new `BugClass`:
  `BASELINE_STATUS_DEVIATION`, `BASELINE_SCHEMA_DEVIATION`, `BASELINE_STATE_DEVIATION`.
- Session lifecycle / telemetry so the dashboard shows the two phases and the learned
  model summary (endpoints learned, schemas captured).

## Schema inference (how deviation stays low-FP)

- Learn from >= N samples per endpoint (N configurable, default 3); an endpoint seen
  fewer times is "under-observed" and its deviations are `NEEDS_VERIFICATION` at most,
  never CONFIRMED.
- Schema = per JSON path: type set, presence ratio, and small-cardinality value set.
  A deviation is a new error status, a dropped required path, a type change, or a
  body that no longer parses as the learned content-type.
- Everything compared modulo the Plan 3 volatility model.

## Edge cases / FP guards (this plan is the FP-riskiest — guard hard)

- **Cold endpoints:** never CONFIRM a deviation on an endpoint with < N benign
  samples. Cap at NEEDS_VERIFICATION.
- **Legit dynamic status:** an endpoint that returned mixed 200/404 in benign phase
  (e.g. optional resource) has a *distribution*, not a single expected status; only a
  status never-seen-benign (esp. 5xx) is a deviation.
- **Phase-A contamination:** if any fault occurs during recon, that state is excluded
  from the baseline (you cannot learn "normal" from a broken observation) and is
  itself reported through the normal pipeline.
- **Auth/state drift between phases:** Phase B must start from the same storage/auth
  state Phase A learned, or schemas mismatch spuriously. Reuse the run context.
- **Reload/idempotence overlap with Plan 2:** dedup by signature so a metamorphic
  finding and a baseline finding for the same defect collapse to one.

## Tests

- Unit: `schemaInference` (3 consistent samples -> stable schema; a 4th 500 ->
  status deviation; a shape change -> schema deviation).
- Unit: `BaselineModel.deviationFor` respects under-observation cap and volatility.
- Integration: two-phase run on the seeded fixture surfaces a seeded boundary-input
  500 as `BASELINE_STATUS_DEVIATION`; two-phase run on the clean fixture surfaces zero.

## Benchmark impact

- Add a seeded "silent-until-boundary" bug (200 normally, 500 on overflow input) to
  `testing/benchmark/seeded-app` so recall of this class is measured.
- `e2e-bench.ts` must be updated to run both phases; record recall/precision split by
  phase.

## Effort

~2–3k LOC, ~15–25 files touched. This is roughly half the total program effort.
1.5–2.5 weeks. Ship in its own PR, behind `BUGSAFARI_TWO_PHASE` (default off until
benchmarked).

## Risk & rollback

High: changes the run lifecycle. Mitigations: feature flag defaults off; Phase A is
pure observation (cannot itself cause harm); the deviation oracle is an ordinary
gated `BugFinder`. Rollback = flag off -> single-phase run, deviation oracle inert.

## Results (fill after implementation)

- Silent-boundary bugs caught on seeded fixture: ____
- Baseline deviations FP on clean fixture: ____ (target 0)
- Recon coverage (endpoints learned / discovered): ____
