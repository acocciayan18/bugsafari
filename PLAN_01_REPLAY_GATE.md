# Plan 1 — Mandatory Replay Gate

**Attacks:** false positives · **Generalized:** yes (no app knowledge) · **Risk:** medium

## Problem

Today reproduction is an *advisory nudge*: `ReproductionProbe` replays a candidate's
timeline N times, and the reproduction rate moves the confidence score by ±0.15
(`REPRODUCED_BONUS` / `NOT_REPRODUCED_PENALTY` in `confidenceScore.ts`). A candidate
can therefore be reported as `CONFIRMED` on evidence strength alone, *before or
without* any replay settling. Flaky, timing, and one-shot faults slip through as
confirmed findings. This is the largest remaining generalized FP source.

## Design

Promote reproduction from a score modifier to a **hard gate on the CONFIRMED band**:

- A finding may only reach `CONFIRMED` if a replay pass **re-observed** it
  (`reproductionRate > 0`).
- A finding whose replay is still pending, or which did not reproduce, is capped at
  `NEEDS_VERIFICATION` — **surfaced, never dropped, never confirmed**.
- Deterministic-crash classes (uncaught exception with a stack, HTTP 5xx) are exempt
  from the *pending* cap: they are self-evident and need no replay to confirm, but a
  replay that runs and fails to reproduce still demotes them.

This keeps recall intact (nothing is discarded) while removing false confirmations.

## Current state (already exists)

- `testing-core/src/domain/services/verification/ReproductionProbe.ts` — replays N
  times (severity-scaled), returns a rate, fire-and-forget, sidecar context.
- `testing-core/src/domain/services/verification/confidenceScore.ts` —
  `applyReproductionOutcome(score, origin, reproduced, rate?)` already scales the
  delta by rate.
- `testing-core/src/domain/services/verification/VerificationPipeline.ts` — the
  verdict gate every candidate flows through.
- `testing-core/src/domain/services/regression/ReplaySession.ts` — the replay driver.

## Files to modify

1. **`confidenceScore.ts`** — add a terminal cap in `gradeScore()`:
   - New signature detail: pass a `reproductionState: 'REPRODUCED' | 'NOT_REPRODUCED' | 'PENDING' | 'EXEMPT'`.
   - Rule: if state is `PENDING` or `NOT_REPRODUCED` and class is not `EXEMPT`, cap
     status at `NEEDS_VERIFICATION` (same mechanism as the existing non-target-app cap on line 119).
2. **`VerificationPipeline.ts`** — thread the reproduction state into scoring; classify
   deterministic-crash fault types as `EXEMPT` (reuse `FaultClassifier` output).
3. **`ReproductionProbe.ts`** — expose a synchronous "verdict-so-far" accessor keyed by
   finding id so the pipeline can read `PENDING` vs settled without blocking exploration.
4. **`bugs/knowledgeBase/securityEvidenceGate.ts`** (pattern reference) — mirror its
   "requires proof" predicate style for a new `requiresReproduction(faultType)` helper.

## Files to create

- `testing-core/src/domain/services/verification/reproductionGate.ts` — pure function:
  `reproductionStateFor(faultType, rate | undefined) -> ReproductionState`.
- `reproductionGate.test.ts` — table test of the four states.

## Data contract change

`shared/types.ts`: extend `VerificationVerdict` (or the finding record) with
`reproductionRate: number | null` and `reproductionState` so the dashboard forensic
view can show "confirmed by replay (3/3)" vs "pending verification".

## Algorithm (pseudocode)

```
// single-line comments only per house style
state = reproductionStateFor(faultType, rate)
score = scoreFinding({...evidence, reproduced: rate>0, rate})
if state in {PENDING, NOT_REPRODUCED} and not isExempt(faultType):
    status = min(status, NEEDS_VERIFICATION)
```

## Edge cases / FP guards

- **Pending forever:** a wedged replay (`PROBE_TIMEOUT_MS`, 45s) must resolve to
  `NOT_REPRODUCED`, not stay `PENDING`, so a finding is never stuck below CONFIRMED
  by a dead probe.
- **Queue shedding:** `ReproductionProbe` sheds load at `MAX_QUEUED` (12). A shed
  candidate is `PENDING` -> capped at NEEDS_VERIFICATION. Acceptable and honest.
- **Exempt but replay contradicts:** a 5xx that replays clean N times still demotes;
  exemption only covers the *pending* window, not a settled negative.
- **Authenticated replays:** sidecar already inherits storage state; no change.

## Tests

- Unit: `reproductionGate` truth table; `confidenceScore` cap interaction with the
  existing origin cap (both caps compose).
- Integration: a synthetic flaky candidate (rate 0) never reaches CONFIRMED; a
  deterministic exception (EXEMPT, pending) reaches CONFIRMED, then demotes if a
  later replay reports rate 0.

## Benchmark impact

- `accuracy-bench.ts`: no corpus change needed (scoring-band test lives in
  `statusForScore.test.ts`; extend it).
- `e2e-bench.ts`: expect precision unchanged or up, recall unchanged (nothing
  dropped). Record before/after CONFIRMED counts.

## Effort

~0.5–1k LOC, ~8–12 files touched (mostly small verification edits). 2–3 days.

## Risk & rollback

Medium: changes the verdict logic every finding flows through. Rollback = revert the
cap in `gradeScore()`; scoring returns to advisory-only. Feature-flag via an env var
(`BUGSAFARI_REPLAY_GATE`, default on) for one release if desired.

## Results (fill after implementation)

- Seeded fixture: recall ____ (was ____)
- Clean fixture: FP count ____ (was ____)
- CONFIRMED count delta: ____
