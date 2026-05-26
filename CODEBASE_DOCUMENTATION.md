# BugSafari Codebase Documentation

This document summarizes the structure and purpose of the files in this repository so another AI (or developer) can quickly understand what each module does.

> Note: Several files referenced by the runtime exist as `.js` + `.ts` pairs (e.g., `inputSanitization.js` and `inputSanitization.ts`). This repo is authored in TypeScript; most `.js` are build outputs.

---

## Repository layout

### Top-level
- `BUGSAFARI_BLUEPRINT.md` — architecture + design goals.
- `TODO.md` — phased implementation plan.
- `developer-dashboard/` — React dashboard that connects to the engine via Socket.IO and triggers sessions via HTTP API.
- `shared/` — shared types (telemetry, element discovery data, etc.).
- `testing-core/` — the autonomous headless testing engine (Playwright + Express + Socket.IO).

---

## Shared types

### `shared/types.ts`
Defines shared data structures used across services.

Key exports:
- `TelemetryType`: `'ACTION' | 'NETWORK' | 'EXCEPTION' | 'HEURISTIC_SCORE'`
- `SemanticRole`: `'LOGIN' | 'SEARCH' | 'SUBMIT' | 'CANCEL' | 'DESTRUCTIVE' | 'NAVIGATE' | 'INPUT' | 'UNKNOWN'`
- `TelemetryMeta` + `TelemetryEvent`: message/selector/state hash/etc. carried in telemetry.
- `BoundingBox`: `{x, y, width, height}`
- `DiscoveredElement`: element features used by the engine + sent to the dashboard.

---

## Developer dashboard (React)

### `developer-dashboard/package.json`
- Vite + React app.
- Uses `socket.io-client` to receive telemetry streams.

### `developer-dashboard/index.html`
Vite entry HTML.

### `developer-dashboard/src/main.tsx`
React entry bootstrapping (standard Vite/React pattern).

### `developer-dashboard/src/App.tsx`
Main UI container.

Responsibilities:
- Holds session UI state: target URL, connection state, whether a test is running, latest engine status, telemetry list.
- Connects to Socket.IO using `VITE_BUGSAFARI_SOCKET_URL` (fallback `http://localhost:3005`).
- Calls the engine HTTP API at `VITE_BUGSAFARI_API_URL` (fallback `http://localhost:3000`) endpoint:
  - `POST /api/start-test` with `{ url }`.
- Renders:
  - `LiveFeed` (browser screenshot stream)
  - `TelemetryStream` (timeline of events)
  - `ControlPanel` (URL input + Launch button)

### `developer-dashboard/src/types.ts`
Dashboard-side telemetry types.

Exports similar to `shared/types.ts` (duplicated for frontend convenience).

### `developer-dashboard/src/components/ControlPanel.tsx`
UI for entering a target staging URL and launching the engine.

- Disables launch when offline or a test is running.
- On submit calls `onLaunch()`.

### `developer-dashboard/src/components/LiveFeed.tsx`
Receives `live-frame` Socket.IO events.

- Each event contains a base64 JPEG string.
- Renders an `<img>` with `src=data:image/jpeg;base64,...`.

### `developer-dashboard/src/components/TelemetryStream.tsx`
Renders an ordered list of telemetry events.

- Sorts by `timestamp` (newest first).
- Each list entry shows a computed title/subtitle depending on telemetry `type`.

### Styling assets
- `developer-dashboard/src/App.css`, `developer-dashboard/src/index.css` — Tailwind/CSS.
- `developer-dashboard/tailwind.config.js`, `postcss.config.js` — build config.

---

## Testing core (autonomous engine)

### `testing-core/package.json`
Backend service package.

- `main`: `src/index.ts`
- Uses:
  - `express` + `cors`
  - `playwright` (Chromium headless)
  - `socket.io`
  - `cheerio` (present; not inspected here)

### `testing-core/src/index.ts`
The backend process entry.

Responsibilities:
1. Start two servers:
   - HTTP/Express server for API
     - `GET /api/health`
     - `POST /api/start-test`
   - Socket.IO server for telemetry + live frames
2. Enforce single-run concurrency via `isTestRunning` (returns `429` if already running).
3. `runBugSafari(targetUrl)`:
   - Emits `ACTION` telemetry `engine-boot`.
   - Launches Playwright Chromium (headless) and creates a browser context.
   - Installs navigation sandboxing via `installDomainGuard`.
   - Creates a new page and calls `runAutonomousSafari`.
   - Emits completion telemetry:
     - `ACTION` with `engine-finished` when completed
     - `EXCEPTION` with `engine-halted`-style reasoning when halted.
   - Closes context/browser in `finally`.

