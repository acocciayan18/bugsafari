# BugSafari Sidecar Architecture

Audit-based reference for the thesis defense. Every claim below is grounded in the
actual implementation. Nothing here is speculative.

## 1. What the Sidecar Is

In BugSafari the term **Sidecar** does not mean a separate process, container, or
microservice. It refers to a **throwaway Playwright `BrowserContext`** opened inside the
**same Chromium browser** that the exploration run is already driving. It is created,
used for a single fault replay, and closed.

Source of the term (verbatim comments in code):

- `testing-core/src/domain/services/verification/ReproductionProbe.ts:9`
  "The replay runs in a SIDECAR context of the same browser, never on the live page."
- `ReproductionProbe.ts:108` "Sidecar context of the replay currently in flight — closed by dispose() to abort it."
- `ExplorationEngine.ts:1122` "Replays land in sidecar contexts of the SAME browser — never on `page`."

The owning component is the class `ReproductionProbe`. Its job is **in-run reproduction
confirmation**: when a candidate becomes a reported finding, its minimized action
timeline is replayed in a sidecar context to decide whether the fault actually recurs.

### Why it exists

Two hard requirements force the sidecar design:

1. **The live page cannot be reused for replay.** The `StateGraphNavigator` owns the
   state of the live `page`: the state graph, the cluster registry, and DOM-hash
   continuity all depend on that page's uninterrupted state. Driving the live page to
   replay a bug would corrupt all three. (`ReproductionProbe.ts:9-11`)

2. **A single replay is statistically weak** for the timing, race, and network faults
   BugSafari specializes in. One coincidental recurrence would false-CONFIRM; one
   coincidental miss would wrongly demote a real bug. The sidecar makes replay cheap
   and disposable enough to run **N times** (severity-scaled) and report a reproduction
   *rate*. (`ReproductionProbe.ts:34-38`)

The sidecar isolates replay from exploration while still sharing the browser and the
authenticated session, so an authenticated run replays authenticated too
(`ReproductionProbe.ts:11-12`).

## 2. How It Works, Step by Step

### 2.1 Creation (once per run)

In `ExplorationEngine.setupRun` region (`ExplorationEngine.ts:1125-1128`):

```ts
const browser = page.context().browser();
this.reproductionProbe = browser
  ? new ReproductionProbe(browser, page.context(), (outcome) => this.onReproductionSettled(outcome))
  : null;
```

- Constructor args (`ReproductionProbe.ts:111-115`): the live `Browser`, the live
  `BrowserContext` (used only to read `storageState`), and a `sink` callback that folds
  the verdict back into the finding.
- If the page exposes no browser handle (non-Chromium or detached driver) the probe is
  `null` and reproduction is silently skipped (`ExplorationEngine.ts:342-344`).

### 2.2 Enqueue (per finding)

Every confirmed finding funnels through one choke point,
`ExplorationEngine.registerConfirmedBug -> enqueueReproduction`
(`ExplorationEngine.ts:571`, `:677-696`):

- Skipped when: no probe, no `bugClass` (nothing to match against), or
  `bug.skipReproduction` is set (oracle-only findings such as reflected XSS that a
  replay cannot re-arm). (`ExplorationEngine.ts:681-684`)
- Otherwise a `ReproductionRequest` is pushed carrying: `bugId`, `targetUrl`, the
  minimized `reproductionActions` timeline, `bugClass`, `faultType`, `severity`,
  `originalMessage`, `scenario`, and the `stateFingerprint`.

`ReproductionProbe.enqueue` (`ReproductionProbe.ts:117-141`):

- Non-blocking, never throws into the caller.
- Dedupe: one verdict per finding via the `seen` set; a re-registration never re-runs
  browser work.
- Skips a finding with an empty timeline (nothing to replay), leaving its score neutral.
- **Bounded queue** (`MAX_QUEUED = 12`) with **severity-aware shedding**: if the queue
  is full and the incoming finding outranks the lowest queued one, the lowest is evicted;
  otherwise the newcomer is dropped. A CRITICAL is never tail-dropped behind a queue of
  LOWs. (`ReproductionProbe.ts:126-137`, helpers `shouldEvictFor` / `lowestSeverityIndex`)
