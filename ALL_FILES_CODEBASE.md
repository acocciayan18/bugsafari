# ALL_FILES_CODEBASE.md

Narrative developer guide to the current source/config surface area of BugSafari.

- Included extensions: `*.ts`, `*.tsx`, `*.js`, `*.jsx`
- Included areas: `developer-dashboard/`, `testing-core/`, `shared/`
- Excluded: `node_modules/`, `.git/`, build output dirs (`dist/`, `build/`)

This version is intentionally not just a catalog. Each section explains what exists, why it exists, what triggers it, and what it triggers next.

---

## System Narrative at a Glance

BugSafari is a two-part runtime:

1. **Watchtower (Developer Dashboard)** - receives operator intent and visualizes live engine behavior.
2. **Intelligence + Arsenal (Testing Core)** - explores targets, scores risk, executes scenarios, detects failures, and emits forensic telemetry.

`shared/types.ts` forms the cross-boundary language so dashboard and engine reason over the same event and payload shapes.

---

## Current File Inventory

Generated from the current repository tree on June 4, 2026.

### `shared/`

- `shared/types.ts` - Shared message, telemetry, and domain contracts used across the dashboard/backend boundary.

### `developer-dashboard/` - Vite/React App Surface

- `developer-dashboard/eslint.config.js` - ESLint configuration for dashboard linting.
- `developer-dashboard/postcss.config.js` - PostCSS/Tailwind processing configuration.
- `developer-dashboard/tailwind.config.js` - Tailwind theme/content configuration.
- `developer-dashboard/vite.config.ts` - Vite development/build configuration.
- `developer-dashboard/src/main.tsx` - React browser entrypoint that mounts the app shell.
- `developer-dashboard/src/App.tsx` - Dashboard composition root and top-level route/state wiring.
- `developer-dashboard/src/types.ts` - UI-local type models for telemetry, sessions, errors, and dashboard rendering.

### `developer-dashboard/src/application/`

- `developer-dashboard/src/application/ports/EngineGateway.ts` - Dashboard-facing transport contract for engine commands and subscriptions.
- `developer-dashboard/src/application/useCases/useDashboardController.ts` - Main orchestration hook translating user actions into engine calls and render state.

### `developer-dashboard/src/components/`

- `developer-dashboard/src/components/AuthGuard.tsx` - Protects authenticated dashboard areas and coordinates auth state before rendering children.
- `developer-dashboard/src/components/ClinicalForensicsDashboard.tsx` - Primary operator dashboard combining target controls, live feed, telemetry tabs, findings, history, and forensic output.
- `developer-dashboard/src/components/ControlPanel.tsx` - Legacy/standalone target and run lifecycle command surface.
- `developer-dashboard/src/components/ForensicTrail.tsx` - Displays captured forensic breadcrumbs, failures, and diagnostic traces.
- `developer-dashboard/src/components/LiveFeed.tsx` - Renders latest visual/live execution frames from the backend stream.
- `developer-dashboard/src/components/LoginForm.tsx` - Login form that authenticates users and stores session credentials through auth flow helpers.
- `developer-dashboard/src/components/ReproductionTrail.tsx` - Presents reproducible step sequences for validating discovered issues.
- `developer-dashboard/src/components/SavedEvaluationSafaris.tsx` - Displays saved or historical evaluation safari runs for review.
- `developer-dashboard/src/components/SessionHistoryTable.tsx` - Expandable session history table showing run status, findings, traces, and timestamps.
- `developer-dashboard/src/components/Sidebar.tsx` - Navigation/sidebar shell for switching dashboard views or major operator sections.
- `developer-dashboard/src/components/SignupForm.tsx` - Signup form for creating user accounts against backend auth endpoints.
- `developer-dashboard/src/components/TelemetryStream.tsx` - Real-time telemetry timeline for live situational awareness.

### `developer-dashboard/src/hooks/`

- `developer-dashboard/src/hooks/useAuth.ts` - Authentication state hook for login/signup/logout/session persistence.

### `developer-dashboard/src/infrastructure/`

- `developer-dashboard/src/infrastructure/engine/SocketHttpEngineGateway.ts` - Concrete engine gateway combining HTTP control calls with socket telemetry streaming.
- `developer-dashboard/src/infrastructure/notifications/toastUtils.ts` - Toast notification helpers for consistent UI feedback.
- `developer-dashboard/src/infrastructure/socket/BinaryFrameReceiver.ts` - Binary frame receiver/parser for live visual feed payloads.

### `developer-dashboard/src/services/`

- `developer-dashboard/src/services/historyService.ts` - Client-side API service for retrieving and shaping historical session/evaluation data.

### `developer-dashboard/src/utils/`

- `developer-dashboard/src/utils/engineControl.ts` - Run-control helper logic used by dashboard orchestration.
- `developer-dashboard/src/utils/semanticInstructionMapper.ts` - Maps human/operator intent into engine-consumable instruction semantics.

