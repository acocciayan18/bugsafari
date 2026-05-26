# ALL_FILES_CODEBASE.md

Canonical list of source files currently present in this repo.

- Included extensions: `*.ts`, `*.tsx`, `*.js`, `*.jsx`
- Included areas: `developer-dashboard/`, `testing-core/`, `shared/` and their subdirectories
- Excluded: `node_modules/`, `.git/`, build output dirs (`dist/`, `build/`)

> Note: Descriptions here are best-effort and may be brief. This file is intended to help humans quickly locate modules.

---

## developer-dashboard/

### `developer-dashboard/package.json`
Vite + React configuration and scripts.

### `developer-dashboard/index.html`
Vite entry HTML.

### `developer-dashboard/src/main.tsx`
React entrypoint (mounts the app).

### `developer-dashboard/src/App.tsx`
Main UI container.
- Maintains connection/test state
- Connects to Socket.IO telemetry stream
- Triggers engine via HTTP `POST /api/start-test`

### `developer-dashboard/src/types.ts`
Frontend-side telemetry/type definitions (mirrors backend contracts).

### `developer-dashboard/src/utils/engineControl.ts`
Helpers for controlling/starting/stopping engine sessions.

### `developer-dashboard/src/utils/semanticInstructionMapper.ts`
Maps semantic instruction labels into engine actions/instructions.

### `developer-dashboard/src/components/ControlPanel.tsx`
URL input + launch controls.

### `developer-dashboard/src/components/TelemetryStream.tsx`
Renders telemetry timeline.

### `developer-dashboard/src/components/LiveFeed.tsx`
Displays live screenshot frames received from the engine.

### `developer-dashboard/src/components/ForensicTrail.tsx`
Renders reproduction/forensics trail from stored crash/playbook data.

### `developer-dashboard/src/components/ReproductionTrail.tsx`
Renders reproduction steps trail for a found issue.

---


## shared/

### `shared/types.ts`
Shared telemetry and element discovery contracts.
- Telemetry event/meta structures
- Discovered element structures

---

## testing-core/

### `testing-core/package.json`
Backend package scripts/config.

### `testing-core/tsconfig.json`
TypeScript configuration.

### `testing-core/src/index.ts`
Engine server bootstrap.
- Express app + routes (`/api/health`, `/api/start-test`)
- Socket.IO telemetry server
- Runs one exploration session at a time

### `testing-core/src/serverUtils.ts`
Server utilities (port parsing, validation, helpers).

### `testing-core/src/contracts.ts`
Internal engine contracts for telemetry and discovery.

---

## testing-core/src/application/

### `testing-core/src/application/ports/BrowserEngine.ts`
Port interface for driving a browser engine.

### `testing-core/src/application/ports/TelemetryGateway.ts`
Port interface for emitting telemetry.

### `testing-core/src/application/useCases/StartExplorationUseCase.ts`
Use-case that orchestrates starting an exploration run.

---

## testing-core/src/domain/

### `testing-core/src/domain/entities/InteractiveElement.ts`
Domain entity for representing an interactive element and its features.

### `testing-core/src/domain/services/AutonomousExplorationEngine.ts`
Domain service that runs autonomous exploration and dispatches actions.

### `testing-core/src/domain/services/ElementScorer.ts`
Service responsible for scoring/ranking discovered elements.

### `testing-core/src/domain/services/InteractionSimulator.ts`
Service responsible for simulating user interactions on a target element.

### `testing-core/src/domain/services/RecursiveDomParser.ts`
DOM parsing utilities (recursive parsing / element extraction).

### `testing-core/src/domain/services/StructuralHashManager.ts`
Creates/maintains structural hashes for DOM/state repetition detection.

---

## testing-core/src/bugs/

### `testing-core/src/bugs/registry.ts`
Registers bug finders.

### `testing-core/src/bugs/types.ts`
Bug framework contracts.

### `testing-core/src/bugs/scenarioAdapters.ts`
Adapter functions used by bug finders to perform payload injection and constraint stripping.

### `testing-core/src/bugs/finders/inputSanitization.ts`
Bug finder for `INPUT_SANITIZATION_FAILURE`.

