# Generalized Bug Detection — Implementation Plan (Overview)

## Goal

Detect real bugs on **any** SPA the engine has never seen before, with false
positives and false negatives driven as close to zero as the domain allows.

No reference version, no hand-written manifest, no spec. Every technique here is
**app-agnostic**: it either asserts something true of correct web apps in general,
or it compares the app **to itself**.

## Honest ceiling (state this in the thesis)

- **False positives → near-zero is achievable.** A reproduced crash, an unescaped
  reflected payload, or a round-trip state violation is self-evidently a bug and
  needs no spec.
- **False negatives → cannot reach zero.** With no spec, no oracle knows the app's
  intended *domain semantics* (e.g. "tax should be 7%"). We catch bug *classes*
  (crashes, contract breaks, metamorphic/invariant/security violations), not
  arbitrary business logic. This limit is fundamental, not a BugSafari weakness.

## The four plans (implement in this sequence)

| # | File | Attacks | Nature | Risk |
|---|------|---------|--------|------|
| 1 | [PLAN_01_REPLAY_GATE.md](PLAN_01_REPLAY_GATE.md) | False positives | Promote existing `ReproductionProbe` from advisory to gate | Medium |
| 2 | [PLAN_02_METAMORPHIC_ORACLES.md](PLAN_02_METAMORPHIC_ORACLES.md) | False negatives | New `BugFinder`s (round-trip, idempotence) | Low |
| 3 | [PLAN_03_VOLATILITY_LEARNING.md](PLAN_03_VOLATILITY_LEARNING.md) | False positives | New utility; prerequisite for #4 | Low |
| 4 | [PLAN_04_SELF_LEARNED_BASELINE.md](PLAN_04_SELF_LEARNED_BASELINE.md) | Both | New recon phase; app is its own reference | High |

Sequence rationale: ship the safest, highest-leverage FP fix first (#1), then the
biggest FN win (#2), then the small FP utility (#3) that #4 depends on, then the
structural centerpiece (#4) last with its own PR.

**Do not implement all four in one pass.** Ship and benchmark each before the next,
so the FP/FN delta of each is measurable in isolation.

## Shared conventions

- All new detection code follows the existing `BugFinder` contract in
  `testing-core/src/bugs/types.ts` and registers through
  `testing-core/src/bugs/finders/index.ts`.
- New finding classes are added to the shared contract in `shared/types.ts` and the
  catalog in `testing-core/src/bugs/knowledgeBase/bugCatalog.ts`.
- Every candidate still passes the existing `VerificationPipeline` gate (provenance
  -> correlation -> scoring). Nothing bypasses it.
- Code style: single-line comments only, concise, no external libraries. Match the
  surrounding file.

## Definition of done (per plan)

1. Unit tests for the new logic (co-located `*.test.ts`, run via `scripts/run-tests.mjs`).
2. Corpus rows added to `src/__accuracy__/` and `npx tsx scripts/accuracy-bench.ts` still green.
3. `npx tsx scripts/e2e-bench.ts` shows no regression against the seeded fixture.
4. `podman restart bugsafari-api` and one live run against the clean fixture shows
   no new false positives (guest-mode verify per project memory).

## Measurement (the loop that makes it converge)

You cannot claim "no FP/FN" without measuring them. After each plan:
- Run against the **seeded** fixture -> recall / FN.
- Run against the **clean** fixture (zero-bug twin) -> precision / FP.
- Record the numbers in the plan's "Results" section before moving to the next plan.
