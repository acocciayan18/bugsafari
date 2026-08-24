# BugSafari — Thesis-Defense Codebase Guide

A plain-English walkthrough of the whole system: what each important file does, how the
pieces connect, and where each fits in the end-to-end flow. Written so you can explain the
architecture confidently, without re-reading the source during questions.

---

## 0. The One-Paragraph Summary

BugSafari is an **autonomous exploratory testing engine for Single-Page Apps**. You give it a
URL. A real Chromium browser (driven by Playwright) opens the page, reads the DOM, and a small
machine-learning model (a **single-layer perceptron**) scores every clickable element by how
"interesting" it looks. It clicks the best one, watches what happens, and **learns** (delta-rule
weight update) from the result. It avoids going in circles by **hashing the DOM structure** into a
fingerprint and remembering where it has been. Along the way it runs **attack scenarios** (rapid
clicking, form fuzzing, route trashing, network sabotage) and **listens for crashes** (JS
exceptions, failed network calls, console errors). When something breaks, it captures the last ~20
actions from a **circular buffer** into a **forensic report** with reproduction steps. Everything
streams live over **Socket.IO** to a **React dashboard** (the "Watchtower"). Logged-in users can
**save runs to MongoDB**; guests can test but not save. **Google Gemini** optionally turns findings
into human-readable fix suggestions.

---

## 1. The Big Picture (Monorepo)

Three packages, one shared contract:

```
bugsafari/
├── testing-core/        ← BACKEND: the engine + API + DB (Node/Express/Playwright, port 3000)
├── developer-dashboard/ ← FRONTEND: the Watchtower (React 19 + Vite, port 5173)
└── shared/              ← the TypeScript "contract" both sides import (types + pure helpers)
```

- `testing-core` explores the target app and finds bugs.
- `developer-dashboard` shows you what the engine is doing, live.
- `shared` is the dictionary both speak — the SAME `TelemetryEvent`, `ForensicCrashReport`,
  `DiscoveredElement`, severity/bug-category rules — so the wire never disagrees on shape.

### End-to-end data flow (memorize this arc)

```
Operator types URL in dashboard
   │  POST /api/start-test
   ▼
registerRoutes → StartExplorationUseCase.execute()
   │  claims the single run slot, mints a RUN- code, registers with SessionManager
   ▼
PlaywrightBrowserEngine.run()  →  AutonomousExplorationEngine  →  ExplorationEngine (orchestrator)
   │      launches Chromium, sets up monitors
   ▼
ExplorationLoop  (repeat until timebox / saturation / stop):
   1. DomHasher.hashCompound(page)      → structural fingerprint of current screen
   2. RecursiveDomParser                → list of interactive elements
   3. SingleLayerPerceptron.score()     → rank elements ("what to click")
   4. StateGraphNavigator / pathfinder  → pick element, avoid loops
   5. ActionExecutor                    → click / type / fuzz it
   6. observe result → perceptron.applyReward()  (LEARN)
   7. bug finders + scenarios + monitors watch for faults
   │
   ▼  (every step) TelemetryEmitter → SocketTelemetryGateway → Socket.IO room
Dashboard runStore consumes events → live feed, targets, screencast, findings, errors
   │
   ▼  (on crash) CircularBuffer → forensic report → dashboard Error tab
Operator clicks "Save to History" → StartExplorationUseCase.manualSaveToHistory() → MongoDB
Operator clicks "Get Insights / Suggest Fix" → GeminiRemediationAdvisor → LLM text
```

---

## 2. Shared Contracts (`shared/`)

The glue. Both packages import these files by relative path. If you change a type here, both the
engine and the dashboard must agree — that is the whole point.

### `shared/types.ts`
- **Why it exists:** single import surface for every cross-package type. It is a *barrel* — it just
  re-exports the real declarations that live in `shared/types/*` (telemetry, bug, session, auth,
  verification, queue, pagination, remediation, termination…).
- **What it does:** lets both sides write `import { TelemetryEvent } from '.../shared/types.js'`
  and get one canonical definition.
- **Where it fits:** the "dictionary." `TelemetryEvent`, `DiscoveredElement`, `ForensicCrashReport`,
  `OptimizationSettings`, `TestingTypeId`, `RunTerminationOutcome` all originate here.
- **Example:** the engine builds a `TelemetryEvent` object; the dashboard's `runStore` reads the
  same shape off the socket. No manual JSON mapping needed.

### `shared/reproduction.ts` (~900 lines — a heavyweight helper)
- **Why:** turning raw recorded actions into safe, human "Step 1 / Step 2 …" reproduction text.
- **What it does:** `resolveControlName` (best human name for a control), `maskPayload` (hides
  passwords in the persisted steps), `scrubSelectors` (removes raw DOM paths from operator-facing
  text). It also enforces a rule: **an API endpoint is never rendered as if it were a UI control**,
  and steps come only from verified telemetry (no fabrication).
- **Connects to:** `StartExplorationUseCase` (builds breadcrumb steps), `SocketTelemetryGateway`
  (scrubs outgoing text), forensic narration.

