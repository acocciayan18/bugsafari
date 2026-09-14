# Plan 2 — Metamorphic Oracles

**Attacks:** false negatives · **Generalized:** yes (no app knowledge) · **Risk:** low

## Problem

The engine only catches *observable exceptions*. Silent logic bugs that never throw
(a remove that does not remove, a toggle that does not revert, a paginated list that
loses items on reload) are invisible. On an unfamiliar app with no spec, we cannot
know the *correct* output, but we CAN assert a **relationship between two runs of the
same app**. When that relationship breaks, it is a real bug, and we never needed the
correct answer. This is the single biggest FN win that generalizes.

## Design

Add metamorphic relations as new `BugFinder`s in the existing `bugs/finders/`
registry, run by `BugFinderRunner` as a post-action phase. Each oracle:
1. captures a **state fingerprint** before an action,
2. performs a transformation the app claims is reversible/idempotent/order-free,
3. captures the fingerprint again,
4. asserts the metamorphic relation, diffing **modulo volatile fields** (see Plan 3;
   until Plan 3 lands, use a conservative static volatility filter).

Relations to ship (highest signal, lowest FP first):

- **Round-trip / reversibility** — `open then close` a modal, `add then remove` a
  cart/list item, `navigate away then back`. Expected: DOM/state fingerprint returns
  to (equivalence of) the start. Violation = state not restored.
- **Idempotence** — repeat the same GET / same benign action twice. Expected: same
  response schema and same end-state fingerprint. Violation = drift.
- **Reload-stability** — perform an action, hard reload, expected: persisted state
  reflects it consistently (no duplicate, no loss). Optional second wave.

## Current state (already exists)

- `testing-core/src/bugs/types.ts` — the `BugFinder` interface (`isApplicable`,
  produces `BugFinding`) and `BugContext`.
- `testing-core/src/bugs/finders/index.ts` — the registry (reflectionOracle,
  injectionDifferential, injectionEvidence, structuralProbe, etc.).
- `testing-core/src/domain/services/exploration/BugFinderRunner.ts` — runs finders
  post-action, per-class budget, quarantine on transient page errors, sweep cadence.
- `testing-core/src/infrastructure/monitoring/stateFingerprint.ts` +
  `captureStateFingerprint` — already used by the runner; the fingerprint primitive
  the oracles diff against.

## Files to create

- `testing-core/src/bugs/finders/metamorphic/roundTripOracle.ts`
- `testing-core/src/bugs/finders/metamorphic/idempotenceOracle.ts`
- `testing-core/src/bugs/finders/metamorphic/reloadStabilityOracle.ts`
- `testing-core/src/bugs/finders/metamorphic/relations.ts` — shared: fingerprint
  capture, equivalence compare (modulo volatile), reversible-action detection.
- Co-located `*.test.ts` for each.

## Files to modify

- `bugs/finders/index.ts` — register the three oracles.
- `bugs/types.ts` + `shared/types.ts` — add `BugClass` values:
  `METAMORPHIC_STATE_LEAK`, `NON_IDEMPOTENT_ACTION`, `RELOAD_STATE_CORRUPTION`.
- `bugs/knowledgeBase/bugCatalog.ts` — catalog entries (severity, student-friendly
  remediation copy).
- `bugs/knowledgeBase/scenarioCatalog.ts` — scenario attribution for the new classes.

## Reversible-action detection (how oracles pick what to test, generally)

No app knowledge: detect candidate reversible pairs structurally.
- Modal: an element whose click adds an overlay/dialog role, plus a close/dismiss
  control inside it.
- Add/remove: a control labeled add/+/cart adjacent to (or producing) a
  remove/-/delete control.
- Nav round-trip: any in-app navigation edge already in the `StateGraphNavigator`.
Skip anything ambiguous. Low recall here is fine; precision is the priority.

## Edge cases / FP guards (critical — metamorphic oracles are FP-prone if naive)

- **Volatile content:** timestamps, ads, tokens, animations differ between snapshots.
  Diff modulo a volatility filter (static allow-list now, learned in Plan 3). If the
  ONLY differences are volatile, it is NOT a violation.
- **Async settle:** wait for network-idle + DOM-stable before each fingerprint, reuse
  the loop's existing settle helpers, so a mid-flight snapshot is not read as drift.
- **Legitimately non-idempotent actions:** POST that creates a new resource each time
  is correct. Only apply idempotence to GET/read and to actions the round-trip oracle
  itself performed (it knows the inverse). Never flag a bare repeated POST.
- **Confirm before report:** every candidate runs through the Plan 1 replay gate, so a
  one-off metamorphic blip cannot CONFIRM.

## Tests

- Unit: `relations.ts` equivalence compare (identical -> equal; volatile-only diff ->
  equal; real diff -> not equal).
- Unit: each oracle against a synthetic DOM fixture (a good modal vs a modal that
  leaks a backdrop; an idempotent vs a drifting endpoint).
- Corpus: add `detectionCorpus.ts` rows for the three new classes.

## Benchmark impact

- `accuracy-bench.ts`: class-accuracy corpus grows; keep green.
- `e2e-bench.ts` / seeded fixture: add at least one seeded metamorphic bug to
  `testing/benchmark/seeded-app` so recall on this class is measured, not assumed.

## Effort

~1.5–2.5k LOC, ~5–10 existing files touched. 4–6 days.

## Risk & rollback

Low: purely additive finders. Rollback = unregister them in `finders/index.ts`. Each
oracle is independently gated by `isApplicable` + the per-class finding budget, so a
noisy oracle cannot starve the others or the run.

## Results (fill after implementation)

- New real bugs found on seeded fixture: ____
- FP on clean fixture from metamorphic classes: ____ (target 0)
