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

`shared/types.ts` is a barrel re-export over `shared/types/*.ts` so dashboard and engine reason over the same event and payload shapes without importing a single monolithic file.

---

## Current File Inventory

Generated from the current repository tree on July 12, 2026.

### `shared/`

- `shared/types.ts` - Barrel re-export of all domain-split shared contracts below; existing relative imports keep working unchanged.
- `shared/types/telemetry.ts` - Telemetry envelope, action/incident/session-snapshot, and live-stream event contracts.
- `shared/types/bug.ts` - Bug class, finding, and evidence contracts shared by finders and the dashboard.
- `shared/types/testingType.ts` - Testing-type IDs, the Infiltration Profile catalog, and optimization-settings defaults.
- `shared/types/regression.ts` - Verify-Fix (regression replay) request/result/progress contracts.
- `shared/types/session.ts` - Session ownership, lifecycle status, and attach/reconnect contracts.
- `shared/types/explainability.ts` - Decision-rationale/explainability payload contracts for the Decision Lens panel.

### `developer-dashboard/` - Vite/React App Surface

- `developer-dashboard/eslint.config.js` - ESLint configuration for dashboard linting.
- `developer-dashboard/postcss.config.js` - PostCSS/Tailwind processing configuration.
- `developer-dashboard/vite.config.ts` - Vite development/build configuration.
- `developer-dashboard/src/main.tsx` - React browser entrypoint that mounts the app shell.
- `developer-dashboard/src/App.tsx` - Main entry hub: React Router routes, AuthProvider wrapping, and auth-aware app content composition.
- `developer-dashboard/src/types.ts` - UI-local type models; re-exports shared telemetry/testing-type types plus dashboard-only forensic-report and user-settings shapes.

### `developer-dashboard/src/application/`

- `developer-dashboard/src/application/ports/EngineGateway.ts` - Dashboard-facing transport contract for engine commands and subscriptions.
- `developer-dashboard/src/application/useCases/useDashboardController.ts` - Main orchestration hook translating user actions into engine calls and render state; owns the unified `TestSessionStatus` lifecycle mapping.
- `developer-dashboard/src/application/useCases/useRegressionVerifier.ts` - "Verify Fix" client hook; owns a dedicated Socket.IO connection to request a deterministic regression replay and stream per-bug verify progress/verdict.

### `developer-dashboard/src/components/auth/`

- `developer-dashboard/src/components/auth/AuthGuard.tsx` - Protects authenticated dashboard areas and coordinates auth state before rendering children.
- `developer-dashboard/src/components/auth/LoginForm.tsx` - Login form authenticating users and storing session credentials via AuthContext.
- `developer-dashboard/src/components/auth/SignupForm.tsx` - Signup form for creating user accounts against backend auth endpoints.
- `developer-dashboard/src/components/auth/ForgotPasswordForm.tsx` - Requests a password-reset email.
- `developer-dashboard/src/components/auth/ResetPasswordForm.tsx` - Consumes a reset token to set a new password.
- `developer-dashboard/src/components/auth/index.ts` - Barrel export for the auth component group.

### `developer-dashboard/src/components/common/`

- `developer-dashboard/src/components/common/LiveFeed.tsx` - Industrial-viewport canvas renderer for the live visual frame stream, object-fit-cover scaled to native resolution.
- `developer-dashboard/src/components/common/SessionTimer.tsx` - Countdown/progress-ring component for the run time box; ticks locally, reseeds from backend-authoritative remaining time.
- `developer-dashboard/src/components/common/ConnectionStatusOverlay.tsx` - Global non-modal banners for disconnect/reconnecting/restoring connection states.
- `developer-dashboard/src/components/common/InfiltrationProfileSelector.tsx` - Picker for the four named Unified Infiltration Profiles (replaces a raw scenario checklist).
- `developer-dashboard/src/components/common/TestingTypeSelector.tsx` - Operator-gated scenario checklist matrix for custom infiltration profiles.
- `developer-dashboard/src/components/common/ForensicCardKit.tsx` - Shared building blocks (copy button, expandable code block, attribution badges, suggested-fix block) used by both the live Errors Tab and the saved Forensic Report.
- `developer-dashboard/src/components/common/RowActionMenu.tsx` - Three-dot action dropdown for forensic history records.
- `developer-dashboard/src/components/common/DeleteConfirmDialog.tsx` - Confirmation modal for destructive delete actions.
- `developer-dashboard/src/components/common/HelpMenuIcon.tsx` - Help/support menu with severity-level docs and quick links.
- `developer-dashboard/src/components/common/SupportModal.tsx` - Support-ticket collection modal (subject + description).

### `developer-dashboard/src/components/forensics/`

- `developer-dashboard/src/components/forensics/ClinicalForensicsDashboard.tsx` - Purified telemetry-only view: live feed plus tabbed terminal (telemetry/errors/network/console/decision-lens); no auth/sidebar/control-panel concerns.
- `developer-dashboard/src/components/forensics/ForensicReport.tsx` - Full-screen saved-session forensic report: executive summary, AI insights, per-finding cards with Verify Fix control, and a raw action-timeline appendix.
- `developer-dashboard/src/components/forensics/ForensicTrail.tsx` - Displays captured forensic breadcrumbs, failures, and diagnostic traces.