### `shared/faultSignature.ts`
- **Why:** two copies of the same crash should count as ONE finding.
- **What it does:** `buildFaultSignature({ reason, stackTrace })` normalizes volatile bits
  (numbers, ids) so "the same bug" hashes the same on the live dashboard AND at save time. This is
  what makes the saved finding count match what the operator saw live.

### `shared/severity.ts`, `shared/bugCategory.ts`
- Deterministic rules that map a finding's class/confidence/verification status to a **severity**
  (Critical/High/Medium/Low) and a **category**. Used both when streaming live and when saving, so
  ratings never drift between the two.

### `shared/url.ts`
- `normalizeTargetUrl`, `isWithinTargetSite` — keep the engine exploring the *target site* and not
  wandering onto the open internet (a safety boundary).

> **Defense soundbite:** "The `shared/` package is a strict typed contract. There is no ad-hoc JSON
> between frontend and backend — both compile against the same definitions, so a shape mismatch is a
> build error, not a runtime surprise."

---

## 3. Backend Bootstrap (`testing-core/src/index.ts`)

- **Location:** `testing-core/src/index.ts` — the backend entry point.
- **Why it exists:** stand up the whole server: Express HTTP API + Socket.IO realtime bridge + DB
  connection, wired together with the exploration use-case.
- **What it does, in order:**
  1. Loads `.env`, asserts critical vars exist in production (`assertBootEnv`).
  2. Hardens the API: disables `x-powered-by`, sets strict security headers (CSP, HSTS,
     nosniff, frame-deny), configures `trust proxy` for correct rate-limit keying.
  3. Validates Socket.IO handshake origins against `FRONTEND_URL` (WebSocket upgrades bypass
     same-origin, so this is a deliberate allow-list).
  4. `connectDatabase()` — waits for MongoDB before serving auth routes; syncs indexes.
  5. Builds the core objects: `PlaywrightBrowserEngine`, `SocketTelemetryGateway`,
     `StartExplorationUseCase`, and wires them to the singleton `sessionManager`.
  6. **Queue mode switch:** if `BUGSAFARI_USE_QUEUE=1`, runs execute in an *isolated worker fleet*
     (Redis + BullMQ) instead of in the API process. **In production this is mandatory** — the
     server refuses to start otherwise, because Chromium visits attacker-chosen sites and must not
     share a process with `JWT_SECRET`.
  7. Registers all routes (auth, user settings, support, main API) + socket handlers.
  8. Starts background sweeps: the **retention reaper** (purges expired trashed sessions and orphan
     forensic docs) and, in queue mode, the **registry reconciler**.
  9. Graceful shutdown + last-resort crash handlers.
- **Connects to:** basically everything — this is the composition root.
- **Defense soundbite:** "The entry file is the *composition root*: it constructs the dependency
  graph once and injects it. The engine, telemetry gateway, and repositories are all interfaces
  wired here, which is why the same use-case runs unchanged in-process or in an isolated worker."

Supporting files: `worker-entry.ts` (the isolated worker process boot), `serverUtils.ts` (port
parsing), `config/env.ts` (fail-closed env validation).

---

## 4. Exploration Engine — the Core Intelligence (`domain/services/exploration/` + `ml/`)

This is the heart of the thesis. It answers: *how does a program decide what to click, learn from
it, and not loop forever?*

### 4.1 The Perceptron — `ml/perceptron.ts` (the "brain")
- **Why:** score every element so the engine clicks the most promising one first (best-first
  search), and get **better over the run** by learning.
- **What it does:**
  - `buildFeatureVectorFromElement(...)` turns a DOM element into a **feature vector** — a bag of
    0/1 and normalized numbers: `isButton`, `isInput`, `kwLogin`, `kwPay`, `kwCheckout`, `kwDelete`,
    `areaNorm` (how big), `yNorm` (how near the top), keyword matches, etc.
  - `SingleLayerPerceptron.score(vector)` = weighted sum + bias. `sigmoidScore` squashes it to
    0..1.
  - **Learning = the Delta Rule:** `applyDeltaRule(vector, target)` nudges each weight by
    `learningRate × error × featureValue`, where `error = target − prediction`. Consistent rewards
    push a feature's weight up; penalties push it down.
  - `applyReward(vector, signals)` converts *observed outcomes* into a target: a **detected fault**
    is the strongest positive (+0.5), network activity and structural change are moderate positives,
    while a **revisit** or landing on a **saturated page** is a contrastive negative.
  - Engineering guards so it stays stable: **momentum** (0.9) for faster convergence, **L2 weight
    decay**, **learning-rate decay** over time, and a hard **weight clamp** (±6) so no single
    feature dominates.
- **Where it fits:** step 3 (score) and step 6 (learn) of the loop.
- **Example:** the model notices that clicking `<button>Pay</button>` keeps producing new states and
  network calls, so it raises `kwPay`/`isButton` weights and prefers similar controls next time.
- **Defense soundbite:** "It is a single-layer perceptron trained online with the delta rule. The
  novelty is the *reward function*: reinforcement comes from real observed behavior — new DOM
  structure, network activity, and detected faults — not from a labeled dataset."

