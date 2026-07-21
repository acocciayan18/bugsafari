# BugSafari — System Engineering Audit (Pass 2)

Date: 2026-07-21 · Branch: `7-21-Tibo-2` · Scope: full monorepo (`testing-core/`, `developer-dashboard/`, `shared/`)

## How this audit was produced

This is a second, deeper pass building on `SYSTEM_AUDIT.md`. Five focused reviews read the actual implementation — the exploration engine and bug finders, the backend (auth/queue/worker/session/socket), the database write and lifecycle paths, the React dashboard, and the cross-cutting architecture/build/quality surface. Every finding cites a real `file:line` or a real command count. Prior findings were re-verified where they matter; several **still hold**, and one prior rating — "database schema/indexing is a strength" (D1) — **does not survive reading the write paths** and is corrected here (see DB1–DB3).

Finding IDs are namespaced by domain: `BK*` backend, `FE*` frontend, `EX*` exploration engine, `DB*` database, and `A/B/Q/T/DO/FR*` cross-cutting. These are **new** findings unless labeled "prior — verified."

## Executive summary

The prior audit's headline still stands: BugSafari is a mature, defensively-engineered system whose hard algorithms are correct. Pass 2 does not overturn that — but it finds that the trustworthy core is wrapped in **boundary layers that are materially weaker than the engine**: the persistence write path, the frontend, the module/contract seams, and the build.

Three themes dominate the new findings:

1. **The persistence boundary silently loses and amplifies data.** Forensic knowledge-base attribution (`bugClass`/`scenario`/`cwe`) is dropped at the repository layer and never reaches Mongo despite being produced, indexed, and rendered (DB1). Forensic errors are written one-doc-per-event with no cap while a batch method sits unused (DB2). The cascade reaper is **off by default** against an always-on TTL, guaranteeing orphan accumulation in the default deployment (DB3). Save-path bugs clobber real termination status (DB4) and orphan a run's forensic children (DB5).

2. **The frontend is the least-defended half of the system.** No error boundary anywhere — one render throw blanks the whole live dashboard and loses unsaved run state (FE1). Every socket event re-renders the main tree with no throttle, including ~15 fps frames (FE2). It is also **not strict-type-checked** (B1) and has **zero automated tests** (T1), while bypassing the `shared` contract with shadow type definitions (A1) and `as any` casts on its one architectural seam (A2).

3. **Reproducibility and coverage honesty have concrete leaks.** Confirmed-bug IDs use `Math.random()`+`Date.now()`, so a seeded "deterministic replay" produces non-matching forensic bundles (EX4). The route-exhaustion machinery acts on the first hit instead of the intended sustained-run threshold, and mislabels legitimate same-shell SPA routes as error states — shrinking real coverage on data-driven apps (EX1+EX2).

No Critical (data-loss-on-the-happy-path or auth-bypass) defect was found, but there are **~12 High-severity** items, and unlike Pass 1 they cluster in the boundaries, not the core. The next phase should harden the persistence write path, the frontend, and the contract/build seams.

---

## ISO/IEC 25010 quality scorecard (Pass 2 evidence)

| Attribute | Rating | Basis (new evidence) |
|---|---|---|
| Functional Suitability | **Strong core, leaky edges** | Pipeline works, but forensic attribution never persists (DB1), coverage still measures effort not reach (EX/F3), and `aiDiagnostics` the UI depends on isn't in the shared contract (FR2). Outputs are less complete than they appear. |
| Performance Efficiency | **Adequate, with hot-path waste** | Per-event single-doc forensic writes (DB2), per-step triple DOM hash (prior E1), whole-tree re-render per socket event (FE2), double user lookup per token refresh (BK4). |
| Compatibility | **At risk** | `shared/` workspace package is decorative; both sides deep-relative-import its source (A3). Shadow contract types on the frontend (A1). Mixed `.ts`/`.js` specifiers (B5). |
| Usability | **Good UI, weak failure UX** | Rich console, but no terminal reconnect state (FE6), infinite "Reconnecting…" after give-up, and a full-page blank on any render throw (FE1). |
| Reliability | **Good engine, fragile lifecycle** | Refresh-rotation race defeats single-use (BK1), reaper-off orphan accumulation (DB3), `stalled` handler tears down still-running runs (BK10), save clobbers terminal status (DB4). |
| Security | **Adequate app layer; unchanged runtime exposure** | Prior S5 (`--no-sandbox` as root) still the top exposure. New: non-atomic refresh rotation (BK1), plaintext unbounded target response bodies persisted (DB11), dev-only compose ships a hardcoded `JWT_SECRET` and `NODE_ENV=development` (FR1). |
| Maintainability | **At risk (confirmed + widened)** | Frontend not strict-checked (B1), zero frontend/shared tests (T1), god-files untested (T2), 15 `as any` / 4 `@ts-expect-error`, two source files carry raw NUL bytes and are invisible to code search (Q1), 18 stale root docs (DO1). |
| Portability | **At risk** | `docker compose -f docker-compose.local.yml build` fails (`npm run build --workspace shared`, no such script) (B2); Dockerfile vs compose diverge on base image and install flags (B3); no production runtime config exists (FR1). |

---

## Implementation status inventory (Pass 2 refinements)

**Implemented & load-bearing (confirmed):** exploration loop/engine/navigator, perceptron + DOM hasher, bug finders/scenarios, forensics persistence (with the DB1/DB2 defects), auth (login/refresh/reset), distributed queue + worker + AuthVault + bridges, session lifecycle, console/network log batching (the healthy part of persistence), `registryReconciler` (5-min interval, **not** dead), `Modal` focus trap (a11y-correct).

**Partial / conditional:** target health monitor (built, off by default — prior R1, re-verified); route-exhaustion threshold (`isErrorState` live, `exhausted`/threshold path dead — EX1); forensic telemetry repo (only `create`+`findLatest` live; `updateMetrics`/`addLoadTime` dead — DB6); non-auth queue retry (`attempts:2` wired but not idempotent — BK5); reconnect UX (no terminal state — FE6).

**Dead / unused (new + confirmed):**
- `developer-dashboard/src/components/telemetry/TelemetryStream.tsx` — no importer (FE13).
- `ForensicTrail.tsx` + `ReproductionTrail.tsx` — unreachable, yet in the current working set (FE14).
- `TelemetryLogStream.tsx` — exported, never consumed (FE15); `CoverageProgressBar` default export unused (FE16).
- `testing-core/src/domain/services/SeededRandomGenerator.ts` — whole file, no importer (EX8).
- `StateGraphNavigator.handleRouteExhaustion` + `routeExhausted` param — production-unreachable (EX3).
- `FindingModel` (`findings` collection) — self-labeled deprecated, still index-synced, **not** in cascade/reaper (DB14).
- Dead repo methods + their indexes on forensic collections (DB15); `timingSafeEqual` branch in `rotateRefreshToken` (BK2); binary-frame stack (prior DC1); crash sentinels in `ExplorationLoop` (prior M3, re-verified).

