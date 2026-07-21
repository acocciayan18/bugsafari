# BugSafari — System Engineering Audit

Date: 2026-07-21 · Branch: `7-21-Tibo-2` · Scope: full monorepo (`testing-core/`, `developer-dashboard/`, `shared/`)

## How this audit was produced

Findings are grounded in the actual implementation: the exploration loop, session lifecycle, ML scorer, auth, credential vault, socket layer, worker orchestration, database schema, and the frontend socket/store were read directly. Systemic patterns (`any` usage, `console.*`, indexes, TODOs, token storage, CORS) were swept across the codebase. Where a claim depends on a specific line, the file is cited. Prior audit docs (`CODEBASE_AUDIT_2026-07-13.md`) were treated as stale and re-verified — the `any` count they report (428) is now **27**, so the codebase has been materially hardened since.

## Executive summary

BugSafari is a **mature, high-quality, defensively-engineered** system, not an early prototype. The hard problems of autonomous exploratory testing — loop prevention, coverage-first scoring, error-state exclusion, reconnect replay, distributed run ownership, single-use credential handoff — are already solved and solved carefully. Most "obvious" bugs a first-pass audit would expect are already guarded against with explicit compensating logic and comments explaining the *why*.

The real risk profile is therefore not scattered bugs. It is concentrated in three places:

1. **Scalability** — the distributed worker is hard-pinned to concurrency 1 because ~6 pieces of run state are process-wide singletons. The fleet scales only by adding processes, never by parallelism within one.
2. **Maintainability** — a handful of files have grown to 1,000–1,650 lines (79 KB), and there are 548 raw `console.*` calls with no structured logging.
3. **Security hardening** — auth tokens (access + refresh) live in `localStorage`, and there is no security-header middleware (helmet). Both are common but real exposures.

Nothing found is a data-loss or auth-bypass defect. The findings below are ranked accordingly.

---

## ISO/IEC 25010 quality scorecard

| Attribute | Rating | Basis |
|---|---|---|
| Functional Suitability | **Strong, with trust caveats** | End-to-end pipeline implemented: explore → score → detect → forensics → report → verify-fix. But three output-integrity gaps (F1 mislabeled "AI" analysis, F3 coverage metric measures effort not reach, BD1 injection false-positives) undercut how much the results can be trusted at face value. |
| Performance Efficiency | **Adequate** | Bounded buffers, capped visited-hash set, `Promise.all` fan-out on reads. Limited by per-process single-run model and synchronous per-step DOM re-hash/re-parse. |
| Compatibility | **Adequate** | Clean sync/distributed duality; env-driven routing (`resolveEngineTargetUrl`). Wildcard CORS is intentional and documented. |
| Usability | **Good** | Rich real-time dashboard, reconnect grace, restore-on-load, transitional states ("Pausing…/Stopping…"). Accessibility of the dashboard itself is unverified. |
| Reliability | **Good** | Reservation timers, grace windows, crash escalation, fail-closed credential path, compensating cleanup on enqueue failure. Target health monitor is OFF by default. |
| Security | **Adequate at the app layer, weak at the runtime boundary** | Strong app-layer: AES-256-GCM single-use vault, JWT hard-fail in prod, ownership scoping everywhere, NoSQL-injection guards, refresh-token rotation. Weak: **Chromium `--no-sandbox` as root loading untrusted sites (S5)** is the standout exposure; plus `localStorage` tokens, no helmet, in-process rate limiter. |
| Maintainability | **At risk** | Excellent internal docs and DI, but several 60–79 KB files and 548 `console.*` calls. Test footprint (51 files) is real but uneven. |
| Portability | **Good** | Dockerfile + compose, env-tunable knobs, ESM throughout, Podman-aware host bridging. |

---

## Implementation status inventory

**Implemented & load-bearing:** exploration loop/engine, StateGraphNavigator + pathfinder, perceptron scorer (delta rule + momentum + L2), DOM hashing/loop prevention, bug finders + scenarios/fuzzing, forensics (errors/telemetry/network/console/analysis), reproduction playbook + verify-fix regression replay, auth (login/signup/reset/refresh rotation), distributed queue (BullMQ + Redis registry + control bridge + telemetry bridge + AuthVault), session lifecycle/reconnect, retention TTL + cascade reaper.

