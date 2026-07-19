# SYSTEM SPECIFICATION & ENGINEERING BLUEPRINT: BUGSAFARI

## Project Title

BUGSAFARI: AN AUTONOMOUS, ADAPTIVE EXPLORATORY TESTING ENGINE FOR SINGLE-PAGE APPLICATIONS

Updated against the current repository tree on July 12, 2026.

---

## 1. SYSTEM OVERVIEW & VALUE PROPOSITION

BugSafari is an autonomous exploratory software testing engine for modern web applications, especially Single-Page Applications (SPAs). It uses browser-level interaction, adaptive decisioning, stress/fuzz scenarios, live telemetry, and persistent forensic evidence to find behavior that scripted tests often miss.

### 1.1 The Core Problem: The Predictability Gap

Traditional QA automation often depends on scripted linear paths and pre-declared assertions. These flows validate only what a developer explicitly anticipated.

When hidden transitions, timing races, validation bypasses, or unexpected state interactions emerge outside scripted expectations, they may remain undetected.

Randomized monkey testing has the opposite problem: broad activity with little structural intelligence, weak reproducibility, and low forensic value.

### 1.2 The BugSafari Solution

BugSafari addresses this gap with scriptless, autonomous exploration that:

- discovers runtime interaction surfaces dynamically,
- prioritizes targets using a perceptron-scored risk model plus novelty/stagnation-aware navigation,
- executes non-linear stress, fuzzing, route, network, async-race, and security scenarios,
- captures runtime, stability, visual-frame, accessibility, and forensic context,
- classifies faults deterministically through a centralized bug/scenario/signal knowledge base,
- persists users, sessions, action traces, brain/config snapshots, findings, and forensic analyses,
- streams live telemetry plus replay-oriented evidence back to a dashboard,
- deterministically replays a saved finding's exact action timeline to verify whether a fix actually resolved it.

### 1.3 Target Audience & Focus

The primary audience is student developers and independent engineers who need rapid feedback on unstable behavior before demos, submissions, or deployment milestones.

BugSafari acts as an automated resilience probe that surfaces high-impact failures early and leaves enough evidence to understand what happened.

---

## 2. HIGH-LEVEL SYSTEM ARCHITECTURE

BugSafari follows a decoupled multi-package architecture with clear boundaries across domain, application, infrastructure, presentation, dashboard, and shared contracts.

### 2.1 Testing Core (Backend Engine)

The backend package (`testing-core/`) hosts autonomous exploration execution and exposes control, telemetry, persistence, and worker-capable execution surfaces.

Key architectural slices:

- **Application layer**: use-case orchestration (`StartExplorationUseCase`), session/reconnection lifecycle (`SessionManager`, `TargetHealthMonitor`), and ports (`BrowserEngine`, `TelemetryGateway`).
- **Domain layer**: interaction modeling, DOM/visual/accessibility heuristics, chaos-transaction attribution, risk scoring, state-graph navigation and pathfinding, scenarios, decomposed exploration services, and regression replay.
- **Bug arsenal**: scenario adapters, a centralized bug/scenario/signal knowledge base, and pattern-specific finders.
- **Infrastructure layer**: Playwright browser integration, monitoring, binary frames, sockets, queue/worker support, and Mongo persistence (including forensic-specific models/repositories).
- **Presentation layer**: HTTP routes, a split auth controller surface, and socket interfaces for external control/streaming/verification.

### 2.2 Developer Dashboard (Interactive Command Center)

The dashboard package (`developer-dashboard/`) is a React client that:

- presents a public landing page (`designs/`) before authentication or guest entry,
- authenticates users or gates protected UI through auth components/hooks/context,
- starts exploration sessions via a command-center control surface and gateway abstractions,
- receives real-time telemetry and binary visual frame streams,
- visualizes live execution status, findings, forensic trails, and history,
- exposes saved evaluations/forensic report views for post-run review, including a per-finding Verify Fix regression-replay control.