### 4.2 Structural DOM Hashing — `ml/domHasher.ts` (the "anti-loop memory")
- **Why:** without it, the engine reloads the same page forever, thinking it is new.
- **What it does:** `hashCompound(page)` runs one `page.evaluate` that builds two normalized
  signatures, then SHA-256s them Node-side:
  - `structure` — the layout skeleton (tags + stable classes), with dynamic text, random ids,
    hashed CSS classes, ad/analytics subtrees, and repeated feed rows **normalized away**.
  - `interactive` — the controls plus their stable state (disabled/checked/expanded + a normalized
    label).
  - `combined` — SHA of both = the **canonical node identity** used by the graph and loop detection.
  - `collapseChildSignatures` folds an infinite feed of identical cards into one token (`A*B`), so
    scrolling a feed does not mint infinite "new" states.
  - `urlAware` mode folds the route path in, so two different routes sharing a 404 template are
    distinct nodes.
- **Where it fits:** step 1 of every loop iteration; also drives novelty, stagnation, and clustering.
- **Defense soundbite:** "Loop prevention is *structural hashing*: the DOM is normalized into a
  fingerprint that is resilient to cosmetic churn, so 'have I seen this screen?' is an O(1) set
  lookup, not a pixel or raw-HTML comparison."

### 4.3 The Orchestrator — `ExplorationEngine.ts` (~1900 lines)
- **Why:** owns one whole run. It sets up all the collaborators (parser, hasher, navigator, bug
  finders, monitors, chaos manager), holds the confirmed-bug ledger, tracks timing/timebox, handles
  pause/resume/stop, persists forensic children, and **delegates the per-step logic to
  `ExplorationLoop`**.
- **Key collaborators it wires:** `RecursiveDomParser`, `DomHasher(urlAware)`,
  `StateGraphNavigator`, `RiskScorer`, `BugFinderRunner` + `BUG_FINDERS`, `ChaosTransactionManager`,
  `StateClusterRegistry`, `TelemetryEmitter`, `StabilityMonitor`, `ActionExecutor`, `StateRestorer`,
  and various trackers (`EdgeRepeatTracker`, `RouteExhaustionTracker`,
  `NetworkFailureCascadeTracker`, `EscalationTracker`).
- **Notable constants (good for defense):** `MAX_CONFIRMED_BUGS=500` (memory bound),
  `BUG_FINDER_BUDGET=10` per bug-class (a chatty detector can only silence itself),
  `NETWORK_ATTRIBUTION_WINDOW_MS=2000` (only blame the clicked element for network calls that fire
  within ~2s).
- **Where it fits:** the run-level "conductor" between `PlaywrightBrowserEngine.run()` and the loop.

### 4.4 The Step Engine — `ExplorationLoop.ts` (~2100 lines)
- **Why:** the actual iteration. Each pass = hash → parse → score → pick → act → observe → learn.
- **What it does (the interesting scoring policy):**
  - Best-first over perceptron scores, but with **coverage-aware demotions**: a control already
    triggered on the current shell is demoted by `TRIGGERED_SELECTOR_DEMOTION=1000` (softer
    `CROSS_SHELL_TRIGGERED_DEMOTION=250` if it was triggered on a *different* shell), so untested
    controls win.
  - **UI-layer awareness:** interior controls of an open modal/menu are boosted so the overlay is
    exhausted first; its dismiss button is sunk until then.
  - **Novelty reward** (`noveltyScoring.isNovelStructuralState`): only reward the perceptron when a
    click reaches a structurally *new* shell — prevents the "false novelty" loop on ad-heavy pages.
  - **Stagnation scoring** (`stagnationScoring.computeStagnation`): instead of a hard "3 repeats →
    stop" cliff, it *scores* stagnation from repeated hashes + structural familiarity + a
    coverage-stall term, and opens an escalating "escape window" that penalizes staying put and
    eventually forces a backtrack.
  - Handles infinite-scroll reveal (bounded scrolls), empty-DOM retries, and route-transition
    demotion (finish in-page controls before navigating away).
- **Where it fits:** called repeatedly by `ExplorationEngine` until timebox / saturation / stop.

### 4.5 Supporting exploration files (one-liners)
- `StateGraphNavigator.ts` / `DIrectedPathFinder.ts` — maintain the explored **state graph** and
  choose the next edge; can plan a route back to an unfinished area.
- `StateClusterRegistry.ts` — layers a **coverage cluster** on top of the graph, keyed by the
  normalized `structure` hash. Tracks discovered-vs-triggered controls per screen *kind*, decides
  when a page is **"Fully Explored" (saturated)**, and importantly still admits a few unseen *route
  instances* (`/products/1` vs `/products/42`) so record-specific bugs are not skipped.
- `noveltyScoring.ts` / `stagnationScoring.ts` — the two pure, unit-tested scoring rules above.
- `ActionExecutor.ts` — actually performs the click/type/fuzz and picks stress scenarios.
- `StateRestorer.ts` / `SessionPreservationGuard.ts` — restore a prior state after backtracking, and
  avoid clicking "Logout"/"Delete account" controls that would destroy the session.
- `PageHealthGuard.ts`, `StrictUrlLockGuard.ts` — keep the run on a healthy page and inside the
  target site.