**Partially implemented / conditional:** target health monitor (built, **disabled by default** — `BUGSAFARI_TARGET_HEALTH_MONITOR` off); distributed concurrency (built for N workers but **clamped to 1**); pagination (dual-envelope, some routes only).

**Dead / unreachable code:**
- `serverCrashReason` / `runtimeCrashReason` in `ExplorationLoop.execute()` (`ExplorationLoop.ts:149-152`) are declared, commented "never assigned here," yet still gate `return` branches at `:215-221` that can never fire.
- The **entire binary-frame streaming stack** — `BinaryFrameReceiver.ts` (250 lines: `BinaryFrameReceiver` + `CanvasFrameRenderer` + `LiveFeedRenderer`) and the `useBinaryStream` branch of `LiveFeed.tsx`. `useBinaryStream` is `false` everywhere and no parent ever sets it true; the live path is base64 JPEG over Socket.IO. See DC1.
- `metrics.totalBugsFound` / `bugsByCategory` in `StartExplorationUseCase.executeInScope` are built but never populated during the run (`:556` "would be collected … in a full implementation"). Real counts are only computed later in `manualSaveToHistory`.

**Convention drift:** `CLAUDE.md` states "never generate multi-line comments," but the codebase is (beneficially) saturated with multi-line JSDoc. The stated rule and the actual, better practice disagree — the rule should be retired, not the comments.

---

## Findings

Each finding: **Severity · Module · Root cause · Impact · Fix · Priority.**

### Security

**S1 — Auth tokens stored in `localStorage` (access + refresh). Severity: High**
- Module: `developer-dashboard/src/utils/authRefresh.ts:25-27`, `SocketConnectionManager.ts:81`, `historyService.ts:15`.
- Root cause: `bugsafari_token` and refresh token persisted to `localStorage` for cross-tab/refresh survival.
- Impact: any XSS on the dashboard exfiltrates both tokens; the refresh token grants long-lived session continuity, so theft is durable despite the 30-min access TTL.
- Fix: move the refresh token to an httpOnly, Secure, SameSite cookie; keep only the short-lived access token in memory (not `localStorage`). Requires a `/refresh` cookie flow and CSRF consideration (currently avoided by having no cookies).
- Priority: Short-Term.

**S2 — No security-header middleware (helmet). Severity: Medium**
- Module: `testing-core/src/index.ts` (registers `cors()` + `express.json`, no helmet).
- Root cause: security headers were never added.
- Impact: responses lack `X-Content-Type-Options`, `Referrer-Policy`, HSTS, frame protections. Low direct risk for a JSON API but free defense-in-depth, and the dashboard is served to browsers.
- Fix: add `helmet()` (no new heavy dep; it is standard) or set the equivalent headers manually to honor the "no external libraries unless necessary" constraint.
- Priority: Short-Term.

**S3 — Rate limiter is per-process, in-memory. Severity: Medium**
- Module: `testing-core/src/presentation/middleware/rateLimiter.ts` (documented at top).
- Root cause: sliding-window buckets live in a `Map` per API process.
- Impact: N API replicas multiply every budget by N; login/reset brute-force protection weakens exactly when scaled. Documented but unmitigated.
- Fix: when `BUGSAFARI_USE_QUEUE=1` (Redis already present), back the limiter with a Redis counter; keep the in-memory path as the single-process default.
- Priority: Short-Term.

**S4 — Wildcard CORS + Socket.IO `origin: '*'`. Severity: Low (accepted)**
- Module: `index.ts:35-52`, `monitoring/socketServer.ts`.
- Root cause: intentional — JWT Bearer auth, no cookies, so no CSRF surface.
- Impact: acceptable given the trust model; revisit if any cookie-based state is ever introduced (see S1 fix — tightening CORS becomes necessary the moment a refresh cookie exists).
- Fix: on adopting S1, pin `origin` to the dashboard host and enable credentials.
- Priority: couple to S1.

### Scalability