### 2.3 Shared Contract Layer

The shared package (`shared/`) provides common typed contracts used across packages for telemetry, session, bug, testing-type, and regression artifacts. `shared/types.ts` is a barrel re-export over the domain-split files under `shared/types/`.

---

## 3. CORE COGNITIVE AND BEHAVIORAL PROCESSES

BugSafari's autonomy is driven by five major functional pillars.

### 3.1 Pillar 1: Adaptive Risk Prioritization

**Goal:** prefer high-risk interaction targets over low-value random actions.

**Execution model:**

1. Discover interactive candidates from live DOM state via the recursive DOM parser.
2. Normalize candidates into `InteractiveElement` structures.
3. Score candidates and observed signals through the perceptron-based `RiskScorer`.
4. Prioritize semantically sensitive controls such as submit, login, form, route, destructive, and state-changing paths, with an explicit attack-target score boost for scoped-in controls.
5. Update behavior after observed outcomes such as network impact, route changes, instability, repeated states, and findings.

### 3.2 Pillar 2: Autonomous Navigation & State Awareness

**Goal:** avoid repetitive low-value loops and increase state-space diversity.

**Execution model:**

1. Parse current DOM topology and route context.
2. Track state transitions through `StateGraphNavigator`, backed by the `pathfinder/` submodules (`GraphStore`, `EdgeSelector`, `TraversalStack`, `EventLog`).
3. Use directed path selection via `DIrectedPathFinder`.
4. Apply confinement guardrails (`StrictUrlLockGuard`, `PageHealthGuard`) before/after navigation decisions.
5. Bias execution toward actions that yield novel or suspicious transitions using `noveltyScoring`, `stagnationScoring`, `EdgeRepeatTracker`, `StateClusterRegistry`, `RouteExhaustionTracker`, and `RouteTrashThrottle` — the collective loop-prevention and coverage layer that supersedes the earlier ad-hoc guard modules.

### 3.3 Pillar 3: High-Speed Behavioral Simulation

**Goal:** surface synchronization defects and fragile UI state under pressure.

**Execution model:**

1. Execute rapid interaction scenarios such as `buttonSpammer` and `coordinateBombing` (`domain/scenarios/rapidClicker/`).
2. Apply route churn through `routeTrasher`, gated by `routeTrashGating` and throttled by `RouteTrashThrottle`.
3. Interrupt in-flight async work via `asyncStateRacer` to surface teardown races and swallowed rejections.
4. Mix deterministic and stochastic action patterns to broaden coverage, reproducible per-run via the shared `seededRandom`/`SeededRandomGenerator` PRNG family.
5. Use Playwright browser automation through the `BrowserEngine` port; continue safely with guarded error handling where possible.

### 3.4 Pillar 4: Generative Attack Vector Synthesis

**Goal:** stress input handling and validation boundaries without static scripts.

**Execution model:**

1. Generate mutated/escalating payload candidates from the `domain/scenarios/fuzzing/` strategy library (email, date, JSON, numeric-boundary, XSS, NoSQL-injection, and a generic chaos-fallback strategy for Unicode/binary corruption), classified per-field by `elementClassifier` and escalated by `payloadEscalator`.
2. Apply payloads through `dataFuzzer` and `formBypasser`; probe network disruption through `networkSaboteur`.
3. Attribute every chaos action to the fault it may have caused via `ChaosTransactionManager`.
4. Confirm genuine exploit execution (not mere reflection) via `reflectionOracle`'s per-injection nonce witness for XSS, and classify observed signals against the centralized `knowledgeBase/` (bug catalog, scenario catalog, signal patterns, deterministic fault classifier).

### 3.5 Pillar 5: Real-Time Telemetry, Fault Isolation & Verified Remediation

**Goal:** convert non-deterministic failures into actionable, reproducible, and verifiable forensic evidence.