### `developer-dashboard/src/components/history/`

- `developer-dashboard/src/components/history/SavedEvaluationSafaris.tsx` - Forensic history page: lists, sorts, filters, paginates, and bulk-deletes saved safari runs.
- `developer-dashboard/src/components/history/CoverageProgressBar.tsx` - Color-coded, animated coverage-percentage progress bar plus a compact `CoverageDisplay` variant.
- `developer-dashboard/src/components/history/ReproductionTrail.tsx` - Presents reproducible step sequences for validating discovered issues.

### `developer-dashboard/src/components/layout/`

- `developer-dashboard/src/components/layout/Sidebar.tsx` - Navigation-only sidebar shell (light/dark aware).
- `developer-dashboard/src/components/layout/SidebarLayout.tsx` - Shared sidebar + content shell that eliminates duplicated layout wrapping across routes.

### `developer-dashboard/src/components/settings/`

- `developer-dashboard/src/components/settings/Settings.tsx` - Application settings page; single source of truth via `useUserSettings`, guest-mode localStorage vs authenticated backend sync, dark-mode bridging.

### `developer-dashboard/src/components/telemetry/`

- `developer-dashboard/src/components/telemetry/TelemetryStream.tsx` - Real-time telemetry timeline for live situational awareness.
- `developer-dashboard/src/components/telemetry/TelemetryLogStream.tsx` - Scrollable structured log view of the telemetry stream.
- `developer-dashboard/src/components/telemetry/ErrorTabPanel.tsx` - Live Errors tab; wraps ForensicCardKit for confirmed-bug cards.
- `developer-dashboard/src/components/telemetry/NetworkTabPanel.tsx` - Live Network tab showing request/response telemetry.
- `developer-dashboard/src/components/telemetry/ConsoleTabPanel.tsx` - Live browser console tab.
- `developer-dashboard/src/components/telemetry/AiDiagnosticCard.tsx` - Unified AI-generated vulnerability diagnostic card shared by TelemetryStream and TelemetryLogStream.
- `developer-dashboard/src/components/telemetry/DecisionLensPanel.tsx` - Glass-box ML decision-explainability panel rendering per-feature attribution behind each autonomous target pick (single-layer perceptron logit breakdown).
- `developer-dashboard/src/components/telemetry/ReproductionChecklist.tsx` - Sequentially numbered reproduction-steps checklist renderer.
- `developer-dashboard/src/components/telemetry/index.ts` - Barrel export for the telemetry component group.

### `developer-dashboard/src/components/ui/`

- `developer-dashboard/src/components/ui/Button.tsx` - Shared styled button primitive.
- `developer-dashboard/src/components/ui/Card.tsx` - Shared card container primitive.
- `developer-dashboard/src/components/ui/Badge.tsx` - Shared status/severity badge primitive.
- `developer-dashboard/src/components/ui/Input.tsx` - Shared styled input primitive.
- `developer-dashboard/src/components/ui/Modal.tsx` - Shared accessible modal primitive.
- `developer-dashboard/src/components/ui/index.ts` - Barrel export for the design-system primitives.

### `developer-dashboard/src/components/control-panel/`

- `developer-dashboard/src/components/control-panel/CommandCenter.tsx` - Brutalist 3-row command center (header controls / target-URL input / workspace grid) that starts, pauses, and stops runs and selects the infiltration profile.

### `developer-dashboard/src/components/icons/`

- `developer-dashboard/src/components/icons/index.ts` - Barrel export of shared inline SVG icon components.

### `developer-dashboard/src/context/`

- `developer-dashboard/src/context/AuthContext.tsx` - Centralized auth-state provider: synchronous token validation on init, login/logout/refresh, guest fallback.
- `developer-dashboard/src/context/DarkModeContext.tsx` - Dark/light theme state provider for the main app shell.
- `developer-dashboard/src/context/index.ts` - Barrel export for the context providers.

### `developer-dashboard/src/designs/` - Marketing/Landing UI Layer

A self-contained pre-auth landing-page and themed sliding-auth surface, distinct from the operator dashboard.

- `developer-dashboard/src/designs/LandingPage.tsx` - Public marketing landing page (feature cards, deep-trace checks) that routes into the auth flow.
- `developer-dashboard/src/designs/SlidingAuthForm.tsx` - Themed sliding login/signup panel used from the landing page.
- `developer-dashboard/src/designs/ThemeContext.tsx` - NovaSpark color-palette provider (retro/pastel) scoped to the designs/landing layer.
- `developer-dashboard/src/designs/components/GradientBlinds.tsx` / `ChromaGrid.tsx` / `CircularGallery.tsx` / `FlowingMenu.tsx` / `MagicBento.tsx` - Decorative animated background/gallery/menu components used across the landing page.
- `developer-dashboard/src/designs/icons/*.tsx` (ChevronDownIcon, DatabaseIcon, EyeIcon, EyeSlashIcon, ForensicHelpIcon, GearIcon, InformationCircleIcon, LockClosedIcon, ShieldIcon, UserIcon, WarningIcon) - Icon set scoped to the designs/landing layer; `index.ts` barrels them.