- `EdgeRepeatTracker.ts`, `RouteExhaustionTracker.ts`, `NetworkFailureCascadeTracker.ts`,
  `EscalationTracker.ts` — anti-loop / escalation bookkeeping.

### 4.6 Pathfinder (`domain/services/pathfinder/`)
- `PathPlanner.ts` — **BFS shortest path** over explored graph edges (only `explored` edges with a
  known child are traversable; deterministic Map-ordered so runs are reproducible).
- `GraphStore.ts`, `EdgeSelector.ts`, `TraversalStack.ts`, `EventLog.ts` — the graph storage and
  DFS traversal machinery.
- **Defense soundbite:** "Navigation is a DFS frontier with a BFS replanner: when the engine needs
  to get back to an unfinished screen, it computes the shortest replayable path over edges it has
  already verified."

### 4.7 Heuristics (`domain/heuristics/`)
- `domParser.ts` (`RecursiveDomParser`) — walks the DOM and emits `InteractiveElement`s (the raw
  material the perceptron scores).
- `DuplicateActionFinder.ts`, `ApiHangFinder.ts`, `BrokenNavigationFinder.ts`,
  `RuntimeStabilityFinder.ts`, `AccessibilityAuditor.ts`, `nonSemanticInteractive.ts` — targeted
  detectors for duplicate actions, hung APIs, broken navigation/redirect loops, runtime crashes, and
  WCAG issues.

---

## 5. Attack Scenarios, Chaos & Fuzzing (`domain/scenarios/` + `domain/chaos/`)

The "Arsenal" — deliberate stress the engine layers on top of plain clicking.

- `scenarios/index.ts` — the **single by-name registry** of stress scenarios. The engine resolves
  scenarios through `ActionExecutor.pickStressScenario`.
- `rapidClicker/` — `buttonSpammer`, `coordinateBombing`, `concurrentBurst`, `InteractionSimulator`:
  hammer a control rapidly / at many coordinates to surface race conditions and double-submit bugs.
- `routeTrasher/` — throws garbage/invalid routes (`/null`, `/-1`, random paths) to find broken
  navigation, unhandled 404 states, and redirect loops.
- `formBypasser.ts` — strips client-side validation attributes then submits, to catch servers that
  trust the frontend.
- `networkSaboteur.ts` (`armNetworkSabotage`) — fails/slows network calls on a cadence to test error
  handling and loading states.
- `asyncStateRacer.ts`, `storageTamper.ts` — race async state; tamper with localStorage/session.
- `seededRandom.ts` — a **seeded PRNG** scoped per run (`withScenarioRandomScope`) so a run is
  **reproducible**: same seed → same fuzz sequence.

### Fuzzing engine (`scenarios/fuzzing/`)
- `dataFuzzer.ts` — the driver that injects payloads into fields.
- `elementClassifier.ts` — figures out what a field *is* (email, number, date, JSON, search…) so the
  fuzz is **semantic**, not random noise.
- `strategies/` — one payload generator per class: `numericBoundaryStrategy` (0, −1, MAX_INT…),
  `xssVectorStrategy`, `noSqlInjectionStrategy`, `emailStrategy`, `dateStrategy`, `jsonStrategy`,
  `chaosFallbackStrategy` (unicode/emoji/huge strings), and `payloadEscalator` (escalate intensity).
- `domain/chaos/ChaosTransactionManager.ts` — coordinates injected chaos so multiple scenarios do
  not stomp each other, and so injected faults are attributable.
- **Defense soundbite:** "Fuzzing is boundary-value + semantic. The classifier picks the payload
  family per field, so a date field gets malformed dates and a numeric field gets integer-overflow
  boundaries — far higher signal than random bytes."

> ⚠️ **Memory note:** `fuzzTextInput` / `fuzzTextWithAttackSurface` only *compute* a payload; a
> finder using them must also `setFieldValue` + `triggerFormSubmission`, or nothing is observed.

---

## 6. Bug Detection, Findings & Forensics (`bugs/` + `domain/services/forensics/` + `monitoring/`)

### 6.1 Finders (`bugs/finders/`)
Behavioral detectors that run during exploration and emit findings:
`constraintBypass`, `injectionDifferential`, `noSqlInjection`, `injectionEvidence`,
`reflectionOracle` (XSS reflection), `concurrentStress`, `spaRaceConditions`, `structuralProbe`,
`fuzzGuard`. `index.ts` exposes `BUG_FINDERS` and reset hooks the engine calls per run.

### 6.2 Knowledge base (`bugs/knowledgeBase/`)
- `bugCatalog.ts` — the catalog: each bug class → CWE + remediation checklist.
- `FaultClassifier.ts` — normalizes a raw fault into a bug class and refines its CWE.
- `securityEvidenceGate.ts` — **gate:** a security/vuln finding is only promoted if it has
  *behavioral proof* (a structured marker: signals / statusCode / endpoint / bypass). A new finder
  without such a marker is silently dropped — this stops false-positive "vulnerabilities."
- `findingEvidence.ts` (`ensureFindingEvidence`) — the **promotion contract**: every promoted
  finding must carry reproduction steps + CWE + fix advice. This funnel fills whatever a self-gating
  detector left blank (from the catalog), and, when *no* interaction was recorded, it labels the
  step **"Unverified"** rather than fabricating one.
