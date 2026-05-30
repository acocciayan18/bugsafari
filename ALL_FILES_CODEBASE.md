# ALL_FILES_CODEBASE.md

Narrative developer guide to the current source/config surface area of BugSafari.

- Included extensions: `*.ts`, `*.tsx`, `*.js`, `*.jsx`
- Included areas: `developer-dashboard/`, `testing-core/`, `shared/`
- Excluded: `node_modules/`, `.git/`, build output dirs (`dist/`, `build/`)

This version is intentionally not just a catalog. Each section explains **what exists, why it exists, what triggers it, and what it triggers next**.

---

## System Narrative at a Glance

BugSafari is a two-part runtime:

1. **Watchtower (Developer Dashboard)** — receives operator intent and visualizes live engine behavior.
2. **Intelligence + Arsenal (Testing Core)** — explores targets, scores risk, executes scenarios, detects failures, and emits forensic telemetry.

`shared/types.ts` forms the cross-boundary language so dashboard and engine reason over the same event and payload shapes.

---

## `developer-dashboard/` — Watchtower (Operator Surface)



### `developer-dashboard/src/App.tsx`
- Composition root for dashboard views and controller wiring.
- Triggered after app bootstrap; binds control panel, stream panels, and derived UI state.
- Uses application use-case hook and component tree.

### `developer-dashboard/src/types.ts`
- UI-local type models for telemetry/rendering safety.
- Referenced whenever components/use-cases shape dashboard state.
- Aligned with `shared/types.ts` and gateway payload handling.

---

## `developer-dashboard/src/application/` — Watchtower Orchestration Layer

### `developer-dashboard/src/application/ports/EngineGateway.ts`
- Defines dashboard-facing contract for engine control and subscriptions.
- UI/use-cases call this abstract interface; concrete adapter executes transport details.
- Implemented by `infrastructure/engine/SocketHttpEngineGateway.ts`; consumed by `useDashboardController.ts`.

### `developer-dashboard/src/application/useCases/useDashboardController.ts`
- Main UI orchestration hook that translates operator actions into engine commands and state transitions.
- Triggered by component actions (start/stop/connect) → calls gateway → updates render state.
- Depends on `EngineGateway` port and utility mapping/control helpers; feeds multiple UI components.

---

## `developer-dashboard/src/components/` — Watchtower Visual Modules

### `developer-dashboard/src/components/ClinicalForensicsDashboard.tsx`
- **Primary composite dashboard** — unified operator surface replacing separate ControlPanel, TelemetryStream, ForensicTrail, and ReproductionTrail.
- Provides three-column layout: sidebar navigation (18%), target control panel (27%), and live output studio (55%).
- Integrates target URL input, optimization toggles, live feed viewport, and multi-tab terminal (telemetry/errors/network/console/history).
- Handles state management for tabs, expanded stack traces, and action trail expansion.
- Accepts telemetry events, error incidents/reports, session history, and frame buffers for real-time display.

### `developer-dashboard/src/components/AuthForm.tsx`
- Authentication form with login/signup modes.
- Connects to backend auth endpoints for token-based authentication.
- Supports guest access for unauthenticated exploration.
- Stores auth tokens in localStorage for session persistence.

### `developer-dashboard/src/components/SessionHistoryTable.tsx`
- Displays historical exploration sessions in expandable table format.
- Shows status, target URL, findings count, action trace count, and timestamps.
- Supports row expansion to reveal brain snapshots and finish reason.
- Used within dashboard history tab and standalone views.

### `developer-dashboard/src/components/LiveFeed.tsx`
- Displays live execution frame/screenshot context.
- Triggered by latest feed updates from backend stream.
- Couples with telemetry and milestone updates for operator context.

### `developer-dashboard/src/components/ControlPanel.tsx`
- Operator command surface (target URL + run lifecycle controls).
- User actions trigger controller methods to start/stop/adjust session.
- Uses dashboard controller hook outputs.

### `developer-dashboard/src/components/TelemetryStream.tsx`
- Real-time telemetry timeline for situational awareness.
- Triggered by incoming telemetry state updates; re-renders event stream.
- Consumes structured events from controller/gateway flow.

### `developer-dashboard/src/components/ForensicTrail.tsx`
- Surfaces forensic breadcrumbs for diagnosing failures.
- Triggered by exception/reproduction telemetry slices.
- Uses monitoring-derived payloads from backend.

### `developer-dashboard/src/components/ReproductionTrail.tsx`
- Presents reproducible step sequence for bug validation.
- Triggered when reproduction playbook entries are available.
- Depends on backend `reproductionPlaybookStore` output semantics.

