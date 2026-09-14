# Plan 3 — Volatility Learning

**Attacks:** false positives · **Generalized:** yes (app is its own reference) · **Risk:** low

## Problem

Any oracle that diffs two observations of the "same" thing (metamorphic in Plan 2,
baseline deviation in Plan 4) will false-positive on **legitimately dynamic content**:
clocks, session tokens, CSRF nonces, ad slots, A/B variants, animation state,
auto-incrementing ids. On an unfamiliar app we do not know in advance which fields
are volatile. So we learn it, from the app itself.

This is the single biggest generalized false-positive source for diff-based oracles,
and a hard prerequisite for the self-learned baseline (Plan 4).

## Design

During benign observation, request/observe the "same" thing twice (or more) and mark
any field that **differs across identical observations** as volatile. Diffs later
run **modulo** the learned volatile set. A field is volatile if it changed without
any causing action; everything else is stable and diff-significant.

Two scopes:
- **DOM volatility** — per state fingerprint, which text nodes / attributes churn
  between two clean captures of the same route with no action between them.
- **Response volatility** — per endpoint, which JSON paths / header values differ
  across two identical requests.

## Current state (already exists)

- `testing-core/src/infrastructure/monitoring/stateFingerprint.ts` — DOM fingerprint
  primitive to sample twice.
- `testing-core/src/infrastructure/monitoring/NetworkLogStore.ts` — captured
  request/response bodies to sample per endpoint.
- Structural DOM hashing already normalizes some churn; volatility learning is the
  field-level complement.

## Files to create

- `testing-core/src/domain/services/baseline/volatilityModel.ts` — the model:
  `record(observationKey, snapshotA, snapshotB)`, `isVolatile(observationKey, path)`,
  `stableDiff(observationKey, a, b) -> significantChanges[]`.
- `testing-core/src/domain/services/baseline/jsonPaths.ts` — flatten JSON/DOM to
  comparable path->value maps (pure).
- Co-located `*.test.ts`.

## Files to modify

- Plan 2 oracles' `relations.ts` — swap the static volatility allow-list for
  `volatilityModel.stableDiff`.
- `ExplorationLoop.ts` — take two clean fingerprints of the entry state at run start
  (cheap, one extra sample) to seed DOM volatility before any action.
- Network capture path (where responses land in `NetworkLogStore`) — feed repeat
  responses for the same endpoint key into the model.

## Algorithm (pseudocode)

```
// mark a path volatile if it differs with no action between observations
record(key, A, B):
  for path in union(paths(A), paths(B)):
    if value(A,path) != value(B,path): volatile[key].add(path)

stableDiff(key, a, b):
  return [ path for path in changedPaths(a,b) if path not in volatile[key] ]
```

## Heuristic seeds (before any learning, to avoid cold-start FPs)

Pre-seed the volatile set with format-based detectors so the first diff is already
safe: ISO/epoch timestamps, UUID/CSRF-shaped tokens, values that parse as
monotonically increasing ids, `Date`-like strings. Learning refines from there.

## Edge cases / FP guards

- **Over-learning:** a field that legitimately changes because of the *action under
  test* must not be pre-marked volatile. Only learn from **action-free** repeat
  observations. Never learn volatility from a snapshot pair that had an action
  between them.
- **Under-sampling:** two samples is the minimum; a field that happens to match twice
  is treated stable. Acceptable — the replay gate (Plan 1) and reproduction still
  guard the downstream finding.
- **Unbounded memory:** cap volatile paths per key; evict least-recently-confirmed.

## Tests

- Unit: timestamp/token/uuid seeds classified volatile without learning.
- Unit: a field that differs across two action-free samples becomes volatile; a
  field that only differs after an action stays stable.
- Unit: `stableDiff` ignores volatile paths, reports real changes.

## Benchmark impact

- No new bug classes. Measured indirectly: it must *reduce* FP on the clean fixture
  for Plan 2 oracles, and is the enabler for Plan 4's precision.

## Effort

~0.5–0.8k LOC, ~3–5 files touched. 2–3 days.

## Risk & rollback

Low: a pure model plus two sampling hooks. Rollback = oracles fall back to the static
allow-list. No verdict-path change.

## Results (fill after implementation)

- Plan 2 clean-fixture FP: ____ -> ____
- Volatile fields learned on a sample unknown app: ____
