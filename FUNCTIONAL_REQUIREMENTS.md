# BugSafari — Functional Requirements

Derived from a direct audit of the implementation (2026-07-19). Documents what the system **does**, not what was planned. Status legend:

- **[C] Complete** — implemented and reachable by a user.
- **[P] Partial** — implemented but gated, degraded, or missing a piece.
- **[X] Not wired** — code exists but has no call site / no UI entry point.

Modules: Authentication · Run Configuration & Lifecycle · Autonomous Exploration Engine · Bug Detection · Verification & Attribution · Telemetry & Evidence · Live Dashboard · Queue Management · Session Recovery · History · Reporting & Export · Regression Verification · Settings.

---

## 1. Authentication & Tenancy

| ID | Feature | Status |
|---|---|---|
| FR-1.1 | Register account | [C] |
| FR-1.2 | Login | [C] |
| FR-1.3 | Token refresh | [C] |
| FR-1.4 | Forgot / reset password | [P] |
| FR-1.5 | Guest mode | [P] |
| FR-1.6 | Tenant isolation | [C] |
| FR-1.7 | Session persistence & cross-tab sync | [C] |

**FR-1.1 Register** — User submits email + password on `/signup`. System enforces ≥8 chars with uppercase, digit, and special character (`authValidation.ts`), bcrypt-hashes at 12 salt rounds (`UserModel.ts`), returns a 7-day JWT, and routes the user to `/login`. Duplicate email returns 409 surfaced as an inline field error.

**FR-1.2 Login** — User submits credentials on `/login`. System verifies via bcrypt and returns `{user, token}`; all failure modes return an identical 401 to prevent account enumeration. Token + user are written to `localStorage`, expiry checked synchronously on load so an expired token never causes a 401 race.

**FR-1.3 Token refresh** — Any request that receives a 401 triggers one silent `POST /api/auth/refresh` retry (`authRefresh.ts`), and the new token is synced back into React state. A `bugsafari:session-expired` event logs the user out if refresh fails.

**FR-1.4 Forgot / reset password** — User submits email; system always responds 200 (no enumeration), stores a bcrypt-hashed 32-byte token with a 1-hour expiry, and emails a reset link. **Partial:** when SMTP is unconfigured the link is only printed to the server console, and the UI tells the user to check it.

**FR-1.5 Guest mode** — A guest may start runs, watch live telemetry, and stop runs, but cannot save, list, export, or analyse history. Guest runs persist nothing (`ExplorationEngine.ts:967`). **Partial:** the "Continue As Guest" button navigates to `/dashboard` without setting `localStorage['bugsafari_guest']` — the only writer is the unrouted `SlidingAuthForm.tsx` — so the user is bounced back to `/login`. Guest mode is reachable via backend API but not via the UI.

**FR-1.6 Tenant isolation** — Every history and forensic query filters on `userId` inside the Mongo query itself (`SessionModel.find/findOne/deleteOne/exists`, `listSessionHistory(limit, userId)`). Run ownership additionally accepts possession of the `runId` UUID (`SessionManager.isOwner`) so a refreshed browser can re-attach.

---

## 2. Run Configuration & Lifecycle

| ID | Feature | Status |
|---|---|---|
| FR-2.1 | Target URL entry | [C] |
| FR-2.2 | Infiltration profile selection | [C] |
| FR-2.3 | Strict boundary lock | [C] |
| FR-2.4 | Start run | [C] |
| FR-2.5 | Pause / resume | [C] |
| FR-2.6 | Stop run | [P] |
| FR-2.7 | Concurrency guard | [C] |
| FR-2.8 | Initialization watchdog | [C] |

**FR-2.1 Target URL** — User types a URL into the command bar. System normalizes it (`shared/url.ts` — non-http(s) schemes rejected before prefixing), applies a NoSQL-operator heuristic (`sanitizeTargetUrl`), and resolves the actual reachable engine target. Input is disabled while a session is active.

**FR-2.2 Infiltration profile** — User picks one of five profiles from `INFILTRATION_PROFILE_CATALOG`: Chaos Infiltration (default, all scenarios), Deep Semantic Data Attack, High-Frequency Concurrency Strain, Async Lifecycle Assault, Auth-State Subversion. The profile gates which scenario families the engine may fire and also derives the pathfinder mode (`exploration` / `coverage` / `probe`).

**FR-2.3 Strict boundary lock** — User ticks a checkbox. System installs `StrictUrlLockGuard`: a `page.route` interceptor aborting off-boundary main-frame document navigations pre-commit, plus an init-script sandbox neutralizing `location.assign/replace`, `history.pushState/replaceState`, and anchor/form navigation. Backtrack navigation and origin re-seeding are suppressed while locked so they cannot race the boundary restore.

**FR-2.4 Start run** — User presses "Start Testing" → `POST /api/start-test`. In queue mode the system deduplicates by owner/runId, enqueues a `run-safari` job, and returns `202 {runId, jobId, queued}`. In sync mode it activates the singleton engine and returns `200 {runId}`. Duplicate start for an owner with a live run returns `resumed: true` and rehydrates instead of launching a second run.

**FR-2.5 Pause / resume** — Buttons appear conditionally on lifecycle state. Pause sets a flag polled by the loop every 100 ms; the active-time accumulator stops, so paused time is not billed against the timebox, and the dashboard countdown deadline shifts by the paused duration.

