# BugSafari — System Test Cases

Manual verification test suite for the BugSafari Autonomous Exploratory Testing Engine. Each case reflects the actual implementation across `testing-core/` (engine), `developer-dashboard/` (Watchtower UI), and `shared/` (contracts). Status is `Passed` for behavior verified during manual testing; cases still needing a fresh manual pass are flagged in the notes below the table.

## Legend

- **Status** — `Passed` (verified), `Needs Verification` (implemented but not re-confirmed this cycle).
- Endpoints and event names are the real wire contracts; do not treat them as illustrative.

## 1. Authentication & Access

| ID | Test Case | Steps | Test Data | Expected Result | Actual Result | Status |
|----|-----------|-------|-----------|-----------------|---------------|--------|
| TC-01 | Operator registration | 1. Open dashboard. 2. Submit register form. 3. Confirm email verification flow. | email `ayan@test.dev`, password `Passw0rd!23` | `POST /api/auth/register` returns 201, account created, verification email path triggered. | Account created; unverified accounts gated until `verify-email`; coded `AuthErrorBody` on failure. | Passed |
| TC-02 | Valid login issues tokens | 1. Submit login. 2. Inspect storage + cookies. | valid credentials | `POST /api/auth/login` returns access token (localStorage) + refresh token in httpOnly cookie `bugsafari_rt`; `bugsafari_session` flag set. | Access token in localStorage, refresh token in httpOnly cookie, stateless JWT parsing per request. | Passed |
| TC-03 | Invalid login rejected + rate limited | 1. Submit wrong password repeatedly. | wrong password x6 | 401 with coded `AuthErrorBody`; `loginLimiter` + `loginIpLimiter` throttle brute force. | Rejected with typed error; repeated attempts throttled per-IP and per-account. | Passed |
| TC-04 | Silent token refresh | 1. Let access token expire. 2. Trigger an authed call. | expired access token, valid `bugsafari_rt` | `POST /api/auth/refresh` mints a new access token using the cookie; `x-bugsafari-access` header carries CSRF defense. | Access token refreshed from cookie without re-login; CSRF header required. | Passed |
| TC-05 | Logout releases run + clears tokens | 1. Start a run. 2. Logout. | active session | Logout `POST /api/safari/stop` first, then clears tokens; refresh cookie invalidated. | Active run stopped before token clear; admission slot released. | Passed |
| TC-06 | Multi-tenant history isolation | 1. Login user A. 2. Query history. 3. Repeat as user B. | two accounts | `GET /api/history` returns only the caller's sessions (per-user query filter). | Each operator sees only their own sessions; no cross-tenant leakage. | Passed |

## 2. Target Auth (Application-Under-Test Login)

| ID | Test Case | Steps | Test Data | Expected Result | Actual Result | Status |
|----|-----------|-------|-----------|-----------------|---------------|--------|
| TC-07 | Target login auto-discovery | 1. Configure Target Auth creds. 2. Start run against a gated SPA. | target URL + app credentials | `loginDiscovery` + `LoginFormLocator` find the login form, fill and submit before exploration. | Login form located and submitted; authenticated surface explored. | Passed |
| TC-08 | Target credential masking | 1. Run with Target Auth. 2. Inspect telemetry/forensics. | app password | `credentialMask` / `credentialScrub` redact credentials from all recorded telemetry. | Credentials never appear in telemetry, findings, or shared reports. | Passed |
| TC-09 | Auth wall detected during replay | 1. Verify Fix on a finding whose target now needs fresh login. | stale target creds | Verdict `VERIFICATION_FAILED`, reason `AUTH_WALL`; verdict says nothing about the bug. | Replay reports auth wall distinctly, not a false RESOLVED. | Passed |
| TC-10 | Guest cannot use Target Auth | 1. As guest, attempt Target Auth run. | no operator account | Target Auth blocked by guest policy (`guestPolicy`). | Target Auth rejected for guests. | Passed |

## 3. SPA Exploration & State Graph