---

## `testing-core/` - Backend Runtime Surface

- `testing-core/playwright.config.ts` - Playwright configuration for backend/browser automation testing.
- `testing-core/src/index.ts` - Main backend process bootstrap that wires infrastructure, routes, sockets, and use-cases.
- `testing-core/src/serverUtils.ts` - Server/runtime helper functions for startup and environment handling.
- `testing-core/src/types.ts` - Engine-local type aliases and runtime models.
- `testing-core/src/worker-entry.ts` - Worker entrypoint for isolated safari/exploration execution.

### `testing-core/src/application/`

- `testing-core/src/application/ports/BrowserEngine.ts` - Browser automation abstraction implemented by Playwright infrastructure.
- `testing-core/src/application/ports/TelemetryGateway.ts` - Telemetry transport abstraction implemented by socket infrastructure.
- `testing-core/src/application/services/domainGuard.ts` - Domain boundary guard that constrains allowed navigation and exploration.
- `testing-core/src/application/services/runController.ts` - Run lifecycle manager for start/stop/completion/error transitions.
- `testing-core/src/application/services/stackManager.ts` - Maintains execution stack and step context across an exploration run.
- `testing-core/src/application/useCases/StartExplorationUseCase.ts` - Use-case that validates a start command and initializes autonomous exploration.

### `testing-core/src/bugs/`

- `testing-core/src/bugs/registry.ts` - Assembles and exposes the active bug finder registry.
- `testing-core/src/bugs/scenarioAdapters.ts` - Bridges scenario outputs into detector/finder input shapes.
- `testing-core/src/bugs/types.ts` - Contracts for findings, evidence, detector inputs, and finder outputs.

### `testing-core/src/bugs/finders/`

- `testing-core/src/bugs/finders/boundaryStress.ts` - Detects boundary-limit failures from stress evidence.
- `testing-core/src/bugs/finders/clientSideBypass.ts` - Detects client-side validation/control bypass signals.
- `testing-core/src/bugs/finders/inputSanitization.ts` - Detects weak input sanitization and unsafe output behavior.
- `testing-core/src/bugs/finders/noSqlInjection.ts` - Detects NoSQL-injection-like response and behavior patterns.
- `testing-core/src/bugs/finders/runtimeStability.ts` - Detects crashes, exceptions, and runtime stability degradation.
- `testing-core/src/bugs/finders/spaRaceConditions.ts` - Detects SPA timing/race/navigation hazards.
- `testing-core/src/bugs/finders/structuralNavigation.ts` - Detects structural navigation drift and inconsistent state transitions.

### `testing-core/src/bugs/stressAdapters/`

- `testing-core/src/bugs/stressAdapters/index.ts` - Central export point for stress adapters.
- `testing-core/src/bugs/stressAdapters/boundaryOverload.ts` - Translates boundary overload scenarios into detector evidence.
- `testing-core/src/bugs/stressAdapters/concurrentStress.ts` - Translates concurrent action stress into race/stability evidence.
- `testing-core/src/bugs/stressAdapters/structuralProbe.ts` - Translates structural probing into navigation/structure evidence.

### `testing-core/src/domain/`

- `testing-core/src/domain/entities/InteractiveElement.ts` - Domain entity for normalized interactive targets discovered from the DOM.
- `testing-core/src/domain/heuristics/domParser.ts` - Parses DOM snapshots into actionable interaction candidates.
- `testing-core/src/domain/repositories/FindingRepository.ts` - Repository contract for storing and retrieving findings.

### `testing-core/src/domain/scenarios/`

- `testing-core/src/domain/scenarios/dataFuzzer.ts` - Mutated payload/input scenario for fuzzing input-bearing targets.
- `testing-core/src/domain/scenarios/formBypasser.ts` - Scenario targeting form validation and client-side bypass behavior.
- `testing-core/src/domain/scenarios/index.ts` - Scenario export composition point.
- `testing-core/src/domain/scenarios/networkSaboteur.ts` - Network disruption/latency/error-behavior probing scenario.
- `testing-core/src/domain/scenarios/rapidClickerStress.ts` - High-frequency click stress scenario for interaction durability.
- `testing-core/src/domain/scenarios/routeTrasher.ts` - Route churn scenario for SPA navigation and state bugs.
- `testing-core/src/domain/scenarios/securityVulnerabilityScout.ts` - Security-oriented scenario composition and scouting logic.
- `testing-core/src/domain/scenarios/smartAttacker.ts` - Strategy selector for choosing next scenario/action based on risk context.
- `testing-core/src/domain/scenarios/types.ts` - Shared scenario contracts.

### `testing-core/src/domain/services/`