**FR-2.6 Stop** — Stop drains the `AsyncTaskTracker` so in-flight DB/telemetry writes flush before browser teardown. **Partial:** in queue mode `POST /api/safari/stop` only touches the in-process engine and is effectively a no-op returning `ok: true`; real stop travels over the `safari:control` Redis pub/sub channel. A job still **waiting** in the queue cannot be cancelled — no code path removes it.

**FR-2.7 Concurrency guard** — A second start while one run is active returns 429. `SessionManager` is a process-wide singleton, so worker concurrency above 1 is incorrect (flagged at `SafariWorker.ts:74`) and is not enforced.

**FR-2.8 Initialization watchdog** — If no engine signal arrives within 30 s the dashboard issues `forceStop()`, logs an EXCEPTION telemetry line, and resets the UI. Disarmed while QUEUED.

---

## 3. Autonomous Exploration Engine

| ID | Feature | Status |
|---|---|---|
| FR-3.1 | Headless browser session | [C] |
| FR-3.2 | DOM parsing & candidate extraction | [C] |
| FR-3.3 | Perceptron element scoring | [C] |
| FR-3.4 | Brain warm-start & persistence | [P] |
| FR-3.5 | Structural state hashing | [C] |
| FR-3.6 | State graph & frontier navigation | [C] |
| FR-3.7 | Loop prevention | [C] |
| FR-3.8 | Backtracking & state restoration | [C] |
| FR-3.9 | Saturation & termination | [C] |
| FR-3.10 | Adaptive step budget | [C] |
| FR-3.11 | Deterministic replay seeding | [C] |

**FR-3.1 Browser session** — Chromium launches headless (`--no-sandbox`, `--disable-dev-shm-usage`, `--disable-gpu`) inside a 30 s race with a hardened fallback launch. One context, one page, viewport 1440×900, `ignoreHTTPSErrors: true`. Popups are recursively armed with the same listeners.

**FR-3.2 DOM parsing** — `RecursiveDomParser` extracts visible interactive candidates, verifies each with `elementFromPoint` to reject overlay-occluded elements, drops ancestors that contain other candidates (anti-weight-expansion), and detects the active modal/overlay layer (ARIA dialog roots trusted; class-hook roots require `position: fixed|absolute` and `z-index ≥ 1`).

**FR-3.3 Element scoring** — Each candidate is scored `risk = heuristic·0.6 + sigmoid(perceptron)·100·0.4 − penalties`. The perceptron (`SingleLayerPerceptron`) is a 24-feature single layer with a momentum-augmented delta rule: `lr = base/(1+0.0005·n)`, L2 λ=0.001, momentum 0.9, weights clamped ±6. Features cover structure (`isInput`, `isButton`, `roleInteractive`…), 10 keyword flags (`kwLogin`, `kwPay`, `kwDelete`…), and normalized layout (area, Y position, text length). Rewards: fault +0.5, network activity +0.3, structural change +0.2, saturated destination −0.5, revisit −0.4, no-op −0.25.

**FR-3.4 Brain persistence** — Weights snapshot to `brain_configs` at `start`, every 10 steps at `runtime`, and at `finish`/`crash`. A new run warm-starts from the latest brain for the same target URL, overlaying saved weights on defaults so newly added features keep their priors. **Partial:** `BrainConfig` has no `userId`, so warm-start is cross-tenant — one account's learned model can seed another's run against the same URL.

**FR-3.5 State hashing** — `hashCompound` produces a `structure` signature (normalized skeleton, dynamic classes stripped, repeated sibling runs collapsed, ad/analytics/media subtrees excluded) and an `interactive` signature (document-ordered `tag|type|role|stateFlags|label` tokens), combined as `sha256(structure:interactive:routePath)`. Budget 5000 elements; failure degrades to a deterministic sentinel and never throws.

**FR-3.6 Graph navigation** — `StateGraphNavigator` returns `explore-edge | backtrack | exhausted`. Edge choice is a diversity-penalized argmax over a 5-sample ring buffer with softmax exploration at `T = 8·(40/(40+n))`, first-visit anchors nudged ×0.85, and look-ahead suppression of anchors whose recorded destination is already saturated. Graph capped at 500 nodes with oldest-visit eviction.

**FR-3.7 Loop prevention** — Five layers: consecutive-repeat strikes (threshold 3); proactive forward look-ahead resolving an `href` without clicking and marking the edge cyclic if it targets a breadcrumb ancestor, an off-origin host, `target="_blank"`, or a non-http scheme; reactive ancestor-hash detection post-click; `EdgeRepeatTracker` per `structureHash::selector` with a default budget of 3 non-productive traversals; and `RouteExhaustionTracker` flagging HTTP ≥400 and route-collapse states, which are then excluded from the graph entirely.

**FR-3.8 Backtracking** — Preferred path is `StateRestorer.replayPath()` — click each BFS hop and verify the expected child hash within 3 s. Fallback ladder: verified `goBack` → deep-link `goto` → hard root reload. Off-origin or blank targets are rewritten to the origin.