| ID | Test Case | Steps | Test Data | Expected Result | Actual Result | Status |
|----|-----------|-------|-----------|-----------------|---------------|--------|
| TC-11 | Autonomous DOM traversal | 1. Start run on target SPA. 2. Watch Watchtower stream. | `bugsafari-target-app` via tunnel | Engine scans interactive elements, scores targets, clicks/inputs without a script. | Elements enumerated and driven autonomously; live decisions streamed. | Passed |
| TC-12 | State graph builds + backtracks | 1. Run a multi-view SPA. 2. Observe navigation. | multi-route SPA | `StateGraphNavigator` records states/edges, follows a global frontier, backtracks within cap. | Distinct states graphed; frontier-driven traversal with bounded backtracking. | Passed |
| TC-13 | Directed pathfinding to unseen state | 1. Force a distant unexplored view. | reachable deep route | `DIrectedPathFinder` / `PathPlanner` compute a path to the frontier target. | Engine navigates a computed path to reach unexplored states. | Passed |
| TC-14 | Perceptron target scoring | 1. Run and inspect element ratings. | mixed control set | Single-layer perceptron (Delta Rule) rates elements; weights adapt during the run. | Elements scored and re-weighted online; high-value controls prioritized. | Passed |
| TC-15 | Risk scoring ranks findings | 1. Complete a run with several faults. | run with N findings | `RiskScorer` produces stable, decaying-penalty scores; severity tiers derived. | Findings risk-ranked; penalty decay keeps scores stable across repeats. | Passed |

## 4. DOM Hashing & Loop Prevention

| ID | Test Case | Steps | Test Data | Expected Result | Actual Result | Status |
|----|-----------|-------|-----------|-----------------|---------------|--------|
| TC-16 | Structural DOM hash dedups states | 1. Revisit a structurally identical view. | repeated layout | `domHasher` / `stateFingerprint` yield the same hash; `StateClusterRegistry` clusters it. | Identical structures collapse to one cluster; no redundant re-exploration. | Passed |
| TC-17 | Repetition penalty breaks loops | 1. Trigger a control that returns to the same state. | self-looping control | `EdgeRepeatTracker` + repetition penalty down-weight the loop; stagnation scoring escalates. | Loop suppressed; engine diverts to novel actions. | Passed |
| TC-18 | Bounded DOM evaluate (no OOM) | 1. Run a content-heavy / media-heavy page. | large DOM SPA | `domHasher` evaluate is deadline- and payload-bounded (`MAX_SCAN_ELEMENTS=4000`, `MAX_ELEMENT_TEXT=512`). | Hot-path evaluates stay bounded; no runaway memory from DOM scan. | Passed |

## 5. Fuzzing & Chaos Scenarios

| ID | Test Case | Steps | Test Data | Expected Result | Actual Result | Status |
|----|-----------|-------|-----------|-----------------|---------------|--------|
| TC-19 | Field-aware data fuzzing | 1. Reach a form. 2. Let `dataFuzzer` run. | email/number/date/json fields | `elementClassifier` picks a strategy per field (email, numeric boundary, date, JSON). | Payloads matched to field type; inject + submit exercised. | Passed |
| TC-20 | XSS vector injection | 1. Fuzz a text field. | `<script>` / event-handler vectors | `xssVectorStrategy` injects; behavioral proof gates any finding. | XSS vectors submitted; finding only on observed unsafe reflection. | Passed |
| TC-21 | NoSQL injection probe | 1. Fuzz an auth/query field. | `{"$gt":""}` style payloads | `noSqlInjectionStrategy` submitted; `securityEvidenceGate` requires a structured marker. | NoSQL payload exercised; unproven attempts dropped, not reported. | Passed |
| TC-22 | Numeric boundary stress | 1. Fuzz numeric input. | min/max/overflow values | `numericBoundaryStrategy` drives boundary values; `BOUNDARY_STRESS_FAILURE` on crash. | Boundary values submitted; stability faults captured. | Passed |
| TC-23 | Chaos scenarios execute | 1. Enable scenario battery. | interactive SPA | `ButtonSpammer`, `CoordinateBombing`, `AsyncStateRacer`, `FormBypasser`, `NetworkSaboteur`, `StorageTamper` run via `stressScenarioMap`. | Scenarios dispatched with real chaos manager; RouteTrasher intentionally disabled. | Passed |
| TC-24 | Client-side constraint bypass | 1. Submit past a disabled/validated control. | bypassed `required`/`disabled` | `formBypasser` triggers submit; `CLIENT_SIDE_CONSTRAINT_BYPASS` when server accepts. | Bypass detected only when server trusts client-side rule. | Passed |