### `developer-dashboard/src/hooks/`

- `developer-dashboard/src/hooks/useAuth.ts` - Authentication state hook for login/signup/logout/session persistence.
- `developer-dashboard/src/hooks/useUserSettings.ts` - Settings CRUD hook; guest localStorage vs authenticated backend sync.
- `developer-dashboard/src/hooks/useDismissableLayer.ts` - Reusable outside-click/escape dismissal behavior for menus and popovers.

### `developer-dashboard/src/infrastructure/`

- `developer-dashboard/src/infrastructure/engine/SocketHttpEngineGateway.ts` - Facade composing the HTTP client and socket connection manager below into the `EngineGateway` surface consumers already depend on.
- `developer-dashboard/src/infrastructure/engine/gateway/EngineHttpClient.ts` - REST/HTTP routines for the engine gateway (start/save/history, HTTP force-stop fallback); owns the auth token.
- `developer-dashboard/src/infrastructure/engine/gateway/SocketConnectionManager.ts` - Socket.IO lifecycle and event binding/dispatch (telemetry, frames, forensic/incident reports, reconnection, session snapshot/decision-rationale events).
- `developer-dashboard/src/infrastructure/notifications/ToastProvider.tsx` - Toast context/provider and custom toast UI (built on `sonner`).
- `developer-dashboard/src/infrastructure/socket/BinaryFrameReceiver.ts` - Binary frame receiver/parser for live visual feed payloads.

### `developer-dashboard/src/services/`

- `developer-dashboard/src/services/historyService.ts` - Client-side API service for retrieving and shaping historical session/evaluation data.

### `developer-dashboard/src/utils/`

- `developer-dashboard/src/utils/engineControl.ts` - Run-control helper logic used by dashboard orchestration.
- `developer-dashboard/src/utils/semanticInstructionMapper.ts` - Maps human/operator intent into engine-consumable instruction semantics.
- `developer-dashboard/src/utils/semanticFormatter.ts` - Formats raw telemetry/finding data into human-readable summary text.
- `developer-dashboard/src/utils/findingsBuilder.ts` - Builds the saved-history findings array verbatim from the live incidents/crash reports the operator saw, so Live and History views match exactly.
- `developer-dashboard/src/utils/errorDeduplication.ts` - Collapses the incident+forensic pair emitted for one runtime fault into a single card so live count, engine count, and stored history stay 1:1.
- `developer-dashboard/src/utils/authHeaders.ts` - Pure helper building fetch `Authorization`/`Content-Type` headers; single source of truth replacing per-module reimplementations.
- `developer-dashboard/src/utils/authRefresh.ts` - Framework-agnostic silent token refresh shared by AuthContext and non-hook modules (historyService, EngineHttpClient).
- `developer-dashboard/src/utils/tokenUtils.ts` - Pure JWT parsing helpers (extracted from AuthContext, no React dependency).
- `developer-dashboard/src/utils/settingsStorage.ts` - Guest-mode localStorage persistence for user settings.

---

## `testing-core/` - Backend Runtime Surface

- `testing-core/playwright.config.ts` - Playwright configuration for backend/browser automation testing.
- `testing-core/src/index.ts` - Main backend process bootstrap: Express + Socket.IO server, CORS/auth wiring, database connection gate, route/socket registration, optional queue-backed worker fleet, graceful shutdown.
- `testing-core/src/serverUtils.ts` - Server/runtime helper functions (port resolution, target-URL parsing/resolution) for startup and environment handling.
- `testing-core/src/types.ts` - Engine-local type aliases and runtime models.
- `testing-core/src/worker-entry.ts` - Worker entrypoint for isolated safari/exploration execution.

### `testing-core/src/application/`

- `testing-core/src/application/ports/BrowserEngine.ts` - Browser automation abstraction implemented by Playwright infrastructure.
- `testing-core/src/application/ports/TelemetryGateway.ts` - Telemetry transport abstraction implemented by socket infrastructure.
- `testing-core/src/application/services/SessionManager.ts` - Centralized session/reconnection manager: attach/detach, reconnect replay buffer, pause/resume/stop control surface, wires `TargetHealthMonitor`.
- `testing-core/src/application/services/TargetHealthMonitor.ts` - Periodic out-of-loop reachability probe for the system-under-test; escalates sustained unreachability to a Critical Server Crash that terminates the run.
- `testing-core/src/application/useCases/StartExplorationUseCase.ts` - Use-case that validates a start command and initializes autonomous exploration.

### `testing-core/src/bugs/`