**FR-3.9 Termination** — Outcomes: `completed`, `boundary-saturated`, `timebox`, `user-stopped`, `graceful-shutdown`, `exception`. A cluster is saturated when all discovered controls are triggered, or after 3 visits without gain, or after 8 redundant actuations. On exhaustion the engine runs up to 2 adaptive recovery rounds re-queuing soft-blocked edges (never cyclic ones) before re-seeding at the origin.

**FR-3.10 Adaptive budget** — Default 60 steps, hard cap 5×, extended by `max(10, ceil(maxSteps/2))` whenever unexplored controls remain and the timebox is not hit. Default timebox 600 000 ms, counted only while actively running.

**FR-3.11 Deterministic seeding** — `exploration-seed` seeds both edge-selection softmax (mulberry32) and payload choice. Fuzz payloads derive from FNV-1a of `(category, level, selector)` and use no RNG at all, so a run is replayable.

---

## 4. Attack Scenarios & Fuzzing

| ID | Scenario | Status |
|---|---|---|
| FR-4.1 | DataFuzzer + payload escalation | [C] |
| FR-4.2 | FormBypasser | [C] |
| FR-4.3 | ButtonSpammer (concurrent burst) | [C] |
| FR-4.4 | CoordinateBombing | [C] |
| FR-4.5 | AsyncStateRacer | [C] |
| FR-4.6 | NetworkSaboteur | [C] |
| FR-4.7 | StorageTamper | [C] |
| FR-4.8 | RouteTrasher | [X] |

**FR-4.1 DataFuzzer** — Inputs are classified into 7 categories (NUMERIC, TEXT_SEARCH, DATABASE_AUTH, EMAIL, DATE, JSON, CHAOS_FALLBACK) and receive a category-specific payload from `strategies/` (xssVector, noSqlInjection, numericBoundary, json, date, email, chaosFallback). Constraints are stripped target-scoped, siblings auto-filled, and the form submitted. Escalation is decided by reading the field back: `escalate` on genuine resistance (payload not retained, or `validationMessage`/`aria-invalid` set), `reset` on fault, `hold` on acceptance — across L0 base → L1 structure breakers → L2 encoding evasion → L3 amplification → L4 polyglot. Per-form cap defaults to 2. Sensitive fields are recorded with `redactValue: true` — masked in narration, verbatim for replay.

**FR-4.2 FormBypasser** — Strips `disabled`, `readonly`, `required`, `maxlength`, `minlength`, `pattern`, `novalidate`, `formnovalidate`, and 17 `data-val-*`/`aria-*` attributes to test whether validation is enforced server-side.

**FR-4.3 ButtonSpammer** — True zero-wait concurrent burst via `Promise.allSettled`, recording settle order. Logged as one reproduction step.

**FR-4.4 CoordinateBombing** — Deterministic near-square grid of clicks; sequential by necessity (one virtual pointer).

**FR-4.5 AsyncStateRacer** — Fires an async action without awaiting, then interrupts mid-flight (Escape + concurrent re-trigger) and records lifecycle deltas. Backs off during failure bursts.

**FR-4.6 NetworkSaboteur** — Intercepts `**/api/**`, GraphQL, and versioned patterns (xhr/fetch only, static assets excluded) in Delayed (10–15 s) / Aborted / Mutated modes, then probes freeze and input-block selectors.

**FR-4.7 StorageTamper** — Snapshots privileged-UI baseline, forges role/admin/isAuthenticated flags, re-mints the JWT with `alg: none` and `role: admin`, reloads the same URL, and applies a strict positive-delta oracle. Originals are restored and the page reloaded afterwards.

**FR-4.8 RouteTrasher** — **Disabled engine-wide.** Omitted from the scenario registry and explicitly excluded in `ActionExecutor.ts:536`. Its module is retained for back-compat forensics, and its `classifyHttpStatus` / `isExpectedResourceNoise` helpers are still the live HTTP source of truth.

---

## 5. Bug Detection

**FR-5.1 Bug taxonomy [C]** — 13 classes, each with title, default severity, CWE, and remediation text in `bugCatalog.ts`: `INPUT_SANITIZATION_FAILURE` (CWE-20), `CLIENT_SIDE_CONSTRAINT_BYPASS` (CWE-602), `NOSQL_INJECTION` (CWE-943), `SPA_STATE_RACE_CONDITION` (CWE-362), `STRUCTURAL_NAVIGATION_LOGIC` (CWE-835), `RUNTIME_STABILITY_EXCEPTION` (CWE-248), `BOUNDARY_STRESS_FAILURE` (CWE-400), `FUZZ_VULNERABILITY_LEAK` (CWE-79), `SECURITY_VULNERABILITY_LEAK` (CWE-200), `CASCADING_STATE_FAILURE` (CWE-754), `ROUTE_MUTATION_FAILURE` (CWE-835), `CLIENT_TRUST_BOUNDARY_VIOLATION` (CWE-602), `INFINITE_LOADING` (CWE-400).

**FR-5.2 Fault classification [C]** — `FaultClassifier` resolves a class deterministically: matched signal expected by the active scenario → CONFIRMED; any matched signal's primary candidate → SIGNAL; unmatched but confirmed → the scenario's primary expected bug; else fault-type default → INFERRED. Security classes can never be assigned from scenario expectation alone. Severity escalates to ≥HIGH on status ≥500.