- Kicks the drain loop with `void this.drain()`.

### 2.3 Drain (serialized)

`drain` / `drainLoop` (`ReproductionProbe.ts:165-186`):

- A single drain loop runs at a time (`this.draining` guard), so replays are
  **serialized** — a fault storm can never spawn parallel headless sessions.
- `takeNext` pops the **highest-severity** queued request (FIFO within a severity), so
  the developer-relevant findings verify first under load. (`ReproductionProbe.ts:143-147`)

### 2.4 Probe (N attempts per finding)

`probe` (`ReproductionProbe.ts:188-228`):

- Attempt count is severity-scaled: `INFO 1, LOW 2, MEDIUM 2, HIGH 3, CRITICAL 3`
  (`ATTEMPTS_BY_SEVERITY`, `ReproductionProbe.ts:39`).
- Each attempt is its own sidecar (see 2.5). Undecidable attempts (nav failure, wedged
  page) are **excluded from the denominator**, not counted as negatives.
- Aggregates into a `ReproductionOutcome`: `reproduced` (true if it recurred on any
  decidable attempt), `reproductionRate` = reproductions / decidable attempts, `attempts`
  (decidable count), `stepsReplayed`, and de-duplicated `matchedSignals`.
- Returns `null` only when **no** attempt was decidable, so an unreplayable finding keeps
  its neutral score.

### 2.5 probeOnce (one sidecar context)

`probeOnce` (`ReproductionProbe.ts:230-286`) is the actual sidecar lifecycle:

1. Bail if `browser.isConnected()` is false.
2. Open the sidecar: `browser.newContext({...})` with
   - `viewport 1440x900`, `ignoreHTTPSErrors: true`
   - `serviceWorkers: 'block'` so a stale cached bundle cannot be re-served
   - `storageState` copied from the live context, so auth carries over
     (`ReproductionProbe.ts:238-246`).
3. Record it as `this.activeContext` so `dispose()` can abort it mid-flight.
4. Run the replay through `runReplaySession(context, {...})` wrapped in
   `withTimeout(..., PROBE_TIMEOUT_MS = 45s)` (`ReproductionProbe.ts:250-264`).
   - `guardLoginWall: false` here: the sidecar carries the live session, so a login wall
     during replay means the surface is genuinely unreachable, not a stale credential.
5. An undecidable result (`!result || !result.ok`, or timeout) returns `null`.
6. `finally`: clear `activeContext` and `context.close()` — the sidecar is always torn
   down. (`ReproductionProbe.ts:282-285`)

### 2.6 The replay core (shared)

`runReplaySession` in `regression/ReplaySession.ts` is the single implementation of
"seed state -> load target -> replay timeline -> decide whether the fault recurred." It
is shared by the in-run probe **and** the post-hoc Verify Fix verifier, so both reach a
verdict through identical rules (`ReplaySession.ts:4-10`). Inside the sidecar it:

- Restores cookies + local/session storage from the `stateFingerprint` before the app
  boots (`restoreState`, `ReplaySession.ts:277-313`).
- Navigates with bounded retries and a hydration wait (`navigateWithRetry`,
  `ReplaySession.ts:86-103`).
- Classifies nav status: a recorded route now returning 4xx/5xx is `ROUTE_CHANGED` and
  not comparable (`classifyNavStatus`).
- Replays each recorded step through `ReplayActionRunner` with deterministic settle
  windows (`PER_STEP_SETTLE_MS = 400`, `FINAL_SETTLE_MS = 800`, network 3s).
- Collects faults via `FaultCollector` + `ReplayProbes`, strips inline script/style so
  an app's own error-string literals do not false-match, then classifies signals into
  `strong` / `weak` / `other` buckets. `reproduced` is true only when a STRONG
  (corroborated) same-class signal recurs. (`ReplaySession.ts:187-223`)
- Detects renderer crash / OOM and reports `BROWSER_CRASH` instead of a generic error.

