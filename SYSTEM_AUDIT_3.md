# BugSafari — System Audit 3

**Date:** 2026-07-30
**Branch:** `7-30-Ayan-4` (working tree, uncommitted Gemini-advisor changes included)
**Scope:** Full stack — `testing-core/` (API, WebSocket, exploration engine, telemetry, forensics, queue, workers, persistence), `developer-dashboard/`, `shared/`, and deploy/CI configuration.
**Status:** Findings only. **No code has been changed.** Fixes are deferred to a later phase pending review of this document.

---

## How to read this document

Findings are ordered by severity and carry a stable ID (`C-`/`H-`/`M-`/`L-`) so they can be referenced in later work.

**Severity definition**

| Level | Meaning |
|---|---|
| **Critical** | Exploitable by an unauthenticated or low-privilege actor with serious consequence, or a defect that silently breaks a core user-visible feature today. |
| **High** | Serious security weakness with a precondition, an availability risk to the whole service, or an engine defect that corrupts exploration results. |
| **Medium** | Real defect with bounded blast radius — resource growth, degraded correctness, information leak, or a scalability ceiling. |
| **Low** | Maintainability, hygiene, documentation drift, and accepted-risk items recorded so they are not re-discovered. |

**Verification legend**

| Tag | Meaning |
|---|---|
| `[direct]` | The cited code was read during this audit and the claim re-checked line by line. |
| `[sweep]` | Surfaced by the automated audit sweep with a code citation, not independently re-read. Treat the citation as accurate and the reasoning as needing confirmation before the fix. |

**CWE references** are given where a recognised weakness class applies.

---

## Summary index

### Critical