**FR-5.3 Live detectors [C]** — Eight detectors actually produce findings: runtime faults (12-way JS error taxonomy via `RuntimeStabilityFinder`); unguarded double-submit (`DuplicateActionFinder`, verdicts CONFIRMED_DUPLICATE / SUSPECTED / GUARDED, with idempotency-header and 409/425/429 suppression); infinite loading (`ApiHangFinder`, 8 s threshold, two-probe persistence with a 2500 ms gap, max 3 re-sweeps); HTTP faults (5xx and soft-fail-masked 2xx); transport failures; UI freeze (2 s heartbeat, 5 s timeout, 3 recovery retries); reflected XSS (payload-correlated `reflectionOracle`); and client-trusted auth state (`storageTamper` oracle).

**FR-5.4 Accessibility audit [P]** — `AccessibilityAuditor` runs a static WCAG 2.1 scan once per structural shell, deduped on `(rule, selector)`, capped at 300 findings, halting entirely at the banner threshold. **Partial:** findings are WebSocket-only and are aggregated to a count in the dashboard — individual findings are discarded and never persisted.

**FR-5.5 Finder registry [X]** — `bugs/finders/noSqlInjection`, `runtimeStability`, `spaRaceConditions`, and `structuralNavigation` have no runner and are never invoked; `structuralProbe` and `concurrentStress` accessors are wired but dormant. Only `reflectionOracle` and `fuzzGuard` from this tree are live.

---

## 6. Verification & Attribution

**FR-6.1 Provenance attribution [C]** — Every candidate fault is classified into `TARGET_APP | BUGSAFARI | PLAYWRIGHT | BROWSER_EXTENSION | NETWORK_ENV | TIMING | UNKNOWN` in a deliberate order: BugSafari markers → extension noise → 13 Playwright driver markers (skipped for `NETWORK` faults so real backend timeouts survive) → abort patterns → DNS/TLS/proxy → host-dependent transport markers (first-party ⇒ TARGET_APP, third-party ⇒ NETWORK_ENV). Non-target-app faults are downgraded to informational telemetry and never reported as bugs.

**FR-6.2 Correlation & dedup [C]** — Signature is `faultType|normalizeMessage|statusCode` with digit runs, hex, and whitespace collapsed and a 160-char cap. A fault is corroborated when seen ≥2 times, or when a different fault type hits the same `origin+pathname` inside a 3 s window. Repeats never re-register; occurrence notes are throttled to the 2nd and every 25th.

**FR-6.3 Confidence scoring [C]** — Base 0.85 CONFIRMED / 0.6 SIGNAL / 0.3 INFERRED, adjusted by origin (+0.1 target-app, −0.2 unknown, −0.5 other), corroboration (+0.15), reproduction (±0.15/−0.1), and evidence completeness (+0.1 × fraction of message/stack/repro/selector/status present). Thresholds: ≥0.8 CONFIRMED, ≥0.5 NEEDS_VERIFICATION, else INCONCLUSIVE. A non-target-app fault can never reach CONFIRMED.

**FR-6.4 Self-gating bypass [C]** — Duplicate-action and API-hang reports deliberately skip the pipeline because their own two-phase / two-probe validation is stricter.

---

## 7. Telemetry & Evidence Collection

| ID | Feature | Status |
|---|---|---|
| FR-7.1 | Console capture | [C] |
| FR-7.2 | Network capture | [C] |
| FR-7.3 | Circular action buffer | [C] |
| FR-7.4 | Reproduction playbook | [C] |
| FR-7.5 | Fault screenshots | [P] |
| FR-7.6 | Source-map resolution | [P] |
| FR-7.7 | State fingerprint | [C] |
| FR-7.8 | Live frame stream | [C] |
| FR-7.9 | Video / trace recording | [X] |
| FR-7.10 | Memory profiling | [X] |

**FR-7.1 Console** — Uncaught exceptions (`pageerror`), `console.error`, unhandled promise rejections (init-script listener + `exposeFunction`, forwarding the in-page timestamp), and renderer crashes. A full multi-level console tab is stored separately (cap 1000).

**FR-7.2 Network** — `xhr`, `fetch`, and `document` only. Three-tier status classification: 5xx and soft-fail-masked 2xx become findings; 4xx is informational and not counted as an API failure; asset noise is dropped. Soft-fail detection scans the body with 9 adjacency regexes under a 128 KB cap. Log capped at 2000 with consecutive-identical collapse.

**FR-7.3 Action buffer** — Two 60-entry circular buffers (`ActionRecorder`, `reproductionPlaybookStore`); the playbook has a `freeze()` latch so post-fault writes cannot overwrite the causal chain.

**FR-7.4 Reproduction playbook** — `stepMinimizer` drops post-fault actions, cuts back to the last entry into the faulting page, collapses consecutive repeats into `repeatCount`, and caps at 40 steps closest to the fault, always prepending a synthetic NAVIGATE. Narration is generated by `shared/reproduction.ts` — the single source shared with the dashboard, so the UI and engine never drift.

**FR-7.5 Screenshots [P]** — JPEG quality 45 with a 3 s timeout, **captured only on the runtime-fault path**. Duplicate-action, API-hang, network, and freeze findings carry none. Screenshots are deliberately never persisted to Mongo (session-document bloat), and `GET /api/forensic/screenshots` returns a hardcoded empty array.

