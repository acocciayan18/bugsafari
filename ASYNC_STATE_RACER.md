# AsyncStateRacer — Async Lifecycle & Interruption-Race Scenario

A new autonomous exploratory testing scenario for BugSafari that attacks the one
dimension the existing arsenal never targets: **the window while an async operation
is in flight.** It hunts race conditions, swallowed asynchronous failures, component
teardown crashes, and lifecycle state inconsistencies in modern SPAs.

---

## Why this is new (and not a duplicate)

| Existing scenario | What it stresses |
|---|---|
| **DataFuzzer** | Input *values* — boundary/malformed/injection payloads |
| **FormBypasser** | Client-side *constraints* — strips validation to reach the backend |
| **ButtonSpammer / CoordinateBombing** | Event-loop *flood* — zero-wait concurrent click bursts |
| **RouteTrasher / NetworkSaboteur** | *Navigation & network* — history/URL mutation, delay/abort |
| **AsyncStateRacer** *(new)* | **Async *timing & lifecycle*** — interrupts work **mid-flight** |

ButtonSpammer floods clicks to overwhelm the loop; it never *interrupts* an in-flight
request. AsyncStateRacer deliberately waits for the sub-round-trip window when a request
or transition is pending, then cancels/re-triggers it — reproducing defects that only
appear at that seam: `setState`-after-unmount, unhandled `AbortError`, stale-closure
state, duplicate writes from double-submit, and optimistic-UI that never recovers.

It also complements the **dormant** `spaRaceConditionsFinder` (a blind concurrent-flood
finder with no loop runner). AsyncStateRacer is a **live** scenario in the exploration
pipeline that *provokes* faults and lets the real classification pipeline judge them —
rather than self-asserting a finding.

---

## What it does (per targeted control)

1. **Surfaces swallowed async failures.** Installs a one-shot, idempotent page bridge
   that forwards `window.unhandledrejection` events into `console.error`. A rejection
   reaching it means the SPA failed to catch it — the always-on console monitor then
   classifies it as a runtime fault. This turns *silent* async bugs into findings.
2. **Runs a bounded interruption race** (3 cycles). Each cycle: fire the control's async
   action **without awaiting**, wait `45 ms` (inside the in-flight window), then interrupt
   with a user-equivalent **Escape** (cancel/close) **plus a concurrent forced re-trigger**
   (double-submit), and let it settle. No cross-origin navigation — fully confined.
3. **Samples lifecycle churn.** Captures DOM-node count and JS heap (`performance.memory`
   when Chromium exposes it) before/after; records the deltas on the transaction as a
   coarse leak/detachment signal. **Diagnostic only** — deltas never create a finding by
   themselves, so no false positives from noisy heap readings.

---

## How it integrates with the engine

- **ML scoring & reward (`RiskScorer`/Perceptron).** The scenario runs on the element the
  navigator scored and selected; the loop sets it as `lastActedTarget`, so any network
  signal it generates rewards the element (`applyCompoundReward({networkActivity})`) and
  any confirmed fault rewards it harder (`{faultDetected}`). Actions therefore *learn from*
  and *influence* exploration through the existing wiring — no direct scorer coupling.
- **Replay system (`actionBuffer.ts`).** The whole race is recorded as **one**
  `ActionRecorder.recordStep(...)` entry (not flooding the 20-slot buffer) plus
  `ActiveScenarioTracker.record(...)` deliberate steps, so every fault gets a deterministic,
  reproducible playbook.
- **Bug classification pipeline.** A real `ASYNC_RACE` `ChaosTransaction` is opened for
  attribution, and the scenario executes inside an `ActiveScenarioTracker` window. Faults
  flow through the same three-tier `StabilityMonitor` + `FaultClassifier` (live tier →
  resolved bug class / severity):
  - **Critical tier** — client crash / unhandled rejection → `RUNTIME_STABILITY_EXCEPTION` (HIGH)
  - **Critical tier** — state race → `SPA_STATE_RACE_CONDITION` / `CASCADING_STATE_FAILURE` (HIGH)
  - **Medium tier** — 5xx from the interrupted request → `BOUNDARY_STRESS_FAILURE` (HIGH on 5xx)
  - **Informational tier** — handled 4xx / graceful aborts → telemetry only, **no finding**
- **Navigation / confinement / recovery / stability.** No cross-origin navigation; every
  browser call is guarded so a detached/closed page never throws; the race is bounded and
  deterministic; the Strict URL Lock and PageHealthGuard remain authoritative.

---

## How to run it

- **Dedicated profile:** select **“Async Lifecycle Assault”** (`ASYNC_LIFECYCLE_ASSAULT` →
  `['asyncRace']`) — isolates the scenario for guaranteed execution.
- **Custom profile:** tick **“Async Lifecycle & Race Probing”** in the testing-type matrix.
- **Full-spectrum:** **Chaos Infiltration** now includes `asyncRace` automatically.

---

## Files

| File | Change |
|---|---|
| `testing-core/src/domain/scenarios/asyncStateRacer.ts` | **New** — the scenario |
| `testing-core/src/domain/scenarios/asyncStateRacer.test.ts` | **New** — wiring test |
| `testing-core/src/domain/chaos/ChaosTransactionManager.ts` | `ASYNC_RACE` type + `AsyncRaceMetadata` |
| `testing-core/src/domain/chaos/index.ts` | export `AsyncRaceMetadata` |
| `testing-core/src/domain/scenarios/index.ts` | register in registry + map + re-export |
| `testing-core/src/domain/services/exploration/ActionExecutor.ts` | gated candidate + adapter |
| `testing-core/src/bugs/knowledgeBase/scenarioCatalog.ts` | fault attribution entry |
| `shared/types/testingType.ts` | `asyncRace` testing type + `ASYNC_LIFECYCLE_ASSAULT` profile |

The dashboard checklist and profile picker render generically from the shared catalog, so
the new category and profile appear with no frontend code change.
