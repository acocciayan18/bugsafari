# SYSTEM SPECIFICATION & ENGINEERING BLUEPRINT: BUGSAFARI

## Project Title

BUGSAFARI: AN AUTONOMOUS, ADAPTIVE EXPLORATORY TESTING ENGINE FOR SINGLE-PAGE APPLICATIONS

Updated against the current repository tree on June 4, 2026.

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
- prioritizes targets using risk and state scoring,
- executes non-linear stress, fuzzing, route, network, and security scenarios,
- captures runtime, stability, visual-frame, and forensic context,
- persists users, sessions, action traces, brain/config snapshots, and findings,
- streams live telemetry plus replay-oriented evidence back to a dashboard.

### 1.3 Target Audience & Focus

The primary audience is student developers and independent engineers who need rapid feedback on unstable behavior before demos, submissions, or deployment milestones.

BugSafari acts as an automated resilience probe that surfaces high-impact failures early and leaves enough evidence to understand what happened.

---

## 2. HIGH-LEVEL SYSTEM ARCHITECTURE

BugSafari follows a decoupled multi-package architecture with clear boundaries across domain, application, infrastructure, presentation, dashboard, and shared contracts.

### 2.1 Testing Core (Backend Engine)

The backend package (`testing-core/`) hosts autonomous exploration execution and exposes control, telemetry, persistence, and worker-capable execution surfaces.

Key architectural slices:

- **Application layer**: use-case orchestration, run lifecycle, guards, and ports (`BrowserEngine`, `TelemetryGateway`).
- **Domain layer**: interaction modeling, DOM parsing, risk scoring, state navigation, scenarios, and exploration intelligence.
- **Bug arsenal**: scenario adapters, stress adapters, finder registry, and pattern-specific bug detectors.
- **Infrastructure layer**: Playwright browser integration, monitoring, binary frames, sockets, queue/worker support, and Mongo persistence.
- **Presentation layer**: HTTP routes, auth controllers/middleware, and socket interfaces for external control/streaming.

### 2.2 Developer Dashboard (Interactive Command Center)

The dashboard package (`developer-dashboard/`) is a React client that:

- authenticates users or gates protected UI through auth components/hooks,
- starts exploration sessions via API/gateway abstractions,
- receives real-time telemetry and binary visual frame streams,
- visualizes live execution status, findings, forensic trails, reproduction trails, and history,
- exposes saved evaluations/session views for post-run review.

### 2.3 Shared Contract Layer

The shared package (`shared/`) provides common typed contracts used across packages for telemetry, session, and interaction artifacts.

---

## 3. CORE COGNITIVE AND BEHAVIORAL PROCESSES

BugSafari's autonomy is driven by five major functional pillars.

### 3.1 Pillar 1: Adaptive Risk Prioritization

**Goal:** prefer high-risk interaction targets over low-value random actions.

**Execution model:**

1. Discover interactive candidates from live DOM state.
2. Normalize candidates into `InteractiveElement` structures.
3. Score candidates and observed signals through `RiskScorer`.
4. Prioritize semantically sensitive controls such as submit, login, form, route, destructive, and state-changing paths.
5. Update behavior after observed outcomes such as network impact, route changes, instability, repeated states, and findings.

### 3.2 Pillar 2: Autonomous Navigation & State Awareness

**Goal:** avoid repetitive low-value loops and increase state-space diversity.

**Execution model:**

1. Parse current DOM topology and route context.
2. Track state transitions through `StateGraphNavigator`.
3. Use directed path selection via `DIrectedPathFinder`.
4. Apply domain guardrails before/after navigation decisions.
5. Bias execution toward actions that yield novel or suspicious transitions.

### 3.3 Pillar 3: High-Speed Behavioral Simulation

**Goal:** surface synchronization defects and fragile UI state under pressure.

**Execution model:**

1. Execute rapid interaction scenarios such as `rapidClickerStress`.
2. Apply route churn through `routeTrasher`.
3. Mix deterministic and stochastic action patterns to broaden coverage.
4. Use Playwright browser automation through the `BrowserEngine` port.
5. Continue safely with guarded error handling where possible.

### 3.4 Pillar 4: Generative Attack Vector Synthesis

**Goal:** stress input handling and validation boundaries without static scripts.

**Execution model:**

1. Generate mutated payload candidates from `chaosData` and `payloadSynthesizer`.
2. Apply payloads through `dataFuzzer`, `formBypasser`, and security-oriented scenarios.
3. Probe network disruption and route lifecycle behavior through `networkSaboteur` and `securityVulnerabilityScout`.
4. Observe telemetry and outcomes for sanitization, bypass, boundary, race, stability, and injection-like indicators.

### 3.5 Pillar 5: Real-Time Telemetry & Fault Isolation

**Goal:** convert non-deterministic failures into actionable forensic evidence.

**Execution model:**

1. Capture runtime exceptions, stability changes, action traces, findings, and visual frames.
2. Buffer recent action history in bounded memory.
3. Emit event streams in real time through socket telemetry.
4. Preserve reproduction-oriented traces for debugging handoff.
5. Persist sessions, findings, action traces, users, and brain/config snapshots through Mongo-backed models.

---

## 4. SYSTEM FEATURE MATRIX & SOURCE LOGIC DIRECTIVES