Key helpers:
- `parseTargetUrl(body)`: validates body contains a usable http/https URL.
- `readPort(value, fallback)`: reads port env vars with bounds.

### `testing-core/src/contracts.ts`
Types used internally for telemetry + discovery data.

Key exports:
- `TelemetryType`, `SemanticRole`
- `TelemetryMeta`, `TelemetryEvent`
- `BoundingBox`, `DiscoveredElement`

### `testing-core/src/reporters/socketServer.ts`
Socket.IO telemetry hub.

Exports:
- `TelemetryHub`:
  - constructor wires `connection` / `disconnect` logs
  - `emitTelemetry(type, meta)` emits:
    - `telemetry` (used by dashboard)
    - `engine-log` (additional channel)
    - returns the constructed `TelemetryEvent`
  - `emitFrame(base64Image)` emits `live-frame`
  - `emitTargets(targets)` emits `discovered-elements` (current dashboard may or may not consume it)

### `testing-core/src/reporters/actionBuffer.ts`
Circular action record buffer.

Exports:
- `ActionBuffer(capacity=20)`
  - `push(record)` keeps last N records
  - `snapshot()` returns records
  - `toReproductionSteps()` converts records into a human-readable step list used in crash telemetry.

### `testing-core/src/reporters/exceptionCatcher.ts`
Captures page runtime exceptions and network-level 500 failures.

Exports:
- `CrashSignal`
  - `halt(reason)`
  - `isHalted()`, `getReason()`
- `setupExceptionCatcher(page, hub, actionBuffer)`
  - Exposes `__bugSafariReportException` for browser-side reporting.
  - `addInitScript` registers handlers in page context for:
    - `window.error`
    - `unhandledrejection`
  - Hooks Playwright events:
    - `pageerror` => halt
    - `console` (error only) => emits EXCEPTION telemetry (ignores `net::ERR`)
    - `request` / `response` => computes `durationMs`, emits NETWORK telemetry
    - if `statusCode >= 500`, emits EXCEPTION and halts
    - `requestfailed` => emits NETWORK telemetry with `request.failure().errorText`

### `testing-core/src/engine/domainGuard.ts`
Sandbox domain enforcement.

Exports:
- `installDomainGuard(context, targetUrl, hub)`:
  - Uses `context.route('**/*', handler)`.
  - Blocks external HTTP(S) navigation requests that would leave `targetOrigin`.
  - Emits `ACTION` telemetry `blocked-external-navigation`.
  - Aborts route via `route.abort('blockedbyclient')`.
- `restoreDomainIfNeeded(page, targetUrl, hub)`:
  - If the current `page.url()` is external, navigates back to the target origin and emits `restore-target-domain`.

### `testing-core/src/engine/autonomousLoop.ts`
Core exploration loop.

Exports:
- `runAutonomousSafari(options)`.

Major responsibilities:
1. Initialize core modules:
   - `MemoryTracker` (state repetition + penalties)
   - `RiskScorer` (adaptive element scoring)
   - `ActionBuffer(20)`
   - `setupExceptionCatcher(page, hub, actionBuffer)` to get a `CrashSignal`.
2. Navigate to the target:
   - `page.goto(targetUrl, waitUntil: 'domcontentloaded', timeout 15000)`
   - Wait for `networkidle` (best-effort)
   - Start streaming frames with `streamLiveFrame`.
3. For each step up to `maxSteps` (default 40):
   - If `crashSignal.isHalted()`, stop and return `{completed:false}`.
   - Ensure page is alive, otherwise create a new page + attach exception catcher (`ensurePage`).
   - Compute a structural DOM fingerprint:
     - `createStructuralFingerprint(page)`
   - Track repeats:
     - `memory.recordState(stateHash)`
     - if repeat, emit `state-repeat-penalty`.
   - Discover interactive elements:
     - `scanInteractiveElements(page)`
   - If none, finish with reason `No interactive elements found.`
   - Score elements:
     - `scorer.scoreElements(page, parsedElements, memory, stateVisit.visitCount)`
     - emit `HEURISTIC_SCORE` for each target
     - send top candidates to clients via `hub.emitTargets(...)`.
   - Choose and execute an action:
     - Selects action name via `chooseActionName(target, step)`.
     - Pushes an action record into `ActionBuffer`.
     - Runs bug finders:
       - `dispatchBugFinders(...)` tries each module from `getAllBugFinders()`.
     - Executes the action via `executeTargetAction`.
     - Monitors action outcomes via `monitorAction`:
       - watches `page.on('response')` to detect high latency / network
       - detects route changes (URL changed)
       - catches thrown exceptions (does not throw)
     - Applies feedback to update scorer weights:
       - `scorer.applyFeedback(target, feedback)`
   - Restores domain if needed.
   - Streams another live frame.