### `developer-dashboard/src/components/ThinkingIndicator.tsx`
- Visual indicator showing engine processing state.
- Displays when BugSafari is actively analyzing/exploring.
- Provides visual feedback during autonomous decision cycles.

---

## `developer-dashboard/src/infrastructure/` — Watchtower Transport Adapter

### `developer-dashboard/src/infrastructure/engine/SocketHttpEngineGateway.ts`
- Concrete adapter combining HTTP control APIs and socket telemetry streams.
- Controller invokes start/stop over HTTP; socket channel pushes live telemetry back to UI.
- Implements `EngineGateway`; depends on backend presentation routes/socket handlers.

---

## `developer-dashboard/src/utils/` — Watchtower Utility Helpers

### `developer-dashboard/src/utils/engineControl.ts`
- Session/run command helper logic to keep controller lean.
- Triggered from use-case/controller operations.
- Supports `useDashboardController.ts` and control-oriented components.

### `developer-dashboard/src/utils/semanticInstructionMapper.ts`
- Converts semantic operator intent into engine-consumable directives.
- Triggered before dispatching instructions to backend.
- Bridges UI intent with backend action vocabulary.

---

## `shared/` — Contract Bridge Between Watchtower and Engine

### `shared/types.ts`
- Shared message/event/type contracts to keep frontend/backend aligned.
- Used at compile-time and runtime serialization boundaries.
- Referenced by dashboard types/gateway and testing-core telemetry/event modules.

---

## `testing-core/` — Intelligence + Arsenal Runtime

### `testing-core/src/contracts.ts`
- Internal contract definitions for engine boundaries.
- Referenced during orchestration and adapter interactions.
- Complements `types.ts` and application ports.

### `testing-core/src/explorer.ts`
- Exploration entry wiring helper for autonomous run flow.
- Triggered by run startup path; prepares exploration context.
- Connects bootstrapping/use-case to domain orchestration.

### `testing-core/src/index.ts`
- Main backend process bootstrap and high-level orchestration entry.
- Process starts → infrastructure + presentation + use-cases wired → engine ready for control events.
- Connects API/socket surfaces with application and domain layers.

### `testing-core/src/serverUtils.ts`
- Runtime/server helper functions (ports/env/runtime utilities).
- Triggered during startup/config resolution.
- Used by `index.ts` and server initialization routines.

### `testing-core/src/types.ts`
- Engine-local type aliases and models.
- Referenced across modules for consistent signatures.
- Works with `contracts.ts` and shared cross-boundary types.

---

## `testing-core/src/application/` — Use-Case Coordination

### `testing-core/src/application/ports/BrowserEngine.ts`
- Abstraction for browser automation capabilities.
- Use-cases/services invoke this port; concrete Playwright adapter executes.
- Implemented by `infrastructure/playwright/PlaywrightBrowserEngine.ts`.

### `testing-core/src/application/ports/TelemetryGateway.ts`
- Abstraction for telemetry emission transport.
- Domain/application emit signals through this boundary.
- Implemented by `infrastructure/socket/SocketTelemetryGateway.ts`.

### `testing-core/src/application/useCases/StartExplorationUseCase.ts`
- Entry use-case for starting autonomous exploration safely.
- Triggered by API/socket start command → validates input/context → initializes engine run.
- Coordinates run controller, browser engine, telemetry gateway, domain engine.

### `testing-core/src/application/services/autonomousLoop.ts`
- Application-level adapter around autonomous loop operation.
- Triggered during run execution cycle.
- Delegates to domain services and monitoring outputs.

### `testing-core/src/application/services/domainGuard.ts`
- Domain boundary guard service to constrain exploration.
- Triggered before/after navigation decisions.
- Supports scenario execution safety and run control.

### `testing-core/src/application/services/runController.ts`
- Session lifecycle manager for run state transitions.
- Triggered by start/stop commands and completion/error conditions.
- Works with stack manager, autonomous loop, telemetry emission.

### `testing-core/src/application/services/stackManager.ts`
- Execution stack/step context manager.
- Triggered during iterative scenario/interaction dispatch.
- Supports run controller and autonomous loop continuity.

---

## `testing-core/src/bugs/` — Arsenal Detection and Stress Mapping

### `testing-core/src/bugs/registry.ts`
- Registers/assembles active bug finders.
- Triggered at runtime init or finder resolution stage.
- Feeds scenario adapters and analysis pipeline.

### `testing-core/src/bugs/scenarioAdapters.ts`
- Bridges scenario execution output with bug-finder expectations.
- Triggered when scenario actions/results need detector interpretation.
- Connects domain scenarios, stress adapters, and finder modules.