### 4.1 Scriptless Runtime Discovery

**Rule:** no hardcoded path assumptions should be required for baseline exploration.

**Directive:** interaction candidates must be discovered from current runtime DOM structure and attributes.

### 4.2 Domain-Bound Navigation Safety

**Rule:** exploration should remain within intended target scope.

**Directive:** `domainGuard` and state navigation services should prevent or recover from unintended off-target flows.

### 4.3 Real-Time Event Streaming

**Rule:** operational visibility must be continuous during runs.

**Directive:** actions, findings, frames, scoring/state changes, network events, and exception-relevant events should be emitted as structured telemetry.

### 4.4 Reproducibility Support

**Rule:** findings must be explainable and repeatable.

**Directive:** preserve enough chronological action context to reconstruct likely reproduction sequences, including action buffers and reproduction playbook entries.

### 4.5 Persistence and History

**Rule:** important run evidence should survive beyond the live process.

**Directive:** sessions, findings, action traces, users, finding types, and brain/config snapshots should be persisted through the database infrastructure and exposed to dashboard history views.

### 4.6 Worker and Queue Readiness

**Rule:** long-running exploration should be isolated from simple request/response control surfaces.

**Directive:** task queue and worker modules should support future distributed or isolated execution without changing dashboard intent semantics.

---

## 5. REQUISITE DIRECTORY ARCHITECTURE & ARCHETYPE

Expected top-level ownership:

```text
testing-core/          Headless TypeScript exploration engine, API/socket server, persistence, workers
developer-dashboard/   React-based command, auth, visibility, and history dashboard
shared/                Shared contracts, schemas, and types
```

Implementation is organized to support layered evolution:

- Backend: `application`, `domain`, `bugs`, `infrastructure`, `presentation`, `payloads`, `ml`, `lib`.
- Frontend: `application`, `components`, `hooks`, `infrastructure`, `services`, `utils`.
- Shared: common cross-boundary contracts.

---

## 6. CODING STANDARDS & ARCHITECTURAL DISCIPLINE

1. **Type Safety First**
   - Maintain strict TypeScript boundaries where configured.
   - Favor explicit contracts for cross-module communication.
2. **Separation of Concerns**
   - Keep scoring, scenario execution, telemetry, persistence, transport, and UI responsibilities modular.
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

Reference telemetry envelope shape:

```json
{
  "timestamp": "2026-06-04T00:00:00.000Z",
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

- Dashboard shell: `developer-dashboard/src/App.tsx`, `ClinicalForensicsDashboard.tsx`
- Auth: `AuthGuard.tsx`, `LoginForm.tsx`, `SignupForm.tsx`, `useAuth.ts`, `presentation/authentication/authController.ts`, `presentation/authentication/authMiddleware.ts`, `userSettingsController.ts`, `database/models/UserModel.ts`
- Dashboard transport: `application/ports/EngineGateway.ts`, `infrastructure/engine/SocketHttpEngineGateway.ts`, `infrastructure/socket/BinaryFrameReceiver.ts`
- Backend startup: `testing-core/src/index.ts`, `presentation/api/registerRoutes.ts`, `presentation/socket/registerSocketHandlers.ts`
- Run orchestration: `application/useCases/StartExplorationUseCase.ts`, `application/services/runController.ts`, `application/services/stackManager.ts`, `application/services/domainGuard.ts`
- Intelligence: `AutonomousExplorationEngine.ts`, `RiskScorer.ts`, `StateGraphNavigator.ts`, `DIrectedPathFinder.ts`, `ForensicAnalysisService.ts`, `BugClassifier.ts`
- Scenarios: `domain/scenarios/fuzzing/dataFuzzer.ts`, `formBypasser.ts`, `networkSaboteur.ts`, `rapidClickerStress.ts`, `routeTrasher.ts`
- Bug detection: `bugs/registry.ts`, `bugs/scenarioAdapters.ts`, `bugs/finders/*` (8 finders: concurrentStress, fuzzGuard, inputSanitization, noSqlInjection, runtimeStability, spaRaceConditions, structuralNavigation, structuralProbe)
- Monitoring: `actionBuffer.ts`, `exceptionCatcher.ts`, `reproductionPlaybookStore.ts`, `stabilityMonitor.ts`, `socketServer.ts`, `BinaryFrameServer.ts`
- Persistence: `database/mongooseClient.ts`, `database/repositories/MongoFindingRepository.ts`, `database/models/ActionTraceModel.ts`, `database/models/BrainConfigModel.ts`, `database/models/FindingModel.ts`, `database/models/FindingType.ts`, `database/models/SessionModel.ts`, `database/models/UserModel.ts`
- Worker/queue: `queue/TaskQueue.ts`, `workers/SafariWorker.ts`, `worker-entry.ts`
- Dashboard notifications: `infrastructure/notifications/ToastProvider.tsx`, `toastUtils.ts`
- Contracts: `shared/types.ts`, `testing-core/src/types.ts`, `developer-dashboard/src/types.ts`

---

## Working Agreement

This blueprint is the guiding architecture for BugSafari. As implementation evolves, updates should preserve the same core principles: autonomy, observability, bounded exploration, persistence, and actionable forensic output.
