# BugSafari Architectural Audit Report
## Data Fuzzing, Constraint Stripping & Adversarial Testing Inventory

**Audit Date:** June 2026  
**Task:** Review code for readability, quality, and issues  
**Role:** Lead Systems Architect / Forensic Code Reviewer

---

## Executive Summary

This report provides a comprehensive inventory of all files, modules, and sub-systems responsible for:
- **Data Fuzzing** - Heuristic-driven input field mutation
- **Constraint Stripping** - Removal of client-side HTML barriers  
- **Chaotic Input Injection** - Adversarial payload synthesis
- **Adversarial Testing** - Stress scenarios and rapid interaction

The codebase maintains a clean **three-layer decoupling** as specified in the "Arsenal vs Intelligence" architectural blueprint:
1. **Intelligence Layer** (Generation & Strategy) - Field classification, payload synthesis
2. **Arsenal Layer** (Adversarial Execution) - Constraint bypass, stress scenarios
3. **Sensory Layer** (Forensic Monitoring) - Error detection, telemetry

---

## 1. Core Architectural Mapping

### A. The Generation & Strategy Selection Layer (INTELLIGENCE)

**Purpose:** Scan, detect, classify input fields, and synthesize chaos payloads

| File Path | Primary Responsibility | Trigger/Dependency |
|----------|-----------------|----------------|
| `testing-core/src/domain/scenarios/fuzzing/elementClassifier.ts` | Heuristic-driven field classification into 7 categories (NUMERIC, TEXT_SEARCH, DATABASE_AUTH, EMAIL, DATE, JSON, CHAOS_FALLBACK) | Called by `dataFuzzer.ts` |
| `testing-core/src/domain/scenarios/fuzzing/strategies/index.ts` | Strategy dispatcher mapping FieldCategory → FuzzingStrategy | Imports all strategy modules |
| `testing-core/src/domain/scenarios/fuzzing/strategies/numericBoundaryStrategy.ts` | Generates boundarytest payloads (min, max, overflow values) | Exported via `index.ts` |
| `testing-core/src/domain/scenarios/fuzzing/strategies/xssVectorStrategy.ts` | Generates XSS attack vectors (script injection, event handlers, SVG, data URI) | Exported via `index.ts` |
| `testing-core/src/domain/scenarios/fuzzing/strategies/noSqlInjectionStrategy.ts` | Generates SQL/NoSQL injection vectors | Exported via `index.ts` |
| `testing-core/src/domain/scenarios/fuzzing/strategies/chaosFallbackStrategy.ts` | Generic chaos tokens for unclassified fields | Exported via `index.ts` |
| `testing-core/src/domain/scenarios/fuzzing/strategies/emailStrategy.ts` | Generates email-specific fuzzing vectors | Exported via `index.ts` |
| `testing-core/src/domain/scenarios/fuzzing/strategies/dateStrategy.ts` | Generates date manipulation vectors | Exported via `index.ts` |
| `testing-core/src/domain/scenarios/fuzzing/strategies/jsonStrategy.ts` | Generates JSON injection vectors | Exported via `index.ts` |
| `testing-core/src/domain/fuzzing/ChaosTransactionManager.ts` | Wraps fuzzing sequences with transaction metadata for vulnerability tracking | Injected into `dataFuzzer.ts`, `fuzzGuard.ts` |

**Classification Categories (from elementClassifier.ts):**
```
- NUMERIC: type="number"/"tel", or tokens: quantity, amount, phone, price, zip, credit, cvv, etc.
- TEXT_SEARCH: type="text", tokens: search, query, comments, description, name, address, etc.
- DATABASE_AUTH: tokens: login, signup, register, username, password, token, auth, credential, otp, etc.
- EMAIL: type="email", tokens: email, e-mail, mail, contact-email, etc.
- DATE: type="date"/"datetime-local", tokens: date, birthdate, dob, expiry, timestamp, etc.
- JSON: type="hidden", tokens: json, data, payload, config, settings, etc.
- CHAOS_FALLBACK: default for unclassified inputs
```