- `testing-core/src/bugs/scenarioAdapters.ts` - Bridges scored/interactive elements and fuzz/bypass scenario outputs into detector-friendly attack-profile shapes.
- `testing-core/src/bugs/types.ts` - Contracts for findings, evidence, `BugFinder`, detector inputs, and finder outputs.

### `testing-core/src/bugs/finders/`

- `testing-core/src/bugs/finders/concurrentStress.ts` - Detects race/deadlock signals from rapid concurrent interaction stress; reads the active ChaosTransactionManager via an injected accessor.
- `testing-core/src/bugs/finders/fuzzGuard.ts` - Detects unsafe input handling (XSS/injection/crash signals) surfaced by fuzz payload injection.
- `testing-core/src/bugs/finders/noSqlInjection.ts` - Detects NoSQL-injection-like response and behavior patterns.
- `testing-core/src/bugs/finders/reflectionOracle.ts` - Confirms genuine XSS execution (not mere tag-presence) via a per-injection nonce witness that only flips when an injected script sink actually fires.
- `testing-core/src/bugs/finders/index.ts` - Registry of finders executed by BugFinderRunner, plus the chaos-manager accessor re-exports.
- `testing-core/src/bugs/finders/spaRaceConditions.ts` - Fires a concurrent event burst and reports only on post-burst damage (client crash or stuck loading state).
- `testing-core/src/bugs/finders/structuralProbe.ts` - Detects structural probing faults tied to the active chaos transaction.

### `testing-core/src/bugs/knowledgeBase/` - Centralized Forensic Knowledge Base

- `testing-core/src/bugs/knowledgeBase/index.ts` - Barrel export: single source of truth for expected bugs, runtime signals, per-scenario validation, and the deterministic classifier.
- `testing-core/src/bugs/knowledgeBase/bugCatalog.ts` - Canonical bug definitions: title, description, default severity, CWE id, and remediation snippet per `BugClass`.
- `testing-core/src/bugs/knowledgeBase/scenarioCatalog.ts` - Maps each stress scenario to the bug classes it is expected to provoke and the signal categories that validate them.
- `testing-core/src/bugs/knowledgeBase/signalPatterns.ts` - Consolidated regex/selector signature library for runtime-fault signal categories (previously duplicated across finder modules).
- `testing-core/src/bugs/knowledgeBase/FaultClassifier.ts` - Pure, side-effect-free classifier resolving a caught fault to its `BugClass`/severity/CWE/remediation and scenario attribution.

### `testing-core/src/domain/`

- `testing-core/src/domain/entities/InteractiveElement.ts` - Domain entity for normalized interactive targets discovered from the DOM.
- `testing-core/src/domain/repositories/FindingRepository.ts` - Repository contract for storing and retrieving findings.

### `testing-core/src/domain/chaos/`

- `testing-core/src/domain/chaos/ChaosTransactionManager.ts` - Generalized transaction layer for the stress-testing arsenal; tracks open/closed chaos contexts (FUZZ/NETWORK/STRESS_CLICK/ROUTE_TRASH/VULN_SCOUT/ASYNC_RACE) with scenario-specific metadata, used by finders to attribute a fault to the exact chaos action that caused it.
- `testing-core/src/domain/chaos/index.ts` - Barrel export for the chaos transaction layer's types/manager.

### `testing-core/src/domain/heuristics/`

- `testing-core/src/domain/heuristics/domParser.ts` - Recursive DOM parser producing actionable interaction candidates, with depth limits and visibility/overlay/anti-weight-expansion filtering.
- `testing-core/src/domain/heuristics/AccessibilityAuditor.ts` - Bounded-ledger DOM accessibility scan (unlabeled controls, contrast, ARIA) with dedup accounting.

### `testing-core/src/domain/scenarios/`

- `testing-core/src/domain/scenarios/index.ts` - Stress-scenario registry factory; wires a shared `ChaosTransactionManager` into each scenario and exposes `stressScenarioMap`/`createStressScenarioRegistry` plus re-exports of the fuzzing strategy library.
- `testing-core/src/domain/scenarios/types.ts` - Shared `StressScenario` and related contracts.
- `testing-core/src/domain/scenarios/formBypasser.ts` - Scenario stripping client-side validation constraints to probe server-side enforcement.
- `testing-core/src/domain/scenarios/networkSaboteur.ts` - Network disruption/latency/error-behavior probing scenario.
- `testing-core/src/domain/scenarios/asyncStateRacer.ts` (+`.test.ts`) - Interrupts in-flight async operations to surface teardown races, swallowed rejections, and lifecycle inconsistencies.
- `testing-core/src/domain/scenarios/seededRandom.ts` (+`.test.ts`) - Module-global mulberry32 seeded PRNG shared by every fuzz strategy/saboteur so a run seed reproduces its exact payload sequence.

### `testing-core/src/domain/scenarios/fuzzing/`