### 2.7 Verdict fold-back

The `sink` (`ExplorationEngine.onReproductionSettled`, `ExplorationEngine.ts:703-745`):

- Re-grades finding confidence with `applyReproductionOutcome`
  (`confidenceScore.ts:83-98`). Delta scales with the rate: full `REPRODUCED_BONUS`
  (0.15) at rate 1, a proportional partial bonus for a flake, and
  `-NOT_REPRODUCED_PENALTY` (0.1) when it never recurred.
- Updates the in-memory ledger (`confirmedBugsMemory`) and marks findings dirty so the
  durable copy saves the corrected verdict.
- Emits `emitReproductionVerdict` (buffered) and an `ACTION` telemetry line reading
  "Reproduced deterministically / intermittently / Did not reproduce (k/N replays)".

## 3. How It Communicates With Each Part of the System

The sidecar has **no network protocol of its own**. It is an in-process object that
communicates through direct method calls, a shared Chromium browser, and the existing
Socket.IO gateway. Communication is entirely in-process except the browser CDP link and
the socket emit to the dashboard.

| Counterpart | Mechanism | Direction |
|---|---|---|
| Testing / exploration engine (`ExplorationEngine`) | Direct method calls: `new ReproductionProbe(...)`, `enqueue()`, `settle()`, `dispose()`, and the `sink` callback | Engine -> probe (control), probe -> engine (verdict via sink) |
| Worker / run lifecycle | Indirect, via the engine. Stop/pause/timebox paths call `dispose()` + `settle()` on the probe | Worker -> engine -> probe |
| API (Express) | None directly. The API launches runs; the probe lives inside the engine the worker runs | n/a |
| Playwright | Shares the same `Browser`; opens its own `BrowserContext` per attempt via `browser.newContext()`; drives replay pages via `runReplaySession` | probe -> Playwright |
| Target app | Only through the sidecar context: navigates to `targetUrl` and replays recorded actions against it | probe -> target |
| Dashboard (Socket.IO) | Verdicts reach the UI via `SocketTelemetryGateway.emitReproductionVerdict` (`REPRODUCTION_VERDICT_EVENT`, buffered) and an `emitTelemetry` ACTION line | engine -> socket -> frontend |

Key point for the defense: the sidecar **never touches the live `page`**. It shares only
the `Browser` handle and a read-only copy of `storageState`. The live exploration context
and the sidecar context are separate `BrowserContext` instances.

## 4. What It Monitors / Intercepts and How That Feeds Bug Detection

The sidecar does not add new monitors to the live run. Inside each replay context it
arms the same detection machinery the engine uses, scoped to that throwaway page:

- `FaultCollector` (`ReplaySession.ts:142`) attaches to the replay page and collects
  console errors, page errors, and (for body-scan classes) network response bodies.
- `ReplayProbes` (`ReplaySession.ts:144`) arms class/fault-type specific oracles,
  including the constraint-bypass endpoint oracle.
- The final classification (`collector.evaluate`) sorts observed signals into
  `strong` (corroborated same-class = reproduction proof), `weak` (same-class but
  uncorroborated), and `other` (different-class faults observed during replay).

That output becomes the reproduction verdict, which is the difference between a one-off
flake and a defect worth a developer's time: it moves `VerificationCandidate.reproduced`,
shifts the confidence score by up to +/-0.15, and drives the reproduction-rate label
("3/3" deterministic vs "1/3" intermittent) shown to the operator.

## 5. What Happens If It Crashes or Disconnects

The design is **fire-and-forget**: exploration never blocks on a probe
(`ReproductionProbe.ts:14`). Failure handling is defensive at every layer:

- **Browser disconnected**: `probe` and `probeOnce` check `browser.isConnected()` and
  bail, returning `null` (undecidable) rather than a false negative.
- **Replay hangs**: `withTimeout(..., 45s)` resolves `null`; the attempt is treated as
  undecidable and excluded from the rate.
- **Replay throws / renderer crashes / OOM**: caught in `probeOnce` and in
  `runReplaySession`; reported as `BROWSER_CRASH` / undecidable, never as "did not
  reproduce."