**SC1 — Worker hard-pinned to concurrency 1 by process-wide singletons. Severity: High**
- Module: `SafariWorker.ts:20-56` (self-documented `CONCURRENCY_BLOCKERS`).
- Root cause: `sessionManager` singleton, six static forensic stores reset per-run in `StartExplorationUseCase`, and chaos-manager module globals are all shared per process, not per run. A second concurrent job would wipe the first's in-flight state and repoint the telemetry room.
- Impact: throughput scales only by adding worker *processes* (memory-heavy — each owns a Playwright browser). No vertical parallelism; a burst of runs queues serially per worker.
- Fix: thread a per-run context object (or `AsyncLocalStorage`, as already done for the scenario PRNG) through the forensic stores and scenario managers; make `SessionManager` instance-per-run keyed by `runId`. This is the single highest-leverage architectural investment.
- Priority: Long-Term (large, but unlocks real scale).

**SC2 — Single active run per API process in synchronous mode. Severity: Medium**
- Module: `StartExplorationUseCase.tryActivate()`, enforced via 429 in `registerRoutes.ts:474`.
- Root cause: same singleton model as SC1, plus deliberate admission control.
- Impact: without the queue, the whole server runs one exploration at a time.
- Fix: same as SC1; until then, document that production must run `BUGSAFARI_USE_QUEUE=1` with a worker fleet.
- Priority: couple to SC1.

### Reliability

**R1 — Target health monitor disabled by default. Severity: Medium**
- Module: `SessionManager.ts:60-66` (`HEALTH_MONITOR_ENABLED` off).
- Root cause: the Node-side probe's network view differs from the browser's (loopback/Podman bridging), risking false crashes.
- Impact: in the default config, "Critical Server Crash" detection relies solely on browser-side signals (5xx/requestfailed/pageerror). A backend that dies without emitting a browser-visible failure (e.g. hangs) may not be caught until timebox.
- Fix: keep off for bridged local dev, but auto-enable when engine and browser share the target network (cloud-hosted, same-origin), or add a browser-side reachability heartbeat as the always-on path.
- Priority: Short-Term.

**R2 — Perceptron learning state resets on every brain reload. Severity: Low**
- Module: `ml/perceptron.ts:170-180` (`loadState` zeroes `velocity`, `biasVelocity`, `updateCount`).
- Root cause: only weights + bias are persisted; momentum and LR-decay counter are transient by design.
- Impact: a reloaded brain restarts LR decay from zero and loses momentum, so early post-reload updates swing harder than a continuously-trained model — mild learning-continuity regression, not a correctness bug.
- Fix: persist `updateCount` (and optionally velocity) in `BrainConfigModel` and restore them; or explicitly accept the reset and document it as intended cold-restart behavior.
- Priority: Long-Term.

### Maintainability

**M1 — Oversized files. Severity: Medium**
- Module: `ExplorationLoop.ts` (1,649 lines / 79 KB), `ExplorationEngine.ts` (61 KB), `StabilityMonitor.ts` (60 KB), `registerRoutes.ts` (59 KB, one function, 14+ routes), `ForensicReport.tsx` (45 KB), `Settings.tsx` (31 KB).
- Root cause: incremental growth without extraction; `CLAUDE.md`'s own "watch for oversized files needing refactor" is being tripped.
- Impact: high cognitive load, harder review, merge-conflict magnets, slower onboarding.
- Fix: `registerRoutes.ts` → split into `sessionRoutes` / `historyRoutes` / `forensicRoutes` routers. `ExplorationLoop.ts` → extract the dead-end/error-state/exhaustion handlers and the scoring-adjustment passes into collaborators. Do this incrementally behind unchanged public signatures.
- Priority: Short-Term (start with routes; it is the lowest-risk split).

**M2 — 548 `console.*` calls, no structured logging. Severity: Medium**
- Module: 111 files across `testing-core/src`.
- Root cause: ad-hoc logging grew with the code.
- Impact: no level filtering, no correlation IDs, noisy prod output, and a latent info-leak risk (verbose `[API]`/`[AUTH]` lines log user emails and IDs). Can't silence debug chatter without editing source.
- Fix: introduce a tiny in-house logger (level + `runId` context, honoring the no-dep constraint) and mechanically migrate. Redact PII in auth logs.
- Priority: Short-Term.