**Prior findings re-verified as still-holding:** M3, M4, BD1 (and broader), F3, E1, R2, R1.

---

## Findings

Each: **Severity · Module/file:line · Root cause · Impact · Fix · Priority.**

### A. Persistence write & lifecycle (database)

> Corrects prior D1. The schema *shape* is good and read shapes are indexed, but the **write and lifecycle boundaries** are the weakest layer in the system.

**DB1 — Forensic attribution (`bugClass`/`scenario`/`cwe`) silently dropped at the repository boundary; its index is dead. Severity: High** *(verified independently)*
- Module: `ForensicErrorRepository.ts:10-26, 33-49, 57-74` vs `StabilityMonitor.ts:316-317, 470-472, 621-622` (produces them), `ForensicErrorModel.ts:111-126, 140` (declares fields + index), `registerRoutes.ts:1124-1126` (reads them).
- Root cause: `CreateForensicErrorParams` and both `create()`/`createMany()` enumerate fields explicitly and omit the three attribution fields; the `create({ forensicRunId, ...params })` spread type-checks but the fields never reach the document.
- Impact: the knowledge-base classification the engine computes is **never persisted** — the forensic report always renders empty `bugClass`/`scenario`/`CWE`, and the `{forensicRunId:1, bugClass:1}` index costs writes for a perpetually-null field. Core product value (defect classification) is silently lost between compute and storage.
- Fix: add the three fields to `CreateForensicErrorParams` and copy them in both `create()` and `createMany()`.
- Priority: **Immediate** (localized, high-value).

**DB2 — Per-event forensic write amplification; batch method unused; writes uncapped. Severity: High**
- Module: `ExplorationEngine.ts:1273-1284` (`create()`→`.save()` per event), `StabilityMonitor.ts:464,680,922,1143,1312`; `ForensicErrorRepository.createMany:57-77` has no callers; read cap `queryLimits.ts:3` (`MAX_FORENSIC_ROWS=5000`).
- Root cause: forensic errors persist one document per event, fire-and-forget; the batch path is dead and there is no per-run write cap.
- Impact: an error-spewing target produces one Atlas insert per event during exploration (the write bottleneck the buffer design avoids elsewhere), and a pathological run writes unbounded rows that reads then silently truncate at 5000.
- Fix: buffer per-run errors and flush via `createMany` (mirror the console/network path in `StartExplorationUseCase.ts:418-419`); cap persisted rows per run.
- Priority: Short.

**DB3 — Retention reaper opt-in (default OFF) while TTL is always ON → guaranteed orphan accumulation. Severity: High**
- Module: `SessionModel.ts:381-388` (TTL registered unconditionally) vs `index.ts:140` (reaper gated on `BUGSAFARI_ENABLE_RETENTION_REAPER==='true'`).
- Root cause: MongoDB TTL does not cascade; the cascade reaper that compensates is off by default.
- Impact: in any deployment missing the flag, expired sessions leave their `forensic_errors`/`telemetry`/`analysis`/`console_logs`/`network_logs`/`brain_configs` children orphaned forever. Concretely refutes the prior "reaper working" claim (true only with a non-default flag).
- Fix: make the reaper on-by-default (opt-out), or fail-loud at boot when TTL is active but neither the reaper nor an external `db:reap` cron is present.
- Priority: Short.

**DB4 — `manualSaveToHistory` clobbers real termination status/outcome. Severity: Medium**
- Module: `StartExplorationUseCase.ts:343-352` vs `MongoFindingRepository.ts:79-89`, read at `registerRoutes.ts:1078-1079`.
- Root cause: save force-sets `status: COMPLETED` + `endedReason:'Manually saved by operator'` and never writes `outcome`, overwriting `markSessionTerminated`.
- Impact: a crashed/timed-out run saved by the operator reads back as `Completed` while `outcome` still says `target-crash`/`timebox` — the report ships inconsistent status.
- Fix: preserve terminal `status`/`outcome`; on save only set `savedManually`/counts/metrics.
- Priority: Short.

**DB5 — `fallback-create` save path orphans the run's in-flight forensic children. Severity: Medium**
- Module: `StartExplorationUseCase.ts:395-398, 418-419`.
- Root cause: when update-in-place returns null (e.g. `userId` miss) the save mints a **new** session `_id` and attaches new logs to it, but `forensic_errors`/`telemetry` written during the run are keyed to the original `sessionId`.
- Impact: the report (read by the new id) shows empty errors/telemetry; the real children orphan, dependent on the default-off reaper (DB3).
- Fix: never mint a new id on save — resolve and reuse the run's session id, or re-point children.
- Priority: Short.

**DB6 — Telemetry insert-new-per-call, never upserted; only latest row read; update methods dead. Severity: Medium**
- Module: `ExplorationEngine.ts:783,1090,1309` (create per call) vs `registerRoutes.ts:1099` (`findLatestByForensicRunId`); dead `ForensicTelemetryRepository.updateMetrics`/`addLoadTime:57-94`.
- Impact: each run leaves N-1 dead telemetry rows written/indexed/never read; the `loadTimes` accumulation the schema was built for never happens.
- Fix: upsert one telemetry doc per run (`findOneAndUpdate … upsert:true`) via the existing update methods, or delete them.
- Priority: Short.

**DB7 — `autoIndex:false` in prod + manual-only index sync = index intent unenforced at deploy. Severity: Medium**
- Module: `mongooseClient.ts:36`, `scripts/sync-indexes.ts`; no CI/Dockerfile/startup hook invokes it.
- Impact: any deploy that changes an index but skips the manual `db:sync-indexes` step leaves compound-index queries doing collection scans, silently. The D1 "indexes cover the queries" claim holds only if a human runs the script post-deploy.
- Fix: invoke `syncIndexes()` on boot (guarded, non-fatal) for the small model set, or wire it into the release pipeline.
- Priority: Short.

**DB8 — `syncIndexes()` does not propagate env-driven TTL changes. Severity: Medium**
- Module: `SessionModel.ts:373-388` (TTL `expireAfterSeconds` read at schema-build), `sync-indexes.ts:49` (reconciles keys, not TTL on an existing index).
- Impact: once `unsaved_sessions_ttl` exists, changing `BUGSAFARI_UNSAVED_SESSION_TTL_SECONDS` is silently ignored (needs `collMod`); operators think retention changed when it didn't.
- Fix: detect the TTL diff and `collMod` it in the sync script.
- Priority: Long.