- **Sink throws**: caught in `drainLoop` and logged; the loop continues.
- **Forced termination (stop / timebox)**: `dispose()` clears the queue, sets
  `disposed = true`, and closes `activeContext`, which rejects the in-flight Playwright
  ops so `probeOnce` unwinds. The engine calls `dispose()` then `settle()` on stop
  (`ExplorationEngine.ts:839-842`, `:1690-1695`) so no sidecar replay outlives the run
  and the probe never outlasts its browser.
- **Pause**: a pure pause does **not** dispose the probe; sidecar probes keep draining in
  the background and re-register verdicts asynchronously, so the run stays resumable
  (`ExplorationEngine.ts:835-838`).
- **Undecidable everything**: if no attempt is decidable, `probe` returns `null` and the
  finding keeps its neutral confidence. A failed sidecar can only ever *withhold*
  evidence, never fabricate a negative verdict.

## 6. Security, Isolation, and Limitations

**Isolation**

- Each replay attempt runs in its own fresh `BrowserContext`, closed in a `finally`
  block, so no cookies/init-scripts leak between attempts or into the live run.
- The live exploration state (state graph, cluster registry, DOM hashes) is fully
  insulated because the sidecar never uses the live `page`/context for interaction.
- Replays are serialized and the queue is bounded (`MAX_QUEUED = 12`), so a fault storm
  cannot exhaust memory or spawn parallel headless sessions.
- `serviceWorkers: 'block'` prevents a stale cached bundle from being re-served during
  replay (parity with the post-hoc verifier).

**Security / auth**

- The sidecar inherits `storageState` from the live context, so authenticated runs
  replay authenticated. It reads that state; it does not mutate the live session.
- `guardLoginWall: false` in the in-run probe is deliberate: because the session is
  carried, a login wall means genuine unreachability, not a stale credential.

**Limitations (grounded in code)**

- The sidecar context is created directly via `browser.newContext()` with only
  `storageState`, `serviceWorkers`, `ignoreHTTPSErrors`, and `viewport`. The per-context
  `StrictUrlLockGuard` and media-abort routes that `TabWindowManager.install` adds to the
  live exploration context (`TabWindowManager.ts:181-185`) are **not** re-installed on the
  sidecar. In practice the sidecar only navigates to the run's own `targetUrl` and replays
  recorded actions, so its reach is naturally bounded to the target surface, but the
  boundary is not enforced by the same route interceptor as the live run.
- Reproduction is best-effort verification, not detection: it can confirm or withhold
  confidence on an already-found bug; it never discovers new findings on its own
  (different-class signals seen during replay are bucketed as `other`, not promoted).
- Oracle-only findings (`skipReproduction`) are never replayed.
- Findings with no recorded timeline are never replayed.
- Under queue pressure, low-severity findings may be evicted and never verified; this is
  logged (`ReproductionProbe.ts:132-134`).

## 7. Actual Files, Classes, Functions, and Communication Methods

**Files**

- `testing-core/src/domain/services/verification/ReproductionProbe.ts` — the sidecar owner.
- `testing-core/src/domain/services/regression/ReplaySession.ts` — the shared replay core.
- `testing-core/src/domain/services/exploration/ExplorationEngine.ts` — creation, enqueue, verdict fold-back, teardown.
- `testing-core/src/domain/services/verification/confidenceScore.ts` — `applyReproductionOutcome`.
- `testing-core/src/infrastructure/socket/SocketTelemetryGateway.ts` — `emitReproductionVerdict`.
- `testing-core/src/domain/services/exploration/ExplorationEngine.control.test.ts` — stop/pause disposal tests.

**Classes / functions**

- `ReproductionProbe` — `enqueue`, `takeNext`, `settle`, `dispose`, `drain`, `drainLoop`,
  `probe`, `probeOnce`; pure helpers `highestSeverityIndex`, `lowestSeverityIndex`,
  `shouldEvictFor`.
- `runReplaySession`, `navigateWithRetry`, `restoreState`, `classifyNavStatus`,
  `stripNonRendered`, `isBlockedByLogin` (ReplaySession).