- `signalPatterns.ts`, `scenarioCatalog.ts` — signal shapes and scenario→attribution mapping.

### 6.3 Forensics (`domain/services/forensics/` — pure narration)
- `narration.ts` — turns recorded `ActionRecord`s into human "Step N: click Login at /login" text
  (`narrateActionRecords`, `resolveElementLabel`). One source of truth for live + saved reports.
- `actionStepMapper.ts` (`buildActionSteps`) — builds the minimized, **replayable** timeline used by
  Verify Fix.
- `stepMinimizer.ts` — trims a noisy timeline down to the shortest reproducing sequence.
- `metadataRecorder.ts` — scenario metadata.

### 6.4 The Circular Action Buffer & monitors (`infrastructure/monitoring/`)
- `actionBuffer.ts` + `lib/circularBuffer.ts` — the **20-step Circular Action Buffer**: a fixed-size
  rolling window of the most recent actions. When a crash fires, this buffer *is* the reproduction
  trail — you get the actions leading up to the fault "for free," without recording the entire run.
- `reproductionPlaybookStore.ts` — the run-scoped store of the reproduction playbook.
- `stabilityMonitor.ts`, `anomalyListeners.ts`, `browserConsoleListener.ts` — the **exception
  interception** layer: hook `page.on('pageerror')`, console errors, and unhandled rejections so a
  target-app crash becomes a finding.
- `NetworkLogStore.ts`, `ConsoleLogStore.ts`, `NetworkQuarantine.ts`, `burstCorrelation.ts`,
  `serverReachability.ts`, `resourceProbe.ts` — capture network/console streams, correlate bursts,
  and tell a *target* fault apart from an *engine/environment* fault.
- `stateFingerprint.ts` (`captureStateFingerprint`) — snapshot of the DOM/route at fault time,
  attached to the finding so Verify Fix can restore it.
- `sourceMapResolver.ts` — resolves minified stack traces back to readable frames.

### 6.5 Verification & regression (`domain/services/verification/`, `regression/`)
- `ReproductionProbe.ts` + `confidenceScore.ts` — after a finding, the engine **re-attempts** it and
  raises/lowers confidence based on whether it reproduced.
- `classifyFaultOrigin` (verification `index.ts`) — the **target-vs-engine gate**: a Playwright/
  browser/DNS failure is an *engine* fault (diagnostics only, never a finding); only faults
  attributed to the target app become findings.
- `regression/` — re-checks a previously found bug (the "Verify Fix" feature) to confirm a fix.

> **Defense soundbite:** "Findings pass through three gates before they reach you: origin (is it the
> target or our engine?), evidence (is there behavioral proof?), and reproduction (does it happen
> again?). That is what keeps the Findings tab high-signal."

---

## 7. Backend Infrastructure — Browser, Realtime, Queue, Telemetry

### 7.1 Playwright driver (`infrastructure/playwright/`)
- `PlaywrightBrowserEngine.ts` — implements the `BrowserEngine` port. Launches Chromium, creates the
  `AutonomousExplorationEngine`, exposes `run/pause/resume/stop`, tracks active-time (pause-aware)
  for the timebox, and captures confirmed bugs + visited routes so they survive after `run()`
  returns. `stop()` flushes pending telemetry/DB writes *before* closing the browser (zombie
  prevention).
- `TargetAuthenticator.ts` + `LoginFormLocator.ts` — optionally **log into the target app first**
  (ephemeral, in-memory credentials, never persisted/logged) so authenticated areas are explored.
- `credentialMask.ts`, `BoundingBoxHighlighter.ts` — mask typed credentials; draw the red box around
  the element the engine is about to act on (what you see in the screencast).

### 7.2 Realtime (`infrastructure/socket/` + `presentation/socket/`)
- `SocketTelemetryGateway.ts` — implements the `TelemetryGateway` port. **Every emit is scoped to
  the run's Socket.IO room** (no cross-operator leakage); a `TelemetryRecorder` buffers events so a
  reconnecting client is *replayed*; a deduper suppresses repeated lines; `scrubCredentials` +
  `scrubSelectors` sanitize outgoing text.
- **The wire events (know these names):** `telemetry`, `discovered-elements`, `live-frame`
  (screencast JPEG), `url-changed`, `forensic-report`, `incident-report`, `accessibility`,
  `browser-console`, `reproduction-verdict`, `finding-upgrade`, `time-sync`.
- `presentation/socket/registerSocketHandlers.ts` — handles client connect / room join / attach /
  reconnect, and (queue mode) the distributed subscribe path.

### 7.3 Telemetry emitters (`domain/services/telemetry/`)
- `TelemetryEmitter.ts` — the engine-side producer that builds and sends every event.
- `StabilityMonitor.ts` — classifies engine-lifecycle vs real errors; sanitizes exceptions.
- `credentialScrub.ts` — the scrub-value registry (`setScrubValues`) so echoed credentials are
  redacted everywhere.

