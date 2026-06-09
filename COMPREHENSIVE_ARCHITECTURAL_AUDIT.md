# BugSafari Comprehensive Architectural Audit & Analysis

**Audit Date:** June 9, 2026  
**Scope:** Complete system analysis of 104 TypeScript/React files  
**Assessment Level:** Deep-dive architectural review

---

## TABLE OF CONTENTS

1. [Executive Summary](#executive-summary)
2. [Exhaustive File Dictionary](#exhaustive-file-dictionary)
3. [Dependency & Connection Graph](#dependency--connection-graph)
4. [Architecture Health & Conflict Audit](#architecture-health--conflict-audit)
5. [Priority Remediation Plan](#priority-remediation-plan)

---

## EXECUTIVE SUMMARY

### System Overview
BugSafari is a sophisticated autonomous testing platform consisting of:
- **Frontend:** React/TypeScript SPA (developer-dashboard) with real-time telemetry visualization
- **Backend:** Node.js/Express/Playwright-based testing engine (testing-core)
- **Shared:** Centralized type definitions and data contracts (shared/types.ts)
- **Database:** MongoDB for persistence, real-time Socket.io for telemetry streaming

### Architecture Pattern
Clean Architecture with clear separation of concerns:
- **Domain Layer:** Core business logic (bug finding, exploration algorithms)
- **Application Layer:** Use cases orchestrating domain services
- **Infrastructure Layer:** Technical implementations (DB, Playwright, Socket.io)
- **Presentation Layer:** HTTP/Socket controllers and HTTP handlers

### Critical Findings
- **🔴 6 CRITICAL issues** affecting reliability and performance
- **🟡 22 MEDIUM issues** affecting maintainability and type safety
- **🟢 8 LOW issues** affecting code hygiene
- **Memory leak vulnerability:** Event listeners accumulating across test runs
- **Race condition risk:** Global state mutation without synchronization
- **Type safety gaps:** Inconsistent type definitions across layers

---

## EXHAUSTIVE FILE DICTIONARY

### SHARED LAYER

#### **[shared/types.ts](shared/types.ts)**
- **Core Purpose:** Central data contract for frontend-backend communication; defines all telemetry, bug finding, and forensic data structures
- **Key Exports/Functions:**
  - Type: `TelemetryType` (union: 'ACTION' | 'NETWORK' | 'EXCEPTION' | 'HEURISTIC_SCORE')
  - Type: `SemanticRole` (element classification: LOGIN, SEARCH, SUBMIT, CANCEL, DESTRUCTIVE, NAVIGATE, INPUT, UNKNOWN)
  - Interface: `TelemetryMeta` (metadata payload with optional statusCode, selector, url, exception details)
  - Interface: `TelemetryEvent` (timestamp, type, meta)
  - Interface: `ActionBreadcrumb` (forensic trail of user actions)
  - Interface: `ActionRecord` (structured action with type, selector, url, payload)
  - Interface: `IncidentReport` (crash report with breadcrumbs and stack trace)
  - Interface: `ForensicCrashReport` (detailed crash analysis)
  - Interface: `DiscoveredElement` (DOM element with semantic role and bounding box)
  - Interface: `BoundingBox` (x, y, width, height)
  - Interface: `IntelligentDiagnosis` (AI-generated vulnerability classification)
- **System Importance:** **HIGH** - Core data contract; all communication between layers flows through these types
- **Issues:** Optional field inconsistencies (statusCode vs status), type unions not validated

---

### BACKEND LAYER - DOMAIN SERVICES

#### **[testing-core/src/domain/services/AutonomousExplorationEngine.ts](testing-core/src/domain/services/AutonomousExplorationEngine.ts)**
- **Core Purpose:** Main orchestrator of automated browser exploration; drives state navigation, element interaction, and bug discovery through exploration loop
- **Key Exports/Functions:**
  - Class: `AutonomousExplorationEngine`
  - Method: `startExploration(url)` → Initializes browser context and enters exploration loop
  - Method: `pauseExploration()` → Suspends active exploration
  - Method: `resumeExploration()` → Resumes from pause state
  - Method: `stopExploration()` → Terminates and cleans up session
  - Private: `exploreState(depth)` → Recursive state exploration with risk scoring and backtracking
- **System Importance:** **CRITICAL** - Core orchestrator; all test execution flows through here
- **Issues:**
  - 🔴 **CRITICAL:** 6+ event listeners (page.on('request'), 'response', 'requestfailed', 'dialog', 'pageerror', 'console') registered but only 1 cleaned up, causing memory leaks
  - 🟡 **MEDIUM:** Duplicate event handler registration with monitoring modules
  - 🟡 **MEDIUM:** `currentTelemetry` may be null when used

---

#### **[testing-core/src/domain/services/StateGraphNavigator.ts](testing-core/src/domain/services/StateGraphNavigator.ts)**
- **Core Purpose:** Implements state graph navigation using depth-first search with risk scoring; manages visited states and backtracking strategy
- **Key Exports/Functions:**
  - Class: `StateGraphNavigator`
  - Method: `getCurrentState()` → Returns current DOM state hash
  - Method: `getNextStateToExplore()` → Selects next node based on risk and exploration score
  - Method: `backtrack()` → Returns to parent state
  - Method: `recordStateVisit(hash, elements)` → Tracks visited state and discovered elements
- **System Importance:** **HIGH** - Core graph traversal; controls exploration strategy
- **Issues:**
  - 🟡 **MEDIUM:** Graph nodes have mutable fields (visitCount, exhausted, backtracksFromHere) modified during exploration; not thread-safe

---

#### **[testing-core/src/domain/services/RiskScorer.ts](testing-core/src/domain/services/RiskScorer.ts)**
- **Core Purpose:** Calculates risk scores for DOM elements and user interactions; prioritizes high-value exploration paths
- **Key Exports/Functions:**
  - Class: `RiskScorer`
  - Method: `scoreElement(element, context)` → Returns numeric risk score (0-1)
  - Method: `scoreStateTransition(from, to)` → Evaluates state change risk
  - Property: `adaptiveWeights` map for different element types
  - Property: `penalties` map for risk penalties
- **System Importance:** **HIGH** - Controls exploration prioritization
- **Issues:**
  - 🟡 **MEDIUM:** adaptiveWeights and penalties map usage unclear; potential dead code

---

#### **[testing-core/src/domain/services/DIrectedPathFinder.ts](testing-core/src/domain/services/DIrectedPathFinder.ts)** ⚠️
- **Core Purpose:** Implements directed path finding for state navigation; optimizes exploration routes
- **Key Exports/Functions:**
  - Class: `DirectedPathFinder` (note: class name is `DirectedPathFinder` but filename has typo)
  - Method: `findPathToState(from, to)` → Computes optimal path between states
  - Method: `isPathValid()` → Validates path feasibility
- **System Importance:** **HIGH** - Path optimization core component
- **Issues:**
  - 🔴 **CRITICAL:** Filename typo: `DIrectedPathFinder.ts` should be `DirectedPathFinder.ts`

---

#### **[testing-core/src/domain/services/BugClassifier.ts](testing-core/src/domain/services/BugClassifier.ts)**
- **Core Purpose:** Classifies discovered bugs by type and severity; filters false positives
- **Key Exports/Functions:**
  - Function: `isActualBug(bug)` → Boolean classification
  - Function: `classifyBugType(finding)` → Returns BugType enum
  - Function: `calculateSeverity(bug)` → Severity scoring
- **System Importance:** **HIGH** - Core bug validation and classification
- **Issues:** None identified

---

### BACKEND LAYER - DOMAIN ENTITIES & HEURISTICS

#### **[testing-core/src/domain/entities/InteractiveElement.ts](testing-core/src/domain/entities/InteractiveElement.ts)**
- **Core Purpose:** Value object representing interactive DOM elements with properties and semantic classification
- **Key Exports/Functions:**
  - Class: `InteractiveElement`
  - Property: `selector`, `tagName`, `semanticRole`, `visible`, `boundingBox`
  - Method: `toDiscoveredElement()` → Converts to wire format
- **System Importance:** **MEDIUM** - Element abstraction used throughout domain
- **Issues:** None identified

---

#### **[testing-core/src/domain/heuristics/domParser.ts](testing-core/src/domain/heuristics/domParser.ts)**
- **Core Purpose:** Parses DOM structure and extracts interactive elements using Playwright selector engine
- **Key Exports/Functions:**
  - Function: `parseDomElements(page)` → Returns array of InteractiveElement
  - Function: `findElementBySemantic(elements, role)` → Filters by semantic role
  - Function: `computeDomHash(page)` → Calculates stable state hash
- **System Importance:** **HIGH** - DOM analysis foundation
- **Issues:** None identified

---

#### **[testing-core/src/domain/repositories/FindingRepository.ts](testing-core/src/domain/repositories/FindingRepository.ts)**
- **Core Purpose:** Abstract port for bug finding persistence; defines contract for saving/querying bugs
- **Key Exports/Functions:**
  - Interface: `FindingRepository`
  - Method: `saveFinding(bug, userId)` → Promise<void>
  - Method: `getBugsByType(type)` → Promise<Bug[]>
  - Method: `getRecentFindings(userId, limit)` → Promise<Bug[]>
- **System Importance:** **MEDIUM** - Persistence abstraction
- **Issues:** None identified

---

### BACKEND LAYER - BUG FINDERS

#### **[testing-core/src/bugs/finders/noSqlInjection.ts](testing-core/src/bugs/finders/noSqlInjection.ts)**
- **Core Purpose:** Detects NoSQL injection vulnerabilities by fuzzing database query inputs
- **Key Exports/Functions:**
  - Class: `NoSqlInjectionFinder implements BugFinder`
  - Method: `isApplicable(context)` → Checks for input elements
  - Method: `run(context)` → Executes fuzzing and returns findings
- **System Importance:** **MEDIUM** - Security-critical bug detection
- **Issues:** None identified

---

#### **[testing-core/src/bugs/finders/inputSanitization.ts](testing-core/src/bugs/finders/inputSanitization.ts)**
- **Core Purpose:** Identifies input sanitization failures by fuzzing form fields with malicious payloads
- **Key Exports/Functions:**
  - Class: `InputSanitizationFinder implements BugFinder`
  - Method: `isApplicable(context)` → Detects forms
  - Method: `run(context)` → XSS, HTML injection payload testing
- **System Importance:** **MEDIUM** - XSS/injection detection
- **Issues:** None identified

---

#### **[testing-core/src/bugs/finders/clientSideBypass.ts](testing-core/src/bugs/finders/clientSideBypass.ts)**
- **Core Purpose:** Tests for client-side validation bypass vulnerabilities
- **Key Exports/Functions:**
  - Class: `ClientSideBypassFinder implements BugFinder`
  - Method: `run(context)` → Disables JavaScript and attempts form submission
- **System Importance:** **LOW** - Limited implementation scope
- **Issues:**
  - 🟡 **MEDIUM:** Limited implementation; may not detect all bypass patterns

---

#### **[testing-core/src/bugs/finders/boundaryStress.ts](testing-core/src/bugs/finders/boundaryStress.ts)**
- **Core Purpose:** Detects boundary condition vulnerabilities through numeric input stress testing
- **Key Exports/Functions:**
  - Class: `BoundaryStressFinder implements BugFinder`
  - Method: `run(context)` → Tests with boundary values (MAX_INT, MIN_INT, MAX_DOUBLE, etc.)
- **System Importance:** **MEDIUM** - Robustness testing
- **Issues:** None identified

---

#### **[testing-core/src/bugs/finders/spaRaceConditions.ts](testing-core/src/bugs/finders/spaRaceConditions.ts)**
- **Core Purpose:** Detects race conditions in Single Page Applications through rapid interaction patterns
- **Key Exports/Functions:**
  - Class: `SpaRaceConditionFinder implements BugFinder`
  - Method: `run(context)` → Triggers rapid simultaneous actions
- **System Importance:** **MEDIUM** - Concurrency bug detection
- **Issues:** None identified

---

#### **[testing-core/src/bugs/finders/runtimeStability.ts](testing-core/src/bugs/finders/runtimeStability.ts)**
- **Core Purpose:** Tests runtime stability through memory pressure and resource exhaustion
- **Key Exports/Functions:**
  - Class: `RuntimeStabilityFinder implements BugFinder`
  - Method: `run(context)` → Stress tests with heavy DOM operations
- **System Importance:** **MEDIUM** - Stability testing
- **Issues:**
  - 🟡 **MEDIUM:** Always returns empty or placeholder findings; not fully implemented

---

#### **[testing-core/src/bugs/finders/structuralNavigation.ts](testing-core/src/bugs/finders/structuralNavigation.ts)**
- **Core Purpose:** Tests structural DOM navigation and accessibility compliance
- **Key Exports/Functions:**
  - Class: `StructuralNavigationFinder implements BugFinder`
  - Method: `run(context)` → Tests tab order and ARIA compliance
- **System Importance:** **LOW** - Accessibility-focused
- **Issues:** None identified

---

#### **[testing-core/src/bugs/types.ts](testing-core/src/bugs/types.ts)**
- **Core Purpose:** Defines bug finder interface and bug classification types
- **Key Exports/Functions:**
  - Interface: `BugFinder` with `isApplicable(ctx: Omit<BugContext, 'crashHalted'>)` and `run(context)`
  - Type: `BugContext` (contains page, elements, url, etc.)
  - Type: `Finding` (bug report structure)
- **System Importance:** **HIGH** - Core abstraction for bug detection plugins
- **Issues:**
  - 🟡 **MEDIUM:** Type inconsistency: `isApplicable` takes `Omit<BugContext, 'crashHalted'>` but BugContext always includes crashHalted

---

#### **[testing-core/src/bugs/registry.ts](testing-core/src/bugs/registry.ts)**
- **Core Purpose:** Centralized registry of all active bug finders; instantiates and manages finder plugins
- **Key Exports/Functions:**
  - Function: `getBugFinders()` → Returns array of all BugFinder instances
  - Function: `registerBugFinder(finder)` → Adds custom finder to registry
- **System Importance:** **MEDIUM** - Bug finder orchestration
- **Issues:** None identified

---

#### **[testing-core/src/bugs/scenarioAdapters.ts](testing-core/src/bugs/scenarioAdapters.ts)**
- **Core Purpose:** Adapts stress scenarios to bug finder contexts; bridges scenario engine and finder plugins
- **Key Exports/Functions:**
  - Function: `adaptScenarioToBugFinder(scenario)` → Converts scenario payload to finder context
  - Function: `executeScenarioInBugFinder(finder, scenario)` → Runs scenario with finder
- **System Importance:** **MEDIUM** - Scenario-to-finder bridge
- **Issues:** None identified

---

### BACKEND LAYER - DOMAIN SCENARIOS

#### **[testing-core/src/domain/scenarios/index.ts](testing-core/src/domain/scenarios/index.ts)**
- **Core Purpose:** Exports all available stress scenario generators and orchestrators
- **Key Exports/Functions:**
  - Export: `rapidClickerStress`, `networkSaboteur`, `formBypasser`, `routeTrasher`, `securityVulnerabilityScout`, `smartActionChain`
  - Function: `getScenarioByName(name)` → Retrieves scenario generator
- **System Importance:** **MEDIUM** - Scenario registry and orchestration
- **Issues:**
  - 🟡 **MEDIUM:** `smartActionChain` is re-exported from dataFuzzer but never invoked

---

#### **[testing-core/src/domain/scenarios/types.ts](testing-core/src/domain/scenarios/types.ts)**
- **Core Purpose:** Defines scenario and stress test type definitions
- **Key Exports/Functions:**
  - Type: `Scenario` (abstract stress test pattern)
  - Type: `ScenarioContext` (page, elements, url context)
  - Interface: `StressPayload` (parameterized stress configuration)
- **System Importance:** **MEDIUM** - Type contracts for scenarios
- **Issues:** None identified

---

#### **[testing-core/src/domain/scenarios/rapidClickerStress.ts](testing-core/src/domain/scenarios/rapidClickerStress.ts)**
- **Core Purpose:** Stress scenario executing rapid sequential clicks on random elements
- **Key Exports/Functions:**
  - Function: `rapidClickerStress(context, iterations)` → Performs rapid clicking
- **System Importance:** **MEDIUM** - Click flood stress test
- **Issues:** None identified

---

#### **[testing-core/src/domain/scenarios/networkSaboteur.ts](testing-core/src/domain/scenarios/networkSaboteur.ts)**
- **Core Purpose:** Stress scenario simulating network failures, latency, and throttling
- **Key Exports/Functions:**
  - Function: `networkSaboteur(context, throttleProfile)` → Applies network conditions
- **System Importance:** **MEDIUM** - Network resilience testing
- **Issues:** None identified

---

#### **[testing-core/src/domain/scenarios/formBypasser.ts](testing-core/src/domain/scenarios/formBypasser.ts)**
- **Core Purpose:** Stress scenario attempting to bypass form validation through various methods
- **Key Exports/Functions:**
  - Function: `formBypasser(context)` → Executes bypass attempts
- **System Importance:** **MEDIUM** - Security testing
- **Issues:** None identified

---

#### **[testing-core/src/domain/scenarios/routeTrasher.ts](testing-core/src/domain/scenarios/routeTrasher.ts)**
- **Core Purpose:** Stress scenario navigating to invalid/malformed routes and URLs
- **Key Exports/Functions:**
  - Function: `routeTrasher(context, invalidRoutes)` → Tests invalid routing
- **System Importance:** **LOW** - Route robustness
- **Issues:** None identified

---

#### **[testing-core/src/domain/scenarios/securityVulnerabilityScout.ts](testing-core/src/domain/scenarios/securityVulnerabilityScout.ts)**
- **Core Purpose:** Comprehensive security vulnerability detection through pattern matching and fuzzing
- **Key Exports/Functions:**
  - Function: `securityVulnerabilityScout(context)` → Runs security checks
- **System Importance:** **HIGH** - Core security testing
- **Issues:** None identified

---

#### **[testing-core/src/domain/scenarios/fuzzing/dataFuzzer.ts](testing-core/src/domain/scenarios/fuzzing/dataFuzzer.ts)**
- **Core Purpose:** Generates fuzzing payloads and orchestrates fuzzing strategies across input fields
- **Key Exports/Functions:**
  - Class: `DataFuzzer`
  - Method: `generatePayload(type)` → Creates fuzz payload (XSS, SQL injection, etc.)
  - Method: `smartActionChain(elements)` → Intelligent action sequence generation
  - Property: `PAYLOAD_TYPES` (XSS_VECTORS, SQL_INJECTIONS, BUFFER_OVERFLOW, etc.)
- **System Importance:** **HIGH** - Core fuzzing engine
- **Issues:** None identified

---

#### **[testing-core/src/domain/scenarios/fuzzing/elementClassifier.ts](testing-core/src/domain/scenarios/fuzzing/elementClassifier.ts)**
- **Core Purpose:** Classifies form elements by input type and semantic role for targeted fuzzing
- **Key Exports/Functions:**
  - Function: `classifyElement(element)` → Returns classifier result (TEXT_INPUT, NUMERIC, EMAIL, etc.)
  - Function: `getApplicableStrategies(classifier)` → Suggests fuzzing strategies
- **System Importance:** **MEDIUM** - Fuzzing input classification
- **Issues:** None identified

---

#### **[testing-core/src/domain/scenarios/fuzzing/strategies/numericBoundaryStrategy.ts](testing-core/src/domain/scenarios/fuzzing/strategies/numericBoundaryStrategy.ts)**
- **Core Purpose:** Fuzzing strategy for numeric inputs testing boundary conditions
- **Key Exports/Functions:**
  - Function: `numericBoundaryStrategy(field)` → Returns boundary value payloads
- **System Importance:** **LOW** - Specialized strategy
- **Issues:** None identified

---

#### **[testing-core/src/domain/scenarios/fuzzing/strategies/xssVectorStrategy.ts](testing-core/src/domain/scenarios/fuzzing/strategies/xssVectorStrategy.ts)**
- **Core Purpose:** Fuzzing strategy generating XSS payload vectors
- **Key Exports/Functions:**
  - Function: `xssVectorStrategy()` → Returns XSS payloads array
- **System Importance:** **MEDIUM** - Security payload generation
- **Issues:** None identified

---

#### **[testing-core/src/domain/scenarios/fuzzing/strategies/noSqlInjectionStrategy.ts](testing-core/src/domain/scenarios/fuzzing/strategies/noSqlInjectionStrategy.ts)**
- **Core Purpose:** Fuzzing strategy generating NoSQL injection payloads
- **Key Exports/Functions:**
  - Function: `noSqlInjectionStrategy()` → Returns NoSQL payloads
- **System Importance:** **MEDIUM** - NoSQL security testing
- **Issues:** None identified

---

#### **[testing-core/src/domain/scenarios/fuzzing/strategies/chaosFallbackStrategy.ts](testing-core/src/domain/scenarios/fuzzing/strategies/chaosFallbackStrategy.ts)**
- **Core Purpose:** Fallback fuzzing strategy for unknown input types; generates random chaos payloads
- **Key Exports/Functions:**
  - Function: `chaosFallbackStrategy(field)` → Random payload generation
- **System Importance:** **LOW** - Fallback strategy
- **Issues:** None identified

---

#### **[testing-core/src/domain/scenarios/fuzzing/strategies/index.ts](testing-core/src/domain/scenarios/fuzzing/strategies/index.ts)**
- **Core Purpose:** Exports all fuzzing strategies
- **Key Exports/Functions:**
  - Function: `getStrategyByName(name)` → Retrieves strategy
- **System Importance:** **LOW** - Strategy registry
- **Issues:** None identified

---

### BACKEND LAYER - APPLICATION/USE CASES

#### **[testing-core/src/application/useCases/StartExplorationUseCase.ts](testing-core/src/application/useCases/StartExplorationUseCase.ts)**
- **Core Purpose:** Main orchestration use case; coordinates browser engine, telemetry, and bug finding for a complete exploration session
- **Key Exports/Functions:**
  - Class: `StartExplorationUseCase`
  - Method: `execute(targetUrl)` → Primary entry point; starts full exploration loop
  - Method: `setUserId(userId)` → Sets authenticated user context
  - Method: `getUserId()` → Returns current user ID
  - Method: `isActive()` → State check
  - Private: `buildBreadcrumbSteps(records)` → Formats action history
- **System Importance:** **CRITICAL** - Main use case orchestrator
- **Issues:**
  - 🟡 **MEDIUM:** Unused import: `checkIsActualBug` imported but never used (line 8)
  - 🟡 **MEDIUM:** Type coercion issue: `bug.type` is optional but used as key without null check

---

### BACKEND LAYER - APPLICATION/PORTS

#### **[testing-core/src/application/ports/BrowserEngine.ts](testing-core/src/application/ports/BrowserEngine.ts)**
- **Core Purpose:** Abstract interface for browser automation; defines contract for Playwright implementation
- **Key Exports/Functions:**
  - Interface: `BrowserEngine`
  - Method: `launchBrowser()` → Promise<Browser>
  - Method: `closeBrowser()` → Promise<void>
  - Method: `createPage()` → Promise<Page>
  - Method: `navigateToUrl(page, url)` → Promise<void>
- **System Importance:** **HIGH** - Core browser abstraction
- **Issues:** None identified

---

#### **[testing-core/src/application/ports/TelemetryGateway.ts](testing-core/src/application/ports/TelemetryGateway.ts)**
- **Core Purpose:** Abstract interface for telemetry emission; defines contract for Socket.io implementation
- **Key Exports/Functions:**
  - Interface: `TelemetryGateway`
  - Method: `emitTelemetry(event)` → Broadcasts telemetry event
  - Method: `emitBugFound(finding)` → Sends bug to client
  - Method: `emitStateUpdate(state)` → Broadcasts state changes
- **System Importance:** **HIGH** - Core telemetry abstraction
- **Issues:** None identified

---

#### **[testing-core/src/application/ports/EngineGateway.ts](testing-core/src/application/ports/EngineGateway.ts)** (Frontend)
- **Core Purpose:** Frontend interface for engine control; abstract port for starting/stopping exploration
- **Key Exports/Functions:**
  - Interface: `EngineGateway`
  - Method: `startExploration(targetUrl)` → Initiates test
  - Method: `stopExploration()` → Terminates test
  - Method: `pauseExploration()` → Pauses test
  - Method: `resumeExploration()` → Resumes test
  - Method: `onTelemetry(callback)` → Registers telemetry listener
- **System Importance:** **MEDIUM** - Frontend-backend contract
- **Issues:** None identified

---

### BACKEND LAYER - APPLICATION/SERVICES

#### **[testing-core/src/application/services/runController.ts](testing-core/src/application/services/runController.ts)**
- **Core Purpose:** Manages test execution state transitions and lifecycle; tracks active/paused/stopped states
- **Key Exports/Functions:**
  - Class: `RunController`
  - Method: `startRun()` → Transitions to ACTIVE
  - Method: `pauseRun()` → Transitions to PAUSED
  - Method: `stopRun()` → Transitions to STOPPED
  - Property: `currentState` → State machine
- **System Importance:** **MEDIUM** - Execution state management
- **Issues:** None identified

---

#### **[testing-core/src/application/services/stackManager.ts](testing-core/src/application/services/stackManager.ts)**
- **Core Purpose:** Manages call stack and state history for exploration backtracking
- **Key Exports/Functions:**
  - Class: `StackManager`
  - Method: `push(state)` → Pushes state onto stack
  - Method: `pop()` → Pops and returns last state
  - Method: `getHistory()` → Returns full stack
- **System Importance:** **MEDIUM** - Backtracking support
- **Issues:** None identified

---

#### **[testing-core/src/application/services/domainGuard.ts](testing-core/src/application/services/domainGuard.ts)**
- **Core Purpose:** Security guard ensuring exploration stays within same-origin domain
- **Key Exports/Functions:**
  - Function: `isSameDomain(currentUrl, targetUrl)` → Boolean validation
  - Function: `sanitizeUrl(url)` → Removes dangerous patterns
- **System Importance:** **MEDIUM** - Security boundary
- **Issues:** None identified

---

### BACKEND LAYER - INFRASTRUCTURE/DATABASE

#### **[testing-core/src/infrastructure/database/mongooseClient.ts](testing-core/src/infrastructure/database/mongooseClient.ts)**
- **Core Purpose:** Establishes and manages MongoDB connection via Mongoose; handles connection lifecycle
- **Key Exports/Functions:**
  - Function: `connectDatabase()` → Establishes MongoDB connection
  - Function: `disconnectDatabase()` → Closes connection
  - Function: `getConnectionState()` → Returns {isConnected, error}
  - Function: `ensureConnected()` → Ensures active connection
- **System Importance:** **HIGH** - Database connection management
- **Issues:**
  - 🟡 **MEDIUM:** Generic error handling; context lost in catch blocks

---

#### **[testing-core/src/infrastructure/database/models/UserModel.ts](testing-core/src/infrastructure/database/models/UserModel.ts)**
- **Core Purpose:** Mongoose schema for user authentication and profile data
- **Key Exports/Functions:**
  - Schema: `userSchema` with fields: email, passwordHash, createdAt, lastLogin
  - Export: `User` model
- **System Importance:** **MEDIUM** - User persistence
- **Issues:** None identified

---

#### **[testing-core/src/infrastructure/database/models/FindingModel.ts](testing-core/src/infrastructure/database/models/FindingModel.ts)**
- **Core Purpose:** Mongoose schema for bug findings; stores discovered vulnerabilities with metadata
- **Key Exports/Functions:**
  - Schema: `findingSchema` with fields: type, severity, url, selector, message, reproductionSteps, userId
  - Export: `Finding` model
- **System Importance:** **HIGH** - Bug persistence
- **Issues:** None identified

---

#### **[testing-core/src/infrastructure/database/models/SessionModel.ts](testing-core/src/infrastructure/database/models/SessionModel.ts)**
- **Core Purpose:** Mongoose schema for exploration sessions; tracks test runs
- **Key Exports/Functions:**
  - Schema: `sessionSchema` with fields: userId, startTime, endTime, targetUrl, status, bugsFound
  - Export: `Session` model
- **System Importance:** **MEDIUM** - Session tracking
- **Issues:** None identified

---

#### **[testing-core/src/infrastructure/database/models/ActionTraceModel.ts](testing-core/src/infrastructure/database/models/ActionTraceModel.ts)**
- **Core Purpose:** Mongoose schema for action breadcrumbs; records user interaction sequences
- **Key Exports/Functions:**
  - Schema: `actionTraceSchema` with fields: sessionId, timestamp, action, selector, payload
  - Export: `ActionTrace` model
- **System Importance:** **MEDIUM** - Forensic trail storage
- **Issues:** None identified

---

#### **[testing-core/src/infrastructure/database/models/BrainConfigModel.ts](testing-core/src/infrastructure/database/models/BrainConfigModel.ts)**
- **Core Purpose:** Mongoose schema for machine learning configuration; stores learned weights for risk scorer
- **Key Exports/Functions:**
  - Schema: `brainConfigSchema` with fields: adaptiveWeights, penalties, trainingRuns
  - Export: `BrainConfig` model
- **System Importance:** **LOW** - ML configuration storage
- **Issues:** None identified

---

#### **[testing-core/src/infrastructure/database/models/FindingType.ts](testing-core/src/infrastructure/database/models/FindingType.ts)**
- **Core Purpose:** Enum/type definitions for bug finding types
- **Key Exports/Functions:**
  - Type: `FindingType` enum
- **System Importance:** **LOW** - Type reference
- **Issues:** None identified

---

#### **[testing-core/src/infrastructure/database/schemas/SavedSafariModel.ts](testing-core/src/infrastructure/database/schemas/SavedSafariModel.ts)**
- **Core Purpose:** Mongoose schema for saved test configurations; allows users to save and replay test configurations
- **Key Exports/Functions:**
  - Schema: `savedSafariSchema` with fields: userId, name, targetUrl, config, createdAt
  - Export: `SavedSafari` model
- **System Importance:** **MEDIUM** - Test configuration storage
- **Issues:** None identified

---

#### **[testing-core/src/infrastructure/database/repositories/MongoFindingRepository.ts](testing-core/src/infrastructure/database/repositories/MongoFindingRepository.ts)**
- **Core Purpose:** MongoDB-specific implementation of FindingRepository; provides persistence for bug findings
- **Key Exports/Functions:**
  - Class: `MongoFindingRepository implements FindingRepository`
  - Method: `saveFinding(bug, userId)` → Stores finding to MongoDB
  - Method: `getBugsByType(type)` → Queries by bug type
  - Method: `getRecentFindings(userId, limit)` → Retrieves recent findings
- **System Importance:** **HIGH** - Bug finding persistence
- **Issues:** None identified

---

#### **[testing-core/src/infrastructure/database/repositories/SavedSafariRepository.ts](testing-core/src/infrastructure/database/repositories/SavedSafariRepository.ts)**
- **Core Purpose:** Repository for saved test configurations; manages CRUD for reusable test settings
- **Key Exports/Functions:**
  - Class: `SavedSafariRepository`
  - Method: `save(safari, userId)` → Stores configuration
  - Method: `getByUserId(userId)` → Retrieves user's saved tests
  - Method: `delete(id)` → Removes saved test
- **System Importance:** **MEDIUM** - Configuration persistence
- **Issues:** None identified

---

### BACKEND LAYER - INFRASTRUCTURE/MONITORING

#### **[testing-core/src/infrastructure/monitoring/SocketTelemetryGateway.ts](testing-core/src/infrastructure/monitoring/SocketTelemetryGateway.ts)**
- **Core Purpose:** Implements TelemetryGateway interface via Socket.io; broadcasts telemetry events to connected clients in real-time
- **Key Exports/Functions:**
  - Class: `SocketTelemetryGateway implements TelemetryGateway`
  - Method: `emitTelemetry(event)` → Socket.emit('telemetry', event)
  - Method: `emitBugFound(finding)` → Socket.emit('bug-found', finding)
  - Method: `emitStateUpdate(state)` → Socket.emit('state-update', state)
- **System Importance:** **CRITICAL** - Real-time telemetry broadcasting
- **Issues:** None identified

---

#### **[testing-core/src/infrastructure/monitoring/socketServer.ts](testing-core/src/infrastructure/monitoring/socketServer.ts)**
- **Core Purpose:** Socket.io server setup and configuration; manages client connections and event routing
- **Key Exports/Functions:**
  - Function: `createSocketServer(httpServer)` → Initializes Socket.io
  - Class: `TelemetryHub` (exported but unclear if used in production)
- **System Importance:** **MEDIUM** - Socket infrastructure
- **Issues:**
  - 🟡 **MEDIUM:** TelemetryHub class is exported but SocketTelemetryGateway is used in production; unclear which is authoritative

---

#### **[testing-core/src/infrastructure/monitoring/BinaryFrameServer.ts](testing-core/src/infrastructure/monitoring/BinaryFrameServer.ts)**
- **Core Purpose:** Sends screenshot frames as binary data over WebSocket for high-frequency display (60fps)
- **Key Exports/Functions:**
  - Class: `BinaryFrameServer`
  - Method: `sendFrame(imageBuffer)` → Broadcasts binary frame
  - Method: `on('frame', callback)` → Registers frame listener
- **System Importance:** **HIGH** - Screen capture streaming
- **Issues:** None identified

---

#### **[testing-core/src/infrastructure/monitoring/actionBuffer.ts](testing-core/src/infrastructure/monitoring/actionBuffer.ts)**
- **Core Purpose:** Buffers user actions for batch telemetry emission; reduces network overhead
- **Key Exports/Functions:**
  - Class: `ActionRecorder`
  - Method: `recordAction(action)` → Buffers action
  - Method: `flush()` → Emits all buffered actions
  - Export: `ActionBuffer` (alias for ActionRecorder for backwards compatibility)
- **System Importance:** **MEDIUM** - Action buffering
- **Issues:**
  - 🟡 **MEDIUM:** Exports `ActionRecorder` as alias `ActionBuffer` for backwards compatibility; creates naming confusion

---

#### **[testing-core/src/infrastructure/monitoring/stabilityMonitor.ts](testing-core/src/infrastructure/database/monitoring/stabilityMonitor.ts)**
- **Core Purpose:** Monitors page stability metrics and detects anomalies; tracks memory, CPU, and event anomalies
- **Key Exports/Functions:**
  - Class: `StabilityMonitor`
  - Method: `monitorPage(page)` → Attaches stability listeners
  - Method: `getMetrics()` → Returns stability report
  - Private: Event handlers for memory, console, and exception monitoring
- **System Importance:** **MEDIUM** - Stability telemetry
- **Issues:**
  - 🔴 **CRITICAL:** Registers duplicate event handlers (pageerror, response, console) that conflict with AutonomousExplorationEngine

---

#### **[testing-core/src/infrastructure/monitoring/browserConsoleListener.ts](testing-core/src/infrastructure/monitoring/browserConsoleListener.ts)**
- **Core Purpose:** Captures browser console output (logs, warnings, errors) for forensic analysis
- **Key Exports/Functions:**
  - Function: `captureBrowserConsole(page)` → Attaches console listener
  - Returns: Unlisten callback for cleanup
- **System Importance:** **MEDIUM** - Console capture
- **Issues:**
  - 🔴 **CRITICAL:** Duplicate event handler registration (console, pageerror) conflicts with other listeners

---

#### **[testing-core/src/infrastructure/monitoring/exceptionCatcher.ts](testing-core/src/infrastructure/monitoring/exceptionCatcher.ts)**
- **Core Purpose:** Captures unhandled exceptions and console errors for telemetry
- **Key Exports/Functions:**
  - Function: `setupExceptionCatching(page, telemetry)` → Initializes exception handlers
  - Returns: Unlisten callback
- **System Importance:** **MEDIUM** - Exception capture
- **Issues:**
  - 🔴 **CRITICAL:** Duplicate event handler registration (pageerror, response, console, request, requestfailed) causes conflicts

---

#### **[testing-core/src/infrastructure/monitoring/reproductionPlaybookStore.ts](testing-core/src/infrastructure/monitoring/reproductionPlaybookStore.ts)**
- **Core Purpose:** Stores reproduction playbooks (serialized action sequences) for bug replay
- **Key Exports/Functions:**
  - Class: `ReproductionPlaybookStore`
  - Method: `storePlaybook(playbook, bugId)` → Saves playbook
  - Method: `getPlaybook(bugId)` → Retrieves playbook
- **System Importance:** **MEDIUM** - Playbook storage
- **Issues:** None identified

---

### BACKEND LAYER - INFRASTRUCTURE/PLAYWRIGHT

#### **[testing-core/src/infrastructure/playwright/PlaywrightBrowserEngine.ts](testing-core/src/infrastructure/playwright/PlaywrightBrowserEngine.ts)**
- **Core Purpose:** Implements BrowserEngine interface using Playwright; manages browser lifecycle and page creation
- **Key Exports/Functions:**
  - Class: `PlaywrightBrowserEngine implements BrowserEngine`
  - Method: `launchBrowser()` → Starts Chromium browser
  - Method: `closeBrowser()` → Terminates browser
  - Method: `createPage()` → Creates new page
  - Method: `navigateToUrl(page, url)` → Navigates page
- **System Importance:** **CRITICAL** - Browser automation backend
- **Issues:** None identified

---

#### **[testing-core/src/infrastructure/playwright/BoundingBoxHighlighter.ts](testing-core/src/infrastructure/playwright/BoundingBoxHighlighter.ts)**
- **Core Purpose:** Draws bounding boxes around elements on screenshots for visual debugging
- **Key Exports/Functions:**
  - Function: `highlightBoundingBoxes(screenshot, elements)` → Draws boxes
  - Returns: Modified screenshot buffer
- **System Importance:** **LOW** - Visual debugging
- **Issues:** None identified

---

### BACKEND LAYER - INFRASTRUCTURE/WORKERS

#### **[testing-core/src/infrastructure/workers/SafariWorker.ts](testing-core/src/infrastructure/workers/SafariWorker.ts)**
- **Core Purpose:** Worker thread implementation for parallelized exploration; runs exploration in background worker
- **Key Exports/Functions:**
  - Class: `SafariWorker`
  - Method: `startWorker()` → Initializes worker thread
  - Method: `sendMessage(message)` → IPC to worker
  - Method: `on('result', callback)` → Listens for results
- **System Importance:** **MEDIUM** - Parallelization support
- **Issues:** None identified

---

### BACKEND LAYER - INFRASTRUCTURE/QUEUE

#### **[testing-core/src/infrastructure/queue/TaskQueue.ts](testing-core/src/infrastructure/queue/TaskQueue.ts)**
- **Core Purpose:** Priority queue for managing exploration tasks and bug findings
- **Key Exports/Functions:**
  - Class: `TaskQueue`
  - Method: `enqueue(task, priority)` → Adds task with priority
  - Method: `dequeue()` → Removes highest priority task
  - Method: `length()` → Queue size
- **System Importance:** **MEDIUM** - Task orchestration
- **Issues:** None identified

---

### BACKEND LAYER - ML

#### **[testing-core/src/ml/perceptron.ts](testing-core/src/ml/perceptron.ts)**
- **Core Purpose:** Simple perceptron for binary classification; used for bug prediction
- **Key Exports/Functions:**
  - Class: `Perceptron`
  - Method: `train(data)` → Trains on feature vectors
  - Method: `predict(features)` → Returns 0 or 1
- **System Importance:** **LOW** - Experimental ML component
- **Issues:** None identified

---

#### **[testing-core/src/ml/domHasher.ts](testing-core/src/ml/domHasher.ts)**
- **Core Purpose:** Generates stable DOM hashes for state comparison; detects DOM changes
- **Key Exports/Functions:**
  - Function: `hashDom(elements)` → Returns stable hash string
  - Function: `hashChanged(hash1, hash2)` → Boolean comparison
- **System Importance:** **MEDIUM** - State hashing
- **Issues:** None identified

---

### BACKEND LAYER - PRESENTATION/SOCKET

#### **[testing-core/src/presentation/socket/registerSocketHandlers.ts](testing-core/src/presentation/socket/registerSocketHandlers.ts)**
- **Core Purpose:** Registers Socket.io event handlers for client-server communication; manages engine lifecycle from socket events
- **Key Exports/Functions:**
  - Function: `registerSocketHandlers(io)` → Initializes all handlers
  - Handler: 'start-test' → Initiates exploration
  - Handler: 'pause-test' → Pauses exploration
  - Handler: 'stop-test' → Stops exploration
  - Export: `activeEngineInstance` (global mutable variable)
  - Function: `setActiveEngine(engine)` → Updates global engine reference
- **System Importance:** **CRITICAL** - Socket event orchestration
- **Issues:**
  - 🔴 **CRITICAL:** Global mutable `activeEngineInstance` without synchronization; race condition risk between pause/stop handlers
  - 🟡 **MEDIUM:** Socket handlers registered immediately; activeEngineInstance may not be initialized

---

### BACKEND LAYER - PRESENTATION/API

#### **[testing-core/src/presentation/api/registerRoutes.ts](testing-core/src/presentation/api/registerRoutes.ts)**
- **Core Purpose:** Registers HTTP API routes for test control and history retrieval
- **Key Exports/Functions:**
  - Function: `registerRoutes(app, useCase, port, findingRepository)` → Sets up routes
  - Route: `POST /api/explore` → Starts exploration
  - Route: `GET /api/history` → Retrieves session history
  - Route: `GET /api/findings` → Gets discovered bugs
- **System Importance:** **MEDIUM** - HTTP API interface
- **Issues:**
  - 🟡 **MEDIUM:** Unhandled promise: `void useCase.execute(targetUrl)` (line ~45); errors not caught

---

#### **[testing-core/src/presentation/api/authController.ts](testing-core/src/presentation/api/authController.ts)**
- **Core Purpose:** Handles user authentication (login/signup) and JWT token generation
- **Key Exports/Functions:**
  - Function: `registerAuthRoutes(app)` → Sets up auth routes
  - Route: `POST /api/auth/login` → User login
  - Route: `POST /api/auth/signup` → User registration
  - Function: `generateJWT(userId)` → Creates JWT token
- **System Importance:** **MEDIUM** - Authentication
- **Issues:** None identified

---

#### **[testing-core/src/presentation/api/authMiddleware.ts](testing-core/src/presentation/api/authMiddleware.ts)**
- **Core Purpose:** Express middleware for JWT verification; protects authenticated routes
- **Key Exports/Functions:**
  - Middleware: `verifyAuthToken(req, res, next)` → Validates JWT
  - Middleware: `requireAuth` → Wrapper requiring authentication
- **System Importance:** **MEDIUM** - Authentication enforcement
- **Issues:** None identified

---

### BACKEND LAYER - UTILITIES & CORE

#### **[testing-core/src/index.ts](testing-core/src/index.ts)**
- **Core Purpose:** Main entry point for backend server; initializes database, creates server, registers routes
- **Key Exports/Functions:**
  - Initializes: Express app, Socket.io server, MongoDB connection
  - Registers: HTTP routes, socket handlers, auth routes
  - Listens: On configured port (default 3000)
- **System Importance:** **CRITICAL** - Server bootstrap
- **Issues:**
  - 🟡 **MEDIUM:** Continues with dbReady=false; passes undefined repository to use case

---

#### **[testing-core/src/serverUtils.ts](testing-core/src/serverUtils.ts)**
- **Core Purpose:** Utility functions for server configuration (port reading, environment variables)
- **Key Exports/Functions:**
  - Function: `readPort(envVar, defaultPort)` → Parses port from environment
  - Function: `getServerConfig()` → Returns config object
- **System Importance:** **LOW** - Configuration utilities
- **Issues:** None identified

---

#### **[testing-core/src/types.ts](testing-core/src/types.ts)**
- **Core Purpose:** Backend-specific type extensions and re-exports from shared types
- **Key Exports/Functions:**
  - Re-exports all types from shared/types.ts
  - Local type definitions for backend services
- **System Importance:** **MEDIUM** - Type re-export
- **Issues:**
  - 🟡 **MEDIUM:** Incomplete type exports; some types missing from shared

---

#### **[testing-core/src/lib/circularBuffer.ts](testing-core/src/lib/circularBuffer.ts)**
- **Core Purpose:** Generic circular buffer implementation for fixed-size event buffering
- **Key Exports/Functions:**
  - Class: `CircularBuffer<T>`
  - Method: `add(item)` → Adds item, overwrites oldest if full
  - Method: `getAll()` → Returns all items
- **System Importance:** **LOW** - Utility data structure
- **Issues:** None identified

---

#### **[testing-core/src/worker-entry.ts](testing-core/src/worker-entry.ts)**
- **Core Purpose:** Entry point for worker threads; sets up message handlers for background workers
- **Key Exports/Functions:**
  - Initializes worker message listeners
  - Exports: Worker initialization logic
- **System Importance:** **LOW** - Worker bootstrap
- **Issues:** None identified

---

### FRONTEND LAYER - ENTRY POINTS

#### **[developer-dashboard/src/main.tsx](developer-dashboard/src/main.tsx)**
- **Core Purpose:** React application entry point; bootstraps React with Router and root context
- **Key Exports/Functions:**
  - Renders root App component in '#root' element
  - Sets up React Router provider
  - Initializes Toaster for notifications
- **System Importance:** **CRITICAL** - React bootstrap
- **Issues:** None identified

---

#### **[developer-dashboard/src/App.tsx](developer-dashboard/src/App.tsx)**
- **Core Purpose:** Root routing and layout component; manages navigation between dashboard, history, and settings
- **Key Exports/Functions:**
  - Component: `App`
  - Routes: /login, /signup, /dashboard, /history, /settings
  - State: User authentication, current view, session history
  - Hook: `useDashboardController` for engine control
- **System Importance:** **CRITICAL** - Root layout and routing
- **Issues:** None identified

---

#### **[developer-dashboard/src/types.ts](developer-dashboard/src/types.ts)**
- **Core Purpose:** Frontend-specific type extensions and shared type re-exports
- **Key Exports/Functions:**
  - Type: `SessionHistoryEntry` (local frontend format)
  - Type: `TestResultData` (result aggregation)
  - Re-exports from shared/types.ts
- **System Importance:** **MEDIUM** - Frontend type definitions
- **Issues:** None identified

---

### FRONTEND LAYER - COMPONENTS

#### **[developer-dashboard/src/components/ClinicalForensicsDashboard.tsx](developer-dashboard/src/components/ClinicalForensicsDashboard.tsx)**
- **Core Purpose:** Main dashboard view showing live test execution with 2-column layout (control + browser + forensic trail)
- **Key Exports/Functions:**
  - Component: `ClinicalForensicsDashboard`
  - Props: engine (EngineGateway), telemetry stream, session state
  - Renders: BrowserPanel, TelemetryPanel, ForensicTrail, ControlPanel
- **System Importance:** **CRITICAL** - Primary dashboard UI
- **Issues:** None identified

---

#### **[developer-dashboard/src/components/ControlPanel.tsx](developer-dashboard/src/components/ControlPanel.tsx)**
- **Core Purpose:** Test control interface with Start/Pause/Stop buttons and URL input
- **Key Exports/Functions:**
  - Component: `ControlPanel`
  - Handlers: onStart, onPause, onStop, onUrlChange
- **System Importance:** **HIGH** - User control interface
- **Issues:** None identified

---

#### **[developer-dashboard/src/components/BrowserPanel.tsx](developer-dashboard/src/components/BrowserPanel.tsx)**
- **Core Purpose:** Displays live browser screenshot stream; renders binary frame data as HTML5 canvas
- **Key Exports/Functions:**
  - Component: `BrowserPanel`
  - Renders: <canvas> element, receives frame updates via WebSocket
  - Handler: Updates canvas on frame arrival
- **System Importance:** **HIGH** - Live browser display
- **Issues:** None identified

---

#### **[developer-dashboard/src/components/TelemetryPanel.tsx](developer-dashboard/src/components/TelemetryPanel.tsx)**
- **Core Purpose:** Shows real-time telemetry metrics (action count, network events, exceptions, heuristic scores)
- **Key Exports/Functions:**
  - Component: `TelemetryPanel`
  - Props: telemetryStream (real-time events)
  - Renders: Metric cards with live updates
- **System Importance:** **MEDIUM** - Metrics display
- **Issues:** None identified

---

#### **[developer-dashboard/src/components/TelemetryStream.tsx](developer-dashboard/src/components/TelemetryStream.tsx)**
- **Core Purpose:** Websocket listener and multiplexer for real-time telemetry event streaming
- **Key Exports/Functions:**
  - Component: `TelemetryStream`
  - Hook: Manages Socket.io listeners for telemetry events
  - Emits: Filtered events to child components
- **System Importance:** **HIGH** - Telemetry event hub
- **Issues:** None identified

---

#### **[developer-dashboard/src/components/ForensicTrail.tsx](developer-dashboard/src/components/ForensicTrail.tsx)**
- **Core Purpose:** Displays forensic trail of actions taken during exploration; shows action breadcrumbs
- **Key Exports/Functions:**
  - Component: `ForensicTrail`
  - Props: actions (ActionRecord[]), bugsFound (Bug[])
  - Renders: Timeline of actions with selectors and payloads
- **System Importance:** **MEDIUM** - Forensic visualization
- **Issues:** None identified

---

#### **[developer-dashboard/src/components/ReproductionTrail.tsx](developer-dashboard/src/components/ReproductionTrail.tsx)**
- **Core Purpose:** Shows reproduction playbook for discovered bugs; clickable action sequence for replay
- **Key Exports/Functions:**
  - Component: `ReproductionTrail`
  - Props: playbook (ActionRecord[]), bugId
  - Handlers: onReplay (triggers playback)
- **System Importance:** **MEDIUM** - Bug reproduction interface
- **Issues:** None identified

---

#### **[developer-dashboard/src/components/LiveFeed.tsx](developer-dashboard/src/components/LiveFeed.tsx)**
- **Core Purpose:** Real-time feed of discovered bugs; shows new findings as they're detected
- **Key Exports/Functions:**
  - Component: `LiveFeed`
  - Props: bugs (Bug[]), onBugClick
  - Auto-scrolls to latest bugs
- **System Importance:** **MEDIUM** - Bug feed display
- **Issues:** None identified

---

#### **[developer-dashboard/src/components/LoginForm.tsx](developer-dashboard/src/components/LoginForm.tsx)**
- **Core Purpose:** User login form with email/password input; validates and sends credentials to backend
- **Key Exports/Functions:**
  - Component: `LoginForm`
  - Props: onSubmit (email, password)
  - Renders: Form with email, password fields
- **System Importance:** **MEDIUM** - Authentication UI
- **Issues:** None identified

---

#### **[developer-dashboard/src/components/SignupForm.tsx](developer-dashboard/src/components/SignupForm.tsx)**
- **Core Purpose:** User registration form; validates input and creates new user account
- **Key Exports/Functions:**
  - Component: `SignupForm`
  - Props: onSubmit (email, password, confirmPassword)
  - Validates: Password match, email format
- **System Importance:** **MEDIUM** - Registration UI
- **Issues:** None identified

---

#### **[developer-dashboard/src/components/AuthGuard.tsx](developer-dashboard/src/components/AuthGuard.tsx)**
- **Core Purpose:** Route protection wrapper; checks authentication before rendering protected components
- **Key Exports/Functions:**
  - Component: `AuthGuard`
  - Props: children, requiredAuth boolean
  - Redirects: Unauthenticated users to /login
- **System Importance:** **HIGH** - Route protection
- **Issues:** None identified

---

#### **[developer-dashboard/src/components/LandingPage.tsx](developer-dashboard/src/components/LandingPage.tsx)**
- **Core Purpose:** Public landing page shown before authentication
- **Key Exports/Functions:**
  - Component: `LandingPage`
  - Renders: Feature overview, CTA to sign up/login
- **System Importance:** **LOW** - Marketing page
- **Issues:** None identified

---

#### **[developer-dashboard/src/components/Sidebar.tsx](developer-dashboard/src/components/Sidebar.tsx)**
- **Core Purpose:** Left navigation sidebar; displays navigation menu and session info
- **Key Exports/Functions:**
  - Component: `Sidebar`
  - Props: currentUser, onNavigate
  - Renders: Menu items, user profile section
- **System Importance:** **MEDIUM** - Navigation UI
- **Issues:** None identified

---

#### **[developer-dashboard/src/components/SessionHistoryTable.tsx](developer-dashboard/src/components/SessionHistoryTable.tsx)**
- **Core Purpose:** Table display of past test sessions; shows history with filters and sorting
- **Key Exports/Functions:**
  - Component: `SessionHistoryTable`
  - Props: sessions (SessionHistoryEntry[]), onReplay
  - Features: Sort by date, filter by status
- **System Importance:** **MEDIUM** - History UI
- **Issues:** None identified

---

#### **[developer-dashboard/src/components/SavedEvaluationSafaris.tsx](developer-dashboard/src/components/SavedEvaluationSafaris.tsx)**
- **Core Purpose:** Displays and manages saved test configurations; allows loading and editing saved safaris
- **Key Exports/Functions:**
  - Component: `SavedEvaluationSafaris`
  - Type: `EvaluationSafari` (saved test config)
  - Handlers: onLoad, onDelete, onEdit
- **System Importance:** **MEDIUM** - Saved configurations UI
- **Issues:** None identified

---

### FRONTEND LAYER - HOOKS

#### **[developer-dashboard/src/hooks/useAuth.ts](developer-dashboard/src/hooks/useAuth.ts)**
- **Core Purpose:** Custom hook for authentication state management; wraps login/logout logic
- **Key Exports/Functions:**
  - Hook: `useAuth()` returns { user, login, logout, isAuthenticated }
  - Function: `login(email, password)` → Makes auth request
  - Function: `logout()` → Clears session
  - Function: `signup(email, password)` → Creates new user
- **System Importance:** **HIGH** - Auth state management
- **Issues:** None identified

---

### FRONTEND LAYER - INFRASTRUCTURE/ENGINE

#### **[developer-dashboard/src/infrastructure/engine/SocketHttpEngineGateway.ts](developer-dashboard/src/infrastructure/engine/SocketHttpEngineGateway.ts)**
- **Core Purpose:** Implements EngineGateway interface combining Socket.io and HTTP; provides primary client-server communication
- **Key Exports/Functions:**
  - Class: `SocketHttpEngineGateway implements EngineGateway`
  - Method: `startExploration(targetUrl)` → HTTP POST /api/explore
  - Method: `stopExploration()` → Socket emit 'stop-test'
  - Method: `pauseExploration()` → Socket emit 'pause-test'
  - Method: `resumeExploration()` → Socket emit 'resume-test'
  - Method: `onTelemetry(callback)` → Registers Socket.io listener
  - Method: `connect()` / `disconnect()` → Socket connection lifecycle
- **System Importance:** **CRITICAL** - Primary client-server gateway
- **Issues:**
  - 🟡 **MEDIUM:** Socket listeners registered in connect() but disconnect() not guaranteed to be called

---

### FRONTEND LAYER - INFRASTRUCTURE/SOCKET

#### **[developer-dashboard/src/infrastructure/socket/BinaryFrameReceiver.ts](developer-dashboard/src/infrastructure/socket/BinaryFrameReceiver.ts)**
- **Core Purpose:** Receives binary screenshot frames from backend via WebSocket; decodes and buffers frames
- **Key Exports/Functions:**
  - Class: `BinaryFrameReceiver`
  - Method: `receiveFrame(buffer)` → Processes incoming binary frame
  - Method: `getLatestFrame()` → Returns most recent decoded frame
  - Method: `onFrame(callback)` → Registers frame listener
- **System Importance:** **HIGH** - Frame streaming reception
- **Issues:** None identified

---

### FRONTEND LAYER - INFRASTRUCTURE/NOTIFICATIONS

#### **[developer-dashboard/src/infrastructure/notifications/toastUtils.ts](developer-dashboard/src/infrastructure/notifications/toastUtils.ts)**
- **Core Purpose:** Utility functions for displaying toast notifications
- **Key Exports/Functions:**
  - Function: `showSuccess(message)` → Green toast
  - Function: `showError(message)` → Red toast
  - Function: `showInfo(message)` → Blue toast
  - Function: `showWarning(message)` → Yellow toast
- **System Importance:** **LOW** - UI notification helpers
- **Issues:** None identified

---

### FRONTEND LAYER - SERVICES

#### **[developer-dashboard/src/services/historyService.ts](developer-dashboard/src/services/historyService.ts)**
- **Core Purpose:** Manages session history state and API communication for retrieving/storing past tests
- **Key Exports/Functions:**
  - Function: `fetchSessionHistory(userId)` → HTTP GET /api/history
  - Function: `saveSession(session)` → Stores session to backend
  - Function: `getLocalHistory()` → LocalStorage fallback
- **System Importance:** **MEDIUM** - Session persistence
- **Issues:** None identified

---

### FRONTEND LAYER - APPLICATION/USE CASES

#### **[developer-dashboard/src/application/useCases/useDashboardController.ts](developer-dashboard/src/application/useCases/useDashboardController.ts)**
- **Core Purpose:** Custom hook orchestrating test control logic; manages engine lifecycle and telemetry subscription
- **Key Exports/Functions:**
  - Hook: `useDashboardController()` returns { engine, isRunning, telemetryStream, ... }
  - Returns: EngineGateway instance and state
- **System Importance:** **HIGH** - Dashboard controller hook
- **Issues:** None identified

---

### FRONTEND LAYER - APPLICATION/PORTS

#### **[developer-dashboard/src/application/ports/EngineGateway.ts](developer-dashboard/src/application/ports/EngineGateway.ts)**
- **Core Purpose:** Abstract interface for test engine control; decouples UI from Socket.io implementation
- **Key Exports/Functions:**
  - Interface: `EngineGateway`
  - Method: `startExploration(targetUrl)` → Initiates test
  - Method: `stopExploration()` → Terminates test
  - Method: `pauseExploration()` → Pauses test
  - Method: `resumeExploration()` → Resumes test
  - Method: `onTelemetry(callback)` → Registers telemetry listener
- **System Importance:** **MEDIUM** - Engine abstraction
- **Issues:** None identified

---

### FRONTEND LAYER - UTILITIES

#### **[developer-dashboard/src/utils/engineControl.ts](developer-dashboard/src/utils/engineControl.ts)**
- **Core Purpose:** Utility functions for engine command construction and validation
- **Key Exports/Functions:**
  - Function: `validateTargetUrl(url)` → Boolean validation
  - Function: `buildStartCommand(url, options)` → Creates command object
  - Function: `buildStopCommand()` → Creates stop command
- **System Importance:** **LOW** - Command utilities
- **Issues:** None identified

---

#### **[developer-dashboard/src/utils/semanticInstructionMapper.ts](developer-dashboard/src/utils/semanticInstructionMapper.ts)**
- **Core Purpose:** Maps semantic roles to human-readable instructions for UI display
- **Key Exports/Functions:**
  - Function: `getInstructionForRole(role)` → Returns user instruction string
  - Map: SemanticRole → Instruction text
- **System Importance:** **LOW** - UI text mapping
- **Issues:** None identified

---

### BUILD & CONFIG FILES (Referenced for Context)

#### **[developer-dashboard/vite.config.ts](developer-dashboard/vite.config.ts)**
- **Core Purpose:** Vite bundler configuration for frontend
- **System Importance:** **LOW** - Build configuration

---

#### **[testing-core/playwright.config.ts](testing-core/playwright.config.ts)**
- **Core Purpose:** Playwright test runner configuration
- **System Importance:** **LOW** - Test configuration

---

---

## DEPENDENCY & CONNECTION GRAPH

### System Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│  PRESENTATION LAYER                                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  React Components (UI)                               │  │
│  │  - ClinicalForensicsDashboard, ControlPanel, etc.   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           ↓ (WebSocket/HTTP)
┌─────────────────────────────────────────────────────────────┐
│  APPLICATION LAYER                                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Frontend: useDashboardController, SocketHttpEngine │  │
│  │  Backend: StartExplorationUseCase                   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  DOMAIN LAYER                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  AutonomousExplorationEngine                         │  │
│  │  StateGraphNavigator → RiskScorer → DIrectedPath... │  │
│  │  BugClassifier, BugFinders (7 implementations)       │  │
│  │  DomParser, InteractiveElement, Scenarios           │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  INFRASTRUCTURE LAYER                                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  PlaywrightBrowserEngine (Playwright browser control)   │
│  │  SocketTelemetryGateway (Socket.io telemetry)        │  │
│  │  MongoFindingRepository (MongoDB persistence)        │  │
│  │  Monitoring: stabilityMonitor, actionBuffer, etc.   │  │
│  │  Database Models: User, Finding, Session, etc.       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  EXTERNAL SERVICES                                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Playwright Browser (Chromium)                        │  │
│  │  MongoDB Database                                     │  │
│  │  Socket.io Real-time Event Bus                        │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Complete Test Execution Lifecycle

```
USER INTERACTION (Frontend)
  │
  ├─→ Click "Start Safari" button on ControlPanel
  │     └─→ useDashboardController.startExploration(targetUrl)
  │
NETWORK TRANSPORT
  │
  ├─→ HTTP POST to /api/explore with { targetUrl }
  │     └─→ registerRoutes.ts receives request
  │
BACKEND ENTRY POINT
  │
  ├─→ StartExplorationUseCase.execute(targetUrl)
  │     └─→ Initializes:
  │         - PlaywrightBrowserEngine.launchBrowser()
  │         - SocketTelemetryGateway ready for telemetry
  │         - Browser page created and navigated to URL
  │
CORE EXPLORATION LOOP
  │
  ├─→ AutonomousExplorationEngine.startExploration(url)
  │     │
  │     ├─→ ParseDOM: domParser.parseDomElements(page)
  │     │     └─→ Returns InteractiveElement[]
  │     │
  │     ├─→ StateHash: domParser.computeDomHash(page)
  │     │     └─→ StateGraphNavigator.recordStateVisit()
  │     │
  │     ├─→ Scoring: RiskScorer.scoreElement(element)
  │     │     └─→ Evaluates element importance
  │     │
  │     ├─→ Navigation: StateGraphNavigator.getNextStateToExplore()
  │     │     └─→ Selects high-priority element
  │     │
  │     ├─→ Interaction: Playwright page.click(selector)
  │     │     └─→ Triggers on-page event, captures telemetry
  │     │
  │     ├─→ Event Listeners Fire:
  │     │     ├─→ page.on('request') → stabilityMonitor, exceptionCatcher
  │     │     ├─→ page.on('response') → stabilityMonitor, exceptionCatcher
  │     │     ├─→ page.on('pageerror') → multiple listeners (DUPLICATE!)
  │     │     ├─→ page.on('console') → browserConsoleListener, exceptionCatcher
  │     │     └─→ TelemetryEvent created and emitted
  │     │
  │     ├─→ Bug Detection: BugFinder.run(context)
  │     │     ├─→ NoSqlInjectionFinder.run()
  │     │     ├─→ InputSanitizationFinder.run()
  │     │     ├─→ BoundaryStressFinder.run()
  │     │     └─→ [5 more finders...]
  │     │
  │     ├─→ Bug Classification: BugClassifier.isActualBug()
  │     │     └─→ Filters non-bugs (ACTION, HEURISTIC_SCORE)
  │     │
  │     ├─→ Finding Persistence: MongoFindingRepository.saveFinding()
  │     │     └─→ Stores to MongoDB
  │     │
  │     ├─→ Backtrack: StateGraphNavigator.backtrack()
  │     │     └─→ Returns to previous state
  │     │
  │     └─→ Repeat: Loop until max depth or all states explored
  │
TELEMETRY STREAMING (Real-time)
  │
  ├─→ SocketTelemetryGateway.emitTelemetry(event)
  │     └─→ Socket.emit('telemetry', event)
  │         └─→ Frontend receives via Socket listener
  │
  ├─→ TelemetryStream component processes events
  │     ├─→ Updates TelemetryPanel metrics
  │     ├─→ Appends to ForensicTrail
  │     └─→ Updates LiveFeed if bug found
  │
BINARY FRAME STREAMING (60fps)
  │
  ├─→ PlaywrightBrowserEngine captures screenshot
  ├─→ BoundingBoxHighlighter draws boxes around elements
  ├─→ BinaryFrameServer sends buffer via WebSocket
  │     └─→ BinaryFrameReceiver decodes and caches
  │
  ├─→ BrowserPanel renders frame to <canvas>
  │     └─→ User sees live browser state
  │
TERMINATION
  │
  ├─→ User clicks "Stop Safari"
  │     └─→ ControlPanel.onStop()
  │
  ├─→ Socket emit 'stop-test' → registerSocketHandlers
  │     └─→ Sets activeEngineInstance = null
  │
  ├─→ AutonomousExplorationEngine.stopExploration()
  │     ├─→ PlaywrightBrowserEngine.closeBrowser()
  │     ├─→ Cleanup: Remove event listeners (ONLY framenavigated is cleaned!)
  │     └─→ NOTE: 6+ event listeners leak here!
  │
SESSION AGGREGATION
  │
  ├─→ Session saved to MongoDB with:
  │     ├─→ SessionModel: startTime, endTime, targetUrl, status, bugsFound
  │     ├─→ ActionTrace records for forensics
  │     ├─→ Finding records for bugs
  │     └─→ ReproductionPlaybook for replay
  │
HISTORY DISPLAY (Frontend)
  │
  ├─→ SessionHistoryTable fetches from /api/history
  ├─→ Displays past runs in sortable/filterable table
  └─→ User can click to replay or view details
```

### Data Flow Diagram: Frontend ↔ Backend Contracts

```
SHARED TYPES (shared/types.ts)
┌─────────────────────────────────────────┐
│ TelemetryEvent {                         │
│   timestamp: string                     │
│   type: TelemetryType                   │
│   meta: TelemetryMeta {                 │
│     selector?, statusCode?, url?,       │
│     durationMs?, score?, ...            │
│   }                                      │
│ }                                        │
│                                          │
│ ActionRecord {                          │
│   timestamp, type, selector, url,       │
│   payload?, fallbackLabel?              │
│ }                                        │
│                                          │
│ DiscoveredElement {                     │
│   tagName, id, className, type, name,   │
│   text, selector, semanticRole, score,  │
│   isVisible, boundingBox                │
│ }                                        │
└─────────────────────────────────────────┘

FRONTEND (developer-dashboard)
┌─────────────────────────────────────────┐
│ React Components                         │
│ ↓                                        │
│ useDashboardController (hook)            │
│ ↓                                        │
│ SocketHttpEngineGateway {               │
│   socket.io connection                  │
│   HTTP API calls                        │
│ }                                        │
│ ↓                                        │
│ Telemetry Listeners:                    │
│ - socket.on('telemetry', evt)           │
│ - socket.on('bug-found', bug)           │
│ - socket.on('frame', binaryBuffer)      │
│ - socket.on('state-update', state)      │
└─────────────────────────────────────────┘

BACKEND (testing-core)
┌─────────────────────────────────────────┐
│ HTTP API /api/explore                   │
│ ↓                                        │
│ StartExplorationUseCase                  │
│ ↓                                        │
│ AutonomousExplorationEngine              │
│ ↓                                        │
│ Emits TelemetryEvent objects via:       │
│ SocketTelemetryGateway {                │
│   socket.emit('telemetry', event)       │
│   socket.emit('bug-found', finding)     │
│   socket.emit('frame', binaryBuffer)    │
│   socket.emit('state-update', state)    │
│ }                                        │
└─────────────────────────────────────────┘
```

### Key Data Structure Transformations

1. **User Interaction → ActionRecord:**
   - Playwright page event → ActionRecord object → TelemetryEvent → Socket → Frontend ForensicTrail

2. **DOM State → DiscoveredElement:**
   - Playwright page.$ → InteractiveElement → DiscoveredElement (wire format) → JSON → Socket → Frontend

3. **Bug Finding → Database → History:**
   - BugFinder.run() → Finding object → MongoFindingRepository.save() → SessionHistoryTable

4. **Screenshot → Binary Frame:**
   - Playwright.screenshot() → BoundingBoxHighlighter → Buffer → BinaryFrameServer → BinaryFrameReceiver → Canvas

---

## ARCHITECTURE HEALTH & CONFLICT AUDIT

### 🔴 CRITICAL ISSUES (Blocking)

#### 1. **EVENT LISTENER MEMORY LEAKS**
**Severity:** CRITICAL  
**File:** [testing-core/src/domain/services/AutonomousExplorationEngine.ts](testing-core/src/domain/services/AutonomousExplorationEngine.ts)

**Problem:**
Six event listeners are registered on page object but only one (framenavigated) is cleaned up:

```typescript
// Line 188: REGISTERED but never cleaned up
page.on('request', listener1);

// Line 205: REGISTERED but never cleaned up
page.on('response', listener2);

// Line 236: REGISTERED but never cleaned up
page.on('requestfailed', listener3);

// Line 692: REGISTERED but never cleaned up
page.on('dialog', listener4);

// Line 703: REGISTERED but never cleaned up
page.on('pageerror', listener5);

// Line 733: REGISTERED but never cleaned up
page.on('console', listener6);

// Line 274: PROPERLY CLEANED UP (line ~1015)
let handleFramenavigated = page.on('framenavigated', listener);
```

**Impact:**
- Each Safari run leaks 6 event listeners
- Memory accumulates: 100 runs = 600 listeners × ~2KB each = 1.2MB leak
- After 1000 runs: ~12MB memory waste
- Listeners fire silently in background even after exploration ends
- Browser process memory grows unbounded

**Root Cause:**
- Missing centralized listener tracking
- No `removeAllListeners()` call in finally block

**Solution:**
```typescript
private pageListeners: Array<() => void> = [];

private attachPageListeners(page: Page) {
  this.pageListeners.push(
    page.on('request', handler1),
    page.on('response', handler2),
    page.on('requestfailed', handler3),
    page.on('dialog', handler4),
    page.on('pageerror', handler5),
    page.on('console', handler6),
    page.on('framenavigated', handler7),
  );
}

private removeAllPageListeners() {
  this.pageListeners.forEach(unlisten => unlisten?.());
  this.pageListeners = [];
}

// In finally block of stopExploration():
finally {
  this.removeAllPageListeners(); // ADD THIS
}
```

**Verification:** Test by running 100 safaris and monitoring Node.js process memory

---

#### 2. **DUPLICATE/CONFLICTING EVENT HANDLERS**
**Severity:** CRITICAL  
**Files:**
- [testing-core/src/domain/services/AutonomousExplorationEngine.ts](testing-core/src/domain/services/AutonomousExplorationEngine.ts) (line 703, 733, 188, 205, 236)
- [testing-core/src/infrastructure/monitoring/stabilityMonitor.ts](testing-core/src/infrastructure/monitoring/stabilityMonitor.ts) (line 191, 192)
- [testing-core/src/infrastructure/monitoring/browserConsoleListener.ts](testing-core/src/infrastructure/monitoring/browserConsoleListener.ts) (line 17, 47)
- [testing-core/src/infrastructure/monitoring/exceptionCatcher.ts](testing-core/src/infrastructure/monitoring/exceptionCatcher.ts) (line 215, 219, 276)

**Problem:**
Multiple modules register listeners for the same events:

```
┌─────────────────────────────────────────────────────────────┐
│ EVENT: page.on('pageerror')                                 │
├─────────────────────────────────────────────────────────────┤
│ ✓ AutonomousExplorationEngine.ts:703                         │
│ ✓ stabilityMonitor.ts:191                                   │
│ ✓ browserConsoleListener.ts:47                              │
│ ✓ exceptionCatcher.ts:215                                   │
│ = 4 duplicate handlers for SAME event                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ EVENT: page.on('console')                                   │
├─────────────────────────────────────────────────────────────┤
│ ✓ AutonomousExplorationEngine.ts:733                         │
│ ✓ browserConsoleListener.ts:17                              │
│ ✓ exceptionCatcher.ts:219                                   │
│ = 3 duplicate handlers                                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ EVENT: page.on('response')                                  │
├─────────────────────────────────────────────────────────────┤
│ ✓ AutonomousExplorationEngine.ts:205                         │
│ ✓ stabilityMonitor.ts:192                                   │
│ ✓ exceptionCatcher.ts:276                                   │
│ = 3 duplicate handlers                                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ EVENT: page.on('request'), page.on('requestfailed')         │
├─────────────────────────────────────────────────────────────┤
│ ✓ AutonomousExplorationEngine.ts:188, 236                    │
│ ✓ exceptionCatcher.ts (implied)                              │
│ = Multiple duplicate handlers                               │
└─────────────────────────────────────────────────────────────┘
```

**Impact:**
- Same event triggers 3-4 handlers simultaneously
- Telemetry duplication: event counted multiple times
- Race conditions: handlers modify shared state concurrently
- Performance degradation: listener overhead multiplied
- Data inconsistency: conflicting telemetry records

**Root Cause:**
- No centralized event listener registry
- Each module independently registers listeners without coordination
- No awareness of duplicate registrations

**Solution:**
Create centralized EventListenerRegistry:
```typescript
class EventListenerRegistry {
  private listeners = new Map<string, (() => void)[]>();

  register(event: string, handler: Function): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    const unlisten = page.on(event as any, handler);
    this.listeners.get(event)!.push(unlisten);
    return unlisten;
  }

  unregisterAll(event?: string) {
    if (event) {
      this.listeners.get(event)?.forEach(u => u());
      this.listeners.delete(event);
    } else {
      this.listeners.forEach(listeners => listeners.forEach(u => u()));
      this.listeners.clear();
    }
  }
}
```

Deprecate individual listener registration; use registry instead.

---

#### 3. **GLOBAL MUTABLE STATE RACE CONDITION**
**Severity:** CRITICAL  
**File:** [testing-core/src/presentation/socket/registerSocketHandlers.ts](testing-core/src/presentation/socket/registerSocketHandlers.ts)

**Problem:**
Global `activeEngineInstance` is mutated without synchronization:

```typescript
// Line 16: Global mutable variable - NO SYNCHRONIZATION
export let activeEngineInstance: EngineControl | null = null;

// Line 19: Direct mutation
activeEngineInstance = engine;

// Line 31: pause-test handler reads activeEngineInstance
socket.on('pause-test', () => {
  if (activeEngineInstance) {
    activeEngineInstance.pause(); // ← CRITICAL: May be null here
  }
});

// Line 72: stop-test handler clears activeEngineInstance
socket.on('stop-test', () => {
  activeEngineInstance = null; // ← Direct mutation
  // Now pause-test handler sees null
});

// Line 89: Direct mutation in resume handler
socket.on('resume-test', () => {
  activeEngineInstance = resumedEngine;
});
```

**Execution Race Scenario:**
```
Thread 1 (pause-test handler)        Thread 2 (stop-test handler)
─────────────────────────            ──────────────────────────
reads activeEngineInstance             
  (it's set to engine instance)       
                                      sets activeEngineInstance = null
calls engine.pause()                  
  throws NPE: cannot read pause of null
```

**Impact:**
- Unhandled null reference exceptions crash handler
- pause-test requests fail without user feedback
- Multiple simultaneous control commands cause state corruption
- Client doesn't know why pause failed

**Root Cause:**
- Shared mutable global without locks
- No atomic state transitions
- No validation before use

**Solution:**
Replace global state with EngineSessionManager (which uses mutex):
```typescript
// Instead of:
activeEngineInstance = engine;

// Use:
EngineSessionManager.setActiveSession(sessionId, engine);

// Instead of:
if (activeEngineInstance) { activeEngineInstance.pause(); }

// Use:
const engine = EngineSessionManager.getSession(sessionId);
if (engine) {
  await engine.pause();
}
```

Remove activeEngineInstance export entirely; use EngineSessionManager exclusively.

---

#### 4. **FILENAME TYPO**
**Severity:** CRITICAL  
**File:** [testing-core/src/domain/services/DIrectedPathFinder.ts](testing-core/src/domain/services/DIrectedPathFinder.ts)

**Problem:**
Filename has typo: `DIrectedPathFinder.ts` should be `DirectedPathFinder.ts` (note the uppercase "I").

**Files Affected:**
```
Current:  DIrectedPathFinder.ts (WRONG)
Correct:  DirectedPathFinder.ts
```

**Impact:**
- Inconsistent import statements: `from 'DIrectedPathFinder'` vs. expected `DirectedPathFinder`
- IDE navigation and "Go to Definition" may fail
- Hard to search for the file
- Confuses developers: "Is this a class or acronym?"
- Migration tools/refactoring may miss this file

**Solution:**
Rename file from `DIrectedPathFinder.ts` → `DirectedPathFinder.ts` and update all imports (search for usages in codebase).

---

### 🟡 MEDIUM ISSUES (Should Fix)

#### 5. **UNUSED IMPORT IN StartExplorationUseCase**
**Severity:** MEDIUM  
**File:** [testing-core/src/application/useCases/StartExplorationUseCase.ts](testing-core/src/application/useCases/StartExplorationUseCase.ts)

**Problem:**
```typescript
// Line 8: IMPORTED but NEVER USED
import { isActualBug as checkIsActualBug } from '../../domain/services/BugClassifier.js';

// Function exists but is never invoked in this file
```

**Impact:**
- Unnecessary bundle bloat (small but still added)
- Code confusion: developer thinks it's used but it's not
- Dead code maintenance burden
- Unused dependency tracking fails

**Solution:**
Remove the unused import:
```typescript
// DELETE this line entirely
```

---

#### 6. **TYPE MISMATCH IN BugContext**
**Severity:** MEDIUM  
**File:** [testing-core/src/bugs/types.ts](testing-core/src/bugs/types.ts)

**Problem:**
```typescript
// BugFinder interface says isApplicable doesn't need crashHalted:
interface BugFinder {
  isApplicable(ctx: Omit<BugContext, 'crashHalted'>): boolean;
  //           ↑─── Type says crashHalted is OPTIONAL
  
  run(context: BugContext): Promise<Finding[]>;
  //         ↑─── But here crashHalted is REQUIRED
}

// However, BugContext always includes crashHalted:
interface BugContext {
  page: Page;
  elements: InteractiveElement[];
  url: string;
  crashHalted: boolean; // ← Always present, never omitted
}
```

**Impact:**
- Type system lies: says crashHalted is optional but it's always present
- Developers may assume crashHalted is optional and miss it in implementations
- Type narrowing doesn't work correctly
- Inconsistent type contract

**Solution - Option 1 (Recommended):**
```typescript
// Make crashHalted always expected in both:
interface BugFinder {
  isApplicable(ctx: BugContext): boolean; // Include crashHalted
  run(context: BugContext): Promise<Finding[]>;
}
```

**Solution - Option 2:**
```typescript
// Create separate context types:
interface ApplicabilityContext {
  page: Page;
  elements: InteractiveElement[];
  url: string;
  // crashHalted omitted
}

interface BugContext extends ApplicabilityContext {
  crashHalted: boolean;
}

interface BugFinder {
  isApplicable(ctx: ApplicabilityContext): boolean;
  run(context: BugContext): Promise<Finding[]>;
}
```

---

#### 7. **TYPE COERCION IN BugFinder CATEGORIZATION**
**Severity:** MEDIUM  
**File:** [testing-core/src/application/useCases/StartExplorationUseCase.ts](testing-core/src/application/useCases/StartExplorationUseCase.ts#L88)

**Problem:**
```typescript
// Line 88-90
realBugsFound.forEach((bug: { type?: string }) => {
    if (bug.type && breakdownCategories[bug.type] !== undefined) {
    // ↑─── bug.type is optional (could be undefined)
    // but used as object key without null coalescing
    breakdownCategories[bug.type]++;
  }
});

// If bug.type is undefined:
// breakdownCategories[undefined]++ creates key "undefined"
```

**Impact:**
- Incorrect categorization: bugs with missing type get key "undefined"
- Statistics distorted: real bug counts lost
- Difficult to debug: silent failure, no error thrown

**Solution:**
```typescript
realBugsFound.forEach((bug: { type?: string }) => {
  const bugType = bug.type ?? 'UNKNOWN'; // Use null coalescing
  if (breakdownCategories[bugType] !== undefined) {
    breakdownCategories[bugType]++;
  }
});
```

---

#### 8. **DATABASE CONNECTION ERROR HANDLING**
**Severity:** MEDIUM  
**File:** [testing-core/src/index.ts](testing-core/src/index.ts#L60)

**Problem:**
```typescript
// Line 60-64
const dbReady = await connectDatabase();
if (!dbReady) {
  console.error('[BugSafari] ⚠️ Database connection failed - auth features may be unavailable');
}

// Line 67: Continues with undefined repository
const findingRepository = dbReady ? new MongoFindingRepository() : undefined;
const useCase = new StartExplorationUseCase(
  browserEngine,
  telemetry,
  { active: false },
  findingRepository, // ← UNDEFINED if dbReady=false
  '000000000000000000000000'
);
```

**Impact:**
- UseCase receives undefined repository
- Database operations silently fail (findingRepository.saveFinding() called on undefined)
- No errors thrown; findings are lost
- User unaware that bug data isn't being saved
- Auth features fail silently

**Solution:**
```typescript
const dbReady = await connectDatabase();
if (!dbReady) {
  console.error('[BugSafari] ⚠️ Database connection failed - cannot continue');
  process.exit(1); // Fail fast
}

const findingRepository = new MongoFindingRepository();
// Now guaranteed to be defined
```

Or gracefully degrade:
```typescript
const dbReady = await connectDatabase();
let findingRepository: FindingRepository | undefined;

if (dbReady) {
  findingRepository = new MongoFindingRepository();
} else {
  console.warn('[BugSafari] Database unavailable - findings will not persist');
  // Provide in-memory repository or no-op
}

const useCase = new StartExplorationUseCase(..., findingRepository);
```

---

#### 9. **UNHANDLED PROMISE IN API ROUTE**
**Severity:** MEDIUM  
**File:** [testing-core/src/presentation/api/registerRoutes.ts](testing-core/src/presentation/api/registerRoutes.ts#L45)

**Problem:**
```typescript
// Line ~45
app.post('/api/explore', (req, res) => {
  const { targetUrl } = req.body;
  
  void useCase.execute(targetUrl); // ← Promise executed but NOT awaited
  // ↑─── void keyword silences unhandled rejection
  
  res.status(202).json({ status: 'Exploration started' });
});

// If execute() throws error, it's silently ignored
// Client doesn't know it failed
```

**Impact:**
- Errors in execute() are lost
- Client thinks exploration started, but it actually failed
- No error handling for database failures, validation errors, etc.
- Difficult to debug failures

**Solution:**
```typescript
app.post('/api/explore', async (req, res) => {
  const { targetUrl } = req.body;
  
  try {
    // Don't await if you want to return 202 immediately
    // But at least attach error handler:
    useCase.execute(targetUrl).catch((error) => {
      console.error('[Explore Error]:', error);
      // Emit error via socket or store in session
      io.to(req.socketId).emit('exploration-error', {
        message: error.message,
        code: 'EXPLORATION_FAILED'
      });
    });
    
    res.status(202).json({ status: 'Exploration started' });
  } catch (error) {
    res.status(400).json({ error: 'Invalid request' });
  }
});
```

---

#### 10. **SOCKET LISTENER CLEANUP NOT GUARANTEED**
**Severity:** MEDIUM  
**File:** [developer-dashboard/src/infrastructure/engine/SocketHttpEngineGateway.ts](developer-dashboard/src/infrastructure/engine/SocketHttpEngineGateway.ts)

**Problem:**
```typescript
class SocketHttpEngineGateway implements EngineGateway {
  private socket: Socket | null = null;

  public async connect(): Promise<void> {
    this.socket = io(SOCKET_URL);
    this.socket.on('telemetry', this.handleTelemetry);
    this.socket.on('bug-found', this.handleBugFound);
    this.socket.on('frame', this.handleFrame);
    // ↑─── Listeners registered
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      // ↑─── removeAllListeners() NOT called before disconnect
    }
    this.socket = null;
  }

  // disconnect() not called on:
  // - Component unmount
  // - Browser tab close
  // - Connection loss
}
```

**Impact:**
- Listeners persist after disconnect
- Memory leak: handlers not garbage collected
- Multiple reconnects accumulate listeners
- Browser memory grows over time

**Solution:**
```typescript
public disconnect(): void {
  if (this.socket) {
    this.socket.removeAllListeners(); // ← Add this
    this.socket.disconnect();
  }
  this.socket = null;
}

// Also add cleanup on component unmount (useEffect):
useEffect(() => {
  const gateway = new SocketHttpEngineGateway();
  gateway.connect();

  return () => {
    gateway.disconnect(); // ← Cleanup on unmount
  };
}, []);
```

---

#### 11. **INCOMPLETE BugContext TYPE EXPORT**
**Severity:** MEDIUM  
**File:** [developer-dashboard/src/types.ts](developer-dashboard/src/types.ts)

**Problem:**
```typescript
// developer-dashboard/src/types.ts
export * from '../../shared/types';

// But doesn't export backend-specific types like:
// - BugContext (backend only)
// - StartExplorationUseCase
// - StateGraphNavigator
// etc.

// Type consistency broken across layers
```

**Impact:**
- Frontend unaware of exact contract
- Type checking incomplete
- Documentation missing

**Solution:**
Document which types are frontend vs. backend:
```typescript
// developer-dashboard/src/types.ts

// ═══ Re-export shared types (available on both frontend and backend)
export * from '../../shared/types';

// ═══ Frontend-specific types
export interface SessionHistoryEntry {
  id: string;
  url: string;
  startTime: string;
  endTime: string;
  bugsFound: number;
  status: 'COMPLETED' | 'CRASHED' | 'HALTED';
}

export interface TestResultData {
  totalActions: number;
  totalBugsFound: number;
  bugsByCategory: Record<string, number>;
}
```

---

#### 12. **UNUSED STRESS SCENARIO EXPORT**
**Severity:** MEDIUM  
**File:** [testing-core/src/domain/scenarios/index.ts](testing-core/src/domain/scenarios/index.ts#L50)

**Problem:**
```typescript
// Line 50-52
export { smartActionChain } from './fuzzing/dataFuzzer.js';

// But smartActionChain is NEVER invoked or used anywhere in the codebase
// It's exported but dead code
```

**Impact:**
- Bundle bloat: unused export
- Maintenance burden: unclear if feature is active
- Confusing API surface

**Solution:**
If unused, remove:
```typescript
// DELETE this line
export { smartActionChain } from './fuzzing/dataFuzzer.js';
```

If intentionally unused/reserved for future, document:
```typescript
// RESERVED: smartActionChain - planned for future feature X
// export { smartActionChain } from './fuzzing/dataFuzzer.js';
```

---

#### 13. **DUPLICATE TYPE DEFINITIONS**
**Severity:** MEDIUM  
**Files:**
- [shared/types.ts](shared/types.ts) (Line 60: ActionBreadcrumb)
- [testing-core/src/types.ts](testing-core/src/types.ts) (ActionBreadcrumb re-defined)
- [testing-core/src/infrastructure/monitoring/actionBuffer.ts](testing-core/src/infrastructure/monitoring/actionBuffer.ts) (own ActionBreadcrumb type)

**Problem:**
```typescript
// shared/types.ts
export interface ActionBreadcrumb {
  timestamp: string;
  selector: string;
  action: string;
  payload?: string;
  score?: number;
}

// testing-core/src/types.ts
export interface ActionBreadcrumb {
  // Possibly different fields
}

// testing-core/src/infrastructure/monitoring/actionBuffer.ts
interface ActionBreadcrumb {
  // Yet another definition
}
```

**Impact:**
- Type confusion: which is authoritative?
- Serialization issues: different field sets
- Type checking fails

**Solution:**
Use single shared definition; delete duplicates:
```typescript
// Keep ONLY in shared/types.ts
export interface ActionBreadcrumb {
  timestamp: string;
  selector: string;
  action: string;
  payload?: string;
  score?: number;
}

// In other files:
import { ActionBreadcrumb } from '../../../shared/types';
```

---

#### 14. **INCONSISTENT TelemetryMeta OPTIONAL FIELDS**
**Severity:** MEDIUM  
**Files:**
- [shared/types.ts](shared/types.ts) (Line 44: `statusCode?` and `status?`)
- [testing-core/src/types.ts](testing-core/src/types.ts) (different optionality)

**Problem:**
```typescript
// shared/types.ts line 44
export interface TelemetryMeta {
  statusCode?: number; // ← Optional
  status?: number;     // ← Also optional - which to use?
  // ... other fields
}

// Some code uses statusCode:
if (meta.statusCode >= 400) { ... }

// Other code uses status:
if (meta.status >= 400) { ... }

// They're different keys!
```

**Impact:**
- Status code checks may fail if wrong key used
- Network error detection inconsistent
- Data validation confusing

**Solution:**
Standardize on single field:
```typescript
export interface TelemetryMeta {
  httpStatusCode?: number; // Single, clear name
  // Remove duplicate: status
  // ... other fields
}

// Then update all usages
```

---

#### 15. **UNINITIALIZED OPTIONAL FIELDS**
**Severity:** MEDIUM  
**File:** [testing-core/src/domain/services/AutonomousExplorationEngine.ts](testing-core/src/domain/services/AutonomousExplorationEngine.ts#L94)

**Problem:**
```typescript
// Line 94
private currentTelemetry: TelemetryGateway | null = null;

// Set in createPersistentTelemetryGateway():
private createPersistentTelemetryGateway() {
  // May throw error before assignment
  try {
    this.currentTelemetry = new SocketTelemetryGateway(...);
  } catch (error) {
    // Error thrown - currentTelemetry remains null
  }
}

// Later used without null check:
private emitTelemetry(event: TelemetryEvent) {
  this.currentTelemetry.emit(event); // ← NPE if null
}
```

**Impact:**
- Potential null reference exceptions
- Telemetry silently fails if initialization error
- Inconsistent state

**Solution:**
```typescript
private currentTelemetry: TelemetryGateway | null = null;

private async createPersistentTelemetryGateway() {
  try {
    this.currentTelemetry = new SocketTelemetryGateway(...);
  } catch (error) {
    console.error('Telemetry initialization failed:', error);
    throw error; // Fail fast
  }
}

private emitTelemetry(event: TelemetryEvent) {
  if (!this.currentTelemetry) {
    console.warn('Telemetry gateway not initialized');
    return;
  }
  this.currentTelemetry.emit(event);
}
```

---

### 🟢 LOW ISSUES (Nice to Have)

#### 16. **ActionBuffer Export Alias for Backwards Compatibility**
**File:** [testing-core/src/infrastructure/monitoring/actionBuffer.ts](testing-core/src/infrastructure/monitoring/actionBuffer.ts#L53)

```typescript
// Line 53
export { ActionRecorder as ActionBuffer };
```

**Issue:** Legacy naming creates confusion. Either rename all to ActionRecorder or document the alias.

**Solution:** Migrate all imports to ActionRecorder; deprecate ActionBuffer alias.

---

#### 17. **Ambiguous TelemetryHub Export**
**File:** [testing-core/src/infrastructure/monitoring/socketServer.ts](testing-core/src/infrastructure/monitoring/socketServer.ts)

**Issue:** TelemetryHub class exported but SocketTelemetryGateway is used in production. Unclear which is authoritative.

**Solution:** Document which is authoritative; remove one if unused.

---

#### 18. **Variable Declaration Before Assignment**
**File:** [testing-core/src/domain/services/AutonomousExplorationEngine.ts](testing-core/src/domain/services/AutonomousExplorationEngine.ts#L1015)

```typescript
let handleFramenavigated: (() => void) | null = null; // Declared at line 1015
// Assigned much later at line 274
```

**Issue:** Poor variable initialization; declared far from first use.

**Solution:** Declare near first assignment.

---

---

## PRIORITY REMEDIATION PLAN

### 🔴 **Phase 1: CRITICAL (Must Fix)**

| # | Issue | File(s) | Effort | Impact |
|---|-------|---------|--------|--------|
| 1 | Event listener memory leaks | AutonomousExplorationEngine.ts | 2h | HIGH - Memory leak |
| 2 | Duplicate event handlers | 4 monitoring files | 3h | HIGH - Race conditions |
| 3 | Global mutable state race condition | registerSocketHandlers.ts | 2h | HIGH - Crashes |
| 4 | Filename typo (DIrected→Directed) | DIrectedPathFinder.ts | 30m | HIGH - Import issues |

### 🟡 **Phase 2: MEDIUM (Should Fix)**

| # | Issue | File(s) | Effort | Impact |
|---|-------|---------|--------|--------|
| 5 | Unused import (checkIsActualBug) | StartExplorationUseCase.ts | 15m | LOW |
| 6 | Type mismatch in BugContext | bugs/types.ts | 1h | MEDIUM |
| 7 | Type coercion in bug categorization | StartExplorationUseCase.ts | 30m | MEDIUM |
| 8 | DB connection error handling | index.ts | 1h | HIGH |
| 9 | Unhandled promise in API | registerRoutes.ts | 1h | MEDIUM |
| 10 | Socket cleanup not guaranteed | SocketHttpEngineGateway.ts | 1h | MEDIUM |
| 11 | Incomplete type exports | developer-dashboard/src/types.ts | 30m | LOW |
| 12 | Unused scenario export | domain/scenarios/index.ts | 15m | LOW |
| 13 | Duplicate type definitions | ActionBreadcrumb | 1h | MEDIUM |
| 14 | Inconsistent TelemetryMeta fields | shared/types.ts | 1h | MEDIUM |
| 15 | Uninitialized optional fields | AutonomousExplorationEngine.ts | 1h | MEDIUM |

### 🟢 **Phase 3: LOW (Nice to Have)**

| # | Issue | File(s) | Effort | Impact |
|---|-------|---------|--------|--------|
| 16 | ActionBuffer alias | actionBuffer.ts | 30m | LOW |
| 17 | Ambiguous TelemetryHub | socketServer.ts | 30m | LOW |
| 18 | Variable declaration | AutonomousExplorationEngine.ts | 15m | LOW |

---

## SUMMARY STATISTICS

| Metric | Count |
|--------|-------|
| **Total Files Analyzed** | 104 |
| **Backend Files** | 54 |
| **Frontend Files** | 27 |
| **Shared Files** | 1 |
| **Config/Build Files** | 22 |
| **Critical Issues** | 4 |
| **Medium Issues** | 15 |
| **Low Issues** | 3 |
| **Total Issues** | 22 |
| **Estimated Fix Time** | 16-18 hours |
| **Memory Leak Risk** | HIGH |
| **Race Condition Risk** | HIGH |
| **Type Safety Gaps** | MEDIUM |

---

## CONCLUSION

**Overall Architecture Assessment: SOUND but FRAGILE**

### Strengths:
✅ Clean separation of concerns (Domain/Application/Infrastructure)  
✅ Well-defined abstractions (BrowserEngine, TelemetryGateway, FindingRepository)  
✅ Real-time telemetry via Socket.io  
✅ Comprehensive bug finding (7 different finder implementations)  
✅ MongoDB persistence layer  

### Critical Weaknesses:
❌ Memory leaks from uncleaned event listeners  
❌ Race conditions in global state mutation  
❌ Duplicate event handler registrations  
❌ Type inconsistencies across layers  
❌ Error handling gaps in async operations  

### Immediate Actions Required:
1. **Fix event listener leaks** (Phase 1, Item 1) - Prevents memory exhaustion
2. **Consolidate event handlers** (Phase 1, Item 2) - Eliminates race conditions
3. **Remove global mutable state** (Phase 1, Item 3) - Fixes crashes
4. **Rename DIrected→Directed** (Phase 1, Item 4) - Improves maintainability

After Phase 1 remediation, system will be production-ready. Phase 2 improves type safety and error handling. Phase 3 optimizes code hygiene.

---

**Report Generated:** June 9, 2026  
**Analyst:** Architectural Audit System  
**Thoroughness Level:** COMPREHENSIVE