**M3 — Dead-code crash sentinels. Severity: Low**
- Module: `ExplorationLoop.ts:149-152, 215-221`.
- Root cause: leftover from an earlier engine shape; `let` vars never reassigned.
- Impact: unreachable branches that mislead readers into thinking crash reasons flow through here.
- Fix: delete the two `let` declarations and the dependent `if` blocks; route genuine crash reasons through `handleIterationError`.
- Priority: Immediate (trivial, safe).

### Exploration-engine quality

**E1 — Per-step full re-parse + re-hash cost. Severity: Low**
- Module: `ExplorationLoop.parseDomAndScore` / `computeFingerprintAndStagnation`, plus `checkPageSaturation` computing a *second* compound hash before the parse.
- Root cause: correctness-first design recomputes the DOM snapshot each iteration.
- Impact: on large DOMs the double-hash + reparse dominates step latency; fine for correctness, costly at scale.
- Fix: memoize `hashCompound` per step (saturation gate and fingerprint currently hash independently) and reuse the first parse.
- Priority: Long-Term.

**E2 — Coverage/false-negative boundary honesty is good but health-gated. Severity: informational**
- The engine correctly distinguishes "graph exhausted" from "boundary saturated" (`completionResult`) and excludes error states from the graph — this is a strength. The residual false-negative risk is authenticated-surface coverage when a run deauthenticates early; the `SESSION_EXIT_DEMOTION=2000` guard mitigates it well. No action beyond keeping that guard.

### Frontend / UX / Accessibility

**U1 — Dashboard accessibility unverified. Severity: Medium**
- Module: `developer-dashboard/src` (the app audits *targets* for WCAG but is not itself audited).
- Root cause: no evidence of a11y testing on the operator console.
- Impact: keyboard/screen-reader operability of the real-time dashboard is unknown; ironic for a tool that flags a11y defects.
- Fix: run axe against the dashboard, verify focus management on modals (Settings, SessionComparison) and live-region announcements for telemetry.
- Priority: Short-Term.

**U2 — Large components mix data + presentation. Severity: Low**
- Module: `ForensicReport.tsx` (45 KB), `Settings.tsx` (31 KB).
- Impact: re-render cost and testability; hard to unit-test formatting logic.
- Fix: extract pure formatters/hooks; memoize heavy report sub-trees.
- Priority: Long-Term.

### Database / schema

**D1 — Schema and indexing are a strength. Severity: informational**
- Compound indexes cover the real query shapes (`userId+savedManually+startedAt`, per-forensic-run indexes), a partial TTL index expires unsaved sessions without touching saved history, and cascade delete + a separate reaper handle child docs. No missing-index hot path was found. Keep the `db:sync-indexes` script in the deploy flow so index intent stays enforced.

---

## Additional findings (deep-read pass)

A second pass into the bug-detection, forensic-scoring, reporting, DOM-hashing, and live-frame subsystems surfaced findings the first pass did not reach. These matter disproportionately because they touch **trust in the output** — the whole product promise is that a clean result means clean and a reported bug is real.

**F1 — "AI Analysis" is deterministic keyword string-matching. Severity: Medium**
- Module: `ForensicAnalysisService.ts:141-213, 245-325`.
- Root cause: root-cause + recommendations are built from `message.includes('Cannot read property')`, `includes('undefined')`, `includes('CORS')`, etc., over only the **first** API failure and the **first** JS exception. The DB field, the API, and the doc-comment all call it "AI-powered."
- Impact: (a) truth-in-labeling — it is a rules engine, not AI; (b) brittle classification — `includes('undefined')` matches any message merely containing that word; (c) no correlation across errors, so a run with one root fault and twenty downstream symptoms is summarized from whichever error happened to sort first.
- Fix: rename to "Heuristic Analysis" in UI/schema/comments, or make it genuinely model-backed; classify on structured fields (type + statusCode) not substring scans; aggregate/rank errors before summarizing.
- Priority: Short-Term (rename + field-based classification is cheap and removes the misleading claim).