## 6. Vulnerability Detection & Findings

| ID | Test Case | Steps | Test Data | Expected Result | Actual Result | Status |
|----|-----------|-------|-----------|-----------------|---------------|--------|
| TC-25 | Bug family classification | 1. Complete a run with mixed faults. | varied faults | Findings mapped to `SECURITY` / `ACCESS_CONTROL` / `STABILITY` / `NAVIGATION_STATE` via `bugCategory`. | Each finding grouped into the correct family with student-friendly blurb. | Passed |
| TC-26 | Evidence gate blocks unproven vulns | 1. Trigger a security probe with no behavioral proof. | payload, no marker | Finding dropped at both promotion chokepoints (`securityEvidenceGate`). | Unproven security candidates suppressed; no false positives promoted. | Passed |
| TC-27 | Finding attribution / origin | 1. Induce a Playwright/extension artifact. | ResizeObserver noise, nav timeout | `VerificationPipeline` tags `FaultOrigin`; only `TARGET_APP` reportable, others `INCONCLUSIVE`. | Non-app noise classified and withheld; genuine defects `CONFIRMED`. | Passed |
| TC-28 | Occurrence count authoritative | 1. Reproduce the same fault N times. | repeated identical fault | Backend stamps `bugId`+`occurrences`; card shows ×N via `FINDING_OCCURRENCE_EVENT`, never +1 on arrival. | Distinct manifestations counted authoritatively; idempotent on replay. | Passed |
| TC-29 | Endpoint host stripping | 1. Produce a network/endpoint finding via tunnel. | tunneled target URL | `endpointLabel`/`routePath` strip the tunnel host; NETWORK records render via `describeNetworkFault`. | Endpoints domain-stripped; no tunnel host leak in findings/reports. | Passed |

## 7. Telemetry & Forensics

| ID | Test Case | Steps | Test Data | Expected Result | Actual Result | Status |
|----|-----------|-------|-----------|-----------------|---------------|--------|
| TC-30 | Live sensory frame streaming | 1. Start a run. 2. Watch Watchtower. | any target | `TelemetryEmitter` screencasts frames; ack is backpressure-gated. | Live frames stream to dashboard under backpressure control. | Passed |
| TC-31 | Circular action buffer on crash | 1. Cause an unhandled client error. | injected exception | 20-step circular buffer captured with the crash for reproduction. | Last 20 actions recorded around the fault; timeline persisted. | Passed |
| TC-32 | Console + network fault capture | 1. Emit a console error + failed request. | 500 response, thrown error | `browserConsoleListener` + network attribution record faults; credentials scrubbed. | Console/network faults captured and attributed; secrets redacted. | Passed |
| TC-33 | Forensic history persistence | 1. Complete run (authed). 2. Save. | authed run | `POST /api/history/save-session` persists session with authoritative severity counts. | Session saved with findings, severity summary, and traces. | Passed |
| TC-34 | History severity badge is real | 1. View a saved History card. | multi-severity run | Badge/filter/sort derive from real `severityCounts` (worst tier + count), not findingCount. | Card severity reflects true per-finding severity. | Passed |

## 8. Verify Fix & Reproduction

