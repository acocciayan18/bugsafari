# BugSafari Codebase Documentation

This document is the architectural narrative companion to `ALL_FILES_CODEBASE.md`.

- `ALL_FILES_CODEBASE.md` answers: **where modules are and what each module does**
- `CODEBASE_DOCUMENTATION.md` answers: **why the architecture exists and how behavior flows end-to-end**

---

## 1) Soul of BugSafari (The Why)

BugSafari exists to automate adversarial exploration of web applications and convert runtime chaos into actionable engineering evidence.

Its design intent is built around three outcomes:

1. **Find issues humans miss manually** by running sustained, strategy-driven exploratory behavior.
2. **Preserve explainability** by emitting milestones, traces, and reproduction artifacts—not just pass/fail signals.
3. **Close feedback loops quickly** by streaming real-time telemetry into an operator dashboard.

This is why the codebase is split into:
- an operator-facing **Watchtower** (`developer-dashboard`)
- an autonomous execution core with detectors (**Intelligence + Arsenal**) (`testing-core`)
- a shared contract bridge (`shared`)

---

## 2) Three Pillars Narrative

## Pillar A — Intelligence (Understanding and Decisioning)

**Primary home:** `testing-core/src/domain` and parts of `testing-core/src/application`

Intelligence is responsible for:
- extracting interaction surfaces from DOM state,
- scoring/prioritizing targets,
- remembering structural state to avoid blind repetition,
- selecting next actions strategically.

Key modules in this pillar:
- Heuristics: `domain/heuristics/domParser.ts`
- Domain services: `AutonomousExplorationEngine.ts`, `RiskScorer.ts`
- Decision strategy support: `domain/scenarios/smartAttacker.ts`

**Why this pillar exists:**  
Without a decision layer, automation is random click replay. Intelligence turns raw DOM and feedback into guided exploration.

---

## Pillar B — Arsenal (Execution and Attack Surface Probing)

**Primary home:** `testing-core/src/domain/scenarios`, `testing-core/src/bugs`, `testing-core/src/payloads`, `testing-core/src/ml`

Arsenal is responsible for:
- executing stress/fuzz scenarios,
- probing boundary and validation assumptions,
- adapting scenario outputs into detector-friendly evidence,
- classifying suspicious behavior into structured findings.

Key modules in this pillar:
- Scenario library: `rapidClickerStress`, `dataFuzzer`, `routeTrasher`, `networkSaboteur`, `formBypasser`, `securityVulnerabilityScout`, etc.
- Detection layer: `bugs/finders/*`
- Bridging logic: `bugs/scenarioAdapters.ts`, `bugs/stressAdapters/*`
- Input generation helpers: `payloads/chaosData.ts`, `ml/payloadSynthesizer.ts`

**Why this pillar exists:**  
Discovery quality depends on diversity of behavior. Arsenal gives Intelligence multiple attack vectors and evidence-producing probes.

---

## Pillar C — Watchtower (Visibility and Human Control)

**Primary home:** `developer-dashboard/src` and backend monitoring/presentation adapters

Watchtower is responsible for:
- accepting operator intent (target/run controls),
- displaying live telemetry and milestones,
- presenting forensic traces and reproduction paths,
- keeping humans in the loop while automation runs continuously.

Key modules in this pillar:
- **Primary composite dashboard:** `ClinicalForensicsDashboard.tsx` — unified operator surface combining sidebar navigation, target control panel, live feed viewport, and multi-tab terminal
- Authentication components (`LoginForm`, `SignupForm`)
- UI components (`ControlPanel`, `TelemetryStream`, `ForensicTrail`, `ReproductionTrail`, `LiveFeed`, `SessionHistoryTable`, `ThinkingIndicator`, `ThoughtStream`, `Sidebar`)
- UI orchestration hook (`useDashboardController.ts`)
- Gateway adapter (`SocketHttpEngineGateway.ts`)
- Backend telemetry and socket infrastructure (`infrastructure/monitoring/*`, `presentation/socket/*`)

**Why this pillar exists:**  
Automation without observability becomes untrustworthy. Watchtower makes findings inspectable, traceable, and operationally useful.

---

## 3) DDD and Layered Architectural Context

BugSafari’s backend (`testing-core`) follows a layered pattern close to DDD-style boundaries.

## Domain Layer (`testing-core/src/domain`)
Contains business behavior independent of transport/framework:
- entities (interactive element model),
- heuristics and scoring logic,
- scenarios,
- core orchestration services.

**Rule:** Domain expresses exploration intelligence and behavior policy; it should not depend on HTTP/socket mechanics.