4. End conditions:
   - Completed after reaching `maxSteps` or no elements.

Internal helpers (high-level):
- `executeTargetAction(page, target, step)`
  - For inputs/text/selection/input roles: fuzz with `fuzzTextInput`.
  - Otherwise:
    - strip constraints
    - sometimes run concurrent spam + route trash
    - otherwise rapid-fire click
    - occasionally run route trash.
- `dispatchBugFinders(...)`
  - Iterates `getAllBugFinders()` and for each finder:
    - checks `finder.isApplicable(ctx)`
    - runs `finder.run(ctx)`
    - emits HEURISTIC_SCORE telemetry for each returned finding.
  - Finder errors are caught and emitted as EXCEPTION telemetry.

### `testing-core/src/heuristics/domParser.ts`
Discovers interactive DOM elements.

Exports:
- `ParsedElement` interface:
  - tagName, id, className, type, name, text
  - selector (custom selector builder)
  - role, href
  - isDisabled
  - boundingBox: `{x,y,width,height}`
  - featureSignature: stable signature used by the scorer + finders
- `scanInteractiveElements(page)`
  - `page.evaluate` executes in-browser JS.
  - Queries elements matching:
    - `button`
    - `input:not([type="hidden"])`
    - `textarea`, `select`
    - `a[href]`
    - `[role="button"]`, `[role="link"]`
    - `[tabindex]` not `-1`
  - Builds selectors using:
    - `#id` when possible
    - `data-testid` when possible
    - `name` / `aria-label`
    - otherwise computes an `nth-of-type`-based path from body
  - Extracts text/content with special handling per element type.
  - Computes `featureSignature` as a truncated normalized join of key attributes.

### `testing-core/src/heuristics/hashUtils.ts`
Computes structural state hashes and tracks repetition.

Exports:
- `createStructuralFingerprint(page)`
  - Serializes DOM tree from `document.body`.
  - Normalizes text and removes volatile attributes matching patterns (e.g. `data-react`, `data-v-*`, aria-busy, style, value).
  - Truncates overly long text.
  - Hashes serialized string via SHA-256.
- `MemoryTracker`
  - `recordState(hash)` returns `{hash, visitCount, isRepeat}`
  - `penalizeAction(actionSignature, amount)` stores penalty per action signature
  - `getActionPenalty(actionSignature)`

### `testing-core/src/heuristics/scorer.ts`
Scores and ranks discovered elements.

Exports:
- `ScoredElement` = `ParsedElement` + `score`, `isVisible`, `semanticRole`.
- `RiskScorer`
  - `scoreElements(page, elements, memory, stateVisitCount)`:
    - For each element (up to 120):
      - checks visibility
      - classifies semantic role
      - computes:
        - base feature score from tag/type/keywords
        - layout score (uses bounding box)
        - constraint score (adds when disabled)
        - adaptive score based on prior feedback weights
        - penalties from memory/action repetition
      - returns elements sorted by descending score.
  - `applyFeedback(element, feedback)` updates adaptive weights.

- `classifySemanticRole(element)` heuristic:
  - Uses regexes against concatenated clues (type/name/text/id/class/role/href)
  - Returns `LOGIN`, `SEARCH`, `DESTRUCTIVE`, `SUBMIT`, `CANCEL`, `NAVIGATE`, `INPUT`, else `UNKNOWN`.

### `testing-core/src/scenarios/*`
Scenario modules implement the “muscle” (interaction patterns and payload injection).

#### `dataFuzzer.ts`
Exports:
- `fuzzTextInput(page, target, seed)`
  - Creates mutated payload via `generatePayloads` from `payloads/chaosData.ts`.
  - Removes constraints via `stripConstraints`.
  - Scrolls into view and clicks target.
  - Fills payload and presses Enter.
  - Returns the payload string.