### `testing-core/src/bugs/types.ts`
- Canonical contracts for findings, evidence, and finder interfaces.
- Used during detection output generation and telemetry packaging.
- Shared by registry/finders/adapters/reporting paths.

---

## `testing-core/src/bugs/finders/` — Pattern-Specific Detectors

> For each finder, `.ts` is the source implementation and `.js` is its JS counterpart present in the repository.

### `testing-core/src/bugs/finders/boundaryStress.ts`
- Detects boundary-limit failure patterns.
- Triggered by stress outputs and interaction anomalies.
- Uses bug contracts and stress adapter outputs.

### `testing-core/src/bugs/finders/boundaryStress.js`
- JavaScript counterpart of boundary stress finder.
- Loaded when JS module path is used.
- Mirrors TS finder behavior.

### `testing-core/src/bugs/finders/clientSideBypass.ts`
- Detects client-side validation/control bypass indicators.
- Triggered by form/constraint scenario outcomes.
- Relies on scenario adapter evidence streams.

### `testing-core/src/bugs/finders/clientSideBypass.js`
- JavaScript counterpart of client-side bypass finder.
- JS runtime/module resolution path.
- Mirrors TS implementation.

### `testing-core/src/bugs/finders/inputSanitization.ts`
- Detects weak or missing sanitization behavior.
- Triggered by fuzz payload responses and output signatures.
- Uses payload/scenario evidence and bug types.

### `testing-core/src/bugs/finders/inputSanitization.js`
- JavaScript counterpart of input sanitization finder.
- JS module path runtime.
- Mirrors TS implementation.

### `testing-core/src/bugs/finders/noSqlInjection.ts`
- Detects NoSQL-injection-like response and behavior signals.
- Triggered by crafted payload execution and backend response patterns.
- Works with payload synthesizer/fuzzer-derived evidence.

### `testing-core/src/bugs/finders/noSqlInjection.js`
- JavaScript counterpart of NoSQL injection finder.
- JS module path runtime.
- Mirrors TS implementation.

### `testing-core/src/bugs/finders/runtimeStability.ts`
- Detects crash/exception/stability degradation signs.
- Triggered by exception catcher and run-time anomaly traces.
- Cooperates with monitoring stack.

### `testing-core/src/bugs/finders/runtimeStability.js`
- JavaScript counterpart of runtime stability finder.
- JS module path runtime.
- Mirrors TS implementation.

### `testing-core/src/bugs/finders/spaRaceConditions.ts`
- Detects SPA race and async timing hazards.
- Triggered during rapid navigation/action overlaps.
- Uses route/action traces and scenario outputs.

### `testing-core/src/bugs/finders/spaRaceConditions.js`
- JavaScript counterpart of SPA race finder.
- JS module path runtime.
- Mirrors TS implementation.

### `testing-core/src/bugs/finders/structuralNavigation.ts`
- Detects structural navigation inconsistencies and state drift.
- Triggered by structural hash/state transitions across navigation.
- Coupled to heuristics hashing and navigation scenarios.

### `testing-core/src/bugs/finders/structuralNavigation.js`
- JavaScript counterpart of structural navigation finder.
- JS module path runtime.
- Mirrors TS implementation.

---

## `testing-core/src/bugs/stressAdapters/` — Scenario-to-Stress Translators

### `testing-core/src/bugs/stressAdapters/index.ts`
- Exports stress adapter set for centralized use.
- Triggered by adapter registry/import path.
- Aggregates boundary/concurrent/structural adapters.

### `testing-core/src/bugs/stressAdapters/boundaryOverload.ts`
- Boundary overload stress translation logic.
- Triggered during boundary-focused test bursts.
- Feeds corresponding finders.

### `testing-core/src/bugs/stressAdapters/boundaryOverload.js`
- JavaScript counterpart of boundary overload adapter.
- JS module path runtime.
- Mirrors TS implementation.

### `testing-core/src/bugs/stressAdapters/concurrentStress.ts`
- Concurrent action stress mapping logic.
- Triggered in multi-action overlap scenarios.
- Supports race/stability detector inputs.

### `testing-core/src/bugs/stressAdapters/concurrentStress.js`
- JavaScript counterpart of concurrent stress adapter.
- JS module path runtime.
- Mirrors TS implementation.

### `testing-core/src/bugs/stressAdapters/structuralProbe.ts`
- Structural probing stress adapter.
- Triggered by structure-sensitive scenario outputs.
- Works with structural navigation detection/hashing.