**FR-7.6 Source maps [P]** — Inline VLQ decode of the top 6 frames with a 32-entry cache and 2500 ms fetch timeout. Applied only on the runtime-fault path.

**FR-7.7 State fingerprint** — localStorage, sessionStorage, and cookies captured at fault time under strict caps (≤32 keys, ≤2 KB/value, ≤8 KB/bucket, ≤32 cookies, 1500 ms evaluate timeout) so a replay can restore the exact client state.

**FR-7.8 Live frames** — 33 ms JPEG quality-35 screencast loop; only the newest frame is buffered for late attach.

**FR-7.9 / FR-7.10** — No `recordVideo` or `context.tracing` calls exist. `MemoryProfiler` and `MemoryLeakDetector` are fully implemented but have zero call sites.

---

## 8. Live Dashboard

| ID | Feature | Status |
|---|---|---|
| FR-8.1 | Browser preview | [C] |
| FR-8.2 | Telemetry tab | [C] |
| FR-8.3 | Errors tab | [C] |
| FR-8.4 | Network tab | [C] |
| FR-8.5 | Console tab | [C] |
| FR-8.6 | Session timer | [C] |
| FR-8.7 | AI diagnostic card | [C] |
| FR-8.8 | Accessibility banner | [C] |
| FR-8.9 | Connection status | [C] |
| FR-8.10 | Telemetry help | [C] |
| FR-8.11 | Dark mode | [C] |

**FR-8.1 Browser preview** — Base64 JPEG frames painted onto a `<canvas>` sized object-fit-cover via `ResizeObserver`, with four exclusive states (IDLE / QUEUED / INITIALIZING / COMPLETED). The surrounding browser chrome is explicitly decorative (`aria-hidden`, `cursor-default`, no handlers). A binary WebSocket frame path exists but defaults off.

**FR-8.2 Telemetry tab** — Live engine narration capped at 500 in state / 100 rendered, color-coded by `[SYSTEM]` / `[ERROR]` / `[EXCEPTION]`, with a pinging current-action indicator and a jump-to-bottom pin. Element scoring decisions surface here as telemetry lines; there is no dedicated element-decision panel.

**FR-8.3 Errors tab** — Incidents and crash reports, mirrored reports deduped against incidents, identical faults collapsed with ×N badges. Each card carries severity, attribution badges, the AI diagnostic, the reproduction checklist, screenshot, resolved stack frames, and a suggested fix.

**FR-8.4 Network tab** — Shows only actionable failures (4xx/5xx and transport errors), deduped by method+url+status, capped at the last 50.

**FR-8.5 Console tab** — Per-level filter chips with counts (all/error/warning/info/debug/log), timestamps, stack traces, copy-per-row and copy-all.

**FR-8.6 Session timer** — Authoritative wall-clock deadline held in the controller so it survives view switches; pause freezes it and shifts the deadline; under 30 s it turns critical and pulses; reaching zero triggers `handleTimeLimitExceeded`.

**FR-8.7 AI diagnostic card** — Per-finding vulnerability class, CWE, plain-language explanation, and remediation, sourced from `bugCatalog`.

**FR-8.8 Accessibility banner** — Appears once 10 WCAG findings accumulate, names the specific remediations (alt text, form labels, accessible control names, unique ids, document `lang`/`title`), and latches dismissed for the session.

**FR-8.9 Connection status** — Three persistent toasts ("Connection lost…", "Reconnecting — attempt N", "Restoring your active session…"), each auto-dismissed when its state clears. Status messages share one toast id so they replace in place rather than stacking.

---

## 9. Queue Management

**FR-9.1 Job enqueue [C]** — BullMQ queue `safari-tasks`, job `run-safari`, enabled by `BUGSAFARI_USE_QUEUE=1`. Options: 2 attempts, exponential backoff from 5 s, `removeOnComplete {age 1h, count 100}`, `removeOnFail {age 24h, count 250}`.

**FR-9.2 Queue position broadcast [C]** — Client emits `queue-subscribe {jobId, runId}`, joins rooms `queue:${jobId}` and `run:${runId}`, and receives `queue-update` with state and position. A monotonic phase guard rejects stale `waiting` pushes.

**FR-9.3 Worker execution [C]** — Concurrency from `BUGSAFARI_WORKER_CONCURRENCY` (default 1), `lockDuration` 10 min, `stalledInterval` 30 s. Per job: validate payload → new browser engine → bind user → resolve target → 2 s snapshot timer → execute. The registry is settled only on success or the final attempt.

**FR-9.4 Distributed control [C]** — Pause/resume/stop are published on the `safari:control` Redis channel and applied by whichever worker owns the run.

**FR-9.5 Queue cancellation [P]** — A **waiting** job cannot be cancelled; no code path removes it from the queue. Only an active run responds to stop.

---

## 10. Session Recovery

**FR-10.1 Run token persistence [C]** — The server-issued `runId` (and `jobId` when queued) is written to `localStorage` and seeded into the gateway *before* connecting, so the first attach carries it. Tokens are cleared only on an explicit `engine-status: IDLE`.

**FR-10.2 HTTP snapshot restore [C]** — On mount `GET /api/session/active` runs independently of the socket. Resolution order: local in-process snapshot → Redis `RunRegistry` entry + BullMQ job state → synthetic QUEUED snapshot with position → worker snapshot → terminal snapshot. Redis keys carry a 2 h index TTL, 60 s live snapshot TTL, and 600 s terminal TTL.