#### `formBypasser.ts`
Exports:
- `stripConstraints(page, selector)`
  - Removes `disabled`, `required`, `readonly`, `maxlength`/`minlength`, `pattern`, `aria-disabled`.
  - For input/textarea removes limits and converts hidden input to text.
- `forceSubmitNearestForm(page, selector)`
  - Finds closest `form` and dispatches a submit event.

#### `buttonSpammer.ts`
Exports:
- `rapidFireClick(page, selector, clickCount=50)`
  - Calls `burstClickElement` with duration 1000ms.
- `burstClickElement(page, selector, clickCount, durationMs)`
  - Schedules `click` calls at staggered timeouts.
- `concurrentEventSpam(page, maxTargets=12)`
  - Clicks multiple visible locators in parallel.

#### `concurrentClicker.ts`
Implements the “burstClickElement” concurrency logic.

#### `routeTrasher.ts`
Exports:
- `trashRoutes(page, repetitions=2)`
  - Repeats navigation shaking by:
    - goBack
    - goForward
    - reload
  - Uses `safeNavigation()` to catch failures.

#### `smartAttacker.ts`
Exports:
- `smartActionChain(page, targets, seed)`
  - Chooses either:
    - fuzz input target (via `fuzzTextInput`)
    - or rapid-fire click a clickable target.

### `testing-core/src/payloads/chaosData.ts`
Token-based payload generator.

Exports:
- `generatePayloads({ element, seed })`
  - Generates contextual prefix (email/password/search heuristics) and appends mutated tokens.
  - Token categories:
    - boundary tokens
    - query/injection tokens
    - script tokens
    - primitive type tokens
  - Uses a deterministic PRNG seeded from element feature signature + seed.
  - Adds one extra “very long” payload with `A` padding.
- `getRandomPayload()` convenience function.

### `testing-core/src/bugs/*`
Bug finder modules discover suspicious behaviors relevant to specific bug classes.

#### `testing-core/src/bugs/types.ts`
Defines engine bug-finder contracts.

Exports:
- `BugClass` union of bug identifiers:
  - `INPUT_SANITIZATION_FAILURE`
  - `CLIENT_SIDE_CONSTRAINT_BYPASS`
  - `NOSQL_INJECTION`
  - `SPA_STATE_RACE_CONDITION`
  - `STRUCTURAL_NAVIGATION_LOGIC`
  - `RUNTIME_STABILITY_EXCEPTION`
  - `BOUNDARY_STRESS_FAILURE`
- `BugFinding` with `bugClass`, `title`, `severity`, optional `evidence`.
- `BugContext` passed into `run()`:
  - `page`, `hub`, `actionBuffer`, `targetUrl`, `step`, `stateHash`, `crashHalted`, optional `element`.
- `BugFinder` interface:
  - `bugClass` constant
  - `isApplicable(ctx)`
  - `run(ctx)` returns `BugFinding[]` and must not throw.

#### `testing-core/src/bugs/registry.ts`
Registers all finders.

Exports:
- `getAllBugFinders()` returns the array:
  - `inputSanitizationFinder`
  - `clientSideConstraintBypassFinder`
  - `noSqlInjectionFinder`
  - `spaRaceConditionsFinder`
  - `structuralNavigationFinder`
  - `runtimeStabilityFinder`
  - `boundaryStressFinder`

#### `testing-core/src/bugs/scenarioAdapters.ts`
Adapter functions that bug finders call for payload injection + constraint stripping.

Exports:
- `fuzzTextWithAttackSurface(page, element, step, options)`
  - strips constraints then calls `fuzzTextInput`.
- `ensureConstraintsStripped(page, elementSelector)`
- `fuzzAndReturnPayload(page, element, seed)`

#### Bug finders (`testing-core/src/bugs/finders/*.ts`)
Each module exports a constant implementing `BugFinder`.

1) `finders/inputSanitization.ts`
- Applicable when current element is `semanticRole` `INPUT` or `LOGIN`.
- In `run()`:
  - fuzzes element using `fuzzTextWithAttackSurface`.
  - returns a `BugFinding` about input sanitization failure (mutated payloads).

2) `finders/clientSideBypass.ts`
- Applicable when element is disabled or semantic role is `INPUT`/`LOGIN`.
- In `run()`:
  - calls `ensureConstraintsStripped` to remove client-side restrictions.
  - fuzzes element.
  - returns a `CLIENT_SIDE_CONSTRAINT_BYPASS` finding (HIGH severity).