**DB9 — Reaper `distinct()` unbounded, scans full collection hourly. Severity: Low**
- Module: `retentionReaper.ts:27,33,39,45,51,57` — `distinct('forensicRunId')` returns every run id ever (saved included), bounded only by the 16 MB BSON ceiling; cost grows with lifetime history, not orphan backlog.
- Fix: drive the sweep off session TTL deletions (change-stream / pending-reap marker) or batch with `allowDiskUse`.
- Priority: Long.

**DB10 — Multi-document save non-atomic. Severity: Low**
- Module: `StartExplorationUseCase.ts:386-419` — session upsert → network insert → console insert as separate awaits, no transaction. A crash between leaves a saved session with partial logs. Fail-soft by design.
- Fix: acceptable to leave; if tightened, `withTransaction`.
- Priority: Long.

**DB11 — Raw target response bodies stored plaintext, unbounded. Severity: Low**
- Module: `ForensicErrorModel.ts:80-83` (`responseText`), written at `ForensicErrorRepository.ts:44` with no length cap; `message`/`stackTrace` likewise.
- Impact: target responses can carry tokens/PII from the tested app, persisted verbatim.
- Fix: cap `responseText` length and redact obvious secret patterns before persist.
- Priority: Short.

**DB12 — Non-`lean()` reads hydrate full docs for a read-only report. Severity: Low**
- Module: `ForensicTelemetryRepository.findLatestByForensicRunId:49-52`, `ForensicAnalysisRepository.findByRunId:47-53` (unlike error/console/network repos which use `.lean()`).
- Fix: add `.lean()` to both.
- Priority: Long.

**DB13 — Duplicate cascade-delete mechanisms; repo `deleteByRunId` methods dead. Severity: Low**
- Module: `retentionReaper.ts:25-58` reimplements `deleteMany` per child while `ForensicErrorRepository.deleteByRunId:186-191` / `ForensicAnalysisRepository.deleteByRunId:106-111` exist unused.
- Fix: have the reaper call the repo methods, or delete the dead ones.
- Priority: Long.

**DB14 — Dead `findings` collection not in cascade/reaper → permanent orphans. Severity: Info**
- Module: `FindingModel.ts:1` (self-labeled deprecated, no writers), still index-synced (`sync-indexes.ts:30`), absent from `retentionReaper` `CHILD_COLLECTIONS` and `deleteSessionCascade`.
- Fix: drop collection + model, or add to cascade+reaper if legacy data must be cleaned.

**DB15 — Dead repository methods and their write-costing indexes. Severity: Info**
- Module: unused (grep-verified) `ForensicErrorRepository.{findByType,findBySeverity,getCountByType,getCountBySeverity,deleteByRunId,createMany}`, `ForensicAnalysisRepository.{findLatest,findByRiskLevel,findHighRisk,getStats,deleteByRunId}`, `ForensicTelemetryRepository.{findByForensicRunId,updateMetrics,addLoadTime}`; dead indexes `forensic_errors {…,type:1}`/`{…,severity:1}` (`ForensicErrorModel.ts:135-136`), `forensic_analysis {riskScore:-1}`/`{riskLevel:1,createdAt:-1}` (`ForensicAnalysisModel.ts:69-70`).
- Fix: prune unused methods + indexes; keep `{forensicRunId:1,createdAt:-1}` (real read shape).

### B. Backend (auth / queue / worker / session / socket)

**BK1 — Refresh-token rotation is a non-atomic read-modify-write; race defeats single-use + reuse detection. Severity: High**
- Module: `refreshTokenService.ts:66-97`.
- Root cause: `findOne({tokenHash})` → check `revokedAt` → separate `updateOne(revokedAt:'rotated')` + `mintPair`. Read and revoke are not atomic.
- Impact: two concurrent presentations of the same valid refresh token both pass the check before either write lands, so both mint successors and neither trips the family-burn reuse path. The single-use guarantee — the entire security value of rotation — is void under concurrency; the frontend `inFlight` dedup only serializes one tab.
- Fix: atomic consume-and-revoke — `findOneAndUpdate({tokenHash, revokedAt:{$exists:false}}, {$set:{revokedAt:new Date(), revokedReason:'rotated'}})`; if null while the hash row exists revoked, burn the family. The unique index on `tokenHash` supports this.
- Priority: Short (highest-value backend fix).

**BK2 — Dead/misleading "constant-time" check in `rotateRefreshToken`. Severity: Info**
- Module: `refreshTokenService.ts:70-75` — after an exact `tokenHash` `findOne`, the `timingSafeEqual` can never fail; no timing side channel on an indexed hash lookup.
- Fix: delete the branch.
- Priority: Long.

**BK3 — `verify-fix` guarded by a process-global flag with no timeout. Severity: Medium**
- Module: `registerSocketHandlers.ts:36, 223-243`.
- Root cause: `verificationInProgress` is one module-level boolean across all sockets/tenants; `regressionVerifier.verify()` awaited with no timeout, flag cleared only in `finally`.
- Impact: (1) cross-tenant denial — one operator's verification makes everyone else's return "already in progress"; (2) if the replay browser hangs, `finally` never runs and verification is disabled process-wide until restart.
- Fix: bound `verify()` with `Promise.race` that always releases the flag; key the guard per userId or use a serialized queue.
- Priority: Short.

**BK4 — Redundant user lookup on every refresh (double DB read). Severity: Low**
- Module: `authRefreshController.ts:35-40` vs `refreshTokenService.ts:88-89` — rotation already loads the user to sign the token; the controller reloads the same user.
- Fix: return `email` in `RotationResult.ok`; drop the second lookup.
- Priority: Long.