**FR-10.3 Socket replay [C]** — `session-attach {runId}` replays the server ring buffers: 500 telemetry events, 100 reports, 100 incidents, 100 accessibility findings, 200 console messages, and 1 frame. Ack returns `not-owner` or `no-active-session` on failure.

**FR-10.4 Full state hydration [C]** — `hydrateFromSnapshot` restores telemetry, network log, accessibility count, deduped reports and incidents, console buffer, current URL, timebox/elapsed/remaining, lifecycle status, queue position, and the last frame — so a mid-run refresh is visually lossless.

**FR-10.5 Disconnect grace [C]** — After `BUGSAFARI_SESSION_GRACE_MS` (default 60 s) with no reattach, the run moves INTERRUPTED → DISCONNECTED and the engine is stopped.

---

## 11. History

**FR-11.1 Manual save [C]** — After a run reaches a terminal state a "Save Session" button appears (single-use). It posts the runtime URL, elapsed ms (with a wall-clock fallback so Duration is never N/A), live findings, the network log deduped by `method|url|statusCode` with `repeatCount`, and the full console log. Guests receive a 403 `GUEST_FORBIDDEN` surfaced as "Registration required to save session history."

**FR-11.2 History list [C]** — `GET /api/history/sessions?limit=50` (clamped 1–200) returns only `savedManually: true` rows for the caller. Each row shows target URL, id, date, step count, a color-banded coverage bar, pages visited, and a client-derived severity chip (≥3 = CRITICAL, ≥1 = HIGH, else CLEAR).

**FR-11.3 Search & filter [C]** — Free-text search over target URL and id; severity filter ALL / CRITICAL / HIGH / CLEAR; pagination at 10 per page; multi-select with a bulk toolbar.

**FR-11.4 Delete [C]** — Per-row via a 3-dot menu with a confirmation dialog, or bulk (sequential, with success/failure counts). The delete query is `{_id, userId}` — ownership-scoped.

**FR-11.5 Sorting [P]** — Sort state, comparators, and severity/status orderings exist but `setSortConfig` is never called — there is no sort UI. Order is permanently date-descending, and the date comparator compares the *formatted* string (`"JUL 19, 2026"`), not the underlying date.

**FR-11.6 Compare [P]** — The bulk "Compare" action does not compare; it toasts and opens the first selected record.

---

## 12. Reporting & Export

**FR-12.1 Forensic report [C]** — `GET /api/forensic/report/:sessionId` aggregates session, errors, network, console, telemetry, and analysis into one document. The page shows an executive summary (status, URL, run id, start time, plus Duration / Actions / Findings / Pages / Risk Score / Coverage), a collapsible visited-routes list, an AI insights panel (root cause, risk level, recommendations), tabbed Findings / Network / Console, and a collapsible full action timeline.

**FR-12.2 Risk scoring [C]** — `ForensicAnalysisService` produces a 0–100 risk score mapped to LOW / MEDIUM (≥26) / HIGH (≥51) / CRITICAL (≥76) from error, API-failure, critical-error, and JS-exception counts.

**FR-12.3 JSON export [C]** — `GET /api/history/export/:id` streams the full record as an attachment named `safari-<id>.json`. Bulk export downloads one file per selected record.

**FR-12.4 Markdown copy [P]** — `toMarkdownChecklist` / `actionStepsToMarkdown` power clipboard copy of the reproduction playbook, per-finding summaries, the action timeline, and console output. **No PDF, CSV, or Markdown file export exists.**

---

## 13. Regression Verification ("Verify Fix")

**FR-13.1 Verify a fix [C]** — From a saved report the user presses "Verify Fix" on a finding. The system opens a fresh isolated Chromium (no exploration), restores cookies and storage *before* `goto`, replays the finding's own `actionSteps` with 400 ms settles, and re-evaluates with the same `classifyFault` used live. Progress streams as `replaying N/M` → `validating`; the ack timeout is 180 s.

**FR-13.2 Verdicts [C]** — `RESOLVED` (no matching signal), `STILL_ACTIVE` (≥1 replayed fault whose `bugClass` equals the original), or `INCONCLUSIVE` (invalid ids, finding not found, nav failure, replay error, launch timeout). The verdict re-themes the finding card and opens a result modal with bug class, steps replayed, duration, reproduced signals, and a Re-verify button.

**FR-13.3 Macro replay [C]** — `ReplayMacroExpander` regenerates `CoordinateBombing` grids, `RouteTrasher` history traversals, and `ConcurrentSiblingBurst` sets from stored parameters so bursts replay faithfully rather than as single clicks.

**FR-13.4 Serialization [P]** — Verification is globally serialized by a module-level flag; a concurrent request returns INCONCLUSIVE rather than queueing.

---

## 14. Settings

**FR-14.1 Theme [C]** — Light / Dark / System segmented control. `system` live-tracks `prefers-color-scheme` only while selected. Initialized synchronously from guest storage to avoid FOUC, and applied immediately on click before the save resolves.

**FR-14.2 Notifications toggle [P]** — Stored and synced, but no code reads `settings.notifications` to gate anything.

**FR-14.3 Auto-save toggle [P]** — Stored and synced; no consumer.