**F2 — Risk score double-counts repeated identical errors. Severity: Medium**
- Module: `ForensicAnalysisService.calculateRiskScore` (`:218-240`) over `forensicErrorRepository.findByRunId` with no dedup.
- Root cause: `errorCount`, `apiFailureCount`, etc. are raw row counts. The save path dedups findings (`dedupeCaughtBugs`), but the analysis path does not.
- Impact: one buggy endpoint hit 15× during exploration scores as 15 API failures → the `Math.min(30, count*10)` cap saturates instantly, so almost any repeated fault reads as maximum risk. Risk scores lose discriminating power.
- Fix: dedup by fault signature (reuse `buildFaultSignature`) before counting; count distinct faults, keep occurrences as a separate weight.
- Priority: Short-Term.

**F3 — "Coverage %" is actions-executed ÷ action-cap, not real coverage. Severity: Medium**
- Module: `StartExplorationUseCase.manualSaveToHistory:335` — `Math.round(actionRecords.length / maxActions * 100)`.
- Root cause: coverage is proxied by how many actions ran against the configured `maxActions`, not by states/controls explored versus discovered.
- Impact: a run that fires 100 actions all on one page reports ~100% "coverage." This is exactly the trust signal users rely on to believe a clean result, and it is measuring effort, not reach. The `StateClusterRegistry` already tracks discovered-vs-triggered controls and distinct structural shells — the real denominator exists and is unused here.
- Fix: derive coverage from `clusterRegistry` (triggered controls ÷ discovered controls, and/or distinct states visited), and surface the boundary-saturated vs graph-exhausted distinction the engine already computes.
- Priority: Short-Term.

**BD1 — NoSQL-injection finder can misattribute an unrelated 5xx. Severity: Medium**
- Module: `bugs/finders/noSqlInjection.ts:25-29, 41`.
- Root cause: after injecting a payload it waits `OBSERVE_WINDOW_MS` (1200 ms) and flags the **first** `status >= 500` **any** response in that window as caused by the injection. There is no baseline/control request to confirm the same field is healthy without the payload.
- Impact: a coincidental background 500 (analytics, polling, an unrelated XHR) within 1.2 s is reported as a CRITICAL/HIGH NoSQL-injection finding — a false positive that erodes confidence in the whole findings list. (The operator-error-leak branch is sound; the bare-5xx branch is the exposure.)
- Fix: correlate the 5xx to the injected field's own request (match URL/endpoint touched by the fuzz), or run a control injection of a benign value first and only report when the malicious payload uniquely triggers the fault.
- Priority: Short-Term.

**DC1 — Unused binary-frame streaming stack (+ latent traps). Severity: Medium**
- Module: `developer-dashboard/src/infrastructure/socket/BinaryFrameReceiver.ts` (250 lines) and `LiveFeed.tsx:127-158`.
- Root cause: an "optimized" binary-over-WebSocket renderer was built but never wired — `useBinaryStream` defaults `false` and no caller sets it true. Live frames actually travel as base64 JPEG over Socket.IO (`SocketTelemetryGateway.emitLiveFrame`), i.e. the exact "legacy laggy ~15fps" path the dead code claims to replace.
- Impact: 250 lines of misleading dead code; and if anyone flips `useBinaryStream` on, two latent bugs bite immediately — the URL is hardcoded `ws://localhost:8765` (breaks in any container/deploy; nothing serves 8765), and `CanvasFrameRenderer.startRenderingLoop` returns a **no-op** cleanup (`:325-326`) so the `requestAnimationFrame` loop leaks forever.
- Fix: delete the stack and the `useBinaryStream` branch; or, if binary streaming is a real roadmap item, stand up the backend `ws` endpoint, make the URL configurable, and return a real RAF-cancel from the loop.
- Priority: Short-Term (delete) — decide keep-or-cut and don't leave it half-wired.