**BK5 — Non-auth queued jobs retry the full exploration into the same runId/room. Severity: Medium**
- Module: `TaskQueue.ts:46-48, 88-92`, `SafariWorker.ts:127-207, 253`, `StartExplorationUseCase.ts:396`.
- Root cause: auth-target jobs get `attempts:1` (vault is destructive), but others inherit `defaultJobOptions.attempts:2`. A failed attempt re-invokes `execute()` with the same `runId`, re-streaming telemetry and launching a second browser; the `failed` handler only reports on the final attempt, so the dashboard sees a silent restart. A no-auth authenticated-operator run also re-creates its session doc on the retry (duplicate unsaved session).
- Fix: `attempts:1` for all safari jobs (partial exploration isn't idempotently resumable), or detect an already-progressed `runId` and refuse; if retries are wanted, gate to pre-`execute` (routing/validation) failures only.
- Priority: Short.

**BK6 — `expiresIn` returned in milliseconds but shaped like the OAuth seconds convention. Severity: Low**
- Module: `refreshTokenService.ts:54` returns `ACCESS_TOKEN_TTL_MS` (1,800,000) named `expiresIn`; token signed `'30m'`.
- Impact: harmless only because the frontend ignores it and refreshes reactively on 401; any standards-following client treating `expiresIn` as seconds schedules refresh ~1.8M s out (never).
- Fix: return seconds or rename `expiresInMs`.
- Priority: Long.

**BK7 — `verifyTokenSync` casts decoded JWT without validating claim shape. Severity: Low**
- Module: `authConfig.ts:120-122` (`as unknown as AuthPayload`), consumed at `authMiddleware.ts:60`.
- Impact: a validly-signed token missing `userId` yields `request.userId===undefined`; downstream `new Types.ObjectId(undefined)` ownership filters throw rather than fail cleanly.
- Fix: assert `userId`/`email` are strings post-verify, else return null.
- Priority: Long.

**BK8 — Forensic report endpoint returns up to ~15,000 rows unpaginated. Severity: Low**
- Module: `registerRoutes.ts:1094-1101`, `queryLimits.ts:3` — errors+network+console each capped 5000, serialized into one JSON response (list routes are correctly paginated; this one isn't).
- Fix: paginate the three arrays via their per-run indexes, or lazy-load per dashboard tab.
- Priority: Long.

**BK9 — Worker treats `uncaughtException`/`unhandledRejection` as graceful shutdown without forcing exit. Severity: Low**
- Module: `worker-entry.ts:41-49` — both call `shutdown('SIGTERM')`, await `runtime.close()`, set `exitCode`, never `process.exit()`.
- Impact: after an uncaught error the process lingers on a possibly-corrupt loop; an in-flight job holds its BullMQ lock until the 10-min `lockDuration` stalls it.
- Fix: `process.exit(1)` (bounded timeout guard) after `runtime.close()` on fault paths so the supervisor restarts clean.
- Priority: Short.

**BK10 — `stalled` handler can tear down a run whose original processor is still executing. Severity: Medium**
- Module: `SafariWorker.ts:234-245`, `SessionManager.ts:296-315`.
- Root cause: BullMQ's `stalled` fires on lock lapse but Node doesn't abort the running processor; `publishRunFailure`→`failRun`→`endRun`/`teardownRun` destroys the live run's buffers/telemetry room while `execute()` still emits for that `runId`.
- Impact: emits land in a nulled room or interleave with the requeued attempt — a real state inconsistency (bounded today only by concurrency-1).
- Fix: on `stalled`, publish the dashboard notice but don't tear down state for a `runId` whose processor `finally` hasn't run; track completion in `claimsByJobId` and no-op if still active. Folds into the SC1 de-singleton work.
- Priority: Short.

### C. Frontend (React / socket / a11y)

> Buffers are correctly bounded (`appendCapped`, `collapseFaultIntoBuffer` cap 100) — **no** client memory leak from the stream. No `dangerouslySetInnerHTML` anywhere (positive). The gaps are resilience, render cost, and a11y.

**FE1 — No error boundary anywhere in the tree. Severity: High**
- Module: `main.tsx:19-27`, `App.tsx:183-193` (grep: zero `componentDidCatch`/`getDerivedStateFromError`).
- Impact: one render throw in any live panel (a telemetry event with an off `meta`, a null reaching `FindingEvidence`) unmounts the entire dashboard; because run state is in-memory, an unattended run's unsaved telemetry/reports/incidents are lost and the operator sees a blank page with no recovery.
- Fix: wrap the `/dashboard` route (and `ForensicReport`) in a route-scoped error boundary that preserves the shell and keeps socket/store alive so a remount rehydrates from the active-session snapshot.
- Priority: **Immediate**.

**FE2 — Whole-dashboard re-render on every socket event; no batch/throttle. Severity: High**
- Module: `useDashboardController.ts:152-185` (broad `useShallow` slice), `gatewayBinding.ts:14,20` (each telemetry/live-frame → `set()`).
- Root cause: every event yields a new array/frame reference so the slice changes on every message; `AuthAppContent` and `ClinicalForensicsDashboard` re-render per event including ~15 fps frames and every ACTION/HEURISTIC_SCORE.
- Impact: the exact render storm the console is meant to avoid — hundreds of reconciliations/sec on a busy target.
- Fix: throttle telemetry ingestion (~100 ms window / rAF for frames); split the frame path and log path into separate leaf components with narrow selectors.
- Priority: Short.

**FE3 — Index-as-key in live, reordering lists. Severity: Medium**
- Module: `ClinicalForensicsDashboard.tsx:453,483`, `ErrorTabPanel.tsx:156,170`, `TelemetryLogStream.tsx:60` — `key={index}` over sliding/regrouping buffers.
- Impact: when the buffer shifts or a repeated fault moves to the front, React re-associates DOM to the wrong data — an expanded stack trace jumps to a different error as events arrive; needless re-renders.
- Fix: use `findingView.ts:20`'s already-computed stable `key: liveFaultSignature(...)` for error cards; `timestamp+seq` for telemetry rows.
- Priority: Short.

**FE4 — LiveFeed allocates a new Image per frame; out-of-order draw race, no cleanup. Severity: Low-Medium**
- Module: `LiveFeed.tsx:163-179` — `new Image()` per `renderFrame` with `onload=draw`, no cleanup, no ordering guard.
- Impact: at ~15 fps churns an Image/frame; two decodes can resolve out of order (older frame paints after newer → stale flash); pending `onload` fires after unmount.
- Fix: one `Image` in a ref + generation counter; bail in `onload` if generation changed; clear `onload` in cleanup.
- Priority: Short.

**FE5 — Dead `fps` state in LiveFeed. Severity: Info**
- Module: `LiveFeed.tsx:53,146` — `fps`/`setFps` set but never rendered; fed only by the dead `useBinaryStream` branch (prior DC1). Fold into the DC1 deletion.

**FE6 — No `reconnect_failed` handler → UI stuck "Reconnecting…" forever. Severity: Medium**
- Module: `SocketConnectionManager.ts:73,186` — `reconnectionAttempts:10`, only `reconnect_attempt` bound; no `reconnect_failed`/`reconnect` listener.
- Impact: after 10 failed attempts Socket.IO gives up but `isReconnecting` never clears, so `ConnectionStatusOverlay` shows an infinite "attempt N" with no "connection lost, reload" state — operators can't tell a recovering run from a dead one.
- Fix: bind `reconnect_failed` → terminal disconnected state (offer reload); `reconnect` → clear it.
- Priority: Short.

**FE7 — Initial connection timeout silent to the store. Severity: Low**
- Module: `SocketConnectionManager.ts:151-156` — on the 10 s connect timeout sets local state but never calls `connectedHandler?.(false)`; store can't distinguish "never connected" from "connecting."
- Fix: notify the handler on timeout.
- Priority: Short.

**FE8 — Live telemetry/errors stream has no live region. Severity: Medium**
- Module: `ClinicalForensicsDashboard.tsx:440-508` (+ `ErrorTabPanel`/`TelemetryLogStream`) — no `aria-live`/`role="log"` (confirms prior U1 concretely).
- Impact: a screen-reader operator gets zero announcement when a crash lands or the engine action changes during an unattended run — the core real-time feedback is inaudible.
- Fix: `role="log" aria-live="polite" aria-relevant="additions"` on the telemetry list; `aria-live="assertive"` on the new-crash surface.
- Priority: Short.

**FE9 — Terminal tabs are not tabs. Severity: Medium**
- Module: `ClinicalForensicsDashboard.tsx:401-433` — Telemetry/Errors/Network/Console are plain `<button>`s, no `role="tab"/"tablist"/"tabpanel"`, no `aria-selected`, no arrow-key handling.
- Impact: SR users aren't told which is active; keyboard users can't arrow between tabs (WCAG 4.1.2).
- Fix: apply the ARIA tabs pattern (roles + `aria-selected` + roving tabindex).
- Priority: Short.

**FE10 — Color-only signaling for severity/status. Severity: Low-Medium**
- Module: `ClinicalForensicsDashboard.tsx:455-460`, `TelemetryLogStream.tsx:62-69` (log color), status pill `:377-391` (color+pulse only).
- Impact: fails WCAG 1.4.1; the status pill has no non-color cue.
- Fix: add a severity glyph/prefix and a text label to the status dot.
- Priority: Long.

**FE11 — Restore-path occurrence count rebuilt, not trusted. Severity: Low**
- Module: `runStore.ts:360-361` → `errorDeduplication.ts:82` sets `occurrences:(existing?.occurrences??0)+1`, discarding the incoming row's own count.
- Impact: after refresh/reconnect a fault that occurred 15× shows a count equal to replayed rows, not its true total — the live `×N` and restored `×N` disagree (the invariant the dedup module guarantees).
- Fix: seed `occurrences` from `max(incoming.occurrences, existing+1)` on hydrate.
- Priority: Long.

**FE12 — Production `console.log` in the store hot path. Severity: Low**
- Module: `runStore.ts:251` (per engine IDLE) + per-connect/cleanup logs; client-side variant of M2 shipping to end-user consoles.
- Fix: gate behind a debug flag / leveled client logger.
- Priority: Short.

**FE13–FE16 — Dead frontend components. Severity: Medium/Low**
- `TelemetryStream.tsx` (~210 lines, no importer) (FE13); `ForensicTrail.tsx` + `ReproductionTrail.tsx` (unreachable, yet "modified" in the working set) (FE14); `TelemetryLogStream.tsx` (exported, never consumed — a second copy of the `[type] message` slice-100 logic that can drift from the inline one) (FE15); `CoverageProgressBar` default export unused (only named `CoverageDisplay` used) (FE16).
- Fix: delete FE13/FE14; adopt-or-delete FE15; prune the FE16 default.
- Priority: Short.

### D. Exploration engine

> Verified still-holding from Pass 1: M3, M4, BD1 (and broader — `noSqlInjection.ts:44-47` scans the whole `body.innerText` for a Mongo pattern, so a page merely *displaying* Mongo-ish text yields a CRITICAL), F3, E1, R2.

**EX1 — RouteExhaustionTracker's consecutive-threshold design is dead; the loop excludes on a single hit. Severity: High**
- Module: `RouteExhaustionTracker.ts:63-99` vs consumer `ExplorationLoop.ts:791`.
- Root cause: the tracker computes `consecutiveErrorStates`/`exhausted`/`threshold` (default 2) and documents "either recurs for `threshold` consecutive steps," but the only production consumer reads `routeVerdict.isErrorState`, true on the first occurrence; the threshold fields are exercised only by the unit test.
- Impact: the intended "tolerate one, act on a sustained run" hysteresis doesn't exist in the running engine; a single step trips exclusion from the graph, clusters, and visited sets. Threshold tuning is inert.
- Fix: gate exclusion on `routeVerdict.exhausted` (match the doc), or delete the threshold machinery and document first-hit. Don't ship both.
- Priority: Short.

**EX2 — `routeCollapse` mislabels legitimate same-shell-different-route SPA pages as error states. Severity: High**
- Module: `RouteExhaustionTracker.ts:69-75` → `ExplorationLoop.ts:791-793` → `handleErrorState`.
- Root cause: `routeCollapse = prevStructureHash===structureHash && routePath!==prevRoutePath`. Two distinct routes sharing one normalized shell (`/products/1`→`/products/2`, master-detail, tabbed views) satisfy it — and `domHasher` deliberately strips digit-runs/ids, *increasing* collapse odds on data-driven SPAs. Combined with EX1 (first hit), the second page is declared an error state.
- Impact: false-negative coverage — a real reachable non-error state is excluded from graph and backtracking, and raises a spurious broken-route defect (`observeErrorState`, `ExplorationLoop.ts:1139-1146`).
- Fix: require HTTP-status corroboration or the `exhausted` consecutive run before treating a route-collapse as an error state; exclude same-shell transitions whose main-frame status is a healthy 2xx/null.
- Priority: Short.

**EX3 — Navigator's `routeExhausted` path (`handleRouteExhaustion`) is production-dead. Severity: Medium**
- Module: `StateGraphNavigator.ts:116-122,161-163,409-431` — the 5th `routeExhausted` param is passed only by two navigator tests; the loop caller (`decidePathfinderAction:973-978`) passes 4 args (defaults `false`), and error states are excluded upstream before ever registering as nodes.
- Impact: ~25 lines of unreachable frontier/cyclic-marking logic that misleads readers into thinking route-exhaustion is handled at the graph layer.
- Fix: remove the param/method, or wire the loop to route exhaustion through the navigator instead of pre-excluding — pick one model.
- Priority: Short.

**EX4 — Confirmed-bug IDs use `Math.random()`+`Date.now()`, bypassing the seeded RNG. Severity: Medium (reproducibility)**
- Module: `ActionExecutor.ts:1007,1047` — `` bugId:`fuzz-…-${Date.now()}-${Math.random().toString(36).slice(2,8)}` ``.
- Root cause: the engine routes determinism through `scenarios/seededRandom.ts` + `EdgeSelector`'s mulberry32 (`ExplorationEngine.ts:268-274`), but these ID sites use raw `Math.random`/`Date.now`.
- Impact: even in seeded mode every finding's `bugId` differs run-to-run, and `registerConfirmedBug` dedups by `bugId` (`ExplorationEngine.ts:338-341`) — so a deterministic replay produces non-matching forensic bundles, defeating "same seed → same bundle" and cross-run diffing.
- Fix: derive the ID from stable fault content (`buildFaultSignature` / payload+selector+bugClass hash) or draw the suffix from `scenarioRandom()`; drop `Date.now()` from identity.
- Priority: Short.

**EX5 — `triggerFormSubmission` can submit the same form 2–3× on network-only SPAs. Severity: Medium**
- Module: `formSubmitter.ts:30-34,50-117` — the change oracle is `location.href + querySelectorAll('*').length`; a submit that fires a `fetch` + toast without changing element count or URL reads as "unchanged," so the ladder (Enter → submit-click → synthetic `submit`) re-commits.
- Impact: duplicate state-changing backend writes during fuzzing; muddies attribution and can manufacture double-submit effects other finders then flag.
- Fix: gate ladder escalation on an actual outbound-request signal (`hadNetworkActivitySinceAction` already tracked), short-circuit once a request is seen.
- Priority: Short.

**EX6 — `visitedUrls`/`visitedStructures` unbounded and query-sensitive; only `visitedHashes` capped. Severity: Medium**
- Module: `ExplorationEngine.ts:105-109`; eviction only for `visitedHashes` (`ExplorationLoop.ts:835-838`).
- Root cause: `visitedUrls.add(page.url())` stores the full URL incl. query string (unlike the route-normalized hash); `visitedStructures`/`firstVisitRevealed` also grow unbounded.
- Impact: (a) memory growth on query-volatile SPAs (cache-busters, pagination); (b) the URL half of `revisitedPage` never matches, degrading revisit detection to hash-only; `getVisitedRoutes` reports thousands of near-duplicate routes (sliced to 500, so real distinct routes may be truncated out).
- Fix: normalize `visitedUrls` via `normalizeRoutePath` before storing and cap it like `visitedHashes`; bound the others.
- Priority: Short.

**EX7 — `constraintBypassFinder` shares BD1's coincidental-request false-positive shape. Severity: Medium**
- Module: `bugs/finders/constraintBypass.ts:117-137` — flags the first state-changing (`POST/PUT/PATCH/DELETE`), same-origin, `<400` response in the 1200 ms window as "server accepted invalid input," with no correlation to the fuzzed field's endpoint.
- Impact: false-positive CLIENT_SIDE_CONSTRAINT_BYPASS from a concurrent autosave/telemetry write. Same root defect as BD1, not covered by BD1's fix scope.
- Fix: correlate the accepted response to the submitted request (match the form action/endpoint) or verify payload reflection; reuse the BD1 fix.
- Priority: Short.

**EX8 — `SeededRandomGenerator` class is dead code. Severity: Low**
- Module: `domain/services/SeededRandomGenerator.ts` (whole file, no importer) — determinism is actually delivered by `scenarios/seededRandom.ts` + `EdgeSelector`'s inline mulberry32; its own doc misleadingly claims it's "critical for thesis panel reproducible runs."
- Impact: a future contributor may wire randomness through it, splitting the deterministic stream.
- Fix: delete it, or make it the single shared PRNG both consumers use (removing the duplicated mulberry32).
- Priority: Long.

**EX9 — Semantic submit-button matching uses substring `includes`. Severity: Low**
- Module: `formSubmitter.ts:85-88,144-147` — `label.includes(tk)` on tokens `send`/`next`/`save`/`accept` fires on `resend`, `Save for later`, `Accept cookies`, so the ladder may click the wrong control.
- Impact: mis-submission and mis-narrated reproduction steps.
- Fix: word-boundary match (reuse `perceptron.ts:257-265`'s `wordBoundaryMatch`); prefer explicit `type=submit` (already done) and tighten the semantic fallback.
- Priority: Long.

**EX10 — Stagnation `forceBacktrack` threshold is inert in the two default modes. Severity: Info**
- Module: `ExplorationLoop.ts:977` → `StateGraphNavigator.ts:198-214` — `prioritizeUnvisitedOverBoredom` (set on exploration + coverage presets, `config.ts:229,240`) defers forced backtracks whenever any unvisited edge remains, so the graduated stagnation-penalty apparatus (`stagnationScoring.ts`) never affects the backtrack decision in the modes most runs use.
- Impact: not a bug, but the threshold is a no-op in default modes; operators may tune a knob that does nothing.
- Fix: document the interaction, or allow a hard stagnation ceiling to override the defer.
- Priority: Long.

### E. Cross-cutting (architecture / build / contracts / quality)

**A1 — Frontend re-declares `shared/` contract types instead of importing them (shadow definitions). Severity: High**
- Module: `shared/types/console.ts:8,11` vs `developer-dashboard/src/application/ports/EngineGateway.ts:3,6` and `developer-dashboard/src/types.ts:82,85` — `BrowserConsoleLevel`/`BrowserConsoleMessage` defined three times.
- Impact: contract drift the compiler can't catch — a field added in `shared` won't exist on the frontend copies. Exactly the failure mode `shared/` exists to prevent.
- Fix: delete both frontend copies; import from `shared/types.js`; reject new frontend-local mirrors of shared shapes.
- Priority: Short.

**A2 — `EngineGateway` port missing its own control methods; callers bypass with `as any`. Severity: High**
- Module: `EngineGateway.ts:69` (only `startTest`) vs `runCommands.ts:85,90,119` (`(getEngineGateway() as any).pauseTest()/.resumeTest()/.stopTest()`).
- Impact: DIP violation on the frontend's one architectural seam; `as any` disables type-checking on control commands and the port no longer describes the gateway's real surface — a fake abstraction.
- Fix: add `pauseTest`/`resumeTest`/`stopTest` to the interface; delete the three casts.
- Priority: Short.

**A3 — `@bugsafari/shared` workspace package is decorative; both sides deep-relative-import its source. Severity: Medium**
- Module: `shared/package.json` (name `@bugsafari/shared`, no `main`/`exports`/`scripts`) vs consumers using `../../../../shared/types.js`.
- Impact: the package identity and workspace membership do nothing; fragile four-level relative paths are the only channel enforcing the boundary, with no alias to lint against.
- Fix: either give `shared` a real `exports` map + build and import by name, or drop the pretense and treat it as a plain sibling folder. Pick one.
- Priority: Short.

**A4 — `testing-core` compiles with `rootDir:".."`, producing a nested `dist/testing-core/src/...` the Dockerfile hard-codes. Severity: Medium**
- Module: `testing-core/tsconfig.json:12`, `Dockerfile:28` (`CMD ["node","testing-core/dist/testing-core/src/index.js"]`).
- Impact: brittle output layout — the entrypoint leaks the source tree shape; the `include` set (only `../shared/types.ts`) doesn't describe the real graph (code imports `shared/reproduction.ts`, `url.ts`, `faultSignature.ts`, `types/*`).
- Fix: build `shared` as its own emitted package (ties to A3) so `testing-core` keeps `rootDir:"src"`; drop the redundant `src/domain/**` include.
- Priority: Short.

**B1 — Frontend app is NOT type-checked in strict mode. Severity: High**
- Module: `developer-dashboard/tsconfig.app.json` — no `strict`, `noUnusedLocals:false`, `noUnusedParameters:false` (`:20-21`); `grep strict tsconfig*.json` → 0.
- Impact: the whole dashboard compiles with implicit `any`, no `strictNullChecks`, dead locals allowed — contradicting the project's strict-contract premise; the `as any` casts (A2) and null bugs go unflagged. Backend strict, frontend not — two halves of one contract held to different standards.
- Fix: `"strict": true` (+ re-enable unused checks) in `tsconfig.app.json`; fix the resulting null-safety wave. Do this **before** A1/A2 so the compiler enforces them.
- Priority: **Immediate** (config one-liner; fallout is the work).

**B2 — `docker-compose.local.yml` build fails on `npm run build --workspace shared` (no such script). Severity: High**
- Module: `docker-compose.local.yml:43,110`; `shared/package.json` has no `scripts`.
- Impact: a clean `docker compose -f docker-compose.local.yml build` errors "Missing script: build" for both `api` and `worker` — the documented local topology has a broken reproducible build (root `Dockerfile:19` survives via `--if-present`; compose dropped it).
- Fix: add `--if-present` or give `shared` a real `build` (ties A3).
- Priority: **Immediate**.

**B3 — Dockerfile and compose diverge (base image, install flags). Severity: Medium**
- Module: `Dockerfile:2` (`playwright:v1.60.0-jammy`) vs `docker-compose.local.yml:34,101` (`…-noble`); root `npm ci` (all workspaces) vs compose `--workspace testing-core --include-workspace-root`.
- Impact: local and image runtimes are different OS bases and dependency closures — "works in compose" ≠ "works in the built image."
- Fix: single source — compose `build.dockerfile: Dockerfile` or a shared build stage; pin one base tag.
- Priority: Short.

**B4 — Env-var sprawl with no committed catalog. Severity: Medium**
- Data: 48 `process.env` reads in `testing-core/src`; 15 `BUGSAFARI_*` flags + `MONGODB_URI/JWT_SECRET/JWT_EXPIRES_IN/REDIS_URL/RUN_ENVIRONMENT/SMTP_*/HOST_GATEWAY_IP/PLAYWRIGHT_BROWSERS_PATH`; frontend `VITE_BUGSAFARI_API_URL/SOCKET_URL`; no `.env.example` committed.
- Impact: no discoverable list of what's configurable or defaults; operators can't know the health-monitor knobs or that `USE_QUEUE=1` is mandatory for prod (SC2).
- Fix: commit `.env.example` per package with defaults, and/or a single validated `config.ts` the rest of the code imports.
- Priority: Short.

**B5 — Inconsistent module-specifier extensions on `shared` imports (`.ts` vs `.js`). Severity: Low**
- Data: `shared/types.js` ×54 vs `.ts` ×10, `shared/reproduction.{js,ts}` mixed; survive only because they're `import type` (erased) under NodeNext.
- Impact: a copy-paste of a `.ts` type import into a value import ships a runtime `ERR_MODULE_NOT_FOUND`.
- Fix: normalize every `shared` specifier to `.js`; add a lint rule.
- Priority: Short.

**Q1 — Two fuzzing files carry raw NUL bytes and are invisible to code search. Severity: Medium**
- Module: `domain/scenarios/networkSaboteur.ts` (NUL at byte 4199, in a payload template) and `domain/scenarios/fuzzing/payloadEscalator.ts` (NUL at 3079, in `STRUCTURE_BREAKERS`) — literal `\0` bytes instead of `\x00` escapes.
- Impact: ripgrep/grep classify both as binary and silently skip them — a whole scenario + the escalation payload table are dark to code search, refactors, and audit sweeps (they escaped Pass 1's counts).
- Fix: replace literal NULs with `\x00` escapes (identical behavior, searchable); add a CI check rejecting NULs in `src`.
- Priority: Short.

**Q2 — `@ts-expect-error` papering over an under-typed user model. Severity: Low**
- Module: `presentation/authentication/userSettingsController.ts:64,66,126,128` — four suppressions on `user.name` "may exist from schema extensions."
- Fix: add `name` to the user schema/type; delete the four suppressions.
- Priority: Short.

**Q3 — Sweep baseline (whole repo).** TODO/FIXME/HACK/XXX: effectively 0 tracked debt tags (clean). `as any`: 15 total (notable: A2 gateway ×3, `ErrorTabPanel.tsx:162,176` `(… as any).aiDiagnostics` — see FR2, `scenarios/index.ts` signature erasure ×4, M4). `eslint-disable`: 5. No truly empty `catch {}` (0); ~140 swallow-catches, the bulk intentional best-effort in probe/fuzz layers — acceptable, but a lint rule should require swallow-catches in `application/`/`presentation/` to at least debug-log. Non-null `!`: ~6, not systemic. Severity: Info.

**T1 — Zero automated tests for the entire frontend and the `shared` contract layer. Severity: High**
- Data: 51 test files, **all** under `testing-core/src`; `developer-dashboard/src` and `shared` → **0**.
- Impact: the whole operator console (auth, stores, socket gateway, forensic rendering) plus every `shared` contract has no regression net — on the exact side that (B1) also isn't strict-checked, and where the highest-drift-risk code lives (A1/A2).
- Fix: stand up Vitest + React Testing Library in the dashboard; start with `shared` pure functions (`reproduction.ts`, `url.ts`, `faultSignature.ts`) and the stores; add contract round-trip tests so shadow-type drift (A1) fails a test.
- Priority: Short.

**T2 — Load-bearing backend god-files have no direct unit test. Severity: Info/advisory**
- Module: `ExplorationLoop.ts` (only boundary/termination tests, not the core step loop), `registerRoutes.ts` (59 KB, 14+ routes), `StabilityMonitor.ts` (60 KB), `PlaywrightBrowserEngine.ts` — untestability is a symptom of their size (prior M1); the M1 split is the enabling fix.
- Priority: Long (unblocked by M1).

**DO1 — Stale audit/session docs accumulating at repo root. Severity: Low**
- Data: 18 root `.md` docs incl. `CODEBASE_AUDIT_2026-07-13.md` (self-labeled stale), `BUG_ANALYSIS_SESSION_20260713.md`, `SESSION-CHANGES-2026-07-10.md`, `ALL_FILES_CODEBASE.md`, `FORENSIC_REPORT_CONTENT_IMPROVEMENTS_2026-07-13.md`.
- Impact: dated point-in-time docs masquerade as current guidance; `ALL_FILES_CODEBASE.md` rots immediately.
- Fix: move superseded audits/logs to `docs/archive/` or delete; keep living docs (CLAUDE.md, README_LOCAL_DEV.md, BUGSAFARI_BLUEPRINT.md, FUNCTIONAL_REQUIREMENTS.md, SETUP_DISTRIBUTED.md, this file).
- Priority: Short.

**FR1 — No production runtime configuration; only a dev compose. Severity: Medium**
- Module: `docker-compose.local.yml` sets `NODE_ENV=development` and a hardcoded `JWT_SECRET=bugsafari-local-development-secret` for both services; no prod compose/manifest.
- Impact: the SC2 "prod must run `USE_QUEUE=1` + fleet" guidance has no enforcing artifact; the only runnable stack is dev-mode, which also disables the prod JWT hard-fail path. Anyone deploying reaches for the dev compose.
- Fix: add `docker-compose.prod.yml` (or document the target orchestrator) — `NODE_ENV=production`, secret-injected `JWT_SECRET`, `USE_QUEUE=1`, ≥1 worker; reconcile with B2/B3.
- Priority: Short.

**FR2 — `aiDiagnostics` consumed by the frontend is not part of the `shared` contract. Severity: Low**
- Module: `ErrorTabPanel.tsx:162,176` read `(incident/report as any).aiDiagnostics` — an output field the UI depends on is untyped end-to-end; the "AI/heuristic analysis" surface (prior F1) isn't modeled in `shared`.
- Fix: add `aiDiagnostics` to the relevant `shared` type and drop the casts (couples with the prior-audit F1 rename).
- Priority: Short.

---

## Prioritized roadmap

### Immediate fixes (this iteration, low risk, high value)
1. **DB1** — copy `bugClass`/`scenario`/`cwe` into `create()`/`createMany()` so classification actually persists.
2. **FE1** — add a route-scoped error boundary around `/dashboard` and `ForensicReport`.
3. **B1** — enable `"strict": true` in `tsconfig.app.json` (config one-liner; then fix the null-safety fallout).
4. **B2** — restore `--if-present` (or add a `shared` build script) so the local compose build stops failing.
5. Delete the dead code with no dependents: **EX8** `SeededRandomGenerator.ts`, **FE13/FE14** dead components, **BK2** the fake constant-time branch, plus the prior M3/M4/DC1 leftovers.

### Short-term improvements (next 1–2 iterations)
1. **Persistence write-path cluster (do together): DB2** batch+cap forensic writes, **DB3** reaper on-by-default (or fail-loud), **DB4/DB5** stop clobbering terminal status and orphaning children, **DB6** upsert telemetry, **DB7** enforce index sync at deploy, **DB11** cap/redact stored response bodies. Highest-value backend work — it repairs data integrity and lifecycle.
2. **Reproducibility + coverage-honesty cluster: EX4** stable content-derived bug IDs, **EX1+EX2** fix the route-exhaustion first-hit false-exclusion, **EX5/EX6/EX7** form double-submit oracle, unbounded `visitedUrls`, constraint-bypass correlation. Directly repairs how far results can be trusted (extends the prior F1/F2/F3/BD1 cluster).
3. **Contract/boundary cluster: A1** delete shadow types, **A2** complete the `EngineGateway` port, **A3/A4** decide the `shared` package model, **B5** normalize `.js` specifiers, **FR2** model `aiDiagnostics`. Restores the monorepo's core contract guarantee — sequence after B1 so the compiler enforces it.
4. **BK1** atomic refresh rotation; **BK3** bounded/per-tenant verify-fix guard; **BK5** `attempts:1` for safari jobs; **BK9** force worker exit on uncaught; **BK10** don't tear down a still-running run on `stalled`.
5. **Frontend resilience/perf/a11y: FE2** throttle ingestion + split selectors, **FE3** stable keys, **FE4** LiveFeed frame race, **FE6/FE7** terminal reconnect state, **FE8/FE9** live regions + ARIA tabs, **FE12** gate client logs.
6. **T1** stand up frontend/shared tests (Vitest + RTL), starting with `shared` pure functions and the stores.
7. **Q1** de-NUL the two fuzzing files; **Q2** type `user.name`; **DO1** archive stale docs; **B3** unify Docker build; **B4** commit `.env.example`; **FR1** add a prod compose.

### Long-term enhancements
1. **SC1/SC2** (prior) de-singleton run state — still the top scalability lever; **BK10** folds into it.
2. **DB8** propagate TTL env changes; **DB9** bound the reaper sweep; **DB12** `.lean()` read repos; **DB13** unify cascade delete; **DB14/DB15** prune the dead `findings` collection, methods, and indexes.
3. **EX3** resolve the navigator route-exhaustion model; **EX9** word-boundary submit matching; **EX10** document/override the inert stagnation threshold; prior **E1/R2/DH1**.
4. **T2** unit-test the god-files after the **M1** splits; add the swallow-catch lint rule for app/presentation.
5. **FE10/FE11** non-color severity cues, hydrate-safe occurrence counts; prior **U1/U2**.
6. **BK4/BK6/BK7/BK8** refresh double-lookup, `expiresIn` unit, JWT claim validation, forensic-report pagination.

### Future functional requirements (product-level)
1. **Persisted, trustworthy coverage + classification** — once DB1 and the EX coverage fixes land, surface real `bugClass`/`CWE`/scenario and boundary-saturated-vs-graph-exhausted in the report (extends prior FR set).
2. **Deterministic replay bundles** — with EX4's stable IDs, export a run's seed + action timeline so a finding reproduces bit-for-bit.
3. **Multi-run orchestration UI** — after SC1, one operator watching several concurrent safaris.
4. **Contract-tested SDK boundary** — a real `@bugsafari/shared` package with round-trip contract tests as the single source of truth for both sides.

---

## Bottom line

Pass 1's verdict was "structural, not corrective — de-singleton, harden auth/headers, tame the big files." Pass 2 sharpens that: the engine is sound, but **the boundaries around it are where the real defects live.** The persistence write path silently loses classification and orphans data (DB1–DB5); the frontend is undefended, unchecked, and untested (FE1/FE2/B1/T1); the contract seam is bypassed by shadow types and `as any` (A1/A2); the build of the documented local stack is broken (B2); and reproducibility/coverage still leak trust (EX1/EX2/EX4). None is a happy-path data-loss or auth-bypass defect, but together they mean the system's outputs are **less complete and less trustworthy than the strong engine implies.** The next phase should harden the write path, the frontend, and the contract/build seams — in that order.