**Execution model:**

1. Capture runtime exceptions, console/network faults, stability freezes, memory-leak trends, visual regressions, and accessibility violations via the primary `telemetry/StabilityMonitor` and the secondary heartbeat `infrastructure/monitoring/stabilityMonitor`.
2. Buffer recent action history in the bounded `CircularBuffer` (20-step action buffer) and record narrated reproduction steps (`domain/services/forensics/narration.ts`).
3. Emit event streams in real time through `TelemetryEmitter`/socket telemetry.
4. Persist sessions, findings, action traces, users, forensic errors/telemetry/analysis, and brain/config snapshots through Mongo-backed models and repositories.
5. On demand, deterministically replay a saved finding's exact recorded action timeline via `RegressionPlaybookVerifier`/`ReplayActionRunner`/`FaultCollector` — with no autonomous exploration — to verify whether a reported bug is fixed, still active, or inconclusive.

---

## 4. SYSTEM FEATURE MATRIX & SOURCE LOGIC DIRECTIVES

### 4.1 Scriptless Runtime Discovery

**Rule:** no hardcoded path assumptions should be required for baseline exploration.

**Directive:** interaction candidates must be discovered from current runtime DOM structure and attributes via `RecursiveDomParser`.

### 4.2 Domain-Bound Navigation Safety

**Rule:** exploration should remain within intended target scope when the operator enables strict URL lock.

**Directive:** `StrictUrlLockGuard`, `PageHealthGuard`, and the state-graph/pathfinder navigation services should prevent or recover from unintended off-target flows.

### 4.3 Real-Time Event Streaming

**Rule:** operational visibility must be continuous during runs.

**Directive:** actions, findings, frames, scoring/state changes, network events, and exception-relevant events should be emitted as structured telemetry.

### 4.4 Reproducibility Support

**Rule:** findings must be explainable, repeatable, and verifiable.

**Directive:** preserve enough chronological action context (action buffers, narrated reproduction steps, saved playbooks) to reconstruct and deterministically replay a reproduction sequence via the regression-replay subsystem.

### 4.5 Persistence and History

**Rule:** important run evidence should survive beyond the live process.

**Directive:** sessions, findings, action traces, users, finding types, forensic errors/telemetry/analysis, and brain/config snapshots should be persisted through the database infrastructure and exposed to dashboard history/forensic-report views.

### 4.6 Worker and Queue Readiness

**Rule:** long-running exploration should be isolated from simple request/response control surfaces.

**Directive:** the opt-in (`BUGSAFARI_USE_QUEUE=1`) task queue and worker modules should support distributed or isolated execution without changing dashboard intent semantics; the synchronous path stays byte-identical when the queue is unset.

### 4.7 Deterministic Classification

**Rule:** the same runtime signal must always resolve to the same bug class, severity, and remediation regardless of which detector observed it.

**Directive:** all fault-detection paths (primary `StabilityMonitor`, secondary heartbeat monitor, bug finders, regression replay) must classify through the shared `knowledgeBase/FaultClassifier`, never via ad-hoc per-module logic.

---

## 5. REQUISITE DIRECTORY ARCHITECTURE & ARCHETYPE

Expected top-level ownership:

```text
testing-core/          Headless TypeScript exploration engine, API/socket server, persistence, workers
developer-dashboard/   React-based command, auth, visibility, and history dashboard
shared/                Shared contracts, schemas, and types
```

Implementation is organized to support layered evolution:

- Backend: `application`, `domain` (`chaos`, `entities`, `heuristics`, `repositories`, `scenarios`, `services` with `exploration`/`pathfinder`/`regression`/`forensics`/`telemetry` sub-slices), `bugs` (`finders`, `knowledgeBase`), `infrastructure`, `presentation` (`api`, `authentication`, `socket`), `ml`, `lib`.
- Frontend: `application`, `components` (`auth`, `common`, `forensics`, `history`, `layout`, `settings`, `telemetry`, `ui`, `control-panel`, `icons`), `context`, `designs` (landing/marketing layer), `hooks`, `infrastructure`, `services`, `utils`.
- Shared: common cross-boundary contracts, domain-split under `types/`.