**DH1 — DOM-hash truncation can collide very large pages. Severity: Low**
- Module: `ml/domHasher.ts:174, 228` — structure DFS `budget` and interactive `iCap` both capped at `maxElements` (5000).
- Root cause: past the cap the walk stops; two genuinely different pages that share their first ~5000-element skeleton hash identically.
- Impact: a false "same state" (novelty false-negative) on unusually large DOMs — the engine may skip a page it should explore. Rare in practice; SPAs seldom exceed 5000 structural nodes after volatile-subtree pruning.
- Fix: fold an element-count / depth signal into the signature, or raise the cap for the structure pass; low priority given the pruning already applied.
- Priority: Long-Term.

**M4 — Lingering `any` on session id telemetry. Severity: Low**
- Module: `StartExplorationUseCase.ts:511` (`sessionId: this.currentSessionId as any` + eslint-disable).
- Impact: one of the last remaining `any` casts; `currentSessionId` is always `null` at that point anyway, so the field ships null.
- Fix: type the telemetry `meta.sessionId` as `string | null` and drop the cast (or drop the field).
- Priority: Immediate (trivial).

**S5 — Chromium runs `--no-sandbox` as root while loading untrusted target sites. Severity: High**
- Module: `PlaywrightBrowserEngine.ts:150-155, 171` (both launch paths pass `--no-sandbox`), `Dockerfile:2` (`mcr.microsoft.com/playwright` base runs as root — no `USER` directive).
- Root cause: the browser sandbox is disabled, and the container runs privileged, but the browser's entire job is to load **arbitrary attacker-controlled** target URLs. The untrusted web content is the primary input to the system.
- Impact: a Chromium renderer exploit on a malicious target has no OS sandbox to contain it and lands as root inside the worker/container — the worst-case blast radius for a tool designed to point a browser at hostile sites. This is the single most consequential security finding in the audit.
- Fix: add a non-root `USER` in the Dockerfile and run Playwright with the sandbox enabled (grant unprivileged user namespaces, or a tuned seccomp profile). Rootless Podman narrows the blast radius but is not a substitute for the sandbox. If `--no-sandbox` must stay, isolate each run in a disposable, network-egress-restricted, non-root container.
- Priority: Short-Term (high impact; the fix is container-level, not a code rewrite).

**S6 — `ignoreHTTPSErrors: true` silently accepts invalid TLS on targets. Severity: Low**
- Module: `PlaywrightBrowserEngine.ts:195`.
- Root cause: convenient for self-signed staging targets.
- Impact: a target reached over a MITM'd or invalid certificate is explored without warning; findings could reflect an injected page rather than the real app. Defensible default for a testing tool, but it should be visible/opt-out.
- Fix: keep the default but surface a telemetry note when a target's certificate is untrusted, and allow a strict-TLS run mode.
- Priority: Long-Term.

**P1 — Cold Chromium launch per run, no browser pool. Severity: Low-Medium**
- Module: `PlaywrightBrowserEngine.run` (`:147-177`) launches a fresh browser every run (30 s launch race + minimal-args fallback).
- Root cause: one-browser-per-run lifecycle, never pooled or reused.
- Impact: every run pays full cold-start latency, and because the worker is concurrency-1 (SC1), that launch cost is on the critical path of every queued job. At fleet scale this is pure wasted wall-clock.
- Fix: pool/reuse a warm browser per worker and open a fresh **context** per run (contexts are cheap and already isolate cookies/storage); only relaunch the browser on crash. Couples naturally with the SC1 de-singleton work.
- Priority: Long-Term.

**IM1 — Docker image is single-stage, ships dev dependencies, runs as root. Severity: Low**
- Module: `Dockerfile` (`npm ci` with no `--omit=dev`, no multi-stage build, no `USER`).
- Impact: larger image and a bigger runtime attack surface (tsc/tsx and all build tooling present in the running container); compounds S5 (root).
- Fix: multi-stage build (build stage → slim runtime stage with production deps only) and a non-root `USER`.
- Priority: Short-Term (pairs with S5).

**COV1 — State graph is capped at 500 nodes. Severity: informational**
- Module: `pathfinder/config.ts` `maxNodes` (default 500), enforced in `GraphStore`; parallels the `MAX_VISITED_HASHES = 5000` cap in `ExplorationLoop`.
- Impact: a genuinely large application whose distinct-state count exceeds the cap cannot have its full graph represented — an upper bound on coverage for big targets, distinct from the timebox. Reasonable for bounded runs, but it means "graph exhausted" on a huge app can mean "hit the node cap," not "explored everything." Worth surfacing in the report alongside the F3 coverage fix so the boundary is honest.
- Priority: fold into F3.