| ID | Title | Area |
|---|---|---|
| [C-01](#c-01) | Real production secrets committed to a tracked template file | Secrets / config |
| [C-02](#c-02) | `targetAuth.loginUrl` bypasses target admission — guest-reachable SSRF and local file read | API / SSRF |
| [C-03](#c-03) | Stale `shared/runCode.js` makes the dashboard reject every run code the backend mints | Shared contracts |

### High

| ID | Title | Area |
|---|---|---|
| [H-01](#h-01) | API process has no `unhandledRejection` / `uncaughtException` guard | Reliability |
| [H-02](#h-02) | Chromium runs with `--no-sandbox` inside a root container while loading hostile pages | Container security |
| [H-03](#h-03) | Browser launched outside the cleanup `try` — zombie Chromium on early-init failure | Resource leak |
| [H-04](#h-04) | `execution-timebox-ms` is unclamped — a guest can pin a worker replica for a day | DoS |
| [H-05](#h-05) | Queue-room join has no ownership check — cross-tenant queue-state leak | Authorization |
| [H-06](#h-06) | Private-host gate is string-only, never re-applied after redirect, no DNS check | SSRF |
| [H-07](#h-07) | Caddy CORS allow-list effectively wildcards `*.vercel.app` with credentials | CORS |
| [H-08](#h-08) | `docker-compose.prod.yml` mounts a Caddyfile path that does not exist in the repo | Deploy |
| [H-09](#h-09) | Access-token TTL drift — prod template signs 7-day non-revocable tokens | Auth |
| [H-10](#h-10) | Paused runs never expire — indefinite Chromium and worker-slot hold | Resource lifecycle |
| [H-11](#h-11) | `page.evaluate` calls with no deadline — a wedged renderer parks the loop forever | Engine liveness |
| [H-12](#h-12) | Edge permanently stranded in `traversing` — exploration frontier shrinks silently | Engine correctness |

### Medium

| ID | Title | Area |
|---|---|---|
| [M-01](#m-01) | JWT verification does not pin the algorithm | Auth |
| [M-02](#m-02) | Hardcoded dev fallback secret is active whenever `NODE_ENV !== 'production'` | Auth |
| [M-03](#m-03) | Unbounded engine collections grow for the whole run | Memory |
| [M-04](#m-04) | Timeout timers never cleared — ~150 live orphan closures at all times | Memory |
| [M-05](#m-05) | `AsyncTaskTracker.settle()` can loop forever | Reliability |
| [M-06](#m-06) | Stop is slow: not observed mid-step, and blocks on an unbounded settle | Responsiveness |
| [M-07](#m-07) | `stop()` races `run()`'s finally and discards the confirmed-bug snapshot | Race condition |
| [M-08](#m-08) | Reproduction sidecar context closed while its replay is still running | Race condition |
| [M-09](#m-09) | Fire-and-forget async in the engine hot path with no rejection handling | Error handling |
| [M-10](#m-10) | Rate limiter keys on an unbounded attacker-controlled string, and is per-process | DoS |
| [M-11](#m-11) | Gemini prompts are built from unbounded target-site content, AI routes unthrottled | Cost / DoS |
| [M-12](#m-12) | Raw internal error message returned to the client on `/api/safari/stop` | Info disclosure |
| [M-13](#m-13) | No security headers; `X-Powered-By` not disabled | Hardening |
| [M-14](#m-14) | Worker container has no healthcheck — a wedged worker is never restarted | Reliability |
| [M-15](#m-15) | Run-ownership token logged to the production browser console | Info disclosure |
| [M-16](#m-16) | Every dashboard history failure is reported as "backend hot-reloading" | UX / error handling |
| [M-17](#m-17) | `/settings` reachable by guests; `AuthGuard` is dead code claiming to protect routes | Frontend authz |
| [M-18](#m-18) | Two competing target-URL validators; the one on the save path is weaker | Architecture |
| [M-19](#m-19) | `findings[]` has no element cap on save while its siblings do | Resource limits |
| [M-20](#m-20) | Hashing failure is misreported as traversal failure, permanently penalising a control | Engine correctness |
| [M-21](#m-21) | `element-selected` telemetry fires before the decision resolves | Telemetry accuracy |
| [M-22](#m-22) | Replay buffer truncates the causal head and interleaves tabs | Replay fidelity |
| [M-23](#m-23) | Forensic child collections have no tenant column | Data isolation |
| [M-24](#m-24) | Cluster can saturate prematurely once a shell exceeds 2000 selectors | Engine correctness |
| [M-25](#m-25) | No Socket.IO connection-level auth middleware | Architecture |
| [M-26](#m-26) | Module-level singletons pin worker concurrency to 1 | Scalability |
| [M-27](#m-27) | Secondary-tab sub-sessions share scoring state with the primary | Engine correctness |
| [M-28](#m-28) | Insecure default fallbacks for Mongo, Redis, SMTP, and the frontend URL | Config |

### Low

| ID | Title | Area |
|---|---|---|
| [L-01](#l-01) | `registerRoutes.ts` is 1441 lines | Maintainability |
| [L-02](#l-02) | Dead-code inventory | Maintainability |
| [L-03](#l-03) | Dependency hygiene, and a documented control that does not exist | Maintainability |
| [L-04](#l-04) | CI supply-chain and deploy hardening | CI/CD |
| [L-05](#l-05) | Hardcoded magic timeouts with no configuration path | Maintainability |
| [L-06](#l-06) | Blanket empty catches on page-driving code | Error handling |
| [L-07](#l-07) | Auth logs include user email addresses | Privacy |
| [L-08](#l-08) | The `shared/*.js` drift mechanism is armed for all 21 artifacts | Build |
| [L-09](#l-09) | `vercel.json` sets no security headers; Vite `allowedHosts: true` | Config |
| [L-10](#l-10) | JWT in `localStorage` — accepted risk, recorded | Auth |
| [L-11](#l-11) | `testing-core/.env.example` comment contradicts the actual CORS design | Docs |

[Verified clean — do not re-audit](#verified-clean)

---

# CRITICAL

<a id="c-01"></a>
## C-01 — Real production secrets committed to a tracked template file

**Severity:** Critical · **CWE-798** (Hard-coded Credentials), **CWE-540** (Information in Source Code)

**Description.** `.env.prod.example` is tracked in git and ships two filled-in 32-byte hex values where every other required field is deliberately blank:

```
.env.prod.example:10   JWT_SECRET=90d2d323d73050a25e0135dcd8eec72ef19669b3f426b260836432e8d650974f
.env.prod.example:13   BUGSAFARI_AUTH_KEY=ab31be095ea3725c04462c5aed9dfbea8be66933ccedb09ffc8872e1141369d2
```

`MONGODB_URI=` and `FRONTEND_URL=` on the same file are empty, so these are not placeholders — someone pasted generated production values into the template. The surrounding comments still read `openssl rand -hex 32`, as though unfilled.

**Root cause.** No separation between "template" and "generated values"; no pre-commit secret scan; the file's own instructions ("Copy to `.env` … fill in") invite an operator to use it verbatim.

**Impact on BugSafari.** `JWT_SECRET` signs every access token — anyone with repo access forges any user's session. `BUGSAFARI_AUTH_KEY` is the AES-256-GCM key protecting the single-use credential vault (`AuthVault.ts:66-100`) that carries **target-application usernames and passwords** from the API to the worker fleet. Both values are in git history and cannot be removed by editing the file.

**Affected files.** `.env.prod.example`; consumers `testing-core/src/presentation/authentication/authConfig.ts`, `testing-core/src/infrastructure/queue/AuthVault.ts`.

**Recommended fix.** Blank both fields. Add the two literals to a `KNOWN_LEAKED_SECRETS` set and refuse them at boot in **all** environments — extend the existing exact-match guard at `authConfig.ts:45` rather than adding a parallel check, and mirror it in `AuthVault.create()`, whose callers already fail closed (`registerRoutes.ts:431-437`). Add secret scanning to CI.

**Verification.** `[direct]` — read `.env.prod.example:1-35`; confirmed tracked via `git ls-files`. Confirmed `.env`, `testing-core/.env`, `developer-dashboard/.env` exist locally and are correctly gitignored (`.gitignore:9`).

**Risks & dependencies.** Confirmed **not deployed**, so no rotation is required. The values remain in git history — scrub history before the repo is ever made public. The boot-time refusal must land before anyone copies the template.

---

<a id="c-02"></a>
## C-02 — `targetAuth.loginUrl` bypasses target admission (guest-reachable SSRF + local file read)

**Severity:** Critical · **CWE-918** (SSRF), **CWE-22** (Path Traversal via `file://`)

**Description.** `/api/start-test` validates `targetUrl` through `parseTargetUrl` + `resolveEngineTargetUrl` (`registerRoutes.ts:373,383`), which enforce the scheme and private-host gates. The optional `targetAuth.loginUrl` on the same request body does not go through either:

```ts
registerRoutes.ts:131      loginUrl: optionalString(raw.loginUrl),
registerRoutes.ts:110-111  typeof value === 'string' && value.trim() ? value.trim() : undefined
```

It is handed directly to Playwright:

```ts
TargetAuthenticator.ts:90   const entryUrl = config.loginUrl ?? targetUrl;
TargetAuthenticator.ts:93   await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
```

`/api/start-test` uses `optionalAuth` (`registerRoutes.ts:369`), so this is reachable **without any account**.

**Root cause.** Target admission was implemented as a check on one named field rather than as a gate every navigable URL in the payload must pass. `parseTargetAuth` validates the *shape* of the auth block (`:113-136`) but not the *safety* of the URL inside it.

**Impact on BugSafari.** An unauthenticated caller can drive the engine to `file:///etc/passwd`, `http://169.254.169.254/latest/meta-data/` (cloud instance credentials), or any service on the container network (`http://redis:6379`, the Mongo host). Rendered content is streamed back to the caller through the live-frame channel (`SocketTelemetryGateway.ts:104`), so this is a read primitive, not a blind one. On the queued path the same payload reaches `SafariWorker`, which sits on the same private network as Redis and the credential vault.

**Affected files.** `testing-core/src/presentation/api/registerRoutes.ts` (`parseTargetAuth`, ~`:105-137`), `testing-core/src/infrastructure/playwright/TargetAuthenticator.ts:82-96`, `testing-core/src/infrastructure/workers/SafariWorker.ts:165`.

**Recommended fix.** Architectural, not a patch at the `page.goto`: make target admission a single function every navigable URL passes through, and call it on `loginUrl` inside `parseTargetAuth`, returning the existing `'invalid'` result on failure. Fixing it at the trust boundary covers the synchronous and queued paths at once, because both mint their payload here. Pairs with H-06 (the gate itself is weak) and M-18 (there are currently two competing gates).

**Verification.** `[direct]` — read `registerRoutes.ts:105-137` and `TargetAuthenticator.ts:75-104`; confirmed `optionalAuth` on the route from the sweep's route inventory. Not exploited — no request was issued against a running instance.

**Risks & dependencies.** Rejecting `loginUrl` values that previously worked will break any operator flow that pointed at a private login host. That is the intended behaviour change and matches how `targetUrl` already behaves, but it should be called out in release notes.

---

<a id="c-03"></a>
## C-03 — Stale `shared/runCode.js` makes the dashboard reject every run code the backend mints

**Severity:** Critical (functional) · Silent data-integrity defect

**Description.** `shared/` ships both `.ts` sources and 21 committed `.js` files. `shared/tsconfig.json:9` sets `"noEmit": true` while `shared/package.json:15` defines `"build": "tsc -p tsconfig.json"` — so **the build never regenerates the `.js`**. One has drifted with runtime consequence:

```js
shared/runCode.js:7    export const RUN_CODE_REGEX = /^RUN-[0-9A-F]{6}$/;      // no RUN_CODE_BYTES export
```
```ts
shared/runCode.ts:9    export const RUN_CODE_REGEX = /^RUN-[0-9A-F]{6,12}$/;
shared/runCode.ts:13   export const RUN_CODE_BYTES = 5;                        // → 10 hex chars
```

Which file wins differs per consumer. `testing-core/tsconfig.json:19-23` compiles `../shared/**/*.ts`, so the backend mints 10-character codes. Every dashboard file imports shared by **relative path** — `import { normalizeRunCode } from '../../../../../shared/runCode.js'` (`EngineHttpClient.ts:5`), `'../../../shared/runCode.js'` (`historyService.ts:8`) — and the `@bugsafari/shared` alias in `vite.config.ts:18-20` matches no import anywhere in the codebase. Vite resolves the literal existing `.js`, so the **6-character regex is what ships to the browser**.

**Root cause.** Committed build artifacts with no regeneration path, combined with two resolvers that disagree. TypeScript's `moduleResolution: "bundler"` (`developer-dashboard/tsconfig.app.json:12`) maps `./runCode.js` → `runCode.ts`, so `tsc` typechecks the correct file while Vite bundles the wrong one. The defect is invisible to CI by construction.

**Impact on BugSafari.** `normalizeRunCode(data.runId)` at `EngineHttpClient.ts:104` returns `null` for every real run, because a 10-character code fails `{6}`. The run code never reaches the store, and the save path — which keys the persisted document on the run code (`runStore.ts:66-67`) — targets the wrong document. `isRunCode` in `historyService.ts:8` is broken identically. Users cannot reliably find or save their runs by code.

**Affected files.** `shared/runCode.js`, `shared/runCode.ts`, `shared/tsconfig.json:9`, `shared/package.json:15`, `developer-dashboard/vite.config.ts:16-21`, `developer-dashboard/src/infrastructure/engine/gateway/EngineHttpClient.ts:5,104`, `developer-dashboard/src/services/historyService.ts:8`.

**Recommended fix.** Delete all `shared/*.js` and gitignore them. Vite falls back to the `.ts` when the `.js` is absent; the backend already compiles from `.ts`; the dashboard already typechecks against `.ts`. Deletion removes the entire drift class permanently rather than adding a regeneration step that can itself fall out of date. See L-08 — the mechanism is armed for all 21 files, not just this one.

**Verification.** `[direct]` — diffed `shared/runCode.js` against `shared/runCode.ts`; enumerated all dashboard shared imports and confirmed every one is relative, not aliased; compared mtimes across all 21 artifacts (only `runCode.js` and `types/remediation.js` are stale, and the latter is types-only so it erases to an empty module).

**Risks & dependencies.** Before deleting, confirm no *non-bundled Node context* imports a shared `.js` at runtime — scripts under `testing-core/scripts/` run via `tsx` and should be checked. Deleting the artifacts changes what Vite resolves, so a full dashboard build and a run-code round-trip test are required.

---

# HIGH

<a id="h-01"></a>
## H-01 — API process has no `unhandledRejection` / `uncaughtException` guard

**Severity:** High · **CWE-248** (Uncaught Exception)

**Description.** `testing-core/src/index.ts` registers only signal handlers:

```ts
index.ts:199   process.on('SIGTERM', () => shutdown('SIGTERM'));
index.ts:200   process.on('SIGINT', () => shutdown('SIGINT'));
```

The worker entrypoint already does the right thing:

```ts
worker-entry.ts:67   process.on('uncaughtException', (error) => { void crash('uncaught exception', error); });
worker-entry.ts:71   process.on('unhandledRejection', (reason) => { void crash('unhandled rejection', reason); });
```

**Root cause.** The guard was added to the worker when the distributed path was built and never backported to the API, which still runs exploration in-process by default (`BUGSAFARI_USE_QUEUE` unset ⇒ `taskQueue` undefined, `index.ts:84`).

**Impact on BugSafari.** Under Node 18+'s default `--unhandled-rejections=throw`, a single rejected fire-and-forget from any session kills the API server — taking down every other user's live session, the Socket.IO gateway, and the HTTP API. M-09 documents at least seven such call sites in the engine hot path, several fired from Playwright event listeners where a throw is guaranteed to become an unhandled rejection.

**Affected files.** `testing-core/src/index.ts:163-200`.

**Recommended fix.** Mirror the worker's handlers with API-appropriate semantics: log-and-continue for `unhandledRejection` (one bad session must not kill the fleet), graceful shutdown for `uncaughtException` (state is genuinely unknown). Add a re-entrancy guard to `shutdown` (`:172`) so a double SIGINT does not run the teardown twice.

**Verification.** `[direct]` — read `index.ts` in full; worker citation `[sweep]`.

**Risks & dependencies.** Swallowing `unhandledRejection` can mask defects. Pair it with a loud, structured log line so M-09's root causes remain visible rather than silently absorbed.

---

<a id="h-02"></a>
## H-02 — Chromium runs with `--no-sandbox` inside a root container while loading hostile pages

**Severity:** High · **CWE-250** (Execution with Unnecessary Privileges), **CWE-693** (Protection Mechanism Failure)

**Description.** The primary browser launch disables the Chromium sandbox, and the fallback launch disables it twice over:

```ts
PlaywrightBrowserEngine.ts:179   ['--start-maximized', '--disable-dev-shm-usage', '--disable-gpu', '--no-sandbox'],
PlaywrightBrowserEngine.ts:187   ['--no-sandbox', '--disable-setuid-sandbox'],
```

The container has no `USER` directive, so it runs as root:

```
Dockerfile   FROM mcr.microsoft.com/playwright:v1.60.0-jammy      # defaults to root; ships an unused `pwuser`
Dockerfile   CMD ["node", "testing-core/dist/testing-core/src/index.js"]
```

**Root cause.** `--no-sandbox` is the standard workaround for running Chromium as root in a container — the two problems are each other's cause. Dropping to `pwuser` (which the base image already provides) removes the need for the flag.

**Impact on BugSafari.** The engine's entire purpose is to load attacker-controlled pages, and C-02/H-06 let an unauthenticated guest choose which. The Chromium sandbox is the single boundary between a malicious page's renderer and the host process. With it disabled and the process running as root, a renderer compromise yields root inside a container holding `MONGODB_URI`, `JWT_SECRET`, `REDIS_URL`, and `BUGSAFARI_AUTH_KEY` in its environment. This is the highest-consequence weakness in the system even though it requires a Chromium exploit.

**Affected files.** `testing-core/src/infrastructure/playwright/PlaywrightBrowserEngine.ts:177-192`, `Dockerfile`, `docker-compose.prod.yml`.

**Recommended fix.** Add `USER pwuser` to the Dockerfile (with the correct `chown` on `/app`), then drop `--no-sandbox` from both launch arg sets. Keep `--disable-dev-shm-usage` — that one is a legitimate container fix. If the sandbox cannot be enabled, compensate with a seccomp profile and a dedicated network namespace that cannot reach Redis, Mongo, or the metadata endpoint.

**Verification.** `[direct]` — read `PlaywrightBrowserEngine.ts:168-197` and the full `Dockerfile`. Not flagged by the automated sweep; found during spot-check.

**Risks & dependencies.** Enabling the sandbox as non-root can fail in restrictive CI or on hosts without user-namespace support — needs a real container test before rollout. Interacts with H-06: network-level egress restriction is the defence-in-depth layer if the sandbox cannot be restored.

---

<a id="h-03"></a>
## H-03 — Browser launched outside the cleanup `try` — zombie Chromium on early-init failure

**Severity:** High · **CWE-404/CWE-772** (Improper Resource Shutdown / Missing Release)

**Description.** The browser is assigned at `:178` inside a `try/catch` that handles *launch* failure only and rethrows (`:190`). The main `try` whose `finally` calls `cleanupResources()` does not begin until `:277`:

```ts
PlaywrightBrowserEngine.ts:178   this.activeBrowser = await launchBounded([...], 'primary');
PlaywrightBrowserEngine.ts:216   this.activePage = await this.activeContext.newPage();
PlaywrightBrowserEngine.ts:221   await installReflectionOracle(this.activePage);
PlaywrightBrowserEngine.ts:238   const platformInfo = await this.activePage.evaluate(() => { … });
PlaywrightBrowserEngine.ts:277   try {                                    // ← cleanup coverage starts here
PlaywrightBrowserEngine.ts:387   } finally { … cleanupResources() … }
```

**Root cause.** The launch/fallback logic was added as a self-contained block ahead of the existing `try`, so the resource it acquires sits outside the scope that releases it.

**Impact on BugSafari.** Any throw between `:178` and `:276` — `newContext` with a malformed `storageState` (operator-supplied), `newPage`, either oracle install, or either `page.evaluate` — leaves a Chromium process, context, and page alive permanently. Each is ~150-300 MB. With `WORKER_REPLICAS=2` on a 4 GB droplet (`.env.prod.example:21-23`), a handful of malformed-storage-state runs exhausts the host. `storageState` is operator-supplied, so this is reachable, not merely theoretical.

**Affected files.** `testing-core/src/infrastructure/playwright/PlaywrightBrowserEngine.ts:177-392`.

**Recommended fix.** Move the launch inside the main `try` so the existing `finally`/`cleanupResources()` covers acquisition through teardown. This is a structural fix, not an added catch — no new cleanup path is introduced.

**Verification.** `[direct]` — read `PlaywrightBrowserEngine.ts:168-197`; confirmed the `try` at `:177` is the launch-fallback block, not the cleanup block. `:277`/`:387` citations `[sweep]`.

**Risks & dependencies.** `cleanupResources()` must tolerate partially-initialised state (null `activeContext`/`activePage`) — verify before moving the boundary.

---

<a id="h-04"></a>
## H-04 — `execution-timebox-ms` is unclamped: a guest can pin a worker replica for a day

**Severity:** High · **CWE-770** (Allocation Without Limits), **CWE-20** (Improper Input Validation)

**Description.** The optimization block is an unchecked cast, and the timebox is read straight from it with no bound at any layer:

```ts
registerRoutes.ts:416   const optimizationSettings = request.body?.optimization as OptimizationSettings | undefined;
registerRoutes.ts:476   const timeboxMs = optimizationSettings?.['execution-timebox-ms'] ?? 600_000;
ExplorationEngine.ts:283 this.timeboxMs = optimizationSettings?.['execution-timebox-ms']
```

**Root cause.** `as` silences the type system at a trust boundary. The default (`?? 600_000`) was mistaken for a limit; nothing enforces a ceiling.

**Impact on BugSafari.** `/api/start-test` is guest-reachable. Fleet capacity equals `WORKER_REPLICAS` (2 in the prod template) and worker concurrency is pinned to 1 (`SafariWorker.ts:49`, see M-26). An unauthenticated caller requesting `execution-timebox-ms: 86400000` occupies half the fleet for 24 hours. Two such requests deny service to every legitimate user. The queue-depth cap (`registerRoutes.ts:462`) limits how many runs *queue*, not how long each *holds a slot*. Compounded by H-10 (a paused run never expires at all).

**Affected files.** `testing-core/src/presentation/api/registerRoutes.ts:416,476,565`, `testing-core/src/domain/services/exploration/ExplorationEngine.ts:283`.

**Recommended fix.** Validate and clamp the whole optimization block at the route boundary — a `clampOptimizationSettings` alongside the existing `parseTargetAuth`, bounding `execution-timebox-ms`, `max-actions`, and `form-fuzz-cap`. Clamping at the boundary covers both the synchronous and queued paths, since both derive their payload there. Consider a lower ceiling for guests than for authenticated users.

**Verification.** `[direct]` — read `registerRoutes.ts:110-137` and confirmed the `parseTargetAuth` pattern this should follow; the `:416`/`:476`/`ExplorationEngine.ts:283` citations are `[sweep]` and should be re-read before the fix.

**Risks & dependencies.** A ceiling below a legitimately long exploration would truncate real runs. Pick the bound from observed run durations in the benchmark suite, and make it configurable per deployment.

---

<a id="h-05"></a>
## H-05 — Queue-room join has no ownership check (cross-tenant queue-state leak)

**Severity:** High · **CWE-639** (Authorization Bypass Through User-Controlled Key), **CWE-862** (Missing Authorization)

**Description.** Joining a queue room requires only a job id:

```ts
registerSocketHandlers.ts:130   if (!jobId || !queueSupport) return;
registerSocketHandlers.ts:132   void socket.join(queueRoom(jobId));
```

The room then receives lifecycle updates including failure text:

```ts
QueueStatusBroadcaster.ts:63   this.events.on('failed', ({ jobId, failedReason }) => void this.onLifecycle(jobId, 'failed', failedReason));
QueueStatusBroadcaster.ts:98   this.emit(jobId, { …, message });
```

There is also no `io.use(...)` anywhere in the repo, so no connection-level auth gates this (see M-25).

**Root cause.** Room membership was treated as a routing concern rather than an authorization decision. Every *other* channel in the system is correctly scoped — `SocketTelemetryGateway.ts:62-63` drops unrouted emits, `verify-fix` re-derives the user server-side (`registerSocketHandlers.ts:225`) — this one path was missed.

**Impact on BugSafari.** BullMQ job ids are sequential integers. An anonymous socket can enumerate them and read other operators' queue positions and `failedReason` strings, which can carry target URLs and internal error text. It breaks the multi-tenant isolation guarantee that the rest of the system upholds.

**Affected files.** `testing-core/src/presentation/socket/registerSocketHandlers.ts:128-135`, `testing-core/src/infrastructure/queue/QueueStatusBroadcaster.ts:53-98`.

**Recommended fix.** Verify ownership against `RunRegistry` — already injected into the handler — before joining, using the same `ownsQueuedRun` rule already applied to control messages at `:187`. Reuse the existing ownership predicate rather than writing a second one.

**Verification.** `[sweep]` — code citations not independently re-read. The surrounding ownership machinery (`runOwnership.ts:23-25`, `registerSocketHandlers.ts:187,194`) was corroborated in the same sweep and is consistent.

**Risks & dependencies.** Guest runs prove ownership by possession of a `runToken` (`registerRoutes.ts:558`), so the check must accept a token as well as a `userId` or it will break guest queue-status updates.

---

<a id="h-06"></a>
## H-06 — Private-host gate is string-only, never re-applied after redirect, and does no DNS check

**Severity:** High · **CWE-918** (SSRF), **CWE-350** (Reliance on Reverse DNS / name resolution)

**Description.** `isPrivateTargetHost` (`shared/url.ts:12-24`) matches literal textual forms only:

```ts
shared/url.ts:18   if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;   // 127.0.0.0/8
```

Three gaps:

1. **Alternate IP encodings are not caught** — decimal `http://2130706433`, octal `http://0177.0.0.1`, hex `http://0x7f000001`, short form `http://127.1`, IPv4-mapped IPv6 `http://[::ffff:127.0.0.1]`. All resolve to loopback; none match the regexes.
2. **No name resolution** — a public hostname whose A record points into `10.0.0.0/8` (`localtest.me` and similar) passes cleanly.
3. **No re-validation after redirect** — the gate runs once at admission (`serverUtils.ts:34`, `SafariWorker.ts:165`). A permitted target that 302s to `http://169.254.169.254/latest/meta-data/` is followed. `TabWindowManager.classify` (`:97`) gates *new tabs*, not main-frame navigation.

**Root cause.** The gate was designed as an operator-facing input hint (`PUBLIC_TARGET_REQUIRED_MESSAGE`, `shared/url.ts:7`) shared with the dashboard, and later reused as the server-side security boundary. A UX hint and a security control have different requirements; only the former was built.

**Impact on BugSafari.** Same class as C-02 — unauthenticated access to loopback services, the cloud metadata endpoint, and the container network, with content streamed back via live frames. C-02 is the wide-open door; this is the fact that the door's lock is weak even when used.

**Affected files.** `shared/url.ts:12-37`, `testing-core/src/serverUtils.ts:34`, `testing-core/src/infrastructure/workers/SafariWorker.ts:165`, `testing-core/src/infrastructure/playwright/TabWindowManager.ts:97`.

**Recommended fix.** Three layers:
- Canonicalise the host to dotted-quad before the existing regexes run. Keep `shared/url.ts` pure and browser-safe — it is imported by the dashboard (`runCommands.ts:4`, `LiveFeed.tsx:8`).
- Add a server-side `dns.lookup` check in `serverUtils.ts` so a public name resolving into private space is rejected. This cannot live in `shared/`.
- Add one `context.route()` handler in `PlaywrightBrowserEngine` that aborts **document-type** requests to private hosts — a single guard covering redirects and in-page navigation together.

Full DNS-rebinding defence needs IP pinning through the browser's request path and is a larger change; document that ceiling explicitly rather than implying the gate is complete.

**Verification.** `[direct]` — read `shared/url.ts` in full and confirmed each bypass form against the actual regexes. Enforcement-point and redirect citations `[sweep]`.

**Risks & dependencies.** A `dns.lookup` on the request path adds latency and a failure mode (resolution timeout) that must fail closed. The `context.route()` handler intercepts every document request — verify it does not interfere with the engine's existing network telemetry hooks in `StabilityMonitor`.

---

<a id="h-07"></a>
## H-07 — Caddy CORS allow-list effectively wildcards `*.vercel.app` with credentials

**Severity:** High · **CWE-942** (Permissive Cross-domain Policy), **CWE-346** (Origin Validation Error)

**Description.** The allow-list's second alternative subsumes the first and matches any single-label `vercel.app` subdomain:

```
deploy/Caddyfile:14   @allowed_origin header_regexp origin Origin ^https://(bugsafari\.vercel\.app|[a-z0-9-]+\.vercel\.app)$
deploy/Caddyfile:26   Access-Control-Allow-Credentials "true"
deploy/Caddyfile:41-45 header @allowed_origin { Access-Control-Allow-Origin "{re.origin.0}" … }
```

The origin is echoed back with credentials enabled, on both the preflight and the proxied response.

**Root cause.** The intent was "allow our own Vercel preview deployments". Vercel preview URLs are not namespaced per account in a way a regex can distinguish, so the pattern admits the entire platform. The comment at `:10-14` correctly reasons about anchoring but not about who else can occupy the matched space.

**Impact on BugSafari.** Anyone can deploy a page to `*.vercel.app` and obtain a credentialed, response-readable origin against the production API. Today's impact is bounded because auth is a `Authorization: Bearer` header rather than a cookie, so the browser attaches nothing automatically — an attacker origin can read responses only from endpoints that need no auth. But the guest-reachable `POST /api/start-test` is exactly such an endpoint, so an attacker page can launch runs and read the response. The moment cookie-based auth is introduced, this becomes full account compromise.

**Affected files.** `deploy/Caddyfile:14,20-22,41-45`.

**Recommended fix.** Replace the second alternative with an explicit origin list supplied by an environment variable, so preview origins are opted in individually. Keep the anchoring and the `Vary: Origin` — both are correct.

**Verification.** `[direct]` — read `deploy/Caddyfile` in full.

**Risks & dependencies.** Tightening this breaks any preview deployment not on the new list; the list must be updatable without a code change. Depends on H-08 — the file is currently not even mounted, so the fix is untestable in prod until the path is corrected.

---

<a id="h-08"></a>
## H-08 — `docker-compose.prod.yml` mounts a Caddyfile path that does not exist in the repo

**Severity:** High · Deploy correctness

**Description.**

```yaml
docker-compose.prod.yml:62      - ./Caddyfile:/etc/caddy/Caddyfile
```

The file lives at `deploy/Caddyfile`; there is no `Caddyfile` at the repo root. The deploy workflow runs compose from the repo root:

```yaml
.github/workflows/deploy.yml   cd /var/www/bugsafari
                              docker compose -f docker-compose.prod.yml up -d --build
```

Docker creates an empty **directory** at a missing bind-mount source rather than failing.

**Root cause.** The Caddyfile was moved into `deploy/` without updating the compose reference, and Docker's silent directory-creation behaviour hides the mistake instead of surfacing it.

**Impact on BugSafari.** As committed, Caddy starts with no configuration: no TLS for `bugsafari.duckdns.org`, no reverse proxy to `127.0.0.1:3000`, and — because `testing-core` deliberately ships no CORS middleware (`index.ts:36-39`) and the Caddyfile is documented as "the ONLY emitter of Access-Control-* headers" — **zero CORS headers reach the browser**, breaking every dashboard→API request. The live droplet is reported to have a hand-placed root `Caddyfile`, which is why production works despite the repo being wrong.

**Affected files.** `docker-compose.prod.yml:62`, `deploy/Caddyfile`, `.github/workflows/deploy.yml`.

**Recommended fix.** Change the mount to `./deploy/Caddyfile`.

**Verification.** `[direct]` — confirmed `deploy/Caddyfile` exists, no root `Caddyfile` exists, and read the deploy workflow's working directory and compose invocation.

**Risks & dependencies.** **The droplet has its own hand-placed root `Caddyfile`.** Once this fix lands, the repo copy is mounted instead and the droplet copy is silently shadowed. Diff the two and reconcile them **before** the next deploy, or the next push to `dev` will replace a working live config with the repo's version — which still carries the H-07 wildcard and lacks the H-07/M-13 hardening.

---

<a id="h-09"></a>
## H-09 — Access-token TTL drift: prod template signs 7-day non-revocable tokens

**Severity:** High · **CWE-613** (Insufficient Session Expiration)

**Description.** Two independent TTL sources disagree:

```ts
authConfig.ts:69   const ACCESS_TOKEN_TTL = process.env.JWT_EXPIRES_IN ?? '30m';   // drives jwt.sign expiresIn
authConfig.ts:70   const ACCESS_TOKEN_TTL_MS = 30 * 60 * 1000;                    // hardcoded; reported to the client
```
```
.env.prod.example:30   JWT_EXPIRES_IN=7d
```

Production therefore signs 7-day access tokens while telling the client `expiresIn: 1800`.

**Root cause.** The env override predates the refresh-token system. When rotating refresh tokens were added (`refreshTokenService.ts:75-88`), the access-token TTL should have become a fixed short constant; instead a second, unrelated constant was introduced for the client-facing value and the two drifted.

**Impact on BugSafari.** Access tokens are stateless and **nothing in the codebase can revoke them** — `revokeAllForUser` (`refreshTokenService.ts:124`) touches only refresh tokens. A leaked token is valid for a week, and password change and password reset (`userSettingsController.ts:194`, `authPasswordResetController.ts:311`), which correctly revoke all refresh tokens, do not invalidate it. A compromised account stays compromised for seven days after the user changes their password.

**Affected files.** `testing-core/src/presentation/authentication/authConfig.ts:67-71`, `.env.prod.example:30`, `testing-core/src/presentation/authentication/refreshTokenService.ts:56`.

**Recommended fix.** Delete the `JWT_EXPIRES_IN` override and collapse to a single 30-minute constant, so the signed TTL and the reported TTL cannot diverge. Durability of a session already comes from the rotating refresh token, exactly as the comment at `:67-68` describes. Remove `JWT_EXPIRES_IN` from `.env.prod.example`.

**Verification.** `[direct]` — read `authConfig.ts` in full and `.env.prod.example:1-35`.

**Risks & dependencies.** Any deployment currently relying on 7-day access tokens will see users hit the refresh path far more often — confirm the single-flight refresh (`authRefresh.ts:40,51`) and the retry wrapper handle the increased rate before rollout.

---

<a id="h-10"></a>
## H-10 — Paused runs never expire

**Severity:** High · **CWE-772** (Missing Release of Resource)

**Description.** The timebox is gated on not being paused, and active-time accumulation stops while paused:

```ts
ExplorationEngine.ts:676   return this.elapsedActiveTimeMs >= timeboxMs && !this.isPaused;
ExplorationEngine.ts:721   (elapsedActiveTimeMs stops accumulating while paused)
ExplorationLoop.ts:473     while (this.deps.isPaused()) { … await new Promise((r) => setTimeout(r, 100)); }
```

The only other reaper is the socket-disconnect grace timer (`SessionManager.ts:533`), which never arms while the operator's tab stays open.

**Root cause.** "Timebox" was modelled as a budget of *active work* — a reasonable definition for measuring exploration effort — and then used as the *resource-release* mechanism, which needs wall-clock semantics. One concept doing two jobs.

**Impact on BugSafari.** An operator who pauses a run and walks away holds a Chromium process and a worker slot indefinitely. With `WORKER_REPLICAS=2`, two forgotten paused runs take the fleet offline permanently with no automatic recovery. Combines with H-04 to make denial of service trivial.

**Affected files.** `testing-core/src/domain/services/exploration/ExplorationEngine.ts:676,721`, `testing-core/src/domain/services/exploration/ExplorationLoop.ts:473`, `testing-core/src/application/services/SessionManager.ts:533`.

**Recommended fix.** Add an absolute wall-clock ceiling independent of pause state, separate from the active-time timebox. Keep the existing timebox semantics for exploration budgeting; the new ceiling is purely a resource-release backstop.

**Verification.** `[sweep]` — citations not independently re-read.

**Risks & dependencies.** The ceiling must be generous enough not to kill a legitimately long paused investigation. Emit a telemetry warning before it fires so the operator can resume or extend.

---

<a id="h-11"></a>
## H-11 — `page.evaluate` calls with no deadline park the loop forever

**Severity:** High · Engine liveness

**Description.** Two hot-path evaluates have no external deadline:

```ts
types.ts:300     await page.evaluate(([floor, cap, quiet]) => new Promise<void>((resolve) => { … setTimeout(finish, cap); … }), …);
domHasher.ts:126 signatures = await page.evaluate<{ structure: string; interactive: string }>(`(function () { … })()`);
```

In `settle`, the `cap` ceiling is an **in-page** timer. If the renderer's main thread is wedged, that timer never runs, `evaluate` never returns, and the loop is parked *before* the next timebox check at `ExplorationLoop.ts:231`. `settle()` is called at `ExplorationLoop.ts:438,538,584,1284,1434,1447`; `hashCompound` at `:292,737,1303` and inside `StateRestorer.verifyTraversal`'s poll loop.

The codebase already solved this elsewhere and documented why:

```ts
domParser.ts:146   // scanBounded — "page.evaluate has no default timeout, so without this a
                   //  renderer that never yields keeps the step … parked indefinitely."
```

**Root cause.** The `scanBounded` guard was applied to the DOM parser when the problem was first hit, but never generalised to the other two evaluate call sites.

**Impact on BugSafari.** A wedged renderer is **precisely the defect class this engine exists to find**. When it finds one, the engine hangs instead of reporting it. The run consumes a worker slot until an external timeout kills it, and the finding is lost. This is a correctness failure at the core of the product.

**Affected files.** `testing-core/src/domain/services/exploration/types.ts:300`, `testing-core/src/ml/domHasher.ts:126`, pattern source `testing-core/src/domain/services/exploration/domParser.ts:146`.

**Recommended fix.** Apply the existing `scanBounded` pattern to both call sites. Reuse, do not reimplement — a third copy of the timeout idiom is how M-04 happened.

**Verification.** `[sweep]` — citations not independently re-read. The `domParser.ts:146` precedent makes the reasoning credible and gives the fix a proven shape.

**Risks & dependencies.** A deadline on `hashCompound` means a hash can now fail where it previously blocked. Confirm the caller treats that as "unknown state" and not as M-20's "traversal failed", or this fix will amplify that bug.

---

<a id="h-12"></a>
## H-12 — Edge permanently stranded in `traversing`, shrinking the frontier

**Severity:** High · Engine correctness

**Description.** When the navigator's chosen selector is absent from the current parse, the code silently substitutes the top-ranked element:

```ts
ExplorationLoop.ts:1454   const foundTarget = ranked.find((el) => el.selector === decision.selector);
ExplorationLoop.ts:1455   const target = foundTarget ?? ranked[0];
```

`StateGraphNavigator.ts:230` has already set the edge for `decision.selector` to `'traversing'`. The engine then actuates `ranked[0]` and confirms or blocks **that** selector (`ExplorationLoop.ts:1674`). The original edge is never revisited.

**Root cause.** The fallback was written as a local resilience measure — "actuate something rather than nothing" — without reconciling the navigator state that the caller had already mutated. Edge status transitions are owned by `StateGraphNavigator` but mutated implicitly by the loop.

**Impact on BugSafari.** `scanUnvisited` considers only `status === 'unvisited'`, so the stranded edge is never retried, never blocked, and never counted. Every occurrence permanently shrinks the exploration frontier. Coverage percentages are silently overstated, and real defects behind those edges are never reached. Because the failure is invisible, it degrades every run's results with no signal.

**Affected files.** `testing-core/src/domain/services/exploration/ExplorationLoop.ts:1450-1462,1674`, `testing-core/src/domain/services/exploration/StateGraphNavigator.ts:230`.

**Recommended fix.** Release the original edge back to `'unvisited'` (or mark it explicitly unreachable) on the fallback path. Architecturally, edge status transitions should be the navigator's responsibility alone — the loop should report the outcome and let the navigator decide, rather than mutating status through two different paths.

**Verification.** `[direct]` — read `resolveExploreEdgeTarget` at `ExplorationLoop.ts:1450-1462` and confirmed the fallback performs no edge bookkeeping. `StateGraphNavigator.ts:230` and `:1674` citations `[sweep]`.

**Risks & dependencies.** Returning the edge to `unvisited` risks a retry loop if the selector is permanently gone. An explicit `unreachable` status, or a bounded retry count, is safer. Existing coverage in `StateGraphNavigator.*.test.ts` should be extended before changing status semantics.

---

# MEDIUM

<a id="m-01"></a>
## M-01 — JWT verification does not pin the algorithm

**Severity:** Medium · **CWE-347** (Improper Verification of Cryptographic Signature)

**Description.** `authConfig.ts:122` — `const decoded = jwt.verify(token, AUTH_CONFIG.JWT_SECRET) as Record<string, unknown>;` No `algorithms` option, no `issuer`, no `audience`.

**Root cause.** Defaults were accepted rather than stated.

**Impact.** Not exploitable as written — `jsonwebtoken@9` restricts a string key to HMAC and rejects `alg: none`. The risk is future: if the secret is ever replaced by a key object or a library major changes defaults, algorithm confusion becomes live. Hardening, not an active vulnerability.

**Affected files.** `testing-core/src/presentation/authentication/authConfig.ts:120-141`.

**Recommended fix.** `jwt.verify(token, SECRET, { algorithms: ['HS256'] })`. Consider adding `issuer`/`audience` if the token is ever consumed by more than one service.

**Verification.** `[direct]` — read `authConfig.ts` in full. Claim shape *is* validated (`:125`) and expiry *is* enforced by `jwt.verify`; both are correct.

**Risks.** None — one-line, no behaviour change for correctly-signed tokens.

---

<a id="m-02"></a>
## M-02 — Dev fallback secret is active whenever `NODE_ENV !== 'production'`

**Severity:** Medium · **CWE-1188** (Insecure Default Initialization)

**Description.**
```ts
authConfig.ts:13   const isDevelopment = process.env.NODE_ENV === 'development' || !isProduction;
authConfig.ts:17   const DEV_FALLBACK_SECRET = 'bugsafari-local-development-secret';
authConfig.ts:34   JWT_SECRET = DEV_FALLBACK_SECRET;
```

**Root cause.** The environment predicate is negative (`!isProduction`) rather than an explicit allow-list of non-production environments.

**Impact.** Any deployment that forgets `NODE_ENV=production` silently mints tokens signed with a public, committed constant — full authentication bypass for anyone reading the repo. The production guards themselves are thorough (hard-throw on absence at `:26`, on exact-match reuse at `:45`, on `<32` chars at `:53`), so the entire protection rests on one env var being set.

**Affected files.** `testing-core/src/presentation/authentication/authConfig.ts:11-39`; consistent dev value at `docker-compose.local.yml:59` (intentional).

**Recommended fix.** Require `NODE_ENV` to be explicitly one of a known set and fail closed on anything unrecognised, rather than treating "not production" as "development". Log the resolved mode loudly at boot.

**Verification.** `[direct]` — read `authConfig.ts` in full.

**Risks.** Failing closed on an unset `NODE_ENV` will break local runs that currently rely on the implicit default — needs a documented local setup step.

---

<a id="m-03"></a>
## M-03 — Unbounded engine collections grow for the whole run

**Severity:** Medium · **CWE-401/CWE-770** (Memory Leak / Allocation Without Limits)

**Description.** Four collections grow monotonically with no eviction:

| Location | Collection | Note |
|---|---|---|
| `pathfinder/GraphStore.ts:17,20,25` | `seenHashes`, `evictedHashes`, `selectorDestinations` | `nodes` **is** LRU-capped at `:127`; these three were missed |
| `telemetry/StabilityMonitor.ts:235` | `reportedNetworkFaults` | written at `:1164`, never cleared |
| `verification/ReproductionProbe.ts:90` | `seen` | `dispose()` at `:136` clears `queue` but not this |
| `exploration/StateClusterRegistry.ts:149,176` | `urls`, `triggered` | `discovered` **is** capped at `:154,174` |

**Root cause.** Caps were added to the collection that was observed growing (`nodes`, `discovered`) rather than to the class of collections with the same lifetime.

**Impact.** Every fuzz payload mints a fresh state hash, so `seenHashes` grows roughly once per keystroke-level action. On long runs against form-heavy targets this is the dominant memory consumer. With `WORKER_REPLICAS` budgeted at ~1.5 GB each (`.env.prod.example:22`), a long run can approach the container limit. `StateClusterRegistry.triggered` has a correctness consequence as well — see M-24.

**Affected files.** As tabulated.

**Recommended fix.** Apply the LRU/cap policy already present in `GraphStore.ts:127` and `StateClusterRegistry.ts:154` to the remaining collections. One shared bounded-set helper is preferable to five separate caps.

**Verification.** `[direct]` for `StateClusterRegistry.ts:145-184` (confirmed `urls` and `triggered` take no cap while `discovered` does); `[sweep]` for the others.

**Risks.** Evicting `seenHashes` entries can cause the engine to re-explore a state it has already seen. Size the cap from observed run profiles, and prefer an LRU over a hard truncate.

---

<a id="m-04"></a>
## M-04 — Timeout timers never cleared

**Severity:** Medium · **CWE-401** (Memory Leak)

**Description.** The `Promise.race` timeout idiom appears three times; two copies never clear the loser's timer:

```ts
TelemetryEmitter.ts:114               new Promise<never>((_, reject) => setTimeout(() => reject(…), SCREENSHOT_TIMEOUT_MS))
monitoring/stabilityMonitor.ts:176    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)),
ReproductionProbe.ts:216              withTimeout(…)   ← the correct, reusable version
```

**Root cause.** The idiom was reimplemented per call site instead of extracted once. Two of the three copies omit the `clearTimeout`.

**Impact.** `TelemetryEmitter` runs on a 33 ms loop (`:86`) with a 5 s timeout, so roughly 150 orphaned timers with retained closures are live at any moment for the entire run — each pinning a screenshot-capture closure and its captured scope. The heartbeat copy adds one 5 s timer per 2 s tick. Steady-state overhead rather than unbounded growth, but it is pure waste on the hottest path in the system.

**Affected files.** `testing-core/src/domain/services/telemetry/TelemetryEmitter.ts:114`, `testing-core/src/infrastructure/monitoring/stabilityMonitor.ts:176`, `testing-core/src/domain/services/verification/ReproductionProbe.ts:216`.

**Recommended fix.** Promote `withTimeout` to a shared utility with `finally { clearTimeout(…) }` and route all three call sites through it. Deletes two implementations rather than adding a third.

**Verification.** `[sweep]`.

**Risks.** None material — behaviour is unchanged, only the timer is released.

---

<a id="m-05"></a>
## M-05 — `AsyncTaskTracker.settle()` can loop forever

**Severity:** Medium · **CWE-835** (Infinite Loop)

**Description.**
```ts
AsyncTaskTracker.ts:17   while (this.pending.size > 0) { await Promise.allSettled([...this.pending]); }
```
The forensic flush chain enqueues a tracked task from within a tracked task (`ExplorationEngine.ts:1583-1584`), which is exactly the shape that never terminates.

**Root cause.** `settle()` assumes the pending set is a closed generation. Nothing prevents a task from adding to the set it is being awaited in.

**Impact.** A run that cannot finish holds its worker slot and its Chromium until an external timeout intervenes. Whether it fires in practice depends on the flush chain's terminating condition; the structural hazard is unambiguous.

**Affected files.** `testing-core/src/domain/services/exploration/AsyncTaskTracker.ts:10-25`, `testing-core/src/domain/services/exploration/ExplorationEngine.ts:1583-1584`.

**Recommended fix.** Bound `settle()` with a deadline and a max-generation count; log loudly when either is hit so a genuine re-entrant chain is diagnosable rather than silently truncated.

**Verification.** `[sweep]`. `AsyncTaskTracker.test.ts` exists and should be checked for whether it covers the re-entrant case.

**Risks.** A deadline may cut off forensic writes mid-flush, producing incomplete telemetry. Make the bound generous and observable.

---

<a id="m-06"></a>
## M-06 — Stop is slow: not observed mid-step, and blocks on an unbounded settle

**Severity:** Medium · Responsiveness

**Description.** Two separate causes.

*Stop is only checked at the top of an iteration:*
```ts
ExplorationLoop.ts:223   if (this.deps.isStopRequested()) { return this.stopResult(); }
```
Nothing inside a step checks it — `revealLazyContent` (8 scroll+settle rounds), `scrollToRevealNewControls` (6 rounds), `bugFinderRunner.sweep`, `stateRestorer.replayPath`, `armed.disarm()` plus its settle wait. Cancellation relies on the browser being closed under the in-flight action.

*Teardown then blocks on an unbounded drain:*
```ts
PlaywrightBrowserEngine.ts:117   await this.activeEngine.settlePendingTasks();
```
→ `ExplorationEngine.ts:646` → `ReproductionProbe.ts:132 await this.draining`, draining up to `MAX_QUEUED = 12` (`:26`) replays each bounded by `PROBE_TIMEOUT_MS = 45_000` (`:28`) — worst case ~9 minutes.

**Root cause.** Cooperative cancellation was implemented at the loop boundary only; no cancellation token is threaded into the long-running sub-operations. Teardown treats "finish all pending work" as unconditional.

**Impact.** An operator pressing Stop sees the UI hang for seconds to minutes. Worse, the worker slot is held for that whole time, so a stopped run does not free capacity promptly.

**Affected files.** `testing-core/src/domain/services/exploration/ExplorationLoop.ts:223` and its inner loops, `testing-core/src/infrastructure/playwright/PlaywrightBrowserEngine.ts:117`, `testing-core/src/domain/services/exploration/ExplorationEngine.ts:646`, `testing-core/src/domain/services/verification/ReproductionProbe.ts:26,28,132`.

**Recommended fix.** Thread an `AbortSignal` through the long inner loops rather than adding scattered `isStopRequested()` checks, and bound `settlePendingTasks()` with a deadline after which pending replays are abandoned.

**Verification.** `[sweep]`.

**Risks.** Abandoning pending reproduction replays on stop loses verification results for findings already discovered. Persist findings before draining so a bounded stop does not discard them.

---

<a id="m-07"></a>
## M-07 — `stop()` races `run()`'s finally and discards the confirmed-bug snapshot

**Severity:** Medium · **CWE-362** (Race Condition)

**Description.**
```ts
PlaywrightBrowserEngine.ts:120   this.activeEngine = null;                                              // in stop()
PlaywrightBrowserEngine.ts:391   this.capturedConfirmedBugs = this.activeEngine?.getConfirmedBugsFromMemory() ?? [];  // in run()'s finally
```

**Root cause.** `activeEngine` is used both as a liveness flag and as a data handle. Clearing the flag destroys the handle.

**Impact.** A stop that races the natural end of a run silently discards every confirmed bug found in that run — the optional chain resolves to `[]` with no error. The user sees a completed run with zero findings.

**Affected files.** `testing-core/src/infrastructure/playwright/PlaywrightBrowserEngine.ts:110-125,385-395`.

**Recommended fix.** Snapshot the confirmed bugs before nulling, or separate the liveness flag from the data handle so clearing one does not destroy the other.

**Verification.** `[sweep]`.

**Risks.** Narrow window, hard to reproduce deterministically — needs a targeted test that forces the interleaving rather than relying on an end-to-end run.

---

<a id="m-08"></a>
## M-08 — Reproduction sidecar context closed while its replay is still running

**Severity:** Medium · **CWE-362** (Race Condition)

**Description.**
```ts
ReproductionProbe.ts:211   } finally { await context?.close().catch(() => undefined); }
ReproductionProbe.ts:216   withTimeout(…)   // resolves null at 45s but does NOT cancel runReplaySession
```

**Root cause.** `withTimeout` implements a timeout as "stop waiting", not "stop working". The abandoned operation keeps running against resources the caller then tears down.

**Impact.** After a probe timeout, an orphaned replay keeps driving pages inside a context being closed, producing spurious errors and unpredictable teardown. The `.catch(() => undefined)` on the close hides the resulting failures.

**Affected files.** `testing-core/src/domain/services/verification/ReproductionProbe.ts:200-220`.

**Recommended fix.** Give `runReplaySession` an `AbortSignal` the timeout can trigger, and await its acknowledgement before closing the context. Same underlying need as M-06.

**Verification.** `[sweep]`.

**Risks.** None beyond the work of threading cancellation into the replay path.

---

<a id="m-09"></a>
## M-09 — Fire-and-forget async in the engine hot path with no rejection handling

**Severity:** Medium · **CWE-391** (Unchecked Error Condition)

**Description.** Seven `void`-ed async calls with no `.catch()`:

```ts
ExplorationEngine.ts:1044   void reportNavigationDefects(navigationFinder.observeUrlChange({ url, timestampMs: Date.now() }));
ExplorationEngine.ts:1049   void handleSessionLoss(from, url);
ExplorationEngine.ts:1102   void reportNavigationDefects(navigationFinder.observeRedirectHop({ … }));
StabilityMonitor.ts:599,608,619,657   void this.reportRuntimeFault(page, 'EXCEPTION', …);
```

`reportRuntimeFault` (`StabilityMonitor.ts:443`) is ~120 lines of unguarded awaits and sinks with no internal try/catch. All are fired from Playwright `framenavigated`/`response` listeners, where a throw becomes an unhandled rejection.

**Root cause.** Event-listener callbacks cannot be awaited, so `void` was used to satisfy the linter — without the `.catch()` that makes `void` safe.

**Impact.** Combined with H-01, any throw here takes down the entire API process. With H-01 fixed, these still fail silently — the exact fault reports the engine exists to produce vanish with no trace.

**Affected files.** `testing-core/src/domain/services/exploration/ExplorationEngine.ts:1044,1049,1102`, `testing-core/src/domain/services/telemetry/StabilityMonitor.ts:443,599,608,619,657`.

**Recommended fix.** Guard at the root — wrap the bodies of `reportRuntimeFault` and `reportNavigationDefects` in try/catch with a structured log — rather than adding seven call-site `.catch()`es. One guard in the shared function is the smaller diff and cannot be forgotten at a future eighth call site.

**Verification.** `[sweep]`.

**Risks.** None. Depends on H-01 for the process-level backstop.

---

<a id="m-10"></a>
## M-10 — Rate limiter keys on an unbounded attacker-controlled string, and is per-process

**Severity:** Medium · **CWE-770** (Allocation Without Limits)

**Description.**
```ts
rateLimiter.ts:31   (the `buckets` map)
rateLimiter.ts:81   keyOn: (request) => (typeof request.body?.email === 'string' ? request.body.email.toLowerCase() : undefined),
```
Bucket keys embed an arbitrary-length attacker-supplied email. The map grows one entry per distinct email/IP pair until the 60 s sweep at `:33`. The module's own comment at `:5-6` notes the second problem: *"budgets are therefore per API process. Running multiple API replicas multiplies the effective limit."*

**Root cause.** An in-process limiter was the pragmatic choice for a single-replica deployment; the key was chosen for readability in logs rather than for bounded width.

**Impact.** A flood of unique long emails inflates memory for up to 60 s before the sweep. Separately, the limiter's guarantee weakens linearly with replica count — the login and password-reset budgets it protects are the ones that matter most.

**Affected files.** `testing-core/src/presentation/middleware/rateLimiter.ts:29-33,77-138`.

**Recommended fix.** Hash the email to a fixed-width key and cap the map size so the sweep is not the only bound. For multi-replica correctness, move the counter into Redis — `ioredis` is already a dependency and a connection already exists in queue mode, so this adds no new dependency.

**Verification.** `[sweep]`.

**Risks.** A Redis-backed limiter adds a failure mode: decide explicitly whether a Redis outage fails open (availability) or closed (security). Given these routes protect authentication, failing closed with a clear error is the safer default.

---

<a id="m-11"></a>
## M-11 — Gemini prompts built from unbounded target-site content; AI routes unthrottled

**Severity:** Medium · **CWE-770** (Allocation Without Limits), prompt-injection surface

**Description.** Prompt construction interpolates target-derived fields with no length or count cap:

```ts
GeminiRemediationAdvisor.ts:100   req.stackTrace && `Stack trace:\n${req.stackTrace}`,
GeminiRemediationAdvisor.ts:101   req.reproductionSteps?.length && `Reproduction:\n${req.reproductionSteps.join('\n')}`,
GeminiRemediationAdvisor.ts:127-129   (req.findings ?? []).map(…).join('\n')
```

And the route calls the model before any ownership check:
```ts
registerRoutes.ts:1106   const call = await generateRemediation(body);      // ownership enforced only on the persist at :1117
```

**Root cause.** The advisor was built for the well-formed case. `SuggestFixRequest` is a client-supplied body, so every field is untrusted — but it is treated as already-validated engine output.

**Impact.** Cost and availability: any authenticated user can burn Gemini quota with arbitrary payloads, and a 5000-finding session builds a prompt large enough to be rejected or billed heavily. Content: stack traces and error messages originate from the *tested site*, so a malicious target can inject instructions into the prompt. The output is advisory text rendered as escaped JSX (see M-15/Verified-clean), so the injection ceiling is misleading advice rather than code execution — real but bounded.

**Affected files.** `testing-core/src/infrastructure/ai/GeminiRemediationAdvisor.ts:92-139`, `testing-core/src/presentation/api/registerRoutes.ts:1102-1131`.

**Recommended fix.** Truncate each interpolated field and cap the findings count in `buildFixPrompt`/`buildInsightsPrompt`. Apply the existing `rateLimiter` to both AI routes. Delimit target-derived content in the prompt so the model treats it as data.

**Verification.** `[direct]` — read `GeminiRemediationAdvisor.ts` in full (including the uncommitted working-tree changes). Route citations `[sweep]`.

**Risks.** Truncating a stack trace can remove the frame that made the advice useful — truncate from the middle, keeping head and tail. Note this file has **uncommitted changes in the working tree**; coordinate before editing.

**Positive note.** The rest of this file is well built: the API key travels in a header not a query string (`:55`), is redacted from all log output (`:37-39,68,83`), and every failure path resolves to a classified reason rather than a bare null.

---

<a id="m-12"></a>
## M-12 — Raw internal error message returned to the client

**Severity:** Medium · **CWE-209** (Information Exposure Through an Error Message)

**Description.** `registerRoutes.ts:363` — ``response.status(500).json({ ok: false, error: `Failed to stop the session: ${errorMessage}` });``

**Root cause.** Written before the sanitized terminal handler existed, and not migrated to it.

**Impact.** Leaks internal error text — potentially Mongo/Redis connection details or file paths — to any caller. `/api/safari/stop` uses `optionalAuth`, so this is guest-reachable. The terminal handler does this correctly (`errorHandler.ts:45,67`: generic message plus an `errorId`, stack to the log only), so this is one route diverging from an established, tested pattern.

**Affected files.** `testing-core/src/presentation/api/registerRoutes.ts:363`; correct pattern at `testing-core/src/presentation/middleware/errorHandler.ts:40-70`.

**Recommended fix.** `next(err)` and let the terminal handler own the response, matching every other route.

**Verification.** `[sweep]`. `errorHandler.ts` line count and the existence of `security.test.ts:105-118` covering it were confirmed `[direct]`.

**Risks.** None.

---

<a id="m-13"></a>
## M-13 — No security headers; `X-Powered-By` not disabled

**Severity:** Medium · **CWE-693** (Protection Mechanism Failure), **CWE-200** (Information Exposure)

**Description.** `testing-core/package.json` has no `helmet`. Express's default `X-Powered-By: Express` is not disabled (`index.ts:32` creates the app and goes straight to `trust proxy`). Caddy — the designated header emitter — sets no `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, or `X-Frame-Options` either (`deploy/Caddyfile`, read in full). `vercel.json` sets none for the dashboard.

**Root cause.** Header responsibility was assigned to Caddy (a sound decision, documented at `index.ts:36-39`) but only CORS headers were ever implemented there.

**Impact.** Version disclosure aids targeted attacks. No HSTS means a downgrade window. No `X-Content-Type-Options` allows MIME sniffing on API responses. Low individual severity; collectively the baseline hardening layer is absent.

**Affected files.** `testing-core/src/index.ts:32`, `deploy/Caddyfile`, `vercel.json`.

**Recommended fix.** `app.disable('x-powered-by')` in `index.ts`, and add the four headers to the Caddyfile — keeping Caddy as the single emitter, and adding no npm dependency (consistent with the project's "no external libraries unless absolutely necessary" rule). Add a CSP to `vercel.json` for the dashboard.

**Verification.** `[direct]` — read `index.ts` and `deploy/Caddyfile` in full; confirmed no `helmet` in `testing-core/package.json`. `vercel.json` citation `[sweep]`.

**Risks.** A CSP on the dashboard needs testing against the WebGL component (`designs/GradientBlinds.tsx`) and inline styles. Depends on H-08 — Caddyfile changes have no effect until the mount path is fixed.

---

<a id="m-14"></a>
## M-14 — Worker container has no healthcheck

**Severity:** Medium · Reliability

**Description.** `Dockerfile` defines no `HEALTHCHECK`. `docker-compose.prod.yml:40-44` adds one for the `api` service only; the `worker` service (`:74-92`) has none despite `restart: unless-stopped`.

**Root cause.** The healthcheck was added at the compose layer for the service with an HTTP endpoint; the worker, having none, was skipped rather than given a different probe.

**Impact.** `restart: unless-stopped` only restarts a worker that *exits*. A worker wedged by M-05, H-11, or H-10 stays "running" forever and is never recycled. With `WORKER_REPLICAS=2`, one wedged worker halves capacity indefinitely with no alert.

**Affected files.** `Dockerfile`, `docker-compose.prod.yml:74-92`.

**Recommended fix.** Add a liveness probe the worker can answer — a heartbeat key in Redis (already connected) checked by a small script, or a minimal HTTP liveness port. Combine with a job-level stall timeout in BullMQ.

**Verification.** `[direct]` — read the full `Dockerfile`; compose service-range citations `[sweep]`.

**Risks.** A naive probe that only checks process liveness will not catch the wedge cases that motivate this. The probe must assert forward progress, not existence.

---

<a id="m-15"></a>
## M-15 — Run-ownership token logged to the production browser console

**Severity:** Medium · **CWE-532** (Insertion of Sensitive Information into Log File)

**Description.** ``EngineHttpClient.ts:108   console.log(`[Gateway] Safari launch ${…} (runId=${runId ?? 'n/a'}…)`)``

`runId` **is** the possession-proof credential: `SocketConnectionManager.ts:117` presents it as `runToken`, and `EngineHttpClient.ts:182` comments *"The run token proves ownership server-side — required for guest runs"*. A DEV-gated `logger` already exists at `utils/logger.ts:8-9` but is bypassed here and at `:55-58,85-90,113-118,196` — which additionally leak target URLs and the API base.

**Root cause.** Debug logging added with raw `console.log` instead of the project's own gated logger.

**Impact.** For a guest run the token is the *only* ownership proof (`runOwnership.ts:23-25`), so anyone who reads it — via a browser extension, a screen share, or a support screenshot — can attach to and control that run. Shipping it to end-user consoles in production is unnecessary exposure. The JWT itself is not logged.

**Affected files.** `developer-dashboard/src/infrastructure/engine/gateway/EngineHttpClient.ts:55-58,85-90,104-118,196`; correct utility at `developer-dashboard/src/utils/logger.ts:8-9`.

**Recommended fix.** Route every bare `console.log` in this file through the existing DEV-gated `logger`, and omit the token from the message entirely.

**Verification.** `[sweep]`. The relative-import and `normalizeRunCode` facts in the same file were confirmed `[direct]` under C-03.

**Risks.** None. Touch alongside C-03, which edits the same file.

---

<a id="m-16"></a>
## M-16 — Every dashboard history failure is reported as "backend hot-reloading"

**Severity:** Medium · **CWE-390** (Detection of Error Condition Without Action)

**Description.**
```ts
EngineHttpClient.ts:150-153   catch (error) { console.log("[Gateway] Backend is hot-reloading. Suppressing transient ERR_EMPTY_RESPONSE."); return []; }
```
`error` is bound and never inspected. Auth failures, malformed JSON, real network outages, and the explicit `throw` at `:146` all produce the same fixed string and an empty array.

**Root cause.** A dev-ergonomics workaround for Vite hot-reload noise was written as a catch-all and never narrowed.

**Impact.** A user whose history failed to load sees an empty history — indistinguishable from having none. Data-loss-shaped from the user's perspective, and it makes production failures undiagnosable because the log line is a fixed lie.

**Affected files.** `developer-dashboard/src/infrastructure/engine/gateway/EngineHttpClient.ts:140-155`.

**Recommended fix.** Narrow the catch to the genuinely transient network case; rethrow everything else so the caller can render a real error state. Distinguish "no history" from "history unavailable" in the UI.

**Verification.** `[sweep]`.

**Risks.** Surfacing previously-hidden errors will make existing failures visible — that is the point, but expect noise on first deploy.

---

<a id="m-17"></a>
## M-17 — `/settings` reachable by guests; `AuthGuard` is dead code claiming to protect routes

**Severity:** Medium · **CWE-1220** (Insufficient Granularity of Access Control)

**Description.** `App.tsx:5` comments *"AuthGuard handles route protection automatically"*, but `components/auth/AuthGuard.tsx` is never rendered — only its own definition and a barrel re-export (`components/auth/index.ts:6`) exist. Gating is actually inline at `App.tsx:255-257`. `/history` (`:165`) and `/history/forensic-report/:sessionId` (`:181`) have `!isAuthenticated` redirects; `/settings` (`:171-178`) does not, so a guest reaches it and `settingsStore.ts:204` falls back to guest-mode localStorage.

**Root cause.** A guard component was written, superseded by inline checks, and left in place with a comment still asserting it is active.

**Impact.** Client-side only — the backend does enforce (`userSettingsController.ts:352-361` uses `requireAuth`, and `fetchWithAuthRetry` handles the 401). The real harm is the false impression of systematic coverage: the next route added will be assumed protected and will not be.

**Affected files.** `developer-dashboard/src/App.tsx:5,165,171-178,181,255-257`, `developer-dashboard/src/components/auth/AuthGuard.tsx`, `developer-dashboard/src/stores/settingsStore.ts:204`.

**Recommended fix.** Add the missing redirect. Then either adopt `AuthGuard` consistently for every protected route or delete it and correct the comment — the current state is the worst of both.

**Verification.** `[sweep]`.

**Risks.** None. See L-02 for the deletion option.

---

<a id="m-18"></a>
## M-18 — Two competing target-URL validators; the one on the save path is weaker

**Severity:** Medium · Architecture / **CWE-1023** (Incomplete Comparison)

**Description.** `sanitizeTargetUrl` (`registerRoutes.ts:184-205`) is a second, independent validator used on the history paths (`:677`), while `parseTargetUrl` + `resolveEngineTargetUrl` guard `/api/start-test` (`:373,383`). It performs **no private-host check**, and its NoSQL-injection test is theatre:

```ts
registerRoutes.ts:195   if (trimmed.includes('$') && trimmed.match(/\$\w+/)) {    // value is already typeof === 'string'
registerRoutes.ts:200   if (!trimmed.match(/^https?:\/\/.+/)) {                  // no private-host check
```

**Root cause.** Two validators evolved for two call sites; the security-relevant improvements landed in only one.

**Impact.** No direct exploit today — the weak validator guards a save path, not a navigation path. The architectural risk is real: two functions named as if interchangeable, with different guarantees, invite the wrong one to be used at a navigation site. C-02 is that mistake in its purest form.

**Affected files.** `testing-core/src/presentation/api/registerRoutes.ts:184-205,373,383,677`, `shared/url.ts:39-65`.

**Recommended fix.** Delete `sanitizeTargetUrl` and point its callers at `normalizeTargetUrl`. One concept, one implementation. Prerequisite for C-02 and H-06 being genuinely closed.

**Verification.** `[direct]` — read `sanitizeTargetUrl` at `registerRoutes.ts:184-205` and `shared/url.ts` in full.

**Risks.** `normalizeTargetUrl` is stricter (rejects non-web schemes up front). Confirm no stored history record has a URL that passes the old validator and fails the new one, or migration will orphan rows.

---

<a id="m-19"></a>
## M-19 — `findings[]` has no element cap on save while its siblings do

**Severity:** Medium · **CWE-770** (Allocation Without Limits)

**Description.**
```ts
registerRoutes.ts:694   const clientFindings = (Array.isArray(rawFindings) ? rawFindings : [])    // no cap
registerRoutes.ts:731   … .slice(0, 2000)     // network — capped
registerRoutes.ts:732   … .slice(0, 1000)     // console — capped
```

**Root cause.** Caps were added when the network/console arrays caused a problem; the sibling array was missed.

**Impact.** Bounded only by the 2 MB body limit (`index.ts:41`) — which was itself raised from the 100 kb default specifically because findings arrays were hitting 413. Each save can therefore write a large unbounded document, and the same content is later fed to Gemini (M-11) and rendered in the dashboard.

**Affected files.** `testing-core/src/presentation/api/registerRoutes.ts:694,731-732`, `testing-core/src/index.ts:41`.

**Recommended fix.** Apply the same `.slice()` cap as the sibling arrays, sized from observed real runs.

**Verification.** `[sweep]`. `index.ts:41` and its explanatory comment confirmed `[direct]`.

**Risks.** Truncating findings loses data the user expects to keep. Cap high, and tell the user when truncation occurs rather than dropping silently.

---

<a id="m-20"></a>
## M-20 — Hashing failure misreported as traversal failure, permanently penalising a control

**Severity:** Medium · Engine correctness

**Description.** `StateRestorer.verifyTraversal` catches hashing errors and retries until its 3 s deadline (`ExplorationLoop.ts:1602` passes `3000`); if hashing fails for the whole window it reports `ok: false`, and `ExplorationLoop.ts:1729` converts that into a permanent scoring penalty on the control.

**Root cause.** A single boolean conflates two distinct outcomes — "the traversal did not happen" and "I could not determine whether it happened".

**Impact.** A transient hashing failure — mid-navigation, or a slow renderer — permanently penalises an innocent control in the perceptron's weights, so the engine learns to avoid a working element. Compounds with H-11: adding a deadline to `hashCompound` makes hash failures *more* frequent, which would amplify this bug if fixed in the wrong order.

**Affected files.** `testing-core/src/domain/services/exploration/StateRestorer.ts` (`verifyTraversal`), `testing-core/src/domain/services/exploration/ExplorationLoop.ts:1602,1729`.

**Recommended fix.** Return a three-state result (`ok` / `failed` / `indeterminate`) and apply the scoring penalty only on `failed`.

**Verification.** `[sweep]`.

**Risks.** **Ordering dependency: fix this before H-11**, or the new hash deadline will increase indeterminate results while they are still being penalised.

---

<a id="m-21"></a>
## M-21 — `element-selected` telemetry fires before the decision resolves

**Severity:** Medium · Telemetry accuracy

**Description.**
```ts
ExplorationLoop.ts:327   let target: InteractiveElement = ranked[0];
ExplorationLoop.ts:335   telemetry.emit('ACTION', { actionExecuted: 'element-selected', selector: target.selector, … });
ExplorationLoop.ts:344   if (decision.kind === 'backtrack') { await this.handleBacktrackDecision(page, decision); continue; }
```

**Root cause.** The emit was placed with the provisional assignment rather than with the resolved decision.

**Impact.** On every backtrack step the dashboard and the forensic log record a "Selected target" that was never actuated. This corrupts the forensic action trace — the artifact the product's replay and reproduction features depend on — and misleads an operator watching live.

**Affected files.** `testing-core/src/domain/services/exploration/ExplorationLoop.ts:327-344`.

**Recommended fix.** Move the emit after the decision resolves, and emit a distinct event for backtrack so the trace reflects what actually happened.

**Verification.** `[sweep]`.

**Risks.** Downstream consumers may count `element-selected` events as a step metric; check `ClinicalForensicsDashboard` and the reporting path before changing event semantics.

---

<a id="m-22"></a>
## M-22 — Replay buffer truncates the causal head and interleaves tabs

**Severity:** Medium · Replay fidelity

**Description.**
```ts
reproductionPlaybookStore.ts:12   private static readonly capacity = 60;
reproductionPlaybookStore.ts:44   while (ReproductionPlaybookStore.actions.length > capacity) { … shift(); }
```

The store is process-static, and secondary-tab sub-sessions share `actionExecutor`/`recordActionTrace` with the primary (see M-27), so popup actions are pushed into the same linear buffer with no tab marker.

**Root cause.** A fixed-size FIFO was chosen for memory safety without modelling which end carries the causal information. Multi-tab support was added later without extending the buffer's schema.

**Impact.** A finding needing more than 60 steps loses its head — including the opening `NAVIGATE` — so `ReproductionProbe` replays a prefix-less sequence that cannot reach the original state. Multi-tab runs desync on replay because a single-context replay cannot reproduce interleaved cross-tab actions. Both mean "reproduction failed" verdicts on genuinely reproducible bugs, undermining the forensic feature.

**Affected files.** `testing-core/src/infrastructure/monitoring/reproductionPlaybookStore.ts:11-17,44`, `testing-core/src/domain/services/verification/ReproductionProbe.ts`.

**Recommended fix.** Always retain the opening navigation and any state-establishing prefix regardless of capacity, and tag each action with its tab id so replay can either reconstruct or explicitly refuse. Raise the cap if profiling allows.

**Verification.** `[sweep]`.

**Risks.** Changing the buffer schema affects any persisted playbook format — check whether stored playbooks need migration.

---

<a id="m-23"></a>
## M-23 — Forensic child collections have no tenant column

**Severity:** Medium · **CWE-639** (Authorization Bypass Through User-Controlled Key)

**Description.** Every forensic child repository keys on run id alone:

```ts
ForensicErrorRepository.ts:97       forensicRunId: new Types.ObjectId(forensicRunId),
NetworkLogRepository.ts:18          return NetworkLogModel.find({ forensicRunId: new Types.ObjectId(forensicRunId) })
ConsoleLogRepository.ts:18          (same shape)
ForensicTelemetryRepository.ts:44   return ForensicTelemetryModel.findOne({ forensicRunId: objectId })
ForensicAnalysisRepository.ts:48    return ForensicAnalysisModel.findOne({ forensicRunId: new Types.ObjectId(forensicRunId) })
```

`deleteSessionCascade` (`retentionReaper.ts:76`) likewise performs no authorization, documenting at `:73-75` that the caller must.

**Root cause.** Tenant scoping was enforced at the route layer (resolve an owner-scoped `SessionModel` first, then use its id — `registerRoutes.ts:1187,1201`) rather than in the data layer. That works, but it is a convention every future caller must know.

**Impact.** No exploit today — every current caller resolves an owner-scoped session first, and the route-layer scoping was verified at `:821,871,922,968,1001,1059,1117,1155,1187`. The risk is structural: one future caller passing a client-supplied id straight through becomes an immediate cross-tenant read of another user's console logs, network traces, and error details.

**Affected files.** `testing-core/src/infrastructure/database/repositories/ForensicErrorRepository.ts:97`, `NetworkLogRepository.ts:18`, `ConsoleLogRepository.ts:18`, `ForensicTelemetryRepository.ts:44`, `ForensicAnalysisRepository.ts:48`, `testing-core/src/infrastructure/database/retentionReaper.ts:73-76`.

**Recommended fix.** Denormalise `userId` onto the child documents and require it in every query, so isolation is enforced by the data layer rather than by caller discipline. Defence in depth — the route-layer check stays.

**Verification.** `[sweep]`.

**Risks.** Requires a schema change and a backfill migration for existing documents, plus index updates (`indexSync.ts` / `db:sync-indexes` already exist for this). Non-trivial — schedule deliberately.

---

<a id="m-24"></a>
## M-24 — Cluster can saturate prematurely once a shell exceeds 2000 selectors

**Severity:** Medium · Engine correctness

**Description.**
```ts
StateClusterRegistry.ts:55    const MAX_SELECTORS_PER_CLUSTER = 2000;
StateClusterRegistry.ts:154   if (cluster.discovered.size >= MAX_SELECTORS_PER_CLUSTER) break;      // discovered capped
StateClusterRegistry.ts:174   if (cluster.discovered.size < MAX_SELECTORS_PER_CLUSTER) cluster.discovered.add(selector);
StateClusterRegistry.ts:176   cluster.triggered.add(selector);                                       // triggered NOT capped
StateClusterRegistry.ts:102   if (cluster.discovered.size > 0 && cluster.triggered.size >= cluster.discovered.size) return true;
```

Once `discovered` saturates at 2000, newly-triggered selectors are added to `triggered` but not to `discovered`. `triggered` can then reach and exceed `discovered.size`, firing the saturation condition while many controls on the shell remain untriggered.

**Root cause.** A memory cap was applied to one of two sets that a correctness invariant compares. Capping one side of `triggered.size >= discovered.size` silently changed what the comparison means.

**Impact.** The shell is declared **Fully Explored** and is never re-parsed, re-tested, or counted toward the frontier again. Every defect behind the untriggered controls is missed, and coverage is overstated. **Precondition:** a single structural shell must present more than 2000 distinct selectors — uncommon, so this is Medium rather than High, but it is exactly the kind of dense enterprise page BugSafari is aimed at.

**Affected files.** `testing-core/src/domain/services/exploration/StateClusterRegistry.ts:55,98-111,145-184`.

**Recommended fix.** Make the saturation invariant independent of the memory cap — track a separate `totalDiscoveredCount` that keeps incrementing past the cap, and compare against that. Or cap both sets identically so the comparison stays meaningful.

**Verification.** `[direct]` — read `StateClusterRegistry.ts:90-184` and confirmed the cap asymmetry and the exact saturation condition. **This corrects the automated sweep**, which reported the impact without noting the >2000-selector precondition.

**Risks.** Changing saturation semantics affects run duration and coverage figures across the board — re-baseline the benchmark suite after the fix.

---

<a id="m-25"></a>
## M-25 — No Socket.IO connection-level auth middleware

**Severity:** Medium · Architecture / **CWE-306** (Missing Authentication for Critical Function)

**Description.** There is no `io.use(...)` anywhere in the repo. `index.ts:123` registers handlers directly; every anonymous socket connects and reaches all handlers, each of which re-derives identity via `socketUserId(socket)` (`registerSocketHandlers.ts:66-70`).

**Root cause.** Guest runs are a first-class feature, so a blanket connection gate was not an option — and per-handler checks were used instead of a middleware that establishes identity once.

**Impact.** Per-handler checks are mostly correct (`verify-fix` at `:225` is properly scoped, control messages re-validate at `:187`/`:194`), but H-05 is exactly the handler that was missed. Repeating an authorization decision at every handler makes omissions inevitable. Additionally, unauthenticated sockets can connect without limit — no per-IP connection cap exists.

**Affected files.** `testing-core/src/index.ts:123`, `testing-core/src/presentation/socket/registerSocketHandlers.ts:42,66-70`.

**Recommended fix.** Add an `io.use` middleware that resolves identity once (authenticated user, guest-with-token, or anonymous) and attaches it to `socket.data`, so handlers make an authorization decision against an already-established identity rather than re-deriving one. Add a per-IP connection cap.

**Verification.** `[sweep]` — the absence of `io.use` repo-wide was established by the sweep's search; `index.ts:123` confirmed `[direct]`.

**Risks.** Must preserve guest connectivity. `socket.data.runToken` is currently set from the client payload before ownership is checked (`registerSocketHandlers.ts:158-160`); the middleware should own that assignment.

---

<a id="m-26"></a>
## M-26 — Module-level singletons pin worker concurrency to 1

**Severity:** Medium · Scalability

**Description.** Run-scoped collaborators are wired into module-level singletons at engine construction:

```ts
ExplorationEngine.ts:341   setStructuralProbeAccessor(this.fuzzManager);
                           setConcurrentStressAccessor(this.fuzzManager);
                           setFuzzGuardAccessor(this.fuzzManager);
```

Acknowledged in-code at `:336-340` ("only safe because one process runs one exploration at a time") and enforced at `SafariWorker.ts:49` — `const MAX_SAFE_WORKER_CONCURRENCY = 1;`. Same class: `activeScenarioTracker.ts:57-64` (static fields), `reproductionPlaybookStore.ts:11-17` (static), `credentialScrub.ts:8` (`let scrubValues: string[] = []`).

**Root cause.** Global accessors were used to avoid threading dependencies through deep call chains. `ExplorationEngine.ts:338` records the reason the follow-up was deferred: converting to constructor injection requires `BugFinder` to become a factory.

**Impact.** Correct today, but it is the binding constraint on scale: capacity comes only from `WORKER_REPLICAS`, each carrying a full container's overhead, rather than from concurrency within a process. It also converts H-04 and H-10 from throughput problems into denial-of-service ones — with concurrency 1 and 2 replicas, two long-running requests take the fleet offline.

**Affected files.** `testing-core/src/domain/services/exploration/ExplorationEngine.ts:336-341`, `testing-core/src/infrastructure/workers/SafariWorker.ts:49`, `testing-core/src/domain/scenarios/activeScenarioTracker.ts:57-64`, `testing-core/src/infrastructure/monitoring/reproductionPlaybookStore.ts:11-17`, `testing-core/src/domain/services/credentialScrub.ts:8`.

**Recommended fix.** Convert the accessors to constructor injection with a per-run context object, making `BugFinder` a factory as the existing comment anticipates. Substantial and best done as its own project.

**Verification.** `[sweep]`. `SafariWorker.ts:49` corroborated by `.env.prod.example:26-28`, which documents the same constraint `[direct]`.

**Risks.** Large refactor across the engine's hottest code. Should not be attempted in the same pass as the security fixes. The benchmark suite is the safety net.

---

<a id="m-27"></a>
## M-27 — Secondary-tab sub-sessions share scoring state with the primary

**Severity:** Medium · Engine correctness

**Description.**
```ts
ExplorationEngine.ts:1122   const subLoop = new ExplorationLoop({ ...loopDeps, pathNavigator: new StateGraphNavigator(…), clusterRegistry: new StateClusterRegistry(…), routeExhaustion: new RouteExhaustionTracker(), … });
```
Only three collaborators are isolated. `visitedUrls`, `visitedHashes`, `visitedStructures`, `scorer`, `edgeRepeat`, `formFuzz`, `escalationTracker`, `actionExecutor`, and `stateRestorer` are shared by reference.

**Root cause.** Sub-session isolation was introduced for the collaborators that caused an observed problem, rather than by defining which state is run-scoped and which is tab-scoped.

**Impact.** A popup's states mark the primary's `visitedStructures`, suppressing the primary's novelty rewards — so exploring a popup makes the engine less likely to explore the main page. The shared `scorer` means the perceptron learns from mixed contexts. Shared `actionExecutor`/`recordActionTrace` is also the mechanism behind M-22's tab interleaving.

**Affected files.** `testing-core/src/domain/services/exploration/ExplorationEngine.ts:1110-1130`.

**Recommended fix.** Classify each collaborator as run-scoped or tab-scoped explicitly and construct accordingly. Novelty/visited tracking is clearly tab-scoped; the scorer is arguably run-scoped by design and should be documented as such rather than left ambiguous.

**Verification.** `[sweep]`.

**Risks.** Changes exploration behaviour on multi-tab targets. Re-baseline `bench:e2e:deep`, which exercises the multi-tab paths.

---

<a id="m-28"></a>
## M-28 — Insecure default fallbacks for Mongo, Redis, SMTP, and the frontend URL

**Severity:** Medium · **CWE-1188** (Insecure Default Initialization)

**Description.**

| Location | Default |
|---|---|
| `mongooseClient.ts:56` | `'mongodb://localhost:27017/'` |
| `TaskQueue.ts:7`, `AuthVault.ts:51`, `RunRegistry.ts:31`, `controlBridge.ts:27,49`, `telemetryBridge.ts:27,74`, `QueueStatusBroadcaster.ts:53`, `SafariWorker.ts:85` | `process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'` — no auth |
| `authPasswordResetController.ts:21` | `host: process.env.SMTP_HOST \|\| 'smtp.gmail.com'` |
| `authPasswordResetController.ts:31` | `const APP_URL = process.env.FRONTEND_URL \|\| 'http://localhost:5173'` |

**Root cause.** Local-development convenience defaults applied uniformly, without the production hard-fail that `JWT_SECRET` correctly receives (`authConfig.ts:26`).

**Impact.** A misconfigured production deploy silently degrades instead of failing: Mongo connection fails and `index.ts:59-61` continues with `findingRepository = undefined` (persistence silently off); Redis defaults to an unauthenticated local instance while holding the sealed credential vault and run registry; **password-reset emails silently contain `http://localhost:5173` links**, breaking account recovery with no error. The eight-way duplication of the Redis default also means a change must be made in eight places.

**Affected files.** As tabulated.

**Recommended fix.** Apply the `authConfig.ts` pattern — in production, require these and fail hard at boot. Centralise the Redis URL in one config module rather than repeating it in eight.

**Verification.** `[direct]` for `authPasswordResetController.ts:21-31` and `index.ts:56-61`; `[sweep]` for the Redis and Mongo call sites.

**Risks.** Failing hard at boot turns a silent misconfiguration into a visible outage — correct, but coordinate with the deploy runbook so it is not mistaken for a regression.

---

# LOW

<a id="l-01"></a>
## L-01 — `registerRoutes.ts` is 1441 lines

**Severity:** Low · Maintainability

`testing-core/src/presentation/api/registerRoutes.ts` holds route registration, request parsing, validation helpers, response shaping, and interface declarations for roughly twenty endpoints — against the project's own guidance in `CLAUDE.md` to watch for oversized files. It concentrates the largest share of this audit's findings (C-02, H-04, M-11, M-12, M-18, M-19), which is itself the evidence: a file this size hides divergence between routes that should be consistent.

**Fix:** split by route group (auth-adjacent, session lifecycle, history, forensics, AI) with shared parsing helpers extracted to a sibling module.
**Verification:** `[direct]` — `wc -l` = 1441.
**Risks:** Large mechanical diff. Do it after the security fixes land, not before, so the fixes stay reviewable.

---

<a id="l-02"></a>
## L-02 — Dead-code inventory

**Severity:** Low · Maintainability

| Item | Evidence |
|---|---|
| `presentation/middleware/validateObjectId.ts:25` | `validateObjectIdParams` has zero production call sites (only `security.test.ts:78,93`). Route params instead go through `resolveSessionSelector` (`registerRoutes.ts:55`), which is safe — so a tested guard sits unused while an untested path does the work. |
| `components/auth/AuthGuard.tsx` | Never rendered; see M-17. |
| `domain/scenarios/fuzzing/dataFuzzer.ts:33,46,53` | `chaosManagerInstance`, `setChaosManager`, `getChaosManager` — no callers. The file's own doc at `:30-37` states `dataFuzzer.execute` is off the live dispatch path. |
| `ExplorationLoop.ts:193` | `serverCrashReason` / `runtimeCrashReason` declared, never assigned; the comment at `:191` concedes they exist only to preserve the return shape. Dead consumers at `:258,264,1875`. |

Notably, there are **no `TODO`/`FIXME`/`not implemented` markers anywhere in `testing-core/src`** — incomplete work is recorded in prose comments instead, which is why it is easy to miss.

**Fix:** delete, or wire up `validateObjectIdParams` if the intent was to use it.
**Verification:** `[sweep]`; the absence of TODO markers confirmed `[direct]` by search.
**Risks:** None.

---

<a id="l-03"></a>
## L-03 — Dependency hygiene, and a documented control that does not exist

**Severity:** Low · Maintainability / documentation accuracy

- `developer-dashboard/package.json:14-15` — `dompurify@^3.4.10` and the deprecated `@types/dompurify@^3.0.5` are installed but **never imported** (the only source hit is a licence listing in `legal/content.ts:177`). Meanwhile `PAPER_Software_Requirements.md:36` documents *"DOMPurify | 3.4 | Cleaning any text that comes from the tested page before it is displayed"* — **a security control asserted in project documentation that does not exist in code**. React's JSX escaping is what actually provides the protection (see [Verified clean](#verified-clean)), and it is sufficient, but the documentation is wrong and should not be relied on in a review or a report.
- `package.json:26` — root `lucide-react@^1.25.0` vs `developer-dashboard/package.json:18` `^0.542.0`. Conflicting majors; the root copy has no importer.
- Three TypeScript versions: root `^5.7.0`, dashboard `~5.7.0`, testing-core `^5.8.3`.
- `testing-core/package.json:25` — `@types/nodemailer` in `dependencies` rather than `devDependencies`.
- No `latest` ranges anywhere; pins are current. **Good.**

**Fix:** remove the unused DOMPurify packages and correct `PAPER_Software_Requirements.md`, or adopt DOMPurify if a real sanitisation need is identified. Align the duplicated packages.
**Verification:** `[sweep]`.
**Risks:** Correct the documentation regardless of the code decision — an inaccurate security claim in a requirements document is worse than no claim.

---

<a id="l-04"></a>
## L-04 — CI supply-chain and deploy hardening

**Severity:** Low · CI/CD

`.github/workflows/deploy.yml`: actions are tag-pinned rather than SHA-pinned (`actions/checkout@v4`, `webfactory/ssh-agent@v0.9.0`) — mutable-tag exposure. Host keys are trust-on-first-use via `ssh-keyscan` on every run. Deployment is `ssh root@…`. The trigger is `push` to `dev` with no environment protection or approval gate, so any push to `dev` deploys to production. No secrets are echoed — the `${{ secrets.* }}` references are used only as action inputs and command arguments. **Good.**

**Fix:** SHA-pin actions, pin the host key as a secret rather than TOFU, deploy as a non-root user, and add an environment approval gate.
**Verification:** `[direct]` — read the full workflow.
**Risks:** None; each change is independent.

---

<a id="l-05"></a>
## L-05 — Hardcoded magic timeouts with no configuration path

**Severity:** Low · Maintainability

`ExplorationEngine.ts:1222` (`page.goto` 20000), `:1644` (`waitForSelector` 5000), `ExplorationLoop.ts:1602` (`verifyTraversal` 3000), `PlaywrightBrowserEngine.ts:146` (`browserLaunchTimeoutMs` 30000), `TabWindowManager.ts:16-21` (five constants), `PageHealthGuard.ts:31` (`NAV_TIMEOUT_MS` 15000).

These are tuning knobs for a system whose behaviour depends on target-app latency; a slow target needs different values, and there is no way to supply them without a code change.

**Fix:** collect into a single tuning-config module with per-deployment overrides.
**Verification:** `[sweep]`.
**Risks:** None. Do it alongside H-04's clamp work, which touches the same concern.

---

<a id="l-06"></a>
## L-06 — Blanket empty catches on page-driving code

**Severity:** Low · Error handling / **CWE-1069**

`ExplorationLoop.ts:547,586`, `StateRestorer.ts:67`, `StrictUrlLockGuard.ts:120,128`, `stateFingerprint.ts:39,51`, `TabWindowManager.ts:103,312`. The comments are accurate about the *expected* case ("detached/closed/navigated page — handled by ensurePageHealth next step") but the catch is untyped, so a genuine error thrown out of `page.evaluate` by the target application is swallowed identically — and that error may be exactly the defect the engine is meant to report.

**Fix:** narrow each catch to the expected Playwright error types and log anything else.
**Verification:** `[sweep]`.
**Risks:** Narrowing may surface genuine errors that were previously invisible — desired, but expect noise.

---

<a id="l-07"></a>
## L-07 — Auth logs include user email addresses

**Severity:** Low · Privacy / **CWE-532**

`authMiddleware.ts:66` — `console.log('[AUTH] requireAuth - accepted for user:', decoded.email);` and `authLoginController.ts:43`. Server-side only, and no tokens or passwords are logged.

**Fix:** log the `userId` instead, or gate on a debug flag.
**Verification:** `[sweep]`.
**Risks:** None.

---

<a id="l-08"></a>
## L-08 — The `shared/*.js` drift mechanism is armed for all 21 artifacts

**Severity:** Low today, Critical when it next fires · Build

C-03 is the instance; this is the class. All 21 committed `shared/*.js` files can drift from their `.ts` sources with no build step to catch it and no CI signal, because `tsc` and Vite resolve different files. A timestamp comparison across all 21 shows only `runCode.js` (runtime impact — C-03) and `types/remediation.js` (types-only, erases to an empty module, no impact today) are currently stale. **Every future edit to a shared `.ts` that adds or changes a runtime value repeats C-03 silently.**

**Fix:** the C-03 fix (delete the artifacts, gitignore them) closes this class entirely. Do not fix C-03 by regenerating `runCode.js` alone — that leaves the mechanism armed.
**Verification:** `[direct]` — mtime comparison across all 21 tracked artifacts; import-style enumeration across the dashboard.
**Risks:** See C-03.

---

<a id="l-09"></a>
## L-09 — `vercel.json` sets no security headers; Vite `allowedHosts: true`

**Severity:** Low · Config

`vercel.json` sets no CSP, HSTS, or `X-Frame-Options` for the dashboard. `developer-dashboard/vite.config.ts:32` sets `allowedHosts: true`, disabling DNS-rebinding protection on the dev server — dev-only, but it means any hostname resolving to the developer's machine can reach the dev server.

**Fix:** add headers to `vercel.json` (see M-13); restrict `allowedHosts` to the hostnames actually needed.
**Verification:** `[direct]` for `vite.config.ts:32`; `[sweep]` for `vercel.json`.
**Risks:** A CSP needs testing against the WebGL component and inline styles.

---

<a id="l-10"></a>
## L-10 — JWT in `localStorage` — accepted risk, recorded

**Severity:** Low (accepted) · **CWE-522**

Tokens live in `localStorage` as `bugsafari_token`, `bugsafari_refresh`, `bugsafari_user` (`utils/authRefresh.ts:18-20,26-30`), so they carry no `HttpOnly`/`SameSite` protection and are readable by any script on the page. The implementation around this is sound: reads are centralised (`attachEligibility.ts:7-13`), the token is attached to the socket handshake through the Socket.IO `auth` payload rather than the URL (`SocketConnectionManager.ts:87`), HTTP uses `Authorization: Bearer` (`utils/authHeaders.ts:11`), refresh is single-flight (`authRefresh.ts:40,51`), and the JWT is never logged.

Recorded because it is the reason the XSS review matters (see [Verified clean](#verified-clean)) and because it interacts with H-07 — moving to cookies would make that wildcard CORS allow-list an account-compromise vector.

**Fix:** none proposed. Revisit only if cookie-based auth is adopted, at which point H-07 must be fixed first.
**Verification:** `[sweep]`.

---

<a id="l-11"></a>
## L-11 — `testing-core/.env.example` comment contradicts the actual CORS design

**Severity:** Low · Documentation

`testing-core/.env.example:12` claims *"Wildcard CORS is intentional for the JSON API"*, contradicting `index.ts:36-39` (Express deliberately emits no CORS) and `deploy/Caddyfile:1-4` (Caddy is the sole emitter, with an allow-list). A future maintainer following the comment would add Express CORS middleware and produce duplicated headers, which browsers reject — breaking every request.

**Fix:** correct the comment to describe the Caddy-owns-CORS design.
**Verification:** `[direct]` — read `index.ts:36-39` and `deploy/Caddyfile:1-6`; `.env.example` line citation `[sweep]`.
**Risks:** None.

---

<a id="verified-clean"></a>
# Verified clean — do not re-audit

Recorded so future audits do not re-cover this ground.

**XSS.** No exploitable path exists in the dashboard. This was the headline hypothesis — the engine captures untrusted content from tested sites and renders it — and it does not hold. Every engine-sourced render path goes through JSX text interpolation, which React auto-escapes: `ConsoleTabPanel.tsx:113,117,120,125` (raw console text, URLs, stack traces from the tested site), `FindingCard.tsx:127`, `FindingEvidence.tsx:36,39,79-85,162,176` (payloads, stripped attributes, stack traces), `ForensicReport.tsx:129,131,159,171`, `RouteErrorBoundary.tsx:52`. There is **no** `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `document.write`, or `srcdoc` anywhere in `developer-dashboard/src/` — the only repo-wide `innerHTML` hits are intentional seeded-vulnerability fixtures under `testing-core/testing/benchmark/`. No dynamic `href={}` or `window.open()`, so no `javascript:` vector. Screenshots are constrained to a fixed `data:image/jpeg;base64,` prefix (`runStore.ts:235`) and land in `img.src`, which cannot execute script. `[direct]` for the absence of `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`new Function` repo-wide; `[sweep]` for the render-path enumeration.

**NoSQL injection.** Not present. Every user string reaching a Mongo filter is `typeof`-guarded (`authValidation.ts:49`), regex-validated (`shared/runCode.ts:27`, `validateObjectId.ts:7`), or wrapped in `new Types.ObjectId(...)`. `resolveSessionSelector` (`registerRoutes.ts:55-60`) returns `null` for anything else. The `$`-substring rejection was deliberately removed from password validation (`authValidation.ts:61-63`) with correct reasoning. `[sweep]`

**Path traversal.** No filesystem path is built from user input anywhere in `presentation/` or `infrastructure/`. The only user-influenced path-like value is the export filename (`registerRoutes.ts:941`), whose input is `record.runId ?? String(record._id)` — both server-minted. `[sweep]`

**Dynamic code execution.** No `child_process`, `exec`, `spawn`, `eval()`, `new Function(`, or dynamic `require(` in the server surface. `page.$eval` hits (`ActionExecutor.ts:862`, `frameworkInput.ts:121`, `constraintBypass.ts:109`) are in-page DOM readers. The `eval` strings in `xssVectorStrategy.ts:26,81` are fuzzing *payloads*, not executed by Node. The one dynamic `import()` (`refreshTokenService.ts:96`) is a static literal. `[direct]`

**Route authorization coverage.** Every route carries an appropriate decorator; none is missing one. Guest-reachable routes are deliberate and enumerated: `POST /api/safari/stop`, `POST /api/start-test`, `GET /api/session/active`, `POST /api/support/tickets`. Everything touching stored data uses `requireAuth`, and tenant scoping via `userId` was verified on all nine `SessionModel` route-layer queries. `[sweep]`

**Guest isolation.** Guests cannot persist or read any user's data — `MongoFindingRepository.ts:55` throws without a valid `userId`, and `listSessionHistory` (`:228`) returns empty. Guest ownership is an unguessable server-minted `randomUUID()` (`registerRoutes.ts:558`) with a clear rule (`runOwnership.ts:23-25`). `[sweep]`

**Authentication implementation.** Refresh-token rotation is atomic and reuse-detecting (`refreshTokenService.ts:75-88`) with tokens HMAC-peppered at rest (`:28-30`); reset tokens are bcrypt-hashed (`authPasswordResetController.ts:208`) and compared with `bcrypt.compare` (`:288`); login and forgot-password are enumeration-safe (`authLoginController.ts:9-12`, `authPasswordResetController.ts:216-227`); password change and reset revoke all refresh tokens (`userSettingsController.ts:194`, `authPasswordResetController.ts:311`); bcrypt cost is 12 (`UserModel.ts:81`). JWT claim shape is validated before use (`authConfig.ts:125`), so a validly-signed token with a missing `userId` fails cleanly rather than blowing up in `new Types.ObjectId(undefined)`. `[direct]` for `authConfig.ts`, `[sweep]` for the rest. *(H-09 and M-01/M-02 are the exceptions and are filed above.)*

**Credential handling.** Target credentials never enter the BullMQ payload — AES-256-GCM plus a single-use `GETDEL` vault (`AuthVault.ts:66-100`), with a fail-closed refusal when the vault is unavailable (`registerRoutes.ts:431-437`). Secrets are scrubbed on the persist path (`ForensicErrorRepository.ts:40-42`) and the wire path (`SocketTelemetryGateway.ts:10`). The Gemini key is header-borne and redacted from logs (`GeminiRemediationAdvisor.ts:37-39,55`). `[direct]` for the Gemini advisor, `[sweep]` for the vault.

**Telemetry room isolation.** `SocketTelemetryGateway.ts:62-63` scopes emits to a room and **drops** unrouted emits rather than broadcasting them — a fail-closed default. Mirrored on the worker transport (`telemetryBridge.ts:38,85`). `verify-fix` derives the user server-side and never accepts a client-supplied `userId` (`registerSocketHandlers.ts:225`, `RegressionPlaybookVerifier.ts:162-164`). *(H-05 is the one channel that escapes this.)* `[sweep]`

**Terminal error handling.** `errorHandler.ts:45,67` returns a generic message plus a correlation `errorId`, with the stack going only to the log. Covered by `security.test.ts:105-118`. *(M-12 is one route bypassing it.)* `[direct]`

**Proxy trust.** `index.ts:35` — `app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 0))` with an explicit hop count and a comment explaining that a blanket `true` would let a client forge `X-Forwarded-For` to evade rate limits. Correct. `[direct]`

**Frontend resource management.** No unbounded state growth: `appendCapped` (`runStore.ts:73-76`) with `CONSOLE_BUFFER_CAP=200`, `TELEMETRY_CAP=500`, `NETWORK_CAP=200` (`stores/run/types.ts:59-61`) and `collapseFaultIntoBuffer` capped at `errorDeduplication.ts:88`. Socket listeners are balanced — `connect()` registers 16 handlers (`SocketConnectionManager.ts:195-214`), `disconnect()` removes all 16 plus error handlers (`:227-245`), using `readonly` arrow properties so `.off()` gets identical references. Reconnect is bounded (10 attempts, 1s→5s cap) with a terminal latch (`:324-328`) — no storm. `useDashboardController.ts:29,78-88` ref-counts mounts so React StrictMode's synthetic unmount cannot kill a live socket. `[sweep]`

**Type safety.** Only 7 `any` occurrences, all in the decorative WebGL component (`designs/GradientBlinds.tsx`) for untyped `ogl` handles. No `any` on any shared-contract boundary. `[sweep]`

**Docker secrets.** Not baked into image layers — `.dockerignore:8-9` excludes `.env`. `[sweep]`

**Test coverage exists.** 84 test files across the three packages, including targeted suites for the exact areas this audit touches: `authConfig.test.ts`, `middleware/security.test.ts`, `shared/url.test.ts`, `runOwnership.test.ts`, `StartExplorationUseCase.concurrency.test.ts`, six `StateGraphNavigator.*.test.ts`, `AsyncTaskTracker.test.ts`, `SessionManager.sync.test.ts`. Plus seeded-vulnerability benchmark targets under `testing-core/testing/benchmark/` (`seeded-app`, `seeded-app-full`, `deep-app`) with manifests declaring expected bug classes — the right harness for validating engine-behaviour fixes. `[direct]`

---

# Suggested remediation sequencing

Not a commitment — a proposal for the review discussion.

**Wave 1 — config and deploy, no runtime risk.** C-01, H-08, H-07, H-09, M-13, L-11. Small, independent, and H-08 unblocks testing anything in the Caddyfile.

**Wave 2 — process safety.** H-01 first (it is the backstop that makes everything else safe to touch), then M-09, H-03, H-02.

**Wave 3 — SSRF and admission.** M-18 first (collapse to one validator), then C-02 and H-06 against that single gate.

**Wave 4 — resource limits and authorization.** H-04, H-10, H-05, M-19, M-10, M-11, M-12, M-25.

**Wave 5 — engine correctness.** **M-20 before H-11** (ordering dependency — see M-20). Then H-12, M-24, M-21, M-03, M-04, M-05, M-06, M-07, M-08, M-22.

**Wave 6 — frontend and shared contracts.** C-03 with L-08 (same fix), M-15, M-16, M-17.

**Wave 7 — deliberate projects, separately scheduled.** M-23 (schema migration), M-26 (concurrency refactor), M-27, L-01 (route-file split), L-02, L-03, L-04, L-05, L-06.

**Verification gates.** `npm run typecheck` and `npm test` in all three packages after every wave. `npm run bench:e2e` and `bench:e2e:deep` against the seeded targets before and after Waves 2, 3, and 5, comparing findings counts and bug classes to a pre-change baseline — that baseline should be captured **before** any fix lands. A live end-to-end pass (telemetry streams, live frames render, pause/resume/stop respond promptly, run code appears in history, session saves, forensic report opens, replay and verify-fix work) plus a two-account concurrency check for the isolation fixes. Confirm no orphan `chrome` processes remain after a forced mid-run stop, and that RSS is flat across a long run.