- `testing-core/src/domain/scenarios/fuzzing/dataFuzzer.ts` - Core mutated-payload fuzzing scenario; owns the injected `ChaosTransactionManager` accessor and per-step telemetry wrapper.
- `testing-core/src/domain/scenarios/fuzzing/elementClassifier.ts` - Classifies input elements into field categories (email/date/numeric/text/etc.) to select the right payload strategy.
- `testing-core/src/domain/scenarios/fuzzing/payloadEscalator.ts` - Escalates payload aggressiveness across repeated attempts on the same field.
- `testing-core/src/domain/scenarios/fuzzing/strategies/index.ts` - Barrel export of all fuzzing payload strategies.
- `testing-core/src/domain/scenarios/fuzzing/strategies/emailStrategy.ts` / `dateStrategy.ts` / `jsonStrategy.ts` / `numericBoundaryStrategy.ts` / `xssVectorStrategy.ts` / `noSqlInjectionStrategy.ts` - Category-specific payload generators + vector detectors.
- `testing-core/src/domain/scenarios/fuzzing/strategies/chaosFallbackStrategy.ts` - Generic chaotic-input fallback (zero-width/formatting corruptors, combining-Unicode "Zalgo" text, multi-byte surrogate pairs, binary/control-character encodings) for fields no specific strategy classifies.

### `testing-core/src/domain/scenarios/rapidClicker/`

- `testing-core/src/domain/scenarios/rapidClicker/index.ts` - Barrel export of rapid-clicker scenarios, the concurrency primitive, `InteractionSimulator`, and shared utils/types.
- `testing-core/src/domain/scenarios/rapidClicker/buttonSpammer.ts` - High-frequency repeated-click stress scenario.
- `testing-core/src/domain/scenarios/rapidClicker/coordinateBombing.ts` - Zero-wait concurrent click-burst scenario at fixed coordinates.
- `testing-core/src/domain/scenarios/rapidClicker/concurrentBurst.ts` - Concurrency primitive firing overlapping interactions without waiting for settle.
- `testing-core/src/domain/scenarios/rapidClicker/interactionSimulator.ts` - `InteractionSimulator` class driving simulated rapid interaction sequences.
- `testing-core/src/domain/scenarios/rapidClicker/utils.ts` - Shared constants (click/bomb counts) and non-fatal-navigation-error classification helpers.

### `testing-core/src/domain/scenarios/routeTrasher/`

- `testing-core/src/domain/scenarios/routeTrasher/index.ts` - Route-churn scenario entry point for SPA navigation/state stress.
- `testing-core/src/domain/scenarios/routeTrasher/navigation.ts` - SPA-safe navigation helpers (settle windows, benign-error classification) used during route churn.
- `testing-core/src/domain/scenarios/routeTrasher/routeTrashClassifier.ts` (+`.test.ts`) - Classifies HTTP status/response noise as expected-resource-noise vs a genuine navigation fault.

### `testing-core/src/domain/services/`

- `testing-core/src/domain/services/AutonomousExplorationEngine.ts` - Backward-compatible facade re-exporting `ExplorationEngine` under its historical name; the former ~1,800-line god class is decomposed into the `exploration/` and `telemetry/` services below.
- `testing-core/src/domain/services/RiskScorer.ts` (+`.penaltyDecay.test.ts`) - Perceptron-based (Delta Rule) scoring of candidate elements and observed signals; drives target prioritization.
- `testing-core/src/domain/services/StateGraphNavigator.ts` (+`.characterization`/`.routeBudget`/`.lifecycle`/`.backtrackCap`/`.globalFrontier` `.test.ts` files) - Tracks and navigates state-graph transitions during exploration; composed from the `pathfinder/` submodules below.
- `testing-core/src/domain/services/DIrectedPathFinder.ts` - Directed path-finding service (explore/backtrack decisions) consumed by `StateGraphNavigator` and `ExplorationLoop`.
- `testing-core/src/domain/services/BugClassifier.ts` - Higher-level bug classification helper layered above the knowledge-base classifier.
- `testing-core/src/domain/services/ForensicAnalysisService.ts` - Produces session-level AI-style forensic analysis summaries persisted via `ForensicAnalysisRepository`.
- `testing-core/src/domain/services/SeededRandomGenerator.ts` - Deterministic mulberry32 PRNG used for reproducible run seeding (shared family with `seededRandom.ts` and `EdgeSelector`).
- `testing-core/src/domain/services/scenarioGate.ts` - Gates which stress scenarios are eligible given the operator-selected infiltration profile/testing types.

### `testing-core/src/domain/services/exploration/` - Decomposed Exploration Engine