- `testing-core/src/domain/services/AutonomousExplorationEngine.ts` - Core loop orchestrator for parse, score, act, observe, and emit cycles.
- `testing-core/src/domain/services/DIrectedPathFinder.ts` - Directed path finding service for choosing/navigation through candidate routes.
- `testing-core/src/domain/services/RiskScorer.ts` - Scores risk/priority of candidates and observed signals.
- `testing-core/src/domain/services/StateGraphNavigator.ts` - Tracks and navigates state graph transitions during exploration.

### `testing-core/src/infrastructure/database/`

- `testing-core/src/infrastructure/database/mongooseClient.ts` - MongoDB/Mongoose connection setup and lifecycle helper.
- `testing-core/src/infrastructure/database/models/ActionTraceModel.ts` - Mongoose model for persisted action traces.
- `testing-core/src/infrastructure/database/models/BrainConfigModel.ts` - Mongoose model for brain/config snapshots.
- `testing-core/src/infrastructure/database/models/FindingModel.ts` - Mongoose model for persisted findings.
- `testing-core/src/infrastructure/database/models/FindingType.ts` - Finding type enum/model helpers.
- `testing-core/src/infrastructure/database/models/SessionModel.ts` - Mongoose model for exploration sessions.
- `testing-core/src/infrastructure/database/models/UserModel.ts` - Mongoose model for authenticated users.
- `testing-core/src/infrastructure/database/repositories/MongoFindingRepository.ts` - Mongo-backed implementation of the finding repository contract.

### `testing-core/src/infrastructure/monitoring/`

- `testing-core/src/infrastructure/monitoring/BinaryFrameServer.ts` - Serves binary visual frame data for live dashboard playback.
- `testing-core/src/infrastructure/monitoring/actionBuffer.ts` - Buffers recent action traces for forensic and reproduction workflows.
- `testing-core/src/infrastructure/monitoring/exceptionCatcher.ts` - Captures runtime exceptions and anomaly context.
- `testing-core/src/infrastructure/monitoring/reproductionPlaybookStore.ts` - Stores reproducible action sequences for bug validation.
- `testing-core/src/infrastructure/monitoring/socketServer.ts` - Socket transport hub for live telemetry streaming.
- `testing-core/src/infrastructure/monitoring/stabilityMonitor.ts` - Tracks stability indicators throughout a run.

### `testing-core/src/infrastructure/playwright/`

- `testing-core/src/infrastructure/playwright/BoundingBoxHighlighter.ts` - Browser visual helper for highlighting selected element bounds.
- `testing-core/src/infrastructure/playwright/PlaywrightBrowserEngine.ts` - Concrete Playwright adapter implementing browser automation operations.

### `testing-core/src/infrastructure/queue/`

- `testing-core/src/infrastructure/queue/TaskQueue.ts` - Queue abstraction for scheduling/serializing backend tasks.

### `testing-core/src/infrastructure/socket/`

- `testing-core/src/infrastructure/socket/SocketTelemetryGateway.ts` - Socket-backed telemetry gateway implementation.

### `testing-core/src/infrastructure/workers/`

- `testing-core/src/infrastructure/workers/SafariWorker.ts` - Worker implementation for running safari jobs off the main process path.

### `testing-core/src/lib/`

- `testing-core/src/lib/circularBuffer.ts` - Bounded rolling buffer used for temporal memory and monitoring windows.

### `testing-core/src/ml/`

- `testing-core/src/ml/domHasher.ts` - DOM/state hashing helpers for fingerprints and repetition detection.
- `testing-core/src/ml/payloadSynthesizer.ts` - Generates payload variants for fuzz/security scenarios.
- `testing-core/src/ml/perceptron.ts` - Lightweight perceptron-style scoring/model experimentation utility.

### `testing-core/src/payloads/`

- `testing-core/src/payloads/chaosData.ts` - Mutation token and chaotic input source for fuzzing scenarios.

### `testing-core/src/presentation/`

- `testing-core/src/presentation/api/authController.ts` - Auth endpoint handlers for signup/login/user session operations.
- `testing-core/src/presentation/api/authMiddleware.ts` - Middleware that validates auth tokens and protects API paths.
- `testing-core/src/presentation/api/registerRoutes.ts` - Registers HTTP endpoints for health, auth, history, and run control.
- `testing-core/src/presentation/socket/registerSocketHandlers.ts` - Registers real-time socket control and telemetry handlers.

---

## End-to-End Wiring

1. Operator authenticates or enters the dashboard through `AuthGuard`, `LoginForm`, or `SignupForm`.
2. `App.tsx` and `useDashboardController.ts` connect dashboard actions to `SocketHttpEngineGateway`.
3. HTTP routes and socket handlers in `testing-core/src/presentation/` receive run commands.
4. `StartExplorationUseCase` initializes run state, browser automation, telemetry, and domain services.
5. `AutonomousExplorationEngine` coordinates candidate discovery, risk scoring, scenarios, monitoring, and findings.
6. Bug finders and stress adapters convert scenario evidence into structured findings.
7. Monitoring, database, socket, and binary-frame infrastructure persist and stream results back to the dashboard.