## Application Layer (`testing-core/src/application`)
Coordinates use-cases and lifecycle:
- starts/stops runs,
- sequences domain services,
- depends on abstractions (ports), not concrete frameworks.

**Rule:** Application decides *when* domain behavior executes and through which abstract capabilities.

## Infrastructure Layer (`testing-core/src/infrastructure`)
Implements technical adapters:
- Playwright browser engine,
- socket telemetry gateway,
- monitoring buffers/stores/emitters.

**Rule:** Infrastructure satisfies ports and operational concerns; it does not own business intent.

## Presentation Layer (`testing-core/src/presentation`)
Exposes interfaces to outside actors:
- HTTP route registration,
- socket event handler registration.

**Rule:** Presentation maps external requests/events into application use-cases.

---

## 4) Wiring: End-to-End Control and Data Flow

## Flow A — Run Startup (Command Path)

1. Operator enters target URL and clicks "INITIALIZE EXPLORATORY SAFARI" in `ClinicalForensicsDashboard.tsx`.
2. `useDashboardController.ts` normalizes intent and invokes `EngineGateway`.
3. `SocketHttpEngineGateway.ts` sends HTTP start request to backend route.
4. Backend presentation (`registerRoutes.ts`) forwards to `StartExplorationUseCase.ts`.
5. Use-case initializes lifecycle services (`runController`, `stackManager`) and domain engine.
6. Autonomous loop starts.

**Outcome:** A controlled, traceable run begins from explicit human intent.

---

## Flow B — Autonomous Exploration Loop (Execution Path)

1. Domain parser extracts interactive elements from current state.
2. Scoring heuristics rank candidates.
3. Smart strategy selects scenario/action path.
4. Interaction simulator executes selected operations through browser engine adapter.
5. Structural hash/memory and guards evaluate state transitions and boundaries.
6. Loop repeats with updated telemetry and state context.

**Outcome:** Stateful exploration that adapts instead of blindly repeating actions.

---

## Flow C — Detection and Evidence (Analysis Path)

1. Scenario outputs and runtime signals are fed through stress adapters.
2. Finder modules classify patterns (sanitization gaps, race conditions, stability faults, etc.).
3. Findings are normalized via bug contracts.
4. Reproduction and forensic modules persist actionable traces.

**Outcome:** Raw runtime behavior becomes structured bug intelligence.

---

## Flow D — Telemetry Return (Observability Path)

1. Milestones/actions/exceptions/findings are emitted via telemetry gateway.
2. Socket infrastructure broadcasts events to connected dashboard clients.
3. Dashboard components update live (timeline, milestones, forensic/reproduction trails, feed).
4. Operator observes progress and can intervene/control subsequent runs.

**Outcome:** Closed loop between autonomous execution and human decision-making.

---

## 5) Package-Level Responsibilities and Boundaries

## `developer-dashboard/`
- Owns operator experience and runtime observability.
- Depends on backend contracts and transport gateways.
- Should not implement backend exploration logic.

## `testing-core/`
- Owns autonomous exploration, scenario execution, detection, and telemetry emission.
- Exposes control/stream interfaces via presentation adapters.
- Should not contain UI rendering responsibilities.

## `shared/`
- Owns cross-package contract stability.
- Minimizes semantic drift between producer (engine) and consumer (dashboard).

---

## 6) Why This Split Works Operationally

This architecture intentionally optimizes for:
- **Autonomy:** domain + scenario engine can run deep explorations.
- **Safety/Control:** application services and guards constrain behavior.
- **Observability:** monitoring + socket stream turns opaque runs into inspectable evidence.
- **Extensibility:** new scenarios/finders/adapters can be added without rewriting UI or transport surfaces.
- **Team parallelism:** frontend, domain logic, and infrastructure can evolve with clear boundaries.

---

## 7) Reading Path for New Contributors

Recommended order for understanding the system quickly:

1. `testing-core/src/index.ts` and `presentation/*` (entrypoints and interfaces)
2. `application/useCases/StartExplorationUseCase.ts` (run orchestration)
3. `domain/services/AutonomousExplorationEngine.ts` + heuristics/scenarios (core behavior)
4. `bugs/*` + monitoring modules (detection and evidence)
5. `developer-dashboard/src/application/useCases/useDashboardController.ts` + components (operator-facing loop)
6. `shared/types.ts` (contract language binding both sides)

---

## 8) Relationship to Other Docs

- `BUGSAFARI_BLUEPRINT.md` captures strategic architecture principles and design direction.
- `ALL_FILES_CODEBASE.md` provides module-by-module narrative references.
- This file (`CODEBASE_DOCUMENTATION.md`) provides the system-level intent and wiring map connecting those details into a coherent mental model.