### 7.4 Queue / worker fleet (`infrastructure/queue/`, `workers/`, `concurrency/`)
Only active when `BUGSAFARI_USE_QUEUE=1` (mandatory in prod for isolation):
- `TaskQueue.ts` — BullMQ/Redis job queue; admits and limits runs.
- `telemetryBridge.ts` — re-emits an isolated worker's telemetry back into the browser-facing
  Socket.IO so the dashboard sees a worker-run identically to an in-process run.
- `controlBridge.ts` — reverse channel: dashboard pause/resume/stop → worker run.
- `RunRegistry.ts` — Redis index so a refreshed client can rediscover/resume its queued/active run.
- `QueueStatusBroadcaster.ts` — pushes live queue positions.
- `AuthVault.ts` — encrypted single-use handoff of target credentials to a worker.
- `registryReconciler.ts` — clears phantom sessions whose job vanished.
- `worker-entry.ts` (root) + `workers/` — the isolated process that actually runs Chromium.

### 7.5 Observability (`infrastructure/observability/`)
- `logger.ts` (zero-dep structured logger), `requestContext.ts` (per-request `reqId`), `metrics.ts`
  (`/metrics` counters). `console.*` inside `page.evaluate` must stay `console` — that runs in the
  browser context, not Node.

---

## 8. Database & Persistence (`infrastructure/database/`)

MongoDB Atlas via Mongoose, **multi-tenant** (every query is scoped by `userId`).

### Models (`models/`) — the schemas
- `UserModel.ts` — accounts (hashed password, email verification).
- `SessionModel.ts` — the **run record** (a saved Safari): target URL, status/outcome, stats,
  `forensicTrace.caughtBugs`, `actionSteps`, `visitedRoutes`, public `runId` (RUN- code). This is the
  parent document; forensic children reference it.
- `FindingType.ts` — enums (`SessionStatus`, bug types).
- `ForensicErrorModel.ts`, `ForensicTelemetryModel.ts`, `ForensicAnalysisModel.ts` — forensic
  children: individual errors, streamed telemetry, and AI/analysis output.
- `NetworkLogModel.ts`, `ConsoleLogModel.ts`, `TelemetryEventModel.ts` — the Network/Console/Event
  tabs of a saved report.
- `BrainConfigModel.ts` — **snapshots of the perceptron's learned weights** (the "brain") so a run's
  learning can be persisted/inspected.
- `ShareLinkModel.ts` — tokens for public read-only report sharing.
- `RefreshTokenModel.ts` — server-side refresh-token records. `SupportTicketModel.ts` — support form.

### Repositories (`repositories/`)
Repository pattern wrapping each model: `MongoFindingRepository`, `ForensicErrorRepository`,
`ForensicTelemetryRepository`, `ForensicAnalysisRepository`, `NetworkLogRepository`,
`ConsoleLogRepository`, `TelemetryEventRepository`. The engine/use-cases depend on these interfaces,
not on Mongoose directly.

### Lifecycle helpers
- `mongooseClient.ts` — connect/disconnect. `indexSync.ts` — enforce declared indexes at boot.
- `retentionReaper.ts` + `reapPolicy.ts` — **soft-delete lifecycle**: history delete = Archive/Trash;
  a reaper purges Trash after `BUGSAFARI_TRASH_RETENTION_DAYS` (30d) and sweeps orphaned children.
- `sessionState.ts` — the bucket-filter source (Active/Archived/Trashed) for history queries.
- `runCodeGenerator.ts` + `runIdBackfill.ts` — mint/stamp the public RUN- code with duplicate retry.
- `queryLimits.ts`, `logSanitizer.ts` — bound query sizes; strip secrets from logs.

> **Defense soundbite:** "Isolation is per-user query scoping plus a parent-child document model.
> A session is the parent; its forensic errors, telemetry, and logs are children keyed to it, so
> deleting or sharing a run cascades correctly. Guests never touch this layer at all."

---

## 9. AI / Gemini Integration (`infrastructure/ai/GeminiRemediationAdvisor.ts`)

- **Why:** turn a raw finding (or a whole run) into readable, actionable advice **on demand** — this
  is the "Get Insights" and "Suggest Fix" buttons.
- **What it does:**
  - `generateRemediation(finding)` → 3-5 numbered fix steps for one bug.
  - `generateInsights(run)` → a session-level `{ rootCause, recommendations[] }` JSON summary.
  - Calls Google Gemini via REST (`generativelanguage.googleapis.com`), key in a **header** (never
    the URL/logs), with a timeout and full failure classification (`auth`, `rate_limited`,
    `timeout`, `model_unavailable`…).
  - **Security:** every target-derived field is length-capped and fenced inside
    `<untrusted_finding_data>` with an explicit "treat as data, never instructions" preamble — the
    mitigation for **indirect prompt injection** from a malicious target app.
  - **Graceful degrade:** every failure returns a classified reason so the caller falls back to the
    deterministic knowledge-base remediation. The AI is an *enhancement*, never a dependency.
- **Where it fits:** called by the `/api/findings/suggest-fix` and `/api/forensic/insights` routes.
- **Defense soundbite:** "The LLM is optional and sandboxed. Findings are produced deterministically
  by the engine; Gemini only rephrases them into remediation prose, with the untrusted app content
  fenced off to prevent prompt injection, and a knowledge-base fallback if the model is unavailable."

