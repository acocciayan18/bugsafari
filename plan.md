# BugSafari Remediation Plan

> Derived from `REVIEWS.md`. Ordered for a subsequent `/goal` execution turn — each step is independently verifiable and low-blast-radius unless noted. Fix in order; do not skip ahead to dead-code removal before security fixes are verified.

## Phase 1 — Security fixes (do first, small diffs, high impact)
1. `authController.ts` password reset: hash the reset token before storing (reuse existing bcrypt helper) and compare hashes, not raw strings with `!==`.
2. `registerRoutes.ts` `POST /api/safari/stop`: require the same auth middleware used by `/api/start-test`, or at minimum scope the stop to the requesting user's own active session.
3. `authConfig.ts`: fail fast (throw on boot) if `NODE_ENV === 'production'` and `JWT_SECRET` equals the hardcoded dev fallback.
4. `index.ts` CORS: replace `cors()` / `origin: '*'` with an explicit allow-list read from env, or document why `*` is intentional (guest/public API) — confirm with user before changing behavior since it may be deliberate for a public demo deployment.
5. `historyService.ts:28-31`: remove the token-prefix `console.log`.

## Phase 2 — Concurrency / correctness fixes
6. `StartExplorationUseCase` + `registerRoutes.ts`: close the TOCTOU race — set `state.active = true` synchronously before any `await`, then roll back on failure. Add a test that fires two concurrent `POST /api/start-test` and asserts the second is rejected.
7. `PlaywrightBrowserEngine.ts:220-231`: replace the message-substring `TypeError` catch with a typed/tagged cancellation signal (e.g. an `AbortController` or a custom `SessionCancelledError`) so real null-deref bugs aren't misclassified as graceful stops.
8. `MongoFindingRepository.collectBugFindings`: add the missing `userId` filter to match sibling queries (fix now even though currently unreferenced, to remove the trap before it's wired up) — or delete it if truly unused (confirm no planned caller first).
9. `useRegressionVerifier.ts`: re-read the token (or resubscribe) when auth state changes instead of caching it at socket creation.

## Phase 3 — Dead code removal (verify zero references before deleting each)
10. Confirm via grep + a full `tsc --noEmit` / `vite build` that each of the following is truly unreferenced, then delete:
    - `testing-core`: `infrastructure/monitoring/socketServer.ts` (`TelemetryHub`), `application/services/{domainGuard,runController,stackManager}.ts`, `infrastructure/queue/TaskQueue.ts`, `infrastructure/workers/SafariWorker.ts`, `worker-entry.ts` (unless the queue path is actually planned for near-term use — ask the user before deleting the BullMQ pipeline specifically, since it may be intentional future infra rather than dead code).
    - `developer-dashboard`: `designs/SlidingAuthForm.tsx`, `designs/GradientBlinds.tsx`, `designs/components/{MagicBento,FlowingMenu,CircularGallery,ChromaGrid}.tsx` (+ CSS), `infrastructure/socket/BinaryFrameReceiver.ts`, `components/telemetry/TelemetryStream.tsx`.
11. Remove the duplicate `AuthRequest` interface in `authController.ts:148-151` (keep `authMiddleware.ts`'s version; import it instead).
12. Remove the duplicate `decodeTokenExpiration` in `useDashboardController.ts`; import from `tokenUtils.ts`.
13. Collapse `ChaosTransactionManager` alias methods (`startTransaction`/`endTransaction`) into the single `open/closeTransaction` API; update call sites.
14. Replace `actionBuffer.ts`'s `ActionRecorder` push/shift logic with the existing `lib/circularBuffer.ts` (or delete `ActionRecorder` if `ExplorationEngine`'s buffer already covers its use case).

## Phase 4 — Duplication consolidation
15. Create one shared `getAuthHeaders()`/token-access helper in the dashboard (e.g. under `utils/` or exposed from `AuthContext`) and replace the 4+ independent reimplementations (`useUserSettings.ts`, `historyService.ts`, `useRegressionVerifier.ts`, `AuthContext.tsx` inline headers).
16. Either wire `refreshToken()` into the 401 handling flow (real silent-refresh) or delete it if session lifetime is intentionally short-lived — ask the user which is intended before choosing.
17. Wire `EngineGateway.removeAllListeners()` into `useDashboardController`'s unmount cleanup, or remove it if cleanup is handled elsewhere.
18. Add a `storage` event listener (or `BroadcastChannel`) so login/logout in one tab reflects in others, replacing ad-hoc `localStorage` reads with `useAuth().token` consistently across `App.tsx` and friends.

## Phase 5 — SRP / file-size cleanup (larger, do last, plan sub-steps before executing)
19. Split `domain/services/StateGraphNavigator.ts` (1295 lines) into cohesive sub-modules (e.g. navigation/pathfinding vs. state-graph bookkeeping) — write a dedicated design pass before touching this file, it's the largest and riskiest change in the plan.
20. Split `domain/services/exploration/ExplorationLoop.execute()` (~540-line method) into named steps (stagnation scoring, telemetry emission, pathfinding decision, action execution) preserving existing behavior; back with the existing perceptron/circularBuffer tests before refactoring.
21. Split `authController.ts` (630 lines) by concern (registration, login, password-reset, session refresh) into separate route modules under `presentation/authentication/`.

## Phase 6 — Documentation & dependency hygiene
22. Reconcile mongoose version skew: root `package.json` (`^9.6.3`) vs `testing-core/package.json` (`^8.24.0`) vs `@types/mongoose@^5.11.96` — pick one major version across the workspace and drop `@types/mongoose` if using mongoose's own bundled types (v6+ ships its own).
23. Update `CLAUDE.md`'s "React 18/Vite" to match the actual `react@^19.2.5` dependency, and remove/replace the empty `backend/` directory (confirm it's not a placeholder for planned work before deleting).
24. Consolidate the eight overlapping root markdown files (`ALL_FILES_CODEBASE.md`, `BUGSAFARI_BLUEPRINT.md`, `CODEBASE_DOCUMENTATION.md`, `SETTINGS_CODE_REVIEW.md`, `implementation_plan.md`, `MONGO_VIEW_DATA.md`, `TESTING_TYPES.md`, `SETUP_DISTRIBUTED.md`) — determine which are current vs. stale, fold the current ones into `README_LOCAL_DEV.md`/`CLAUDE.md`, archive or delete the rest (ask user before deleting anything — some may be intentionally preserved design history).

## Execution notes for the next `/goal` turn
- Each numbered step should be its own commit with its own verification (typecheck + relevant unit test) before moving to the next.
- Phases 1–2 are safe to automate fully. Phase 3 requires a fresh grep verification pass per item (code may have changed since this review). Phases 5–6 involve judgment calls flagged above — surface those as questions rather than assuming.
- Existing test coverage is thin (only `circularBuffer.test.ts` and `perceptron.test.ts` were found under `testing-core/src`) — consider adding a regression test alongside each Phase 1–2 fix rather than as a separate pass.
