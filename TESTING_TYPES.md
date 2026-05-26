# BugSafari Testing Types (Engine + Exploratory Scenarios)

This document enumerates the **testing types** implemented by BugSafari inside `testing-core/` and explains what each one does, what it targets, and what signals/telemetry it produces.

> Repository scope: `testing-core/src` (Playwright headless engine), `developer-dashboard/src` (visual telemetry UI), `shared/` (shared types).

---

## 1) Client-side Exploratory Testing (DOM-aware)

### What it is
BugSafari is not script-based. It continuously extracts interactive elements from the active page DOM, ranks them, and executes actions.

### Where in code
- DOM extraction / target discovery:
  - `testing-core/src/heuristics/domParser.ts`
- Element scoring:
  - `testing-core/src/heuristics/scorer.ts`
- Engine loop:
  - `testing-core/src/engine/autonomousLoop.ts`
  - `testing-core/src/domain/services/AutonomousExplorationEngine.ts`

### Typical effects
- Unexpected state changes
- UI freezes
- Navigation instability
- Race condition exposure

### Signals / telemetry
- `TelemetryType: ACTION`
- `TelemetryType: HEURISTIC_SCORE`
- `TelemetryType: EXCEPTION` (for crashes / halts)
- `TelemetryType: NETWORK` (filtered to failures/>=400 + soft-fail heuristics)

---

## 2) Front-end Constraint Stripping / Form Hardening Bypass

### What it is
Before injecting or submitting values, BugSafari attempts to remove client-side constraints such as:
- `maxlength`
- `pattern`
- `required`
- `disabled`
- `readonly`

This forces the application to handle inputs that would normally be blocked by frontend validation.

### Where in code
- Form constraint stripping:
  - `testing-core/src/scenarios/formBypasser.ts`
- Payload injection orchestrated in:
  - `testing-core/src/domain/services/AutonomousExplorationEngine.ts`

### Common testing outcomes
- Backend rejects/handles edge payloads incorrectly
- Incorrect error handling on invalid inputs
- UI crashes due to unexpected input shapes

### Signals / telemetry
- `ACTION` events like payload injection / form bypass steps (engine emits via `meta.actionExecuted`)
- Possible `EXCEPTION` if the app halts
- Possible `NETWORK` failures if server rejects/returns errors

---

## 3) Input Sanitization / Payload Injection Testing

### What it is
BugSafari fuzzes text inputs (including login-like inputs) by generating mutated payloads and injecting them into fields.

This tests:
- Robustness of sanitization
- Handling of unexpected characters
- Server-side validation correctness

### Where in code
- Fuzz text input scenario:
  - `testing-core/src/scenarios/dataFuzzer.ts`
- Payload generation engine:
  - `testing-core/src/ml/payloadSynthesizer.ts`
  - (support) `testing-core/src/payloads/chaosData.ts`
- Bug finder wiring for input sanitization:
  - `testing-core/src/bugs/finders/inputSanitization.ts`

### Common testing outcomes
- Client-side crashes
- Server 4xx/5xx responses
- Soft failures (GraphQL-like error bodies)

### Signals / telemetry
- `TelemetryType: ACTION` (payload injection steps)
- `TelemetryType: NETWORK` (only failure-ish responses)
- `TelemetryType: EXCEPTION` (for fatal runtime issues)

---

## 4) SPA Client-side Constraint Bypass Testing

### What it is
BugSafari targets scenarios where the frontend disables controls or hides/unlocks fields.

It attempts to bypass those controls by:
- stripping constraints
- injecting payloads even when the UI is “disabled”

### Where in code
- Bug finder:
  - `testing-core/src/bugs/finders/clientSideBypass.ts`

### Common testing outcomes
- Backend accepts invalid state transitions
- Missing authorization checks
- Unhandled UI assumptions (disabled controls still get values)

### Signals / telemetry
- `HEURISTIC_SCORE` events for bug finding evidence
- `NETWORK` failures if backend rejects
- `EXCEPTION` if runtime crashes

---

## 5) NoSQL Injection Style Testing

### What it is
BugSafari generates payloads intended to resemble NoSQL query operators and injects them into input fields.

This tests whether the backend:
- incorrectly builds queries using unsanitized input
- fails to parameterize queries

### Where in code
- Bug finder:
  - `testing-core/src/bugs/finders/noSqlInjection.ts`

### Common testing outcomes
- 4xx/5xx due to invalid query structures
- Soft-failure error responses

### Signals / telemetry
- `HEURISTIC_SCORE` bug evidence
- `NETWORK` failure telemetry (>=400 + soft-fail)

---

## 6) SPA Race Condition / Concurrency Stress Testing

### What it is
BugSafari deliberately spams concurrent interactions to force:
- asynchronous state update conflicts
- race conditions between click handlers, network requests, and component lifecycle

### Where in code
- Concurrent stress adapter:
  - `testing-core/src/bugs/stressAdapters/concurrentStress.ts`
- Bug finder:
  - `testing-core/src/bugs/finders/spaRaceConditions.ts`