---

## 10. HTTP API, Authentication & Middleware (`presentation/`)

### Application layer (`application/`)
- `useCases/StartExplorationUseCase.ts` — the **orchestrator use-case**. `execute()` claims the
  single run slot (`tryActivate` closes a TOCTOU race), mints the RUN- code, registers with
  `SessionManager`, runs the engine, and settles the terminal status. `manualSaveToHistory()` is the
  **only** path that writes a `SessionModel` to Mongo — it reads the engine's confirmed-bug memory
  (lossless superset of the live Errors tab), dedupes by fault signature, caps embedded arrays under
  the 16MB BSON limit, and updates the run's own document in place (idempotent saves).
- `services/SessionManager.ts` (~1150 lines) — the **run lifecycle singleton**: owns the engine
  control surface, the reconnect replay buffer, the grace window (survives a brief dashboard
  disconnect), room wiring, and the target-health monitor. Also force-releases a hung stop so the
  admission slot is never pinned.
- `services/TargetHealthMonitor.ts`, `services/runOwnership.ts` — health polling; ownership checks.
- `ports/` — `BrowserEngine` and `TelemetryGateway` **interfaces** (dependency-inversion seams that
  let `index.ts` swap in-process vs worker/Redis transports without touching domain code).

### REST routes (`presentation/api/registerRoutes.ts`)
Main endpoints:
- `POST /api/start-test` — launch a run. `POST /api/safari/stop` — stop it.
- `GET /api/session/active` — rediscover a live run after refresh.
- `POST /api/history/save-session` — persist the run (the manual/auto save).
- `GET /api/history`, `GET /api/history/sessions`, `DELETE /api/history/:id`,
  `POST /api/history/:id/archive|restore`, `DELETE /api/history/:id/permanent` — history + soft-delete.
- `POST /api/history/:id/share`, `GET /api/history/:id/shares`, `DELETE .../shares/:shareId` — sharing.
- `POST /api/findings/suggest-fix`, `POST /api/forensic/insights`, `POST /api/forensic/analyze`,
  `GET /api/forensic/analysis`, `GET /api/forensic/report/:sessionId` — findings + AI + reports.
- `GET /api/public/report/:token` — **anonymous** shared report (token is the only credential).
- `GET /api/health`, `GET /metrics` — ops.

### Authentication (`presentation/authentication/`)
Split by concern: `authController.ts` wires the routes; `authSignupController`, `authLoginController`,
`authEmailVerificationController`, `authPasswordResetController`, `authRefreshController` handle each
flow. Endpoints: `/api/auth/register|signup|login|logout|refresh|verify-email|resend-verification|
forgot-password|reset-password`. Plus `/api/users/profile`, `/api/users/password`, `/api/settings`.
- `authMiddleware.ts` — stateless **JWT** verification (`requireAuth`); attaches `userId`.
- `refreshCookie.ts` + `refreshTokenService.ts` — refresh token lives in an **httpOnly cookie**
  (`bugsafari_rt`); access token in localStorage; CSRF defended by an `x-bugsafari-access` header.
- `authValidation.ts` — **centralized** validation. `/api/auth/*` returns coded `AuthErrorBody`;
  `/api/users` + `/api/settings` return bare `{error}` — do not cross the two.
- `authConfig.ts` — hard-fails if `JWT_SECRET` is missing. `shareToken.ts` — signed share tokens.
  `emailTransport.ts` — SMTP (verified once at boot).