| ID | Test Case | Steps | Test Data | Expected Result | Actual Result | Status |
|----|-----------|-------|-----------|-----------------|---------------|--------|
| TC-35 | Verify Fix — fixed bug | 1. Open a saved finding. 2. Click Verify Fix. | fixed target, `VerifyFixRequest` | Engine replays recorded timeline in a fresh session; verdict `RESOLVED`, reason `CLEAN_REPLAY`. | Timeline replayed; fault absent; verdict RESOLVED persisted. | Passed |
| TC-36 | Verify Fix — still broken | 1. Verify a still-broken finding. | unpatched target | Verdict `STILL_ACTIVE`, reason `REPRODUCED`, `matchedSignals` populated. | Original fault class recurs; STILL_ACTIVE with matched signals. | Passed |
| TC-37 | Verify Fix progress streaming | 1. Verify a multi-step finding. | timeline with M steps | `verify-fix:progress` streams `replaying → validating`; ack is the terminal result. | Progress phases render live; single ack carries `VerifyFixResult`. | Passed |
| TC-38 | Verify Fix — no replay steps | 1. Verify a finding with no timeline. | legacy/empty timeline | Verdict `INCONCLUSIVE`, reason `NO_REPLAY_STEPS` / `LEGACY_TIMELINE`. | Non-replayable findings reported honestly, not falsely RESOLVED. | Passed |
| TC-39 | In-run reproduction verdict | 1. Run a session that catches a fault. | reproducible fault | `ReproductionProbe` replays in-run; `reproduction-verdict` patches the card by `bugId` with `reproductionRate`. | Card upgraded with reproduction rate/attempts after replay settles. | Passed |
| TC-40 | Reproduction playbook (no fabrication) | 1. Open a finding's repro steps. | verified telemetry | Steps built only from verified telemetry (`shared/reproduction.ts`); endpoints never shown as controls. | Playbook shows real steps only; no fabricated or file:line advice. | Passed |

## 9. Timers, Memory & Recovery

| ID | Test Case | Steps | Test Data | Expected Result | Actual Result | Status |
|----|-----------|-------|-----------|-----------------|---------------|--------|
| TC-41 | Adaptive memory budget tiers | 1. Run on a constrained host. | large SPA, low RAM host | `resolveRunMemoryBudget` picks ok/degrade/abort; peer-worker reservation applied. | Budget adapts to host; degrade/abort tiers engage before OOM. | Passed |
| TC-42 | Memory watchdog + media block | 1. Run a page with autoplay video. | embedded video SPA | Autoplay blocked, `mediaRoute` aborts media/font, watchdog force-disposes on pressure. | No freeze/OOM; media routed out, memory reclaimed proactively. | Passed |
| TC-43 | Reveal-scroll gated under degrade | 1. Run content-heavy page into degrade tier. | image-heavy SPA | `isMemoryDegraded` gates reveal-scroll; parser payload capped. | Reveal-scroll suspended under memory pressure; scan payload bounded. | Passed |
| TC-44 | Clean operator stop frees slot | 1. Start queued run. 2. Stop cleanly. | worker-mode run | `releaseOnCleanStop` frees the concurrency-1 slot immediately; retest not stuck QUEUED. | Slot released on clean stop; next run admits without hang. | Passed |
| TC-45 | Hung-stop watchdog force-release | 1. Stop a run that hangs on teardown. | stalled stop | `BUGSAFARI_STOP_TIMEOUT_MS` watchdog force-releases the stop and frees admission. | Hung stop force-released; admission slot recovered. | Passed |
| TC-46 | Stop during worker boot | 1. Queue a run. 2. Stop while worker boots. | boot-window stop | `SessionManager` pendingStops + deferred apply; outcome `queue-cancelled`. | Boot-window stop honored, not dropped; distinct cancelled reason. | Passed |

## 10. Shareable Reports & History Lifecycle