---

## 6. CODING STANDARDS & ARCHITECTURAL DISCIPLINE

1. **Type Safety First**
   - Maintain strict TypeScript boundaries where configured.
   - Favor explicit contracts for cross-module communication.
2. **Separation of Concerns**
   - Keep scoring, navigation, scenario execution, classification, telemetry, persistence, transport, and UI responsibilities modular — the exploration engine's decomposition into `exploration/`, `pathfinder/`, `regression/`, `forensics/`, and `telemetry/` sub-services is the reference example.
3. **Failure Isolation**
   - Handle runtime/browser failures defensively to preserve session stability where possible.
4. **No Placeholder-Only Modules**
   - Prefer functional implementations over non-executable stubs in core paths.
5. **Structured Telemetry**
   - Emit stable, typed telemetry envelopes consumable by dashboard components.
6. **Persistence Discipline**
   - Keep Mongo/Mongoose models and repositories in infrastructure; do not leak storage mechanics into domain policy.
7. **Dashboard as Operator Surface**
   - Keep dashboard code focused on auth, control, visualization, and history. It should not own exploration intelligence.
8. **Single Source of Truth for Classification**
   - Bug definitions, scenario-to-bug mapping, and signal patterns live once in `bugs/knowledgeBase/`; detectors consume it rather than duplicating regex/severity tables.

Reference telemetry envelope shape:

```json
{
  "timestamp": "2026-07-12T00:00:00.000Z",
  "type": "ACTION | NETWORK | EXCEPTION | FINDING | FRAME | SESSION | HEURISTIC_SCORE",
  "meta": {
    "sessionId": "string",
    "selector": "string",
    "actionExecuted": "string",
    "statusCode": 500,
    "findingType": "string",
    "exceptionDetails": {
      "message": "string",
      "stackTrace": "string"
    },
    "reproductionSteps": ["Step 1...", "Step 2..."]
  }
}
```

---

## 7. CURRENT MODULE ANCHORS

Important implementation anchors in the current tree:

- Dashboard shell: `developer-dashboard/src/App.tsx`, `components/forensics/ClinicalForensicsDashboard.tsx`, `components/control-panel/CommandCenter.tsx`
- Landing/pre-auth: `designs/LandingPage.tsx`, `designs/SlidingAuthForm.tsx`, `designs/ThemeContext.tsx`
- Auth: `components/auth/*` (AuthGuard, LoginForm, SignupForm, ForgotPasswordForm, ResetPasswordForm), `context/AuthContext.tsx`, `hooks/useAuth.ts`, `presentation/authentication/authController.ts` + `authLoginController.ts` + `authSignupController.ts` + `authRefreshController.ts` + `authPasswordResetController.ts` + `authMiddleware.ts` + `authValidation.ts` + `authConfig.ts` + `userSettingsController.ts`, `database/models/UserModel.ts`
- Dashboard transport: `application/ports/EngineGateway.ts`, `infrastructure/engine/SocketHttpEngineGateway.ts` composing `infrastructure/engine/gateway/EngineHttpClient.ts` + `SocketConnectionManager.ts`, `infrastructure/socket/BinaryFrameReceiver.ts`
- Backend startup: `testing-core/src/index.ts`, `presentation/api/registerRoutes.ts`, `presentation/socket/registerSocketHandlers.ts`
- Run/session orchestration: `application/useCases/StartExplorationUseCase.ts`, `application/services/SessionManager.ts`, `application/services/TargetHealthMonitor.ts`
- Intelligence (exploration engine): `domain/services/AutonomousExplorationEngine.ts` (facade) → `domain/services/exploration/ExplorationEngine.ts`, `ExplorationLoop.ts`, `ActionExecutor.ts`, `StateRestorer.ts`, `PageHealthGuard.ts`, `StrictUrlLockGuard.ts`
- Scoring & navigation: `domain/services/RiskScorer.ts`, `domain/services/StateGraphNavigator.ts`, `domain/services/DIrectedPathFinder.ts`, `domain/services/pathfinder/*` (GraphStore, EdgeSelector, TraversalStack, EventLog, config, utils)
- Loop-prevention & coverage: `domain/services/exploration/StateClusterRegistry.ts`, `EdgeRepeatTracker.ts`, `RouteExhaustionTracker.ts`, `RouteTrashThrottle.ts`, `noveltyScoring.ts`, `stagnationScoring.ts`, `escalationDecision.ts` + `EscalationTracker.ts`
- Chaos/attribution: `domain/chaos/ChaosTransactionManager.ts`
- Scenarios: `domain/scenarios/fuzzing/dataFuzzer.ts` + `elementClassifier.ts` + `payloadEscalator.ts` + `strategies/*`, `domain/scenarios/formBypasser.ts`, `networkSaboteur.ts`, `asyncStateRacer.ts`, `domain/scenarios/rapidClicker/*` (buttonSpammer, coordinateBombing, concurrentBurst, interactionSimulator), `domain/scenarios/routeTrasher/*`
- Bug detection: `bugs/scenarioAdapters.ts`, `bugs/knowledgeBase/*` (bugCatalog, scenarioCatalog, signalPatterns, FaultClassifier), `bugs/finders/*` (index registry, concurrentStress, fuzzGuard, noSqlInjection, reflectionOracle, spaRaceConditions, structuralProbe), executed by `domain/services/exploration/BugFinderRunner.ts`
- Regression replay ("Verify Fix"): `domain/services/regression/RegressionPlaybookVerifier.ts`, `ReplayActionRunner.ts`, `FaultCollector.ts`; dashboard side `application/useCases/useRegressionVerifier.ts`, `components/forensics/ForensicReport.tsx`
- Heuristics: `domain/heuristics/domParser.ts`, `AccessibilityAuditor.ts`
- Monitoring: `domain/services/telemetry/StabilityMonitor.ts` (primary), `infrastructure/monitoring/stabilityMonitor.ts` (secondary heartbeat), `actionBuffer.ts`, `activeScenarioTracker.ts`, `anomalyListeners.ts`, `browserConsoleListener.ts`, `fuzzForensics.ts`, `navForensics.ts`, `reproductionPlaybookStore.ts`, `serverReachability.ts`, `socketServer.ts`, `BinaryFrameServer.ts`
- Persistence: `database/mongooseClient.ts`, `database/repositories/MongoFindingRepository.ts` + `ForensicAnalysisRepository.ts` + `ForensicErrorRepository.ts` + `ForensicTelemetryRepository.ts` + `SavedSafariRepository.ts` (deprecated), `database/models/ActionTraceModel.ts` + `BrainConfigModel.ts` + `FindingModel.ts` + `FindingType.ts` + `SessionModel.ts` + `UserModel.ts` + `ForensicAnalysisModel.ts` + `ForensicErrorModel.ts` + `ForensicTelemetryModel.ts`
- Worker/queue: `queue/TaskQueue.ts`, `workers/SafariWorker.ts`, `worker-entry.ts`
- Dashboard notifications: `infrastructure/notifications/ToastProvider.tsx`
- Contracts: `shared/types.ts` (barrel) → `shared/types/*.ts`, `testing-core/src/types.ts`, `developer-dashboard/src/types.ts`

---

## Working Agreement

This blueprint is the guiding architecture for BugSafari. As implementation evolves, updates should preserve the same core principles: autonomy, observability, bounded exploration, deterministic classification, persistence, and actionable, verifiable forensic output.