### `testing-core/src/bugs/stressAdapters/structuralProbe.js`
- JavaScript counterpart of structural probe adapter.
- JS module path runtime.
- Mirrors TS implementation.

---

## `testing-core/src/domain/` — Intelligence Core

### `testing-core/src/domain/entities/InteractiveElement.ts`
- Domain entity representing normalized interactive targets.
- Created during DOM parsing and consumed by scoring/interaction modules.
- Used by parser, scorer, simulator, and scenarios.

---

## `testing-core/src/domain/heuristics/` — Intelligence Scoring and Memory

### `testing-core/src/domain/heuristics/domParser.ts`
- Extracts actionable interaction surface from DOM snapshots.
- Triggered each exploration cycle before candidate ranking.
- Produces entities for scorer and scenario engines.

### `testing-core/src/domain/heuristics/hashUtils.ts`
- Structural hash utilities for state memory and repetition detection.
- Triggered after DOM parse/state transition.
- Supports structural hash manager and navigation detectors.

### `testing-core/src/domain/heuristics/scorer.ts`
- Heuristic risk/priority scoring for discovered elements.
- Triggered after candidate extraction; influences next action selection.
- Collaborates with `ElementScorer` and autonomous orchestration.

---

## `testing-core/src/domain/scenarios/` — Arsenal Behavior Library

### `testing-core/src/domain/scenarios/buttonSpammer.ts`
- High-frequency click stress scenario.
- Triggered when action strategy selects aggressive click burst behavior.
- Uses interaction simulator and telemetry monitoring.

### `testing-core/src/domain/scenarios/concurrentClicker.ts`
- Concurrent click helper behavior for overlap stress.
- Triggered by concurrency-focused paths.
- Supports race-condition discovery and concurrent stress adapters.

### `testing-core/src/domain/scenarios/coordinateBombing.ts`
- Coordinate-based bombardment scenario for layout/event edge cases.
- Triggered when positional stress strategy is selected.
- Interacts with simulator and structural monitoring.

### `testing-core/src/domain/scenarios/dataFuzzer.ts`
- Mutated data/payload injection scenario.
- Triggered on input-bearing targets requiring fuzz exploration.
- Uses payload sources and sanitization/injection finders.

### `testing-core/src/domain/scenarios/formBypasser.ts`
- Scenario targeting client-side validation bypass opportunities.
- Triggered on forms/constraints under test.
- Feeds client-side bypass and sanitization detectors.

### `testing-core/src/domain/scenarios/index.ts`
- Scenario export/index composition.
- Triggered when scenario registry imports behavior set.
- Aggregates all scenario modules.

### `testing-core/src/domain/scenarios/networkSaboteur.ts`
- Network disruption/latency/error-behavior probing scenario.
- Triggered by resilience-focused strategy paths.
- Cooperates with exception/stability monitoring.

### `testing-core/src/domain/scenarios/routeTrasher.ts`
- Aggressive route churn to expose navigation/state bugs.
- Triggered in SPA route stress mode.
- Supports structural navigation and race-condition detectors.

### `testing-core/src/domain/scenarios/securityVulnerabilityScout.ts`
- Security-centric scouting strategy composition.
- Triggered when run objective emphasizes vulnerability signals.
- Orchestrates security-relevant scenario/finder combinations.

### `testing-core/src/domain/scenarios/smartAttacker.ts`
- Strategy selector for choosing best-next scenario/action sequence.
- Triggered during autonomous decision points.
- Consumes scorer/risk context and dispatches scenario modules.

### `testing-core/src/domain/scenarios/types.ts`
- Shared scenario contracts for compatibility and composability.
- Compile-time/runtime typing across scenario registry and execution.
- Used by scenario implementations and orchestrators.

---

## `testing-core/src/domain/services/` — Intelligence Orchestrators

### `testing-core/src/domain/services/AutonomousExplorationEngine.ts`
- Core domain orchestrator driving autonomous exploration loops.
- Triggered by start use-case; repeatedly parse → score → act → observe.
- Uses parser/scorer/simulator/scenario stack and telemetry emissions.

### `testing-core/src/domain/services/ElementScorer.ts`
- Service-level scoring coordinator around heuristic ranking.
- Triggered when candidate elements are available for prioritization.
- Built on heuristics scorer; feeds smart attacker decisions.

### `testing-core/src/domain/services/InteractionSimulator.ts`
- Executes low-level interactions against targets.
- Triggered by selected scenario actions.
- Relies on browser engine capabilities and informs monitoring channels.

### `testing-core/src/domain/services/RecursiveDomParser.ts`
- Recursive DOM analysis/traversal support.
- Triggered during deep interaction-surface discovery.
- Supports domParser and interactive entity creation.

