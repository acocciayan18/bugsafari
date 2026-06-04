# BugSafari Codebase Documentation

This document is the architectural narrative companion to `ALL_FILES_CODEBASE.md`.

- `ALL_FILES_CODEBASE.md` answers: **where modules are and what each module does**
- `CODEBASE_DOCUMENTATION.md` answers: **why the architecture exists and how behavior flows end-to-end**

Updated against the current repository tree on June 4, 2026.

---

## 1) Soul of BugSafari

BugSafari exists to automate adversarial exploration of web applications and convert runtime chaos into actionable engineering evidence.

Its design intent is built around three outcomes:

1. **Find issues humans miss manually** by running sustained, strategy-driven exploratory behavior.
2. **Preserve explainability** by emitting milestones, traces, findings, binary frames, and reproduction artifacts.
3. **Close feedback loops quickly** by streaming real-time telemetry into an operator dashboard and preserving history in storage.

This is why the codebase is split into:

- an operator-facing **Watchtower** (`developer-dashboard`)
- an autonomous execution core with detectors (**Intelligence + Arsenal**) (`testing-core`)
- a shared contract bridge (`shared`)

---

## 2) Three Pillars Narrative

## Pillar A - Intelligence

**Primary home:** `testing-core/src/domain` and `testing-core/src/application`

Intelligence is responsible for:

- extracting interaction surfaces from DOM state,
- scoring/prioritizing targets and observed signals,
- navigating state transitions without blind repetition,
- selecting next actions strategically.

Key modules in this pillar:

- DOM understanding: `domain/heuristics/domParser.ts`, `domain/entities/InteractiveElement.ts`
- Domain services: `AutonomousExplorationEngine.ts`, `RiskScorer.ts`, `StateGraphNavigator.ts`, `DIrectedPathFinder.ts`
- Decision strategy support: `domain/scenarios/smartAttacker.ts`
- Run coordination: `StartExplorationUseCase.ts`, `runController.ts`, `stackManager.ts`, `domainGuard.ts`

**Why this pillar exists:** without a decision layer, automation becomes random click replay. Intelligence turns DOM state, historical context, and runtime feedback into guided exploration.

---

## Pillar B - Arsenal

**Primary home:** `testing-core/src/domain/scenarios`, `testing-core/src/bugs`, `testing-core/src/payloads`, `testing-core/src/ml`

Arsenal is responsible for:

- executing stress, fuzz, route, network, and security scenarios,
- probing boundary and validation assumptions,
- adapting scenario outputs into detector-friendly evidence,
- classifying suspicious behavior into structured findings.

Key modules in this pillar:

- Scenario library: `dataFuzzer`, `formBypasser`, `networkSaboteur`, `rapidClickerStress`, `routeTrasher`, `securityVulnerabilityScout`, `smartAttacker`
- Detection layer: `bugs/finders/*`
- Bridging logic: `bugs/scenarioAdapters.ts`, `bugs/stressAdapters/*`
- Input generation helpers: `payloads/chaosData.ts`, `ml/payloadSynthesizer.ts`

**Why this pillar exists:** discovery quality depends on behavioral diversity. Arsenal gives Intelligence multiple attack vectors and evidence-producing probes.

---

## Pillar C - Watchtower

**Primary home:** `developer-dashboard/src` plus backend monitoring, presentation, and persistence adapters

Watchtower is responsible for:

- accepting operator intent and authentication state,
- starting/stopping runs and connecting to live streams,
- displaying live telemetry, screenshots/frames, milestones, findings, and session history,
- presenting forensic traces and reproduction paths.

Key modules in this pillar:

- Primary dashboard: `ClinicalForensicsDashboard.tsx`
- Auth surface: `AuthGuard.tsx`, `LoginForm.tsx`, `SignupForm.tsx`, `useAuth.ts`
- History and saved runs: `SessionHistoryTable.tsx`, `SavedEvaluationSafaris.tsx`, `historyService.ts`
- Live visualization: `LiveFeed.tsx`, `TelemetryStream.tsx`, `ForensicTrail.tsx`, `ReproductionTrail.tsx`, `BinaryFrameReceiver.ts`
- UI orchestration and transport: `useDashboardController.ts`, `EngineGateway.ts`, `SocketHttpEngineGateway.ts`
- Backend telemetry and persistence: `presentation/*`, `infrastructure/monitoring/*`, `infrastructure/database/*`

**Why this pillar exists:** automation without observability becomes untrustworthy. Watchtower makes findings inspectable, traceable, and operationally useful.

---

## 3) DDD and Layered Architectural Context

BugSafari's backend (`testing-core`) follows a layered pattern close to DDD-style boundaries.

## Domain Layer (`testing-core/src/domain`)

Contains exploration behavior independent of transport/framework:

- entities such as `InteractiveElement`,
- DOM parsing and risk/state services,
- scenario definitions and strategy selection,
- repository contracts such as `FindingRepository`.

**Rule:** Domain expresses exploration intelligence and behavior policy; it should not depend on HTTP, socket, Mongo, or UI mechanics.

## Application Layer (`testing-core/src/application`)

Coordinates use-cases and lifecycle:

- starts and stops runs,
- sequences domain services,
- enforces domain guards,
- depends on abstractions such as `BrowserEngine` and `TelemetryGateway`.

**Rule:** Application decides when domain behavior executes and through which abstract capabilities.

## Infrastructure Layer (`testing-core/src/infrastructure`)

Implements technical adapters:

- Playwright browser automation,
- socket telemetry gateway,
- binary frame server,
- Mongo/Mongoose models and repositories,
- worker and task queue support,
- monitoring buffers/stores/emitters.

**Rule:** Infrastructure satisfies ports and operational concerns; it does not own business intent.

## Presentation Layer (`testing-core/src/presentation`)

Exposes interfaces to outside actors:

- HTTP route registration,
- authentication controllers and middleware,
- socket event handler registration.

**Rule:** Presentation maps external requests/events into application use-cases.

---

## 4) Wiring: End-to-End Control and Data Flow

## Flow A - Authentication and Dashboard Entry

1. `AuthGuard.tsx` checks whether the operator has usable auth state.
2. `LoginForm.tsx` or `SignupForm.tsx` submits credentials through backend auth routes.
3. `authController.ts`, `authMiddleware.ts`, and `UserModel.ts` handle identity and token validation.
4. The dashboard renders authenticated views and can request history/saved runs.

**Outcome:** operator access and persisted session data are separated from autonomous engine behavior.

---

## Flow B - Run Startup

1. Operator enters a target URL or run intent in `ClinicalForensicsDashboard.tsx`.
2. `useDashboardController.ts` normalizes intent and invokes `EngineGateway`.
3. `SocketHttpEngineGateway.ts` sends HTTP control requests and opens socket subscriptions.
4. `registerRoutes.ts` forwards start commands to `StartExplorationUseCase.ts`.
5. The use-case initializes lifecycle services (`runController`, `stackManager`, `domainGuard`) and engine dependencies.
6. `AutonomousExplorationEngine.ts` begins the exploration loop.

**Outcome:** a controlled, traceable run begins from explicit human intent.

---

## Flow C - Autonomous Exploration Loop

1. DOM parsing extracts interactive elements from current browser state.
2. Risk/state services rank candidates and evaluate navigation context.
3. Strategy code selects a scenario or action path.
4. `PlaywrightBrowserEngine.ts` executes interactions through the browser.
5. Monitoring captures actions, exceptions, stability, frames, and reproduction context.
6. Loop repeats with updated telemetry and state context until stopped or completed.

**Outcome:** stateful exploration that adapts instead of blindly repeating actions.

---

## Flow D - Detection and Evidence