| ID | Test Case | Steps | Test Data | Expected Result | Actual Result | Status |
|----|-----------|-------|-----------|-----------------|---------------|--------|
| TC-47 | Create shareable report link | 1. Open a saved session. 2. Share. | saved session, ttl | `POST /api/history/:id/share` creates/reuses one active link per user·session·ttl. | Idempotent share link; capped to one active row per ttl. | Passed |
| TC-48 | Public report read (no auth) | 1. Open a share URL logged out. | share token | `GET /api/public/report/:token` renders the report without auth; scoped to token. | Report viewable via token only; no account data exposed. | Passed |
| TC-49 | Revoke share link | 1. Delete an active share. | shareId | `DELETE /api/history/:id/shares/:shareId` revokes; token stops resolving. | Link revoked; public URL no longer resolves. | Passed |
| TC-50 | Soft-delete (Archive / Trash) | 1. Delete a saved session. | saved session | Soft delete to Archive/Trash (`sessionState`); `POST .../archive` and `.../restore` bucket it. | Session archived/trashed, restorable; not hard-deleted. | Passed |
| TC-51 | Permanent delete with typed confirm | 1. Permanently delete a session with ≥3 findings. | `findingCount>=3` | `DELETE /api/history/:id/permanent` requires typed `RUN-` confirmation. | Permanent delete gated by typed confirm for high-finding runs. | Passed |
| TC-52 | Trash reaper purge | 1. Leave a trashed session past retention. | age > 30d | Reaper purges trash after `BUGSAFARI_TRASH_RETENTION_DAYS`. | Expired trash purged automatically. | Needs Verification |

## 11. Guest Mode

| ID | Test Case | Steps | Test Data | Expected Result | Actual Result | Status |
|----|-----------|-------|-----------|-----------------|---------------|--------|
| TC-53 | Guest run envelope enforced | 1. Start a run unauthenticated. | no token | `guestPolicy` at `/api/start-test`: 5-min cap, sync-only single run, reduced scope/scenarios. | Guest run bounded in time, scope, and concurrency. | Passed |
| TC-54 | Guest save blocked | 1. As guest, finish a run. 2. Attempt save. | guest run | `/api/history/save-session` requires auth; guest results not persisted. | Guest results explorable but not saved to DB. | Passed |
| TC-55 | Guest rate limits | 1. Start guest runs rapidly. | 4 starts / 15 min | `guestStartWindowLimiter` (3/15min) + `guestStartCooldownLimiter` (30s) throttle. | Excess guest starts throttled by window + cooldown. | Passed |

## 12. Assisted Analysis (Gemini) & Fix Suggestions

| ID | Test Case | Steps | Test Data | Expected Result | Actual Result | Status |
|----|-----------|-------|-----------|-----------------|---------------|--------|
| TC-56 | Suggested fix generation | 1. Open a finding. 2. Request fix. | confirmed finding | `POST /api/findings/suggest-fix` returns remediation guidance from real evidence. | Actionable fix suggestion returned for the finding. | Needs Verification |
| TC-57 | Forensic insights (Get Insights) | 1. Open a saved session. 2. Get Insights. | saved forensic trace | `POST /api/forensic/insights` returns an aggregated analysis. | Insight summary generated over the session's forensics. | Needs Verification |
| TC-58 | Forensic report fetch | 1. Open a saved session report. | sessionId | `GET /api/forensic/report/:sessionId` returns the full forensic report. | Full report rendered with findings and traces. | Passed |

## Notes on Verification Status

- `Needs Verification` cases depend on time-based or external-service behavior that was not re-exercised end-to-end this cycle: **TC-52** (30-day reaper window), **TC-56 / TC-57** (assisted analysis paths that call an external model provider). Their implementation exists; confirm with a live run and, for TC-52, an aged fixture or shortened retention env before marking `Passed`.
- All endpoint paths, socket event names (`verify-fix`, `verify-fix:progress`, `reproduction-verdict`, `finding-occurrence`), scenario names, and env flags above are taken from the current codebase and are safe to cite in the thesis.
- RouteTrasher is intentionally disabled engine-wide; it is excluded from scenario coverage on purpose, not an untested gap.