**FR-14.4 Change password [C]** — Current / new / confirm with show-hide toggles and client validation. **Note:** the backend endpoint enforces only a minimum length of 8 and does **not** call `validatePasswordComplexity`, unlike registration.

**FR-14.5 Account view [P]** — Display name, email, and user id are read-only. `updateProfile` exists in the hook with no UI caller.

**FR-14.6 Settings persistence [C]** — Authenticated users use `GET/PUT /api/settings` with optimistic update and rollback; guests use `localStorage`. On a genuine guest→authed transition, non-default guest settings are migrated once and guest storage is cleared.

---

## Known Limitations & Future Functional Requirements

### Security gaps (highest priority)
1. **No rate limiting anywhere.** Login, signup, forgot-password, and start-test are all unthrottled — credential stuffing and enqueue-flood are both open.
2. **No Express error-handling middleware.** Several auth and settings handlers call `next(error)`, which falls through to Express's default handler and returns an HTML stack trace outside production. Other handlers echo raw internal error strings to the client.
3. **`GET /api/debug/db` is unauthenticated** and leaks the Mongo database name and full collection list.
4. **Socket control events are unauthenticated.** `pause-test` / `resume-test` / `stop-test` carry no payload and perform no ownership check; in sync mode any connected socket can stop the singleton run.
5. **Guest stop matches any guest-owned run** — `getActiveUserId() === null` matches every guest.
6. **Token refresh is unbounded.** Any still-valid token mints a fresh 7-day token; there is no revocation list or rotation.
7. **Brain warm-start is cross-tenant.** `BrainConfig` has no `userId`, so `loadLatestBrainConfig(targetUrl)` can seed a run with another account's learned weights.
8. **`markSessionCompleted` / `markSessionCrashed` / `markSessionSaved` do not filter by `userId`**; `markLatestSessionSaved()` with no `targetUrl` matches the newest session of *any* user.
9. **`/api/forensic/report/:sessionId` does not validate the id as an ObjectId** — malformed input throws inside `new Types.ObjectId()` and surfaces as a 500.

### Broken or unreachable functionality
10. **Guest mode is unreachable from the UI** (FR-1.5) — the button cannot set the flag that enables the mode.
11. **Queued jobs cannot be cancelled** (FR-9.5).
12. **`/api/safari/stop` is a no-op in queue mode**, yet returns `ok: true` — and returns `ok: true` on internal error too.
13. **History sorting has no UI**, and its date comparator sorts formatted strings (FR-11.5).
14. **"Compare" does not compare** (FR-11.6).
15. **`SupportModal` submit button is a literal placeholder** — the form is never sent.
16. **`QueueStatusBanner` is entirely commented out**, as is its import.

### Missing evidence & observability
17. **No video or Playwright trace recording.** Only the ephemeral 33 ms JPEG stream exists.
18. **Screenshots are not persisted** and are captured only on the runtime-fault path — duplicate-action, API-hang, network, and freeze findings have no visual evidence.
19. **Source-map resolution is runtime-fault-only**, so other findings show minified frames.
20. **No DOM snapshot is ever serialized** — only state hashes and storage fingerprints.
21. **Accessibility findings are never persisted** — only an aggregate count reaches the UI, and nothing reaches the report.
22. **`MemoryProfiler` and `MemoryLeakDetector` are dead code** — no memory-leak detection runs.
23. **`VisualRegressionDetector` is instantiated but never called**, and its `bufferToImageData` parses PNG only while every screenshot is JPEG — even if wired it would always fall through to "match".

### Scale & data-lifecycle gaps
24. **No pagination anywhere.** Every list is limit-only — no skip, cursor, or total count.
25. **No TTL or retention policy.** Auto-tracked (unsaved) sessions accumulate forever, are never listed, and are never purged.
26. **N+1 query in `listSessionHistory`** — one `countDocuments` per session, up to 200 per request.
27. **Missing compound index** `{userId: 1, startedAt: -1}` for the exact history query shape; and `forensic_errors` indexes a `timestamp` field that does not exist on the schema.
28. **`console_logs` / `network_logs` store `timestamp` as a String**, so their sorts are lexicographic.
29. **Worker concurrency > 1 is incorrect** because `SessionManager` is a process-wide singleton — the constraint is documented but unenforced.
30. **`seededRandom` uses one global PRNG stream** — not safe for concurrent in-process runs.

### Feature gaps
31. **No authentication support for target apps.** There is no credentials field, so any application behind a login wall can only be explored to its login page.
32. **No timebox or step-budget control in the UI.** Duration is hardcoded to 10 minutes.
33. **No per-scenario toggles** — only the five bundled profiles.
34. **No PDF / CSV / Markdown file export** (FR-12.4).
35. **`bugs/finders/` registry has no runner** — four finder modules are entirely unreachable (FR-5.5).
36. **RouteTrasher is disabled engine-wide** despite ~690 lines of live scenario code (FR-4.8).
37. **`VerificationCandidate.reproduced` is never set in-run**, so its ±0.15 confidence branch is unreachable.
38. **Landing page is non-functional** — every nav link, CTA, and footer link except "Try BugSafari" is a dead `href="#"`.
39. **Notifications and Auto-Save settings have no consumers** (FR-14.2, FR-14.3).
40. **~14 dashboard components are dead code** (`HelpMenuIcon`, `InfiltrationProfileSelector`, `TelemetryStream`, `TelemetryLogStream`, `ReproductionTrail`, `ForensicTrail`, `AuthGuard`, `SlidingAuthForm`, and the `designs/components/*` set).

