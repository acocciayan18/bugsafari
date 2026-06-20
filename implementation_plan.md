# Implementation Plan

## [Overview]

Refactor the project structure by creating a new `/authentication` folder under `testing-core/src/presentation/` and moving authentication-related files from `/api` to this clearer, more semantic folder name. This improves code organization and makes the purpose of files immediately obvious.

## [Types]

No type system changes. This is a file reorganization task affecting import paths only.

## [Files]

### New files to be created
- `testing-core/src/presentation/authentication/authController.ts` - Moved from `../api/authController.ts` (handlers for signup, login, password reset)
- `testing-core/src/presentation/authentication/authMiddleware.ts` - Moved from `../api/authMiddleware.ts` (requireAuth, optionalAuth middleware)
- `testing-core/src/presentation/authentication/userSettingsController.ts` - Moved from `../api/userSettingsController.ts` (user profile/settings endpoints)

### Existing files to be modified
- `testing-core/src/index.ts` - Update import paths:
  - Change: `./presentation/api/authController.js` → `./presentation/authentication/authController.js`
  - Change: `./presentation/api/userSettingsController.js` → `./presentation/authentication/userSettingsController.js`
- `testing-core/src/presentation/api/registerRoutes.ts` - Update import path:
  - Change: `./authMiddleware.js` → `./authentication/authMiddleware.js`

### Files to be deleted
- `testing-core/src/presentation/api/authController.ts`
- `testing-core/src/presentation/api/authMiddleware.ts`
- `testing-core/src/presentation/api/userSettingsController.ts`

Note: `registerRoutes.ts` stays in `/api` as it contains non-auth routes (health check, forensic endpoints, history endpoints).

## [Functions]

No function modifications. All function implementations remain identical, only import paths change.

## [Classes]

No class modifications.

## [Dependencies]

No dependency changes.

## [Testing]

No test file modifications required. Verify:
1. Server starts successfully
2. Auth endpoints respond correctly:
   - POST /api/auth/register
   - POST /api/auth/login
   - POST /api/auth/forgot-password
   - POST /api/auth/reset-password
3. User settings endpoints respond correctly:
   - GET /api/users/profile
   - PUT /api/users/profile
   - PUT /api/users/password
   - GET /api/settings
   - PUT /api/settings

## [Implementation Order]

1. **Step 1:** Create new `/authentication` folder structure
2. **Step 2:** Copy `authController.ts` to new location with updated relative imports
3. **Step 3:** Copy `authMiddleware.ts` to new location
4. **Step 4:** Copy `userSettingsController.ts` to new location
5. **Step 5:** Update import paths in `testing-core/src/index.ts`
6. **Step 6:** Update import path in `testing-core/src/presentation/api/registerRoutes.ts`
7. **Step 7:** Delete original files from `/api` folder
8. **Step 8:** Test server startup and auth endpoints