### `testing-core/src/domain/services/StructuralHashManager.ts`
- Maintains structural state memory using hashing.
- Triggered on each state snapshot to detect loops/drift.
- Uses hash utils and informs structural/routing detectors.

---

## `testing-core/src/infrastructure/` — Adapters and Monitoring Plumbing

### `testing-core/src/infrastructure/monitoring/actionBuffer.ts`
- Buffers recent action traces for forensic introspection.
- Triggered whenever scenario actions execute.
- Feeds forensic and reproduction outputs.

### `testing-core/src/infrastructure/monitoring/exceptionCatcher.ts`
- Captures runtime anomalies/exceptions.
- Triggered by errors, failed interactions, and runtime instability events.
- Supports stability finders and forensic trail generation.

### `testing-core/src/infrastructure/monitoring/reproductionPlaybookStore.ts`
- Persists reproducible action sequences.
- Triggered as notable bug paths are detected.
- Feeds dashboard `ReproductionTrail` and forensic workflows.

### `testing-core/src/infrastructure/monitoring/socketServer.ts`
- Telemetry socket transport hub.
- Triggered after backend startup; streams events to connected clients.
- Works with telemetry gateway and presentation socket handlers.

### `testing-core/src/infrastructure/monitoring/stabilityMonitor.ts`
- Tracks stability indicators over run lifecycle.
- Triggered continuously as action/outcome data arrives.
- Supports runtime stability detection and milestone/alert emission.

### `testing-core/src/infrastructure/playwright/PlaywrightBrowserEngine.ts`
- Concrete browser automation adapter (Playwright).
- Triggered through `BrowserEngine` port from use-cases/domain services.
- Implements application port; powers interaction simulator.

### `testing-core/src/infrastructure/socket/SocketTelemetryGateway.ts`
- Concrete telemetry transport adapter over sockets.
- Triggered when domain/application emit telemetry events.
- Implements `TelemetryGateway`; routes data toward socket server and UI subscribers.

---

## `testing-core/src/lib/` — Shared Engine Utility

### `testing-core/src/lib/circularBuffer.ts`
- Reusable bounded history structure for rolling event/action windows.
- Triggered by modules requiring fixed-size temporal memory.
- Common helper for monitoring and buffering workflows.

---

## `testing-core/src/ml/` — Heuristic/Model Utilities

### `testing-core/src/ml/domHasher.ts`
- Hashing helpers for DOM/state characterization.
- Triggered when structure fingerprints are needed.
- Complements domain hash/state memory logic.

### `testing-core/src/ml/payloadSynthesizer.ts`
- Generates/combines payload variations for probing.
- Triggered by fuzz/security-oriented scenarios.
- Supports `dataFuzzer` and injection/sanitization detection paths.

### `testing-core/src/ml/perceptron.ts`
- Lightweight perceptron-like utility for scoring/model experimentation.
- Triggered in model-assisted decision helpers.
- Supports heuristic weighting/selection experimentation.

---

## `testing-core/src/payloads/` — Input Mutation Source

### `testing-core/src/payloads/chaosData.ts`
- Source of mutation tokens and chaotic input sets.
- Triggered when payload generation/fuzz scenarios request candidate inputs.
- Used by payload synthesizer and scenario fuzz routines.

---

## `testing-core/src/presentation/` — External Interfaces

### `testing-core/src/presentation/api/registerRoutes.ts`
- Registers HTTP endpoints for run control/health operations.
- Triggered at backend startup; maps incoming requests to use-cases.
- Invoked from bootstrap; called by dashboard HTTP gateway.

### `testing-core/src/presentation/socket/registerSocketHandlers.ts`
- Registers socket event handlers for real-time control/streaming.
- Triggered during socket server init; binds event names to orchestration handlers.
- Integrates with telemetry gateway and dashboard socket client.

---

## End-to-End Wiring (Operator Intent to Forensic Insight)

1. Operator enters target URL and clicks "INITIALIZE EXPLORATORY SAFARI" in **ClinicalForensicsDashboard**.
2. Dashboard controller calls **EngineGateway** (HTTP start/control + socket subscribe).
3. Backend **StartExplorationUseCase** initializes autonomous run.
4. **AutonomousExplorationEngine** loops through parse → score → scenario action → observe.
5. **Bug finders + stress adapters** interpret evidence into findings/signals.
6. **Monitoring infrastructure** captures milestones, exceptions, action traces, and reproduction steps.
7. **Socket telemetry** streams everything back to dashboard: tabs display telemetry live-feed, errors, network, console, and session history.