---

## Recommended Additional Functional Requirements

Not currently implemented. Ordered by leverage against the existing architecture.

### Tier 1 — Correctness & trust (do first)
- **RFR-1 Target-app authentication.** Accept credentials, a storage-state file, or a scripted login preamble, and inject via `context.storageState` before exploration. Without this the engine cannot reach the authenticated surface of any real SPA — which is where the interesting bugs are. This is the single highest-value gap.
- **RFR-2 Auth-aware boundary rules.** Pair RFR-1 with a logout-selector denylist so the engine does not immediately click "Sign Out" and lose its session. Reuse the existing `TRIGGERED_SELECTOR_DEMOTION` machinery.
- **RFR-3 In-run reproduction confirmation.** Replay each candidate finding once immediately after detection using the existing `ReplayActionRunner`, and set `VerificationCandidate.reproduced`. This activates an already-implemented confidence branch and would materially cut false positives at near-zero engineering cost.
- **RFR-4 Rate limiting + error middleware + endpoint hardening.** Addresses limitations 1–3 and 9 together.
- **RFR-5 Authenticated socket control.** Require the handshake JWT and a `runId` on `pause-test` / `resume-test` / `stop-test`, matching the ownership model `session-attach` already uses.

### Tier 2 — Report quality
- **RFR-6 Universal evidence capture.** Attach a screenshot, source-mapped stack, and DOM snapshot to *every* finding class, not just runtime faults. Store screenshots in GridFS or object storage keyed by finding id rather than embedding them, preserving the current no-bloat rule while making evidence durable.
- **RFR-7 Session video export.** The 33 ms frame stream already exists — persist it as a WebM per run, or enable `context.tracing` behind a flag, so a report links to a watchable reproduction.
- **RFR-8 PDF and CSV export.** JSON is machine-readable but not shareable with non-engineers. A PDF of the forensic report and a CSV of findings would make output usable in a QA workflow.
- **RFR-9 Accessibility section in the report.** Persist `AccessibilityFinding[]` and render a WCAG section with rule, impact, selector, and remediation. The auditor already produces this data; only storage and rendering are missing.
- **RFR-10 Bug triage state.** Add `status` (new / triaged / confirmed / wontfix / fixed) and an assignee to `caughtBugs`, with filtering in the report. Findings are currently write-once with no workflow.

### Tier 3 — Exploration power
- **RFR-11 Cross-run coverage memory.** Persist per-URL saturated cluster hashes and unexplored frontier edges, then seed the next run to resume where the last one stopped. The `StateClusterRegistry` and `GraphStore` already model exactly this; only persistence is missing — and it converts repeated 10-minute runs into cumulative coverage.
- **RFR-12 Run-over-run regression diff.** Compare a new run's findings against the previous run for the same URL and label each NEW / PERSISTING / FIXED. `buildFaultSignature` already gives a stable key.
- **RFR-13 Wire the dormant finder registry.** Add the missing runner so `structuralNavigation`, `spaRaceConditions`, `noSqlInjection`, and `structuralProbe` execute — or delete them. Four detector families are currently paid for and unused.
- **RFR-14 Visual regression.** Fix `bufferToImageData` to accept JPEG and call `compareFrames` on revisited states to catch layout and rendering regressions that DOM hashing is blind to by design.
- **RFR-15 Memory-leak detection.** Wire the existing `MemoryProfiler` and `MemoryLeakDetector` — sample the heap on each state revisit and report monotonic growth as a `BOUNDARY_STRESS_FAILURE`.

### Tier 4 — Usability & control
- **RFR-16 Advanced run configuration.** Expose timebox, max steps, per-scenario toggles, viewport, and allowed-domain list. `OptimizationSettings` already carries most of these; the UI simply does not surface them.
- **RFR-17 Scheduled and recurring runs.** Cron-triggered exploration with an email or webhook summary. The queue infrastructure needed for this already exists.
- **RFR-18 CI integration.** A CLI entry point and a `POST /api/runs` + poll API returning a non-zero exit on new CRITICAL/HIGH findings, so BugSafari can gate a pipeline.
- **RFR-19 Issue-tracker export.** One-click Jira / GitHub issue creation from a finding, using the existing Markdown reproduction formatter as the body.
- **RFR-20 Run comparison view.** Make the existing "Compare" button real — a side-by-side diff of findings, coverage, and visited routes for two selected runs.

### Tier 5 — Scale
- **RFR-21 Cursor pagination + retention policy.** Address limitations 24–25: cursor-based history paging, plus a TTL on unsaved sessions (e.g. 7 days) so auto-tracked rows do not grow without bound.
- **RFR-22 Multi-worker correctness.** Make `SessionManager` and `seededRandom` run-scoped rather than process-scoped so worker concurrency above 1 becomes safe, then raise the default.
- **RFR-23 Queue cancellation.** Remove waiting jobs on stop, and make `/api/safari/stop` report honestly in queue mode.
- **RFR-24 Team workspaces.** Shared runs, roles, and per-project history — the current model is strictly single-user.