- `testing-core/src/domain/services/exploration/ExplorationEngine.ts` - The real orchestrator (formerly `AutonomousExplorationEngine`): parse/score/act/observe/emit loop composition, wiring RiskScorer, StateGraphNavigator, ChaosTransactionManager, DOM/visual/accessibility heuristics, and persistence.
- `testing-core/src/domain/services/exploration/ExplorationLoop.ts` - The per-step decision loop: frontier scrolling, visited-hash tracking, novelty/stagnation-biased target selection, triggered-selector demotion.
- `testing-core/src/domain/services/exploration/ActionExecutor.ts` - Per-target action and fuzz-scenario dispatch (resolves operator-gated stress scenario or falls back to standard interaction).
- `testing-core/src/domain/services/exploration/StateRestorer.ts` - Restores navigator/browser state after a recoverable fault or backtrack.
- `testing-core/src/domain/services/exploration/PageHealthGuard.ts` - Confirms page responsiveness/navigation settle before issuing a competing navigation.
- `testing-core/src/domain/services/exploration/StrictUrlLockGuard.ts` - Enforces the operator's strict-URL-lock confinement, ignoring non-application navigations.
- `testing-core/src/domain/services/exploration/StateClusterRegistry.ts` (+`.saturation.test.ts`) - Bounded per-run tracking of structural-state clusters and page-saturation coverage metrics.
- `testing-core/src/domain/services/exploration/EscalationTracker.ts` (+`.test.ts`) / `escalationDecision.ts` (+`.test.ts`) - Tracks and decides payload-escalation across repeated attempts on the same field.
- `testing-core/src/domain/services/exploration/EdgeRepeatTracker.ts` (+`.test.ts`) - Bounded session-wide tracking of repeated (structure, selector) edges to bias against loop revisits.
- `testing-core/src/domain/services/exploration/RouteExhaustionTracker.ts` (+`.test.ts`) - Tracks consecutive route-step observations to detect an exhausted route.
- `testing-core/src/domain/services/exploration/RouteTrashThrottle.ts` (+`.test.ts`) - Session-scoped throttle capping route-mutation frequency.
- `testing-core/src/domain/services/exploration/routeTrashGating.ts` (+`.test.ts`) - Pure gate deciding whether a control should be treated as an SPA-router route-trash target.
- `testing-core/src/domain/services/exploration/interactionScope.ts` (+`.test.ts`) - Classifies an element's interaction scope and computes the attack-target score boost.
- `testing-core/src/domain/services/exploration/noveltyScoring.ts` (+`.test.ts`) - Pure novelty-reward rule for structurally-new states.
- `testing-core/src/domain/services/exploration/stagnationScoring.ts` (+`.test.ts`) - Pure stagnation-score/backtrack-penalty formulas.
- `testing-core/src/domain/services/exploration/networkAttribution.ts` (+`.test.ts`) - Pure gate bounding causal attribution of async network signals to the click that likely caused them.
- `testing-core/src/domain/services/exploration/pacing.ts` (+`.test.ts`) - Pure adaptive-pacing no-op early-exit rule.
- `testing-core/src/domain/services/exploration/formSubmitter.ts` - Triggers form submission as part of action execution.
- `testing-core/src/domain/services/exploration/types.ts` - Shared runtime-metric, confirmed-bug, and per-module dependency-contract types for the exploration package; also small shared utilities (`wait`, `inferSemanticRole`).

### `testing-core/src/domain/services/pathfinder/`

- `testing-core/src/domain/services/pathfinder/GraphStore.ts` - Underlying state-graph storage (nodes/edges) for `StateGraphNavigator`.
- `testing-core/src/domain/services/pathfinder/EdgeSelector.ts` - Selects the next edge to explore, with a mild coverage-first bias on a page's first visit.
- `testing-core/src/domain/services/pathfinder/TraversalStack.ts` - Backtrack stack for directed traversal.
- `testing-core/src/domain/services/pathfinder/EventLog.ts` - Bounded event log of navigator decisions.
- `testing-core/src/domain/services/pathfinder/config.ts` - Default navigator configuration and pathfinder-mode presets.
- `testing-core/src/domain/services/pathfinder/utils.ts` - Small pure helpers (hash shortening, action-type inference, selector-complexity scoring).

### `testing-core/src/domain/services/regression/` - Deterministic Regression Replay

- `testing-core/src/domain/services/regression/RegressionPlaybookVerifier.ts` - "Verify Fix" orchestrator: launches a fresh isolated Playwright session and replays a saved finding's recorded action timeline with no autonomous exploration, re-applying knowledge-base validation.
- `testing-core/src/domain/services/regression/ReplayActionRunner.ts` - Replays one recorded action deterministically against a live page.
- `testing-core/src/domain/services/regression/FaultCollector.ts` - Attaches page listeners during a replay and accumulates faults, re-classified via the same deterministic knowledge-base classifier used live.
- `testing-core/src/domain/services/regression/types.ts` - Shared regression-replay types (`LoadedFinding`, `CollectedFault`, etc.).

### `testing-core/src/domain/services/forensics/`

- `testing-core/src/domain/services/forensics/metadataRecorder.ts` - Records structured forensic metadata alongside captured faults.
- `testing-core/src/domain/services/forensics/narration.ts` - Human-readable narration helpers (element labels, constraint-bypass/injection/navigation/recovery descriptions) for reproduction steps.
- `testing-core/src/domain/services/forensics/index.ts` - Barrel export for the forensics helpers.

### `testing-core/src/domain/services/telemetry/`