- **Guest mode:** an unauthenticated operator can start a run (the use-case's `userId` stays null),
  but every persistence path refuses — guests explore, they do not save.
- `presentation/middleware/errorHandler.ts` — terminal middleware: turns every `next(err)` and every
  unmatched `/api` path into sanitized JSON, never an HTML stack trace.

> **Defense soundbite:** "Auth is stateless JWT for access, with the refresh token in an httpOnly
> cookie so JavaScript can't read it, and a CSRF header requirement. Multi-tenancy is enforced at the
> query layer, and guests are a first-class mode: full testing, zero persistence."

---

## 11. Frontend Watchtower (`developer-dashboard/`)

### Entry & routing
- `main.tsx` — mounts React. `App.tsx` — routing + **auth gating**. The key design: everything that
  opens a socket or hits a protected endpoint lives *below* `DashboardWorkspace`, which only mounts
  once a real session exists — so visiting `/`, `/login`, or a `/shared/:token` report never fires a
  protected call. `useDashboardController()` is what boots the run session.
- Routes: `/` (landing), `/login|/signup|/forgot-password|/reset-password|/verify-email`,
  `/dashboard`, `/history`, `/settings`, `/history/forensic-report/:sessionId`, `/shared/:token`
  (public), `/explore|/features|/community|/about` (info).

### The engine gateway (frontend side of the wire)
- `infrastructure/engine/engineGateway.ts` — lazy singleton `getEngineGateway()`.
- `SocketHttpEngineGateway.ts` + `gateway/SocketConnectionManager.ts` + `gateway/EngineHttpClient.ts`
  — one object that both **calls the REST API** and **listens on Socket.IO**, with reconnect/attach
  eligibility logic (`attachEligibility.ts`). This is the mirror of the backend
  `SocketTelemetryGateway`.

### State stores (Zustand) (`stores/`)
- `stores/run/runStore.ts` — the **live run state**: consumes every socket event and turns it into
  the feed, discovered targets, screencast frame, findings/incidents, network/console tabs, status,
  and the timebox timer. `runRefs` holds non-reactive bookkeeping; the frontend timer is *slaved* to
  the engine's `time-sync` event (no independent countdown).
- `stores/run/` supporting: `gatewayBinding.ts` (wire events → store), `runCommands.ts`
  (start/pause/resume/stop), `sessionBootstrap.ts` (rediscover a run after refresh), `runTimer.ts`,
  `engineLiveness.ts`, `stateMachine`/`types`.
- `stores/history/historyStore.ts` + `useHistoryView.ts` — saved-runs list, buckets, filters.
- `stores/authStore.ts` + `authBridge.ts`, `settingsStore.ts`, `themeStore.ts`,
  `targetUrlDraft.ts`, `launchConfigDraft.ts` — auth, settings, theme, and persisted form drafts.

### Context & hooks
- `context/AuthContext.tsx` — `useAuth()`: `user`, `isAuthenticated`, `isGuestMode`, `logout`; listens
  for a `bugsafari:session-expired` event. `DarkModeContext.tsx` — theme.
- `hooks/` — `useAuth`, `useUserSettings`, `useRunNotifications` (toasts for run lifecycle),
  `useDismissableLayer`, `useBodyScrollLock`, etc.

### Components (`components/`)
- `forensics/ClinicalForensicsDashboard.tsx` — the **main dashboard**: live feed, screencast,
  discovered-targets panel, and the tabbed telemetry (Errors / Network / Console / Accessibility).
- `forensics/ForensicReport.tsx` — the full saved (or shared) report view.
- `telemetry/` — `ErrorTabPanel`, `NetworkTabPanel`, `ConsoleTabPanel`, `ReproductionChecklist`
  (Verify-Fix steps), `AiDiagnosticCard` (Gemini output), `AccessibilityWarningBanner`,
  `TelemetryHelpModal`.
- `history/SavedEvaluationSafaris.tsx` + `ShareLinkModal.tsx` — history list + share dialog.
- `auth/` — the login/signup/reset/verify forms + `GuestSavePromptModal` (upsell when a guest tries
  to save). `layout/`, `common/`, `ui/`, `legal/` — shell, shared widgets, primitives, legal pages.
- `utils/` (21 files) — client-side helpers: `errorDeduplication` (collapse repeated faults into one
  card, mirroring the backend fault signature), `logger`, formatting, etc.

> **Defense soundbite:** "The dashboard is a thin, event-driven view. It holds no engine logic — it
> subscribes to a room over Socket.IO and renders whatever the engine streams, with the timer slaved
> to the engine's authoritative clock so the two can never disagree."

---

## 12. Configuration & Ops (root)

- `.env` / `.env.example` — secrets and tunables (`JWT_SECRET`, `GEMINI_API_KEY`, `BUGSAFARI_USE_QUEUE`,
  `FRONTEND_URL`, timebox/retention windows…).
- `Dockerfile`, `docker-compose.local.yml`, `docker-compose.prod.yml`, `deploy/Caddyfile` — Podman/
  Docker images and the Caddy reverse proxy (which owns CORS + TLS in prod).
- `vercel.json` — dashboard CDN headers. `package.json` (root + per package) — dependency versions.
- Target apps for demos: `bugsafari-target-app/` (reproduces every detected bug class — the
  benchmark) and `bugsafari-shop/` ("Nimbus Store", intentional subtle bugs — do **not** "fix" them).

---

## 13. Five Questions You Can Now Answer Cold

1. **"How does it decide what to click?"** → A single-layer perceptron scores each element's feature
   vector; best-first pick, demoted for already-triggered controls (`ExplorationLoop` + `perceptron.ts`).
2. **"How does it learn?"** → Delta rule with momentum + weight decay. Reward comes from observed
   behavior: new structure, network activity, detected faults reward; revisits/saturation penalize
   (`applyReward` in `perceptron.ts`).
3. **"How does it avoid infinite loops?"** → Structural DOM hashing normalizes cosmetic churn into a
   fingerprint; a state-cluster registry tracks per-screen coverage and saturation; stagnation
   scoring forces backtracking (`domHasher.ts`, `StateClusterRegistry.ts`, `stagnationScoring.ts`).
4. **"How does it capture a crash?"** → A 20-step circular action buffer + exception interception;
   on a fault it freezes the buffer into a forensic report with a state fingerprint and reproduction
   steps, gated by origin/evidence/reproduction (`actionBuffer.ts`, `forensics/`, `verification/`).
5. **"How does live streaming + saving work?"** → The engine emits room-scoped Socket.IO events; the
   dashboard's `runStore` renders them; saving is a separate, explicit `manualSaveToHistory()` write
   to MongoDB, and only for authenticated users (`SocketTelemetryGateway`, `runStore`,
   `StartExplorationUseCase`).

---

*Guide generated from a read-only audit of the repository. No source files were modified.*
