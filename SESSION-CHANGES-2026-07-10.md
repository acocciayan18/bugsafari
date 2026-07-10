# BugSafari — Session Changes (2026-07-10)

**Goal:** make the engine do its job without producing false results, looping forever, or failing to explore different parts of a target site — then implement **D2/D3 adaptive pacing**.

**Status:** ✅ All changes implemented, unit-tested, typechecked, built, and verified end-to-end against a live site.

**Test/build:** `tsc --noEmit` clean · **16/16** test files pass · `tsc` build clean.

---

## Context: how this started

A runtime log showed the engine clicking one control (`#submitBtn`, "Subscribe for Free") every step on an ad-heavy/crashing page (guru99), with `Novel state discovered (visitCount: 1)` and a **climbing** score each step. A prior static audit had concluded "no infinite-loop path found" (its finding **C1**) — because this is **not a control-flow loop**. It's a **false-novelty reward loop**: the combined DOM hash churns on every reload (ads + a `noConflict` JS crash), so re-clicking one control read as an endless stream of "novel" states and the perceptron kept rewarding it.

Two opposite failure modes both defeat the goal:

| Failure mode | Cause | Fix |
|---|---|---|
| Loops forever on one control | Hash instability → false novelty → perceptron rewards same control | Fix 1 |
| Runs go dead / premature "exhausted" | Monotonic penalty accumulation (audit A1) zeros the frontier | Fix 2 |
| False escalation / false bug signals | Value-blind hash confounds the escalation ladder (A2/A3) | Fix 3 |
| Wasted timebox / heavy per-step work | Fixed waits + full 3 s verify poll on every click (D2/D3) | Pacing |

---

## Foundation — zero-dependency test runner

The repo's `*.test.ts` were self-executing `tsx` scripts with **no runner** and no `npm test`. Rather than add vitest (the project forbids new external libs), added a runner that discovers and runs them via the existing `tsx`.

- **new** `testing-core/scripts/run-tests.mjs` — recursively finds `src/**/*.test.ts`, runs each through `tsx`, aggregates exit codes.
- `testing-core/package.json` — added `"test": "node scripts/run-tests.mjs"`.

---

## Fix 1 — kill the false-novelty loop

Novelty reward is now gated on the **structure** sub-hash (normalized layout shell), not the volatile **combined** hash. A reloaded page = same shell = not novel. Graph node/edge identity still uses `combined` (unchanged). Plus ad/volatile-subtree exclusion so the structure hash is actually stable across reloads.

- **new** `.../exploration/noveltyScoring.ts` — pure `isNovelStructuralState()` (a verified traversal to a structurally new shell; false for no-op, invalid-context, or already-seen shells).
- **new** `.../exploration/noveltyScoring.test.ts` — 5 checks (incl. the guru99 reload case).
- `ml/domHasher.ts` — added a `VOLATILE` selector (`iframe`, `ins.adsbygoogle`, `[id^=google_ads]`, `[id^=div-gpt-ad]`, `[data-ad-*]`, …) excluded from **both** signatures (structure `serialize()` skips the subtree; interactive loop skips `el.closest(VOLATILE)`).
- `.../exploration/StateRestorer.ts` — `verifyTraversal` now returns `childStructure` (hashes the compound, not just combined).
- `.../exploration/ExplorationLoop.ts` — novelty gate uses `isNovelStructuralState`; `visitedStructures` recorded per step; `childStructure` + `landedInvalid` threaded into the reward.
- `.../exploration/types.ts` — added `visitedStructures: Set<string>` to `ExplorationLoopDeps`.
- `.../exploration/ExplorationEngine.ts` — declares and passes the `visitedStructures` set.

---

## Fix 2 — penalty decay + cap (audit A1)

`RiskScorer.penalties` was only ever incremented, never decayed. One stagnation event (which penalizes **every** ranked element by `|score|+1`) drove the whole frontier permanently negative → premature "graph exhausted." Penalties are now transient.

- `domain/services/RiskScorer.ts`:
  - `penalize()` caps per-call magnitude (60) and accumulated total (200).
  - new `decayPenalties()` — multiplies all penalties by 0.9 per ranking pass, drops entries < 0.5.