- Scenario components for concurrency:
  - `testing-core/src/scenarios/concurrentClicker.ts`

### Common testing outcomes
- UI inconsistent state
- Navigation desync
- Runtime exceptions due to unmounted updates

### Signals / telemetry
- `ACTION` (concurrent click/burst actions)
- `NETWORK` failure bursts
- `EXCEPTION` if app halts

---

## 7) Structural Navigation Logic Testing

### What it is
BugSafari probes whether navigation changes truly reflect UI/DOM state changes.

It performs navigation loops and checks whether the state meaningfully changes.

### Where in code
- Structural probe adapter:
  - `testing-core/src/bugs/stressAdapters/structuralProbe.ts`
- Bug finder:
  - `testing-core/src/bugs/finders/structuralNavigation.ts`

### Common testing outcomes
- Stuck navigation (back/forward doesn’t change state)
- Incorrect routing logic

### Signals / telemetry
- `HEURISTIC_SCORE` bug evidence (based on detected navigation/state change)
- Possible `NETWORK` anomalies during navigation

---

## 8) Boundary / Overload / Denial-of-Render Testing

### What it is
BugSafari stress-tests the app boundary behavior by sending very large/complex payloads and repeatedly interacting with UI elements.

Goal:
- detect unresponsive UI
- detect memory pressure symptoms
- detect render-locks

### Where in code
- Boundary overload probe:
  - `testing-core/src/bugs/stressAdapters/boundaryOverload.ts`
- Boundary stress bug finder:
  - `testing-core/src/bugs/finders/boundaryStress.ts`

### Common testing outcomes
- App freezes
- Browser unresponsiveness
- Crashes or fatal halts

### Signals / telemetry
- `HEURISTIC_SCORE` with HIGH/CRITICAL severity
- `EXCEPTION` (if runtime stability fails)
- `NETWORK` failure telemetry if server overloads

---

## 9) Runtime Stability Testing

### What it is
BugSafari watches for crash/halts and reports them as critical runtime stability findings.

### Where in code
- Bug finder:
  - `testing-core/src/bugs/finders/runtimeStability.ts`
- Crash interception and halt management:
  - `testing-core/src/reporters/exceptionCatcher.ts`

### Common testing outcomes
- Unhandled runtime errors
- Fatal exception traces

### Signals / telemetry
- `EXCEPTION` telemetry
- `forensic-report` / incident bundles

---

## 10) Generative Payload Mutation Testing

### What it is
BugSafari synthesizes payloads dynamically (not just static dictionaries).

### Where in code
- Payload synthesis:
  - `testing-core/src/ml/payloadSynthesizer.ts`
- Payload noise generation:
  - `testing-core/src/payloads/chaosData.ts`

### Common testing outcomes
- Reduced false negatives vs fixed payload sets
- Higher diversity in server parsing / error surfaces

### Signals / telemetry
- `ACTION` / `HEURISTIC_SCORE` reflecting injection/evidence
- `NETWORK` failures if payload triggers server errors

---

## 11) Telemetry-Driven Failure Isolation (Detector layer)

### What it is
BugSafari captures:
- uncaught JS errors
- window errors / unhandled rejections
- and network failure status telemetry

### Where in code
- Exception capture + halt criteria:
  - `testing-core/src/reporters/exceptionCatcher.ts`
- Network interception + failure gating:
  - `testing-core/src/domain/services/AutonomousExplorationEngine.ts`

### Notes about NETWORK filtering
Per your earlier requirement, `NETWORK` events are emitted only for failure-like signals:
- `HTTP status >= 400`
- OR (soft-fail) `status < 400` if response body contains keywords such as `"error" : true` or `"status" : "fail"`

This reduces noisy 200-series traffic and keeps focus on bug-relevant network activity.

---

## Summary: Testing Types vs Core Modules

- **Front-end constraint stripping**: `scenarios/formBypasser.ts` (+ engine orchestration)
- **Exploratory DOM testing**: `heuristics/domParser.ts` + `engine/*`
- **Input fuzzing**: `scenarios/dataFuzzer.ts` + `ml/payloadSynthesizer.ts`
- **Bypass disabled/front-end restrictions**: `bugs/finders/clientSideBypass.ts`
- **NoSQL injection style**: `bugs/finders/noSqlInjection.ts`
- **Race/concurrency stress**: `bugs/stressAdapters/concurrentStress.ts`
- **Navigation correctness**: `bugs/stressAdapters/structuralProbe.ts`
- **Boundary overload**: `bugs/stressAdapters/boundaryOverload.ts`
- **Runtime stability**: `bugs/finders/runtimeStability.ts` + `reporters/exceptionCatcher.ts`

---

## Where to add future “testing types”
1. Add a new **bug finder** under `testing-core/src/bugs/finders/`.
2. If it needs a new kind of behavior, add a **scenario adapter** under `testing-core/src/bugs/stressAdapters/` or `testing-core/src/scenarios/`.
3. Ensure it emits evidence via existing telemetry types (`ACTION`, `NETWORK`, `EXCEPTION`, `HEURISTIC_SCORE`).