1. Scenario outputs and runtime signals are fed through scenario/stress adapters.
2. Finder modules classify patterns such as sanitization gaps, race conditions, boundary failures, stability faults, and injection-like behavior.
3. Findings are normalized via `bugs/types.ts`.
4. `MongoFindingRepository.ts`, `FindingModel.ts`, `SessionModel.ts`, and related models persist structured evidence.
5. Reproduction and forensic modules preserve actionable traces.

**Outcome:** raw runtime behavior becomes structured bug intelligence.

---

## Flow E - Telemetry Return and History

1. Milestones, actions, exceptions, frames, findings, and run state changes are emitted through `TelemetryGateway`.
2. `SocketTelemetryGateway.ts`, `socketServer.ts`, and `registerSocketHandlers.ts` broadcast live updates.
3. `BinaryFrameServer.ts` and `BinaryFrameReceiver.ts` handle visual frame transport for the live feed.
4. Dashboard components update live: timeline, feed, forensic trail, reproduction trail, saved runs, and session history.
5. `historyService.ts` retrieves persisted session/evaluation data for review after a run.

**Outcome:** a closed loop between autonomous execution, persisted evidence, and human decision-making.

---

## 5) Package-Level Responsibilities and Boundaries

## `developer-dashboard/`

- Owns operator experience, auth-aware UI, runtime observability, and history visualization.
- Depends on backend contracts and transport gateways.
- Should not implement backend exploration, browser automation, or detector logic.

## `testing-core/`

- Owns autonomous exploration, scenario execution, detection, persistence, and telemetry emission.
- Exposes control/stream interfaces through presentation adapters.
- Should not contain UI rendering responsibilities.

## `shared/`

- Owns cross-package contract stability.
- Minimizes semantic drift between producer (engine) and consumer (dashboard).

---

## 6) Why This Split Works Operationally

This architecture intentionally optimizes for:

- **Autonomy:** domain + scenario engine can run deep explorations.
- **Safety/control:** application services and guards constrain behavior.
- **Observability:** monitoring, sockets, and binary frames turn opaque runs into inspectable evidence.
- **Persistence:** Mongo-backed repositories/models keep findings, sessions, actions, brain config, and users inspectable after runtime.
- **Extensibility:** new scenarios, finders, stress adapters, storage adapters, or UI panels can be added without rewriting the whole system.
- **Team parallelism:** frontend, domain logic, infrastructure, and persistence can evolve with clear boundaries.

---

## 7) Reading Path for New Contributors

Recommended order for understanding the system quickly:

1. `testing-core/src/index.ts` and `testing-core/src/presentation/*` - backend entrypoints and external interfaces.
2. `testing-core/src/application/useCases/StartExplorationUseCase.ts` - run orchestration.
3. `testing-core/src/domain/services/AutonomousExplorationEngine.ts` and `testing-core/src/domain/scenarios/*` - core behavior.
4. `testing-core/src/bugs/*` and `testing-core/src/infrastructure/monitoring/*` - detection and evidence.
5. `testing-core/src/infrastructure/database/*` - persistence model and repositories.
6. `developer-dashboard/src/App.tsx`, `useDashboardController.ts`, and `components/*` - operator-facing loop.
7. `shared/types.ts` - contract language binding both sides.

---

## 8) Relationship to Other Docs

- `BUGSAFARI_BLUEPRINT.md` captures strategic architecture principles and design direction.
- `ALL_FILES_CODEBASE.md` provides module-by-module narrative references for the current file tree.
- `SETUP_DISTRIBUTED.md` and `TODO_DISTRIBUTED_ARCHITECTURE.md` cover distributed/local runtime setup and future architecture work.
- `MONGO_VIEW_DATA.md` explains how to inspect persisted Mongo data.
- This file (`CODEBASE_DOCUMENTATION.md`) provides the system-level intent and wiring map connecting those details into a coherent mental model.