3) `finders/noSqlInjection.ts`
- Applicable for INPUT/LOGIN elements whose type/name/text/id/class clues match NoSQL-ish targets:
  - regex: `(search|query|filter|email|username|account|id)`
- In `run()`:
  - fuzzes with injection token profiles.
  - returns a `NOSQL_INJECTION` finding (HIGH severity).

4) `finders/spaRaceConditions.ts`
- Applicable always (returns `true`).
- In `run()`:
  - calls `burstConcurrentStress(page, step)` from stress adapters.
  - returns a `SPA_STATE_RACE_CONDITION` finding.

5) `finders/structuralNavigation.ts`
- Applicable always.
- In `run()`:
  - calls `probeStructuralNavigation(page, step)` from stress adapters.
  - returns `STRUCTURAL_NAVIGATION_LOGIC` finding.

6) `finders/runtimeStability.ts`
- Applicable always.
- In `run()`:
  - only returns a finding when `ctx.crashHalted` is true.
  - emits a `RUNTIME_STABILITY_EXCEPTION` finding (CRITICAL severity).

7) `finders/boundaryStress.ts`
- Applicable always.
- In `run()`:
  - calls `boundaryOverloadProbe(page, step)`.
  - marks severity CRITICAL when `unresponsive`.

#### Stress adapters (`testing-core/src/bugs/stressAdapters/*.ts`)
These are invoked by race/structural/boundary bug finders.

- `stressAdapters/index.ts` re-exports:
  - `concurrentStress`, `structuralProbe`, `boundaryOverload`

1) `stressAdapters/concurrentStress.ts`
- `burstConcurrentStress(page, step)`:
  - runs `concurrentEventSpam(page, 12)` and `trashRoutes(page, 1)`.
  - returns attempted/completed aggregate counts.

2) `stressAdapters/structuralProbe.ts`
- `probeStructuralNavigation(page, step)`:
  - captures `beforeUrl` and a slice of `beforeText`.
  - performs goBack + goForward (best-effort).
  - compares URL + visible text.
  - if nothing changed, flags potential dead-end/loop-like behavior.

3) `stressAdapters/boundaryOverload.ts`
- `boundaryOverloadProbe(page, step)`:
  - builds a very long string with optional Zalgo-like combining marks.
  - attempts to find common text input selectors and click+fill with large payload.
  - uses a “ping” via `page.waitForFunction` to check if the app remains responsive.
  - returns `{ unresponsive, durationMs, attempted }`.

---

## Control flow summary (end-to-end)

1. Dashboard calls `POST /api/start-test` with a URL.
2. Engine (testing-core):
   - launches headless Chromium
   - installs a domain guard
   - starts `runAutonomousSafari` loop
3. In each step:
   - discover interactive elements (`scanInteractiveElements`)
   - score/rank (`RiskScorer`)
   - emit heuristic telemetry
   - execute selected action (fuzz or rapid clicks + route trash)
   - monitor action for network/route changes/exceptions
   - update adaptive weights
   - run bug finders; each emits a finding telemetry frame
   - stream screenshot frame
4. Exceptions and 5xx responses are captured via `setupExceptionCatcher`.

---

## Telemetry contract used by the system

Telemetry is emitted as objects shaped like:
- `TelemetryEvent = { timestamp, type, meta }`
- `type` in `'ACTION' | 'NETWORK' | 'EXCEPTION' | 'HEURISTIC_SCORE'`
- `meta` includes optional fields such as `selector`, `actionExecuted`, `statusCode`, `url`, `score`, `exceptionDetails`, `reproductionSteps`, etc.

Dashboard subscribes to Socket.IO event name:
- `telemetry` for event list
- `live-frame` for screenshot frames

---

## Scripts / commands

This repo contains two packages; typical workflows:
- Backend (testing-core):
  - `npm -C testing-core run typecheck`
  - `npm -C testing-core run start`
- Frontend (developer-dashboard):
  - `npm -C developer-dashboard install`
  - `npm -C developer-dashboard run dev`

---

## Files not fully inspected

Some files present in the repository were not read directly in this documentation generation pass (e.g., some `.ts` utilities under `testing-core/src/bugs/finders/*.ts` beyond what was already loaded, plus any remaining UI/css/static assets). The core modules relevant to engine operation and bug finding are covered above.