### `testing-core/src/bugs/finders/clientSideBypass.ts`
Bug finder for `CLIENT_SIDE_CONSTRAINT_BYPASS`.

### `testing-core/src/bugs/finders/noSqlInjection.ts`
Bug finder for `NOSQL_INJECTION`.

### `testing-core/src/bugs/finders/spaRaceConditions.ts`
Bug finder for `SPA_STATE_RACE_CONDITION`.

### `testing-core/src/bugs/finders/structuralNavigation.ts`
Bug finder for `STRUCTURAL_NAVIGATION_LOGIC`.

### `testing-core/src/bugs/finders/runtimeStability.ts`
Bug finder for `RUNTIME_STABILITY_EXCEPTION`.

### `testing-core/src/bugs/finders/boundaryStress.ts`
Bug finder for `BOUNDARY_STRESS_FAILURE`.

---

## testing-core/src/bugs/stressAdapters/

### `testing-core/src/bugs/stressAdapters/index.ts`
Re-exports stress adapter entry points.

### `testing-core/src/bugs/stressAdapters/concurrentStress.ts`
Concurrent stress adapter.

### `testing-core/src/bugs/stressAdapters/structuralProbe.ts`
Structural navigation probe adapter.

### `testing-core/src/bugs/stressAdapters/boundaryOverload.ts`
Boundary overload probe adapter.

---

## testing-core/src/engine/

### `testing-core/src/engine/runController.ts`
Run controller for orchestrating a session.

### `testing-core/src/engine/stackManager.ts`
Action/step stack management utilities.

### `testing-core/src/engine/autonomousLoop.ts`
Main autonomous loop (discover -> score -> act -> observe -> feedback).

### `testing-core/src/engine/domainGuard.ts`
Target-domain enforcement and external navigation blocking/restoration.

---

## testing-core/src/heuristics/

### `testing-core/src/heuristics/domParser.ts`
Discovers interactive elements and derives selectors/features.

### `testing-core/src/heuristics/hashUtils.ts`
Structural fingerprinting and state repetition support.

### `testing-core/src/heuristics/scorer.ts`
Element scoring and semantic-role classification.

---

## testing-core/src/payloads/

### `testing-core/src/payloads/chaosData.ts`
Token-based mutated payload generator.

---

## testing-core/src/presentation/

### `testing-core/src/presentation/http/registerRoutes.ts`
Registers HTTP routes for the engine server.

### `testing-core/src/presentation/socket/registerSocketHandlers.ts`
Registers Socket.IO handlers.

---

## testing-core/src/reporters/

### `testing-core/src/reporters/socketServer.ts`
Socket.IO telemetry hub and frame emission.

### `testing-core/src/reporters/actionBuffer.ts`
Circular buffer storing action history + reproduction steps.

### `testing-core/src/reporters/exceptionCatcher.ts`
Attaches browser exception/network monitoring and converts them into telemetry.

### `testing-core/src/reporters/reproductionPlaybookStore.ts`
Stores and retrieves reproduction/playbook info for forensic display.

### `testing-core/src/reporters/engineMilestones.ts`
Defines engine milestone tracking/aggregation types/state for the dashboard.

### `testing-core/src/reporters/engineMilestoneEmitter.ts`
Emits milestone updates over Socket.IO to support live progress UI.

### `testing-core/src/reporters/engineMilestones.ts`
Defines engine milestone tracking/aggregation types/state for the dashboard.

---

## testing-core/src/scenarios/

### `testing-core/src/scenarios/formBypasser.ts`
Constraint stripping + form submission helpers.

### `testing-core/src/scenarios/dataFuzzer.ts`
Generates mutated input and performs fuzzing interactions.

### `testing-core/src/scenarios/buttonSpammer.ts`
Rapid click spam scenario.

### `testing-core/src/scenarios/concurrentClicker.ts`
Concurrency helpers for burst clicking.

### `testing-core/src/scenarios/routeTrasher.ts`
Route disruption scenario (goBack/goForward/reload loops).

### `testing-core/src/scenarios/smartAttacker.ts`
Chooses an action strategy (fuzz vs click) for candidate targets.