**Payload Vector Summary (from xssVectorStrategy.ts):**
- **SCRIPT_VECTORS:** `<script>alert(1)</script>`, `<script>eval(atob(...))</script>`
- **EVENT_HANDLER_VECTORS:** `<img src=x onerror=alert(1)>`, `<svg onload=alert(1)>`, etc.
- **SVG_VECTORS:** `<svg><animate onbegin=alert(1)...></svg>`
- **DATA_URI_VECTORS:** `data:text/html,<script>alert(1)</script>`
- **FORM_ACTION_VECTORS:** `javascript:alert(1)`, `<a href="javascript:...">`

---

### B. The Adversarial Execution Sub-Systems (ARSENAL)

**Purpose:** Strip client-side constraints and inject payloads into form controls

| File Path | Primary Responsibility | Trigger/Dependency |
|----------|-----------------|----------------|
| `testing-core/src/domain/scenarios/fuzzing/dataFuzzer.ts` | Executes field-level fuzzing with constraint stripping, integrates ChaosTransactionManager | Called by `ActionExecutor` in `ExplorationEngine.ts` |
| `testing-core/src/domain/scenarios/formBypasser.ts` | Strips all HTML constraints (disabled, readonly, required, maxlength, pattern) and data-val/* attributes | Called by `scenarioGate.ts` |
| `testing-core/src/domain/scenarios/index.ts` | Central registry exporting all StressScenario implementations | Imported by `scenarioGate.ts` |
| `testing-core/src/domain/scenarios/types.ts` | Type definitions for StressScenario interface | Used by all scenario modules |
| `testing-core/src/domain/scenarios/rapidClicker/buttonSpammer.ts` | Rapid click stress (15 clicks @ 50ms intervals) to trigger race conditions | Called by `scenarioGate.ts` |
| `testing-core/src/domain/scenarios/rapidClicker/burstClicker.ts` | Burst click variant | Imported by `index.ts` |
| `testing-core/src/domain/scenarios/rapidClicker/coordinateBombing.ts` | Coordinate-based rapid interaction | Imported by `index.ts` |
| `testing-core/src/domain/scenarios/rapidClicker/interactionSimulator.ts` | Generic interaction simulation wrapper | Imported by `ExplorationEngine.ts` |
| `testing-core/src/domain/scenarios/networkSaboteur.ts` | Network disruption and route lifecycle behavior testing | Called by `scenarioGate.ts` |
| `testing-core/src/domain/scenarios/routeTrasher.ts` | Route churn stress testing | Called by `scenarioGate.ts` |
| `testing-core/src/domain/services/exploration/ActionExecutor.ts` | Orchestrates scenario execution based on gate configuration | Delegates to all StressScenario implementations |

**Constraint Stripping (from formBypasser.ts):**
```typescript
const STRIPPED_ATTRIBUTES = [
  'disabled', 'readonly', 'required', 'maxlength', 'minlength', 
  'pattern', 'novalidate', 'formnovalidate'
];
const EXTENDED_ATTRIBUTES = [
  'data-val', 'data-val-required', 'data-val-number', 'data-val-date',
  'data-val-email', 'data-val-equalto', 'data-val-regex',
  'aria-required', 'aria-readonly', 'aria-disabled'
];
const MAX_LENGTH_LIMIT = 999999;
```

**Data Fuzzer Execution Flow:**
1. Classify input element via `classifyInputElement()`
2. Resolve fuzzing strategy via `getStrategyByCategory()`
3. Strip constraints via `page.evaluate()` (remove maxlength, pattern, required, etc.)
4. Inject payload via `page.fill()` or `page.evaluate()` for large payloads (>10000 chars)
5. Trigger form submission via `triggerFormSubmission()`
6. Track transaction via `ChaosTransactionManager`

---

### C. The Forensic Interception & Detection Layer (SENSORY/MONITORING)

**Purpose:** Watch for fuzzing fallout, intercept crashes, pattern-match errors

| File Path | Primary Responsibility | Trigger/Dependency |
|----------|-----------------|----------------|
| `testing-core/src/infrastructure/monitoring/stabilityMonitor.ts` | Monitors runtime instability (JS exceptions, HTTP ≥500, main thread lockup), emits telemetry | Called after navigation in `ExplorationEngine.ts` |
| `testing-core/src/infrastructure/monitoring/actionBuffer.ts` | Records action traces for reproduction playbook (circular buffer, capacity 20) | Called by all scenario modules |
| `testing-core/src/infrastructure/monitoring/reproductionPlaybookStore.ts` | Persistent store for reproduction-oriented action sequences | Uses `ActionRecord` from `shared/types.ts` |
| `testing-core/src/infrastructure/monitoring/activeScenarioTracker.ts` | Records active scenario milestones for telemetry | Called by scenarios |
| `testing-core/src/infrastructure/monitoring/browserConsoleListener.ts` | Captures browser console output stream | Called by stability monitor |
| `testing-core/src/infrastructure/monitoring/playbookNarrator.ts` | Converts action records to human-readable narrative steps | Used by `actionBuffer.ts` |
| `testing-core/src/infrastructure/monitoring/MemoryProfiler.ts` | Memory profiling for long-running sessions | Background monitor |
| `testing-core/src/domain/services/ForensicAnalysisService.ts` | Generates root cause analysis, risk scoring (0-100), and developer recommendations | Called at run completion |
| `testing-core/src/application/ports/TelemetryGateway.ts` | Telemetry emission contract | Used by all monitoring modules |
| `testing-core/src/infrastructure/socket/BinaryFrameServer.ts` | Streams visual frames for live replay | Called by `ExplorationEngine.ts` |
| `testing-core/src/infrastructure/socket/socketServer.ts` | WebSocket server for real-time telemetry | Backend startup |

**Stability Monitoring Patterns (from stabilityMonitor.ts):**
```typescript
const DEEP_SCAN_PATTERNS = [
  /internal server error/i,
  /database error/i,
  /sql execution failed/i
];
// Heartbeat: 2000ms interval, 5000ms timeout
// On HTTP ≥500: emitServerCollapse()
// On pageerror: emitUnhandledJsException()
// On heartbeat timeout: emitMainThreadLockup()
```

**Forensic Analysis Output (from ForensicAnalysisService.ts):**
- **Root Cause:** Human-readable cause description (API 500/404/401/403, JS exceptions, network errors)
- **Risk Score:** 0-100 calculated from errorCount, apiFailureCount, criticalErrorCount, jsExceptionCount
- **Recommendations:** Actionable fixes (up to 5)

---

## 2. Bug Finder Registry

| File Path | Bug Category | Purpose |
|----------|------------|---------|
| `testing-core/src/bugs/finders/fuzzGuard.ts` | Fuzzing Vulnerability Detection | Detects input validation bypasses from fuzzing |
| `testing-core/src/bugs/finders/inputSanitization.ts` | Input Sanitization | Detects improper sanitization |
| `testing-core/src/bugs/finders/noSqlInjection.ts` | NoSQL Injection | Detects NoSQL injection vulnerabilities |
| `testing-core/src/bugs/finders/concurrentStress.ts` | Concurrent Stress | Detects race conditions |
| `testing-core/src/bugs/finders/runtimeStability.ts` | Runtime Stability | Detects runtime crashes/freezes |
| `testing-core/src/bugs/finders/spaRaceConditions.ts` | SPA Race Conditions | Detects SPA-specific race conditions |
| `testing-core/src/bugs/finders/structuralNavigation.ts` | Structural Navigation | Detects navigation issues |
| `testing-core/src/bugs/finders/structuralProbe.ts` | Structural Probe | Detects DOM structure issues |

---

## 3. Flow Transition Matrix

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Fuzzing Action Flow                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  DOM_SCANNING                                                 │
│  └─> RecursiveDomParser discovers InteractiveElement candidates    │
│      └─> RiskScorer weights by semantic sensitivity            │
│                                                         │
│  FIELD_CLASSIFICATION (INTELLIGENCE)                       │
│  └─> elementClassifier.classifyInputElement()           │
│      maps to: NUMERIC | TEXT_SEARCH | DATABASE_AUTH | ... │
│                                                         │
│  PAYLOAD_GENERATION (INTELLIGENCE)                       │
│  └─> strategies.getStrategyByCategory()                │
│      generates: XSS_VECTOR | SQL_INJECTION | CHAOS ...  │
│                                                         │
│  CONSTRAINT_STRIPPING (ARSENAL)                          │
│  └─> formBypasser.execute()                        │
│      removes: maxlength, required, disabled, ...      │
│                                                         │
│  PAYLOAD_INJECTION (ARSENAL)                          │
│  └─> dataFuzzer.execute()                          │
│      fills input, triggers form submission            │
│                                                         │
│  ERROR_LISTENING (SENSORY)                            │
│  └─> page.on('pageerror')                          │
│  └─> page.on('response') (status >= 500)           │
│  └─> StabilityMonitor.runHeartbeat()                │
│                                                         │
│  TELEMETRY_EMISSION (SENSORY)                          │
│  └─> TelemetryGateway.emitTelemetry()               │
│  └─> ActionBuffer.recordStep()                    │
│  └─> ForensicAnalysisService.analyzeRun()         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Architectural Decoupling Verification

| Layer | Module Ownership | Decoupling Status |
|-------|--------------|----------------|
| INTELLIGENCE | `elementClassifier.ts`, `strategies/*`, `ChaosTransactionManager.ts` | ✅ Isolated - no UI dependencies |
| ARSENAL | `dataFuzzer.ts`, `formBypasser.ts`, `buttonSpammer.ts`, `scenarioGate.ts` | ✅ Isolated - uses Playwright only |
| SENSORY | `stabilityMonitor.ts`, `actionBuffer.ts`, `ForensicAnalysisService.ts` | ✅ Isolated - telemetry + storage |

---

## 5. Code Quality Assessment

### Strengths
1. **Clean Separation:** Three-layer architecture is well-respected
2. **Type Safety:** Strict TypeScript throughout
3. **Extensibility:** New strategies can be added to `strategies/index.ts`
4. **Telemetry:** Structured event envelopes with consistent format
5. **Error Isolation:** Non-fatal errors handled gracefully in all scenarios

### Potential Issues Identified
1. **Large Fuzz Payloads:** `dataFuzzer.ts` handles >10K chars via `page.evaluate()` - ensures browser stability
2. **Circular Buffer:** `actionBuffer.ts` capacity of 20 may overflow in long runs - check if sufficient
3. **Heuristic Classification:** Token matching is case-insensitive but could produce false positives
4. **XSS Vectors:** `xssVectorStrategy.ts` contains live attack vectors - ensure no stored XSS in dashboard

---

## 6. File Inventory Summary

| Category | File Count | Key Files |
|----------|-----------|----------|
| Intelligence (Generation) | 9 | `elementClassifier.ts`, `strategies/*.ts`, `ChaosTransactionManager.ts` |
| Arsenal (Execution) | 11 | `dataFuzzer.ts`, `formBypasser.ts`, `buttonSpammer.ts`, `rapidClicker/*.ts` |
| Sensory (Monitoring) | 11 | `stabilityMonitor.ts`, `actionBuffer.ts`, `reproductionPlaybookStore.ts`, `ForensicAnalysisService.ts` |
| Bug Finders | 8 | `bugs/finders/*.ts` |
| **Total** | **39** | Core fuzzing/bypass/monitoring infrastructure |

---

## 7. Dependencies Flow

```
elementClassifier.ts ──> getStrategyByCategory() ──> strategies/*.ts
        │                                             
        v                                             
dataFuzzer.ts ──> ChaosTransactionManager.ts ──> fuzzGuard.ts
        │
        +──> formBypasser.ts ──> page.evaluate(constraint removal)
        │           │
        +──> buttonSpammer.ts ──> rapid click (race conditions)
        │
        v
stabilityMonitor.ts ──> TelemetryGateway.emitTelemetry()
        │
        +──> ActionBuffer.recordStep()
        │
        +──> ForensicAnalysisService.analyzeRun()
```

---

## Conclusion

The BugSafari codebase maintains a clear, intentional decoupling between:
- **Intelligence** (field classification, payload synthesis)
- **Arsenal** (constraint stripping, stress execution)  
- **Sensory** (error detection, telemetry, forensic analysis)

This aligns with the "Arsenal vs Intelligence" architectural blueprint. The fuzzing flow transitions seamlessly from DOM scanning → field classification → payload generation → constraint stripping → injection → error listening → forensic logging.

All core files are functional with proper TypeScript typing and follow established coding standards.

**Report Generated:** June 2026  
**Auditor:** Lead Systems Architect