- `testing-core/src/domain/services/telemetry/TelemetryEmitter.ts` - Emits structured telemetry events (actions, findings, frames, scoring/state changes) to the socket gateway.
- `testing-core/src/domain/services/telemetry/StabilityMonitor.ts` - Primary in-loop stability monitor: exception/console/network fault capture, stack-trace sanitization to prevent information disclosure, classification via the knowledge base, forensic-error persistence.

### `testing-core/src/domain/services/explainability/`

- `testing-core/src/domain/services/explainability/DecisionExplainer.ts` - Builds the glass-box decision-rationale payload (per-feature score attribution) streamed to the Decision Lens panel.

### `testing-core/src/infrastructure/database/`

- `testing-core/src/infrastructure/database/mongooseClient.ts` - MongoDB/Mongoose connection setup and lifecycle helper.
- `testing-core/src/infrastructure/database/models/ActionTraceModel.ts` - Mongoose model for persisted action traces.
- `testing-core/src/infrastructure/database/models/BrainConfigModel.ts` - Mongoose model for brain/config snapshots.
- `testing-core/src/infrastructure/database/models/FindingModel.ts` - Mongoose model for persisted findings.
- `testing-core/src/infrastructure/database/models/FindingType.ts` - Finding type / session-status enums and model helpers.
- `testing-core/src/infrastructure/database/models/SessionModel.ts` - Mongoose model for exploration sessions (caught bugs, action-step traces, ownership).
- `testing-core/src/infrastructure/database/models/UserModel.ts` - Mongoose model for authenticated users.
- `testing-core/src/infrastructure/database/models/ForensicAnalysisModel.ts` - Mongoose model for persisted session-level forensic analysis summaries.
- `testing-core/src/infrastructure/database/models/ForensicErrorModel.ts` - Mongoose model for persisted classified forensic errors (severity/type enums).
- `testing-core/src/infrastructure/database/models/ForensicTelemetryModel.ts` - Mongoose model for persisted raw forensic telemetry events.
- `testing-core/src/infrastructure/database/repositories/MongoFindingRepository.ts` - Mongo-backed implementation of the finding repository contract.
- `testing-core/src/infrastructure/database/repositories/ForensicAnalysisRepository.ts` - Repository (with module singleton) for `ForensicAnalysisModel`.
- `testing-core/src/infrastructure/database/repositories/ForensicErrorRepository.ts` - Repository (with module singleton) for `ForensicErrorModel`.
- `testing-core/src/infrastructure/database/repositories/ForensicTelemetryRepository.ts` - Repository (with module singleton) for `ForensicTelemetryModel`.
- `testing-core/src/infrastructure/database/repositories/SavedSafariRepository.ts` - Deprecated repository kept for compatibility; `MongoFindingRepository`'s sessions collection is now the single source of truth for saved history.
- `testing-core/src/infrastructure/database/schemas/SavedSafariModel.ts` - Mongoose schema backing the (deprecated) saved-safari repository.

### `testing-core/src/infrastructure/monitoring/`

- `testing-core/src/infrastructure/monitoring/BinaryFrameServer.ts` - Serves binary visual frame data for live dashboard playback.
- `testing-core/src/infrastructure/monitoring/actionBuffer.ts` - `ActionRecorder`: bounded circular buffer of recent action traces for forensic and reproduction workflows.
- `testing-core/src/infrastructure/monitoring/activeScenarioTracker.ts` - Tracks which chaos/stress scenario is currently active so faults can be attributed.
- `testing-core/src/infrastructure/monitoring/anomalyListeners.ts` - Attaches bounded page listeners (response/console flood caps) for anomaly capture.
- `testing-core/src/infrastructure/monitoring/browserConsoleListener.ts` - Streams browser console messages to telemetry.
- `testing-core/src/infrastructure/monitoring/exceptionCatcher.ts` - Captures runtime exceptions and anomaly context.
- `testing-core/src/infrastructure/monitoring/fuzzForensics.ts` - `FuzzForensicLog`: captures late API/console responses in the settle window after a fuzz injection.
- `testing-core/src/infrastructure/monitoring/navForensics.ts` - `NavForensicLog`: captures late API/console responses in the settle window after a navigation.
- `testing-core/src/infrastructure/monitoring/reproductionPlaybookStore.ts` - Stores reproducible action sequences for bug validation.
- `testing-core/src/infrastructure/monitoring/serverReachability.ts` (+`.test.ts`) - Isolated Node HTTP reachability probe (never runs on the browser thread); single source of truth for "is the target actually down."
- `testing-core/src/infrastructure/monitoring/socketServer.ts` - `TelemetryHub`: socket transport hub for live telemetry streaming.
- `testing-core/src/infrastructure/monitoring/stabilityMonitor.ts` - Secondary background heartbeat monitor (`setupStabilityMonitoring`) detecting main-thread freezes via a bounded-retry responsiveness probe, classified through the same knowledge base as the primary `StabilityMonitor`.

### `testing-core/src/infrastructure/playwright/`