- **new** `RiskScorer.penaltyDecay.test.ts` — 4 checks (cap bound; full recovery after decay; a stagnation event doesn't permanently lock out a high-value control).
- `.../exploration/ExplorationLoop.ts` — calls `scorer.decayPenalties()` once per ranking pass (before scoring).

---

## Fix 3 — escalation on true input resistance (audit A2/A3)

The fuzz escalation ladder advanced whenever `preStateHash === postStateHash`, but the fuzz hasher is **value-blind** — an accepted, processed payload that didn't navigate hashed identical to the pre-state and escalated to L4 almost unconditionally. Escalation now keys on real **input resistance**.

- **new** `.../exploration/escalationDecision.ts` — pure `decideEscalation()` → `reset` (fault / field vanished) · `escalate` (payload rejected or client-validation error) · `hold` (accepted & processed, no fault).
- **new** `.../exploration/escalationDecision.test.ts` — 5 checks (incl. the A2 false-escalation case now holding).
- `.../exploration/ActionExecutor.ts` — replaced the hash-equality branch with `decideEscalation(...)`; added `detectInputResistance()` (reads the field back post-submit: payload not retained, or `validationMessage`/`aria-invalid` → resistance).

---

## D2/D3 — adaptive pacing

Fixed waits (`wait(350)` per step) and a full **3 s** `verifyTraversal` poll on **every** click — including no-op clicks that never diverge — wasted much of the timebox and re-hashed the DOM up to ~10×/click.

- **new** `.../exploration/pacing.ts` — pure `shouldExitNoOp()`. Two floor-gated exits: network went idle for `quietMs` (clean fast path), **or** an absolute `noOpCeilingMs` elapsed (so a perpetually-chattering ad/analytics page can't pin verification at the hard cap). In-flight requests below the ceiling keep the window open so a slow backend transition is never cut short.
- **new** `.../exploration/pacing.test.ts` — 6 checks (floor, network-quiet exit, in-flight hold, ceiling exit on a chattering page).
- `.../exploration/StateRestorer.ts` — `verifyTraversal` is now **network-aware**: attaches short-lived `request`/`response` listeners, polls at 200 ms, accepts a stable divergence as before, and early-exits a no-op via `shouldExitNoOp` (floor 600 ms, quiet 350 ms, ceiling 1800 ms, hard cap 3000 ms). Listeners removed in `finally`.
- `.../exploration/types.ts` — new `settle(page, floor=100, cap=600, quiet=150)` — a `MutationObserver`-based DOM-quiet race (static page resolves at the floor, churny page is capped), falling back to a fixed wait if the page navigates mid-evaluate.
- `.../exploration/ExplorationLoop.ts` — the three inter-step `wait(350)` calls replaced with `settle(page)`.

**Note:** the win scales with no-op frequency — large on the looping/ad-heavy pages this targets (each dead click drops ~3 s → ~1 s), modest on mostly-navigating pages. The remaining per-step cost is the live-frame screenshot + DOM parse (telemetry, outside the audit's D2/D3 scope).

---

## End-to-end verification (live site: academybugs.com/find-bugs/)

Drove the real production path (`PlaywrightBrowserEngine.run`, headless, guest mode) via a throwaway harness (`testing-core/scripts/e2e-academybugs.mts`, exploration+navigation, 150 s active timebox). Consistent across runs:

- **8 → 7 distinct controls** acted on out of 10 actions; **top-control share ~20 %** → verdict **✅ EXPLORING**.
- Novelty rewards fired **only** on genuinely new shells; returns to seen shells registered as `state-revisited` (penalty), not false novelty.
- **Cyclic loops blocked**: re-selecting a just-clicked control was caught (`cyclic-blocked` + revisit penalty), not rewarded — the exact behavior that was broken on guru99.
- Pacing: run time **182 s → 161 s → 153.7 s** for the same 10 steps across the pacing iterations, with behavior unchanged.

---

## Deferred (agreed out of scope — higher risk / not goal-critical)

- **P0.2** unify the dual scoring brains (frozen heuristic `0.6` dominates the learned perceptron `0.4`; two keyword systems can disagree). Alters ranking globally — needs strict characterization tests first.
- **P2.2** per-run engine instances behind a queue (today one global `state.active` singleton → one URL at a time).
- **B2/D4** dead `dataFuzzer.ts` internal escalation loop (unused in the live path) — dedup/remove.
- Live-frame screenshot cost per step (make non-blocking) — biggest remaining per-step latency, but it's telemetry, not D2/D3.

---

## Files changed / added

**New:** `scripts/run-tests.mjs`, `scripts/e2e-academybugs.mts`, `exploration/noveltyScoring.ts` (+test), `exploration/escalationDecision.ts` (+test), `exploration/pacing.ts` (+test), `RiskScorer.penaltyDecay.test.ts`.

**Modified:** `package.json`, `ml/domHasher.ts`, `domain/services/RiskScorer.ts`, `exploration/ExplorationEngine.ts`, `exploration/ExplorationLoop.ts`, `exploration/StateRestorer.ts`, `exploration/ActionExecutor.ts`, `exploration/types.ts`.
