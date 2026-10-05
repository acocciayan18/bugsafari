# Admin / Ops Section - Phase 1 Implementation Plan

Status: PLANNED (not built). Read-only. Scope-locked.
Date: 2026-10-05

## Decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Access gate | `BUGSAFARI_ADMIN_EMAILS` env allowlist | No schema/token change, no migration. Privilege stays out of the mutable DB and out of the JWT. Adding a `role` field/claim would create the exact escalation surface the engine itself attacks (`storageTamper.ts` forges `role=admin`). |
| Scope | Read-only ops panel | No mutations, no new collection, fully reversible. Cross-tenant reads over data that already exists. |

Rejected: `role` field on `UserModel` + re-signed JWT claim. More scope, a migration, a new attack target. Not justified for an ops panel.

## Integration facts this plan relies on

- Auth payload is `{ userId, email }` only (`authConfig.ts`), HS256, issuer/audience pinned. No role claim.
- Middleware: `requireAuth` / `optionalAuth` / `ifGuest` (`presentation/authentication/authMiddleware.ts`). `AuthRequest` carries `userId`, `userEmail`, `isGuest`.
- Routers mount in `testing-core/src/index.ts` via `registerAuthRoutes(app)` / `registerUserSettingsRoutes(app)` / `registerSupportRoutes(app)` / `registerRoutes(app, ...)`. One more line adds admin.
- Reusable: `readLimiter`/`writeLimiter` (`middleware/rateLimiter.ts`), `maskEmail` (`authValidation.ts`), `parsePagination`/`buildPage` (`api/pagination.ts`), `extractStringParam`/`extractIntParam` (`api/queryParams.ts`), `sessionStateFilter` (`sessionState.ts`).
- Login response shape: `{ ok, user: { id, email }, token, expiresIn }` (`authLoginController.ts:105`). `GET /api/users/profile` (requireAuth) is the natural carrier for `isAdmin`; there is no `/api/auth/me`.
- Existing read-mostly data: `UserModel`, `SessionModel` (tenant-scoped by `userId`, soft-delete lifecycle), `SupportTicketModel` (currently write-only, `POST /api/support/tickets` with no read path), `RunRegistry` + `taskQueue.workerCount()/waitingCount()`, `/api/health`, `/metrics`.

## Backend

### 1. Admin identity resolver - `presentation/authentication/adminAllowlist.ts` (new)

- Parse `process.env.BUGSAFARI_ADMIN_EMAILS` once at module load: comma-split, trim, lowercase, dedupe into a `Set<string>`.
- Export `isAdminEmail(email?: string): boolean` (empty/undefined -> false; empty allowlist -> false, fail closed).
- No wildcards. Exact match on normalized email.

### 2. `requireAdmin` middleware - add to `authMiddleware.ts`

- Compose: run `requireAuth` logic first (reuse, do not fork). On success, check `isAdminEmail(request.userEmail)`.
- Non-admin authenticated user -> `403 { error, code: 'ADMIN_FORBIDDEN' }`. Never downgrade to guest, never 404-hide.
- Log admin access with `maskEmail`.

### 3. Admin router - `presentation/admin/adminController.ts` (new) + `registerAdminRoutes(app)`

Every route: `readLimiter` + `requireAdmin`. Never `optionalAuth`. Reuse `parsePagination`/`buildPage`.

| Method + path | Returns | Notes |
|---|---|---|
| `GET /api/admin/overview` | `{ users, sessions, openTickets, fleet: { workerCount, waiting } }` | `countDocuments` on each model + `taskQueue?.workerCount()/waitingCount()` (null-safe in sync mode). |
| `GET /api/admin/users` | paginated user list | Projection: `_id, email(masked), name, emailVerified, createdAt`. Never password/tokens/reset fields. `maskEmail` on every row. |
| `GET /api/admin/sessions` | paginated cross-tenant history | Same query as `registerRoutes` history, minus the per-user `userId` clause. Reuse `sessionStateFilter`. Include `userId` for attribution. |
| `GET /api/admin/support/tickets` | paginated ticket list | The missing consumer for `SupportTicketModel`. Filter by `status`/`category` via `extractStringParam`. |

- Mount in `index.ts` next to the other `register*Routes(app)` calls: `registerAdminRoutes(app)`.
- All list endpoints bounded by `parsePagination` (cap page size); no unbounded `.find()`.

### 4. Surface `isAdmin` to the client

- `GET /api/users/profile` (`userSettingsController.ts`): add `isAdmin: isAdminEmail(request.userEmail)` to the response body.
- Optionally add `isAdmin` to the login response (`authLoginController.ts:105`) so the flag is present pre-first-profile-fetch. Server stays the real gate regardless.

## Shared contract - `shared/types.ts`

- Extend the profile (and login `user`) DTO with `isAdmin: boolean`.
- Add admin list view types: `AdminUserView`, `AdminSessionView`, `AdminTicketView`, `AdminOverview`. Keep them projection-shaped (no internal `_id` leakage beyond what listings need; emails masked).

## Frontend - `developer-dashboard/`

- `AuthContext` / auth store: carry `isAdmin` from the profile/login response.
- New lazy route `/admin` in `App.tsx`, wrapped in `RouteErrorBoundary`, gated on `isAdmin` (redirect to `/dashboard` otherwise).
- Nav entry for Admin shown only when `isAdmin`.
- `pages/AdminOps.tsx` (new): overview tiles + tabbed tables (Users / Sessions / Tickets). Reuse existing table/card/pagination components. No new design language. No em dashes in copy.

## Security invariants

- `requireAdmin` on every admin route. No guest path, ever.
- Emails masked in all listings. Projection = least privilege (no secrets).
- All lists paginated/bounded. No cross-tenant mutation in Phase 1.
- Allowlist fails closed (empty env -> no admins).
- Revocation = edit `BUGSAFARI_ADMIN_EMAILS` + redeploy.

## Explicitly out of scope (Phase 2, only if requested)

- Any mutation (disable user, force-purge, kill run). Those require: an audit-log collection, typed confirmation (reuse the permanent-delete typed-`RUN-` pattern), and per-action authorization.
- `role` field on users or in the token.
- New persisted collections.

## File touch list (for the build pass)

New:
- `testing-core/src/presentation/authentication/adminAllowlist.ts`
- `testing-core/src/presentation/admin/adminController.ts`
- `developer-dashboard/src/pages/AdminOps.tsx`

Edit:
- `testing-core/src/presentation/authentication/authMiddleware.ts` (add `requireAdmin`)
- `testing-core/src/presentation/authentication/userSettingsController.ts` (add `isAdmin` to profile)
- `testing-core/src/presentation/authentication/authLoginController.ts` (optional: `isAdmin` in login body)
- `testing-core/src/index.ts` (`registerAdminRoutes(app)`)
- `shared/types.ts` (DTOs + `isAdmin`)
- `developer-dashboard/src/context/AuthContext.tsx` + auth store (carry `isAdmin`)
- `developer-dashboard/src/App.tsx` (route + nav gate)

New env var:
- `BUGSAFARI_ADMIN_EMAILS` (comma-separated, lowercased). Document in deployment env.