- `testing-core/src/infrastructure/playwright/BoundingBoxHighlighter.ts` - Browser visual helper for highlighting selected element bounds.
- `testing-core/src/infrastructure/playwright/PlaywrightBrowserEngine.ts` - Concrete Playwright adapter implementing browser automation operations.

### `testing-core/src/infrastructure/queue/`

- `testing-core/src/infrastructure/queue/TaskQueue.ts` - Redis-backed queue abstraction for scheduling/serializing backend tasks; opt-in via `BUGSAFARI_USE_QUEUE=1`.

### `testing-core/src/infrastructure/socket/`

- `testing-core/src/infrastructure/socket/SocketTelemetryGateway.ts` - Socket-backed telemetry gateway implementation.

### `testing-core/src/infrastructure/workers/`

- `testing-core/src/infrastructure/workers/SafariWorker.ts` - Worker implementation for running safari jobs off the main process path.

### `testing-core/src/lib/`

- `testing-core/src/lib/circularBuffer.ts` (+`.test.ts`) - Bounded rolling buffer used for temporal memory and monitoring windows (the 20-step action buffer).

### `testing-core/src/ml/`

- `testing-core/src/ml/domHasher.ts` - DOM/state hashing helpers (`DomHasher`, `CompoundStateHash`, `normalizeRoutePath`) for fingerprints and repetition detection.
- `testing-core/src/ml/perceptron.ts` (+`.test.ts`) - Single-layer perceptron (Delta Rule) scoring model consumed by `RiskScorer`.

### `testing-core/src/presentation/api/`

- `testing-core/src/presentation/api/registerRoutes.ts` - Registers HTTP endpoints for health, run start/control, history, and forensic report retrieval; resolves the operator's infiltration profile into concrete testing types.

### `testing-core/src/presentation/authentication/` - Split Auth Surface

- `testing-core/src/presentation/authentication/authConfig.ts` - Shared JWT secret/config resolution (production requires env var; dev falls back to a named local-dev secret).
- `testing-core/src/presentation/authentication/authController.ts` - `registerAuthRoutes`: wires the individual login/signup/refresh/password-reset handlers below onto Express routes.
- `testing-core/src/presentation/authentication/authLoginController.ts` - `handleLogin`: authenticates a user with timing-safe password comparison, issues JWT.
- `testing-core/src/presentation/authentication/authSignupController.ts` - `handleSignup`: registers a new user.
- `testing-core/src/presentation/authentication/authRefreshController.ts` - `handleTokenRefresh`: issues a new JWT from an existing valid one without requiring the password.
- `testing-core/src/presentation/authentication/authPasswordResetController.ts` - Forgot/reset-password handlers, including nodemailer-based reset email delivery.
- `testing-core/src/presentation/authentication/authValidation.ts` - Shared input sanitization and server-side password-complexity validation (mirrors frontend regex checks; defense in depth).
- `testing-core/src/presentation/authentication/authMiddleware.ts` - `requireAuth`/`optionalAuth` middleware validating JWTs and populating `AuthRequest`.
- `testing-core/src/presentation/authentication/userSettingsController.ts` - User profile/settings CRUD routes.

### `testing-core/src/presentation/socket/`

- `testing-core/src/presentation/socket/registerSocketHandlers.ts` - Registers real-time socket handlers: session attach/reconnect, live telemetry, and the Verify Fix regression-replay request/progress/ack flow (serialized to one in-flight replay at a time).

---

## End-to-End Wiring

1. Operator lands on `designs/LandingPage.tsx` or authenticates via `AuthGuard`/`LoginForm`/`SignupForm`, all backed by `context/AuthContext.tsx`.
2. `App.tsx` and `useDashboardController.ts` connect dashboard actions to `SocketHttpEngineGateway`, which composes `EngineHttpClient` (REST) and `SocketConnectionManager` (Socket.IO).
3. HTTP routes in `presentation/api/registerRoutes.ts` and the split auth routes in `presentation/authentication/` receive run and account commands; `presentation/socket/registerSocketHandlers.ts` handles session attach and Verify Fix.
4. `StartExplorationUseCase` initializes run state; `SessionManager` (with `TargetHealthMonitor`) owns session/reconnection lifecycle.
5. `ExplorationEngine` (aliased as `AutonomousExplorationEngine` for compatibility) composes `ExplorationLoop`, `ActionExecutor`, `StateGraphNavigator`/`DIrectedPathFinder`, `RiskScorer`, `ChaosTransactionManager`, DOM/visual/accessibility heuristics, and `TelemetryEmitter`/`StabilityMonitor`.
6. Stress scenarios (fuzzing, rapidClicker, routeTrasher, formBypasser, networkSaboteur, asyncStateRacer) execute against targets; bug finders and the `knowledgeBase/` classifier convert runtime signals into structured, attributed findings.
7. Monitoring, database, socket, and binary-frame infrastructure persist and stream results back to the dashboard; `RegressionPlaybookVerifier` replays saved findings deterministically for the Verify Fix flow.