---

## Prioritized roadmap

### Immediate fixes (this iteration, low risk)
1. **M3** — delete the dead crash-sentinel branches in `ExplorationLoop.ts`.
2. **M4** — drop the `sessionId as any` cast in `StartExplorationUseCase.ts:511`.
3. **DC1** — decide keep-or-cut on the binary-frame stack; if cut, delete `BinaryFrameReceiver.ts` and the `useBinaryStream` branch now (250 lines of misleading dead code).
4. Retire the "no multi-line comments" rule in `CLAUDE.md` (it contradicts the codebase's own good practice).
5. Confirm `BUGSAFARI_USE_QUEUE=1` + worker fleet is the documented production topology (guards against the single-run trap of SC2).

### Short-term improvements (next 1–2 iterations)
1. **F1/F2/F3/BD1 — output-integrity cluster (do these together).** Rename "AI Analysis" → "Heuristic Analysis" and classify on structured fields; dedup errors before risk scoring; derive real coverage from `StateClusterRegistry`; add baseline/URL-correlation to the NoSQL finder. This is the highest-value short-term work — it directly repairs how far the results can be trusted.
2. **S5 + IM1 — harden the browser runtime.** Non-root `USER`, sandbox enabled (or per-run disposable isolated container), multi-stage image without dev deps. Highest-impact security work; container-level, not a code rewrite.
3. **S1** — move refresh token to httpOnly cookie; access token to memory. Tighten CORS (S4) alongside.
4. **S2** — add security headers (helmet or manual).
5. **S3** — Redis-backed rate limiter when the queue is enabled.
6. **M1** — split `registerRoutes.ts` into route modules (lowest-risk large-file win).
7. **M2** — introduce a leveled logger with `runId` context; redact PII in auth logs.
8. **R1** — make the target health monitor auto-enable when engine and browser share the network, or add a browser-side heartbeat.
9. **U1** — axe audit of the dashboard.

### Long-term enhancements
1. **SC1/SC2** — de-singleton run state (per-run context / `AsyncLocalStorage`) to raise `MAX_SAFE_WORKER_CONCURRENCY` above 1. Highest scalability leverage.
2. **E1** — memoize per-step DOM hash/parse.
3. **R2** — persist perceptron `updateCount`/velocity for learning continuity.
4. **M1 (cont.)** — decompose `ExplorationLoop` / `StabilityMonitor` collaborators.
5. **U2** — extract frontend formatters/hooks from the mega-components.
6. **DH1** — fold an element-count/depth signal into the DOM hash to prevent large-page collisions.
7. **P1** — pool/reuse a warm browser per worker, fresh context per run (couples with SC1).
8. **S6** — surface untrusted-TLS targets in telemetry; add a strict-TLS run mode.

### Future functional requirements (product-level opportunities)
1. **Multi-run orchestration UI** — once SC1 lands, let one operator watch several concurrent safaris.
2. **Cross-run learning corpus** — persist and share brain snapshots across targets to shorten cold-start (builds on `BrainConfigModel`).
3. **Deterministic replay bundles** — export a run's full seed + action timeline so a finding reproduces bit-for-bit outside the engine (extends the existing reproduction playbook).
4. **Coverage evidence surfacing** — expose the boundary-saturation vs graph-exhausted distinction and the untriggered-control frontier in the report, so users trust "clean" results.
5. **Authenticated-surface coverage metric** — quantify how much of the post-login graph was reached, closing the main false-negative gap.

---

## Bottom line

BugSafari is past the "find the bugs" stage of maturity. The engineering is disciplined, the hard algorithms are correct, and the defensive posture is unusually thorough. The next development phase should be **structural, not corrective**: de-singleton for scale (SC1), harden the auth-token and header surface (S1/S2), tame the largest files and the logging (M1/M2), and turn the already-strong coverage semantics into user-visible trust signals.