- `ExplorationEngine.enqueueReproduction`, `ExplorationEngine.onReproductionSettled`.
- `applyReproductionOutcome` (confidence scoring).

**Communication methods**

- In-process: constructor injection + method calls (`enqueue` / `settle` / `dispose`) +
  the `ReproductionSink` callback.
- Browser: Playwright CDP via the shared `Browser` and per-attempt `BrowserContext`.
- Realtime UI: Socket.IO `REPRODUCTION_VERDICT_EVENT` (buffered) and `emitTelemetry` ACTION.

**Key constants**

- `MAX_QUEUED = 12`, `PROBE_TIMEOUT_MS = 45_000`
- `ATTEMPTS_BY_SEVERITY = { INFO:1, LOW:2, MEDIUM:2, HIGH:3, CRITICAL:3 }`
- `REPRODUCED_BONUS = 0.15`, `NOT_REPRODUCED_PENALTY = 0.1`
- `PER_STEP_SETTLE_MS = 400`, `FINAL_SETTLE_MS = 800`, network settle `3_000`

## 8. Architecture / Data-Flow Diagram

```
                 EXPLORATION RUN (worker process)
  +-------------------------------------------------------------+
  |  ExplorationEngine                                          |
  |                                                             |
  |  live page  ---- drives ---->  [ Live BrowserContext ]      |
  |  (StateGraphNavigator owns state graph / DOM hashes)        |
  |     |                                                       |
  |     | registerConfirmedBug()                                |
  |     v                                                       |
  |  enqueueReproduction(bug) --> ReproductionProbe.enqueue()   |
  |                                     |                       |
  |                                     v                       |
  |                        [ bounded queue, severity-ranked ]   |
  |                                     |  drainLoop (serial)   |
  |                                     v                       |
  |                              probe() -> probeOnce()         |
  |                                     |                       |
  |            browser.newContext(storageState, SW=block) ----+ |
  |                                     |                     | |
  |                                     v                     | |
  |                    [ SIDECAR BrowserContext (throwaway) ] | |
  |                       runReplaySession():                 | |
  |                         restoreState -> navigate ->        ||
  |                         replay steps -> FaultCollector     ||
  |                                     |                     | |
  |                                     v                     | |
  |                       ReproductionOutcome (rate, signals) | |
  |                                     |  sink callback      | |
  |                                     v                     | |
  |                   onReproductionSettled():               (context.close())
  |                     applyReproductionOutcome (+/-0.15)     |
  |                     update ledger + markFindingsDirty      |
  |                                     |                       |
  +-------------------------------------|-----------------------+
                                        | emitReproductionVerdict
                                        v
                             SocketTelemetryGateway
                                        |
                                        v
                              Dashboard (Watchtower)
```

Both the live context and the sidecar context live inside the **same Chromium `Browser`**;
they never share a `BrowserContext`. The sidecar's only inbound data is the recorded
timeline plus a copy of `storageState`; its only outbound data is the verdict.

## 9. Defense-Ready Explanation (short)

"When BugSafari finds a bug, it does not trust a single observation. The engine hands
the finding's minimized action timeline to a `ReproductionProbe`, which replays it in a
Sidecar: a throwaway Playwright browser context opened inside the same Chromium browser,
never on the live page. Using a sidecar is essential because the live page's state,
cluster registry, and DOM-hash continuity belong to the navigator, so replaying on it
would corrupt exploration. The sidecar inherits the live session's storage state, so an
authenticated run replays authenticated. Each finding is replayed several times, scaled
by severity, and we report a reproduction rate, so a developer can distinguish a
deterministic defect from a flake. The verdict adjusts the finding's confidence by up to
0.15 and is streamed to the dashboard. The whole thing is fire-and-forget, serialized,
and bounded: exploration never blocks on it, a fault storm cannot spawn parallel
sessions, and on stop or timeout the sidecar is disposed so no replay outlives the run.
Crucially, a failed sidecar can only withhold evidence, never fabricate a false
negative."
