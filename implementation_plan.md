# Implementation Plan

## Overview
Bypass client-side token validation checks on the "Save History" route to allow test runs to save anonymously straight to the database without checking for an active user session or token lifespan. This enables instant error-free database writes on click for testing/anonymous scenarios.

## Scope
The implementation modifies three main areas:
1. **Frontend (historyService.ts)**: Strip token header compilation from saveSessionToHistory
2. **Backend Middleware (authMiddleware.ts)**: Whitelist /api/history/save-session endpoint to bypass JWT verification
3. **Controller (useDashboardController.ts)**: Remove auth checks and token refresh logic from saveSession
4. **Backend Route (registerRoutes.ts)**: Change route to use optionalAuth and handle anonymous fallback

---

## Types

### Data Structures
```typescript
// Anonymous session payload
interface AnonymousSessionPayload {
  targetUrl: string;
  initialUrl?: string;
  ownerType?: 'anonymous' | 'guest' | 'authenticated';
  fallbackOwner?: string;
}
```

### Changes to Existing Types
- No type changes required - existingSessionHistoryEntry type remains same

---

## Files

### Modified Files

1. **developer-dashboard/src/services/historyService.ts**
   - Remove Authorization header from fetch request
   - Remove token parameter from saveSessionToHistory function signature
   - Simplify to basic unauthenticated POST request

2. **developer-dashboard/src/application/useCases/useDashboardController.ts**
   - Remove token existence check in saveSession
   - Remove token refresh/catch-retry logic block
   - Call saveSessionToHistory without token parameter

3. **testing-core/src/presentation/authentication/authMiddleware.ts**
   - No changes needed - will whitelist route in registerRoutes.ts instead

4. **testing-core/src/presentation/api/registerRoutes.ts**
   - Change /api/history/save-session from requireAuth to optionalAuth
   - Add anonymous/guest fallback owner handling in route handler

---

## Functions

### Modified Functions

1. **saveSessionToHistory** (historyService.ts)
   - **Current**: Requires `token: string` parameter, sends Authorization header
   - **Modified**: No token parameter, no Authorization header - basic unauthenticated POST
   - Signature: `saveSessionToHistory(targetUrl: string, options?: { initialUrl?: string }): Promise<void>`

2. **saveSession** (useDashboardController.ts)
   - **Current**: Checks `if (!token)` throws auth error, has 401 catch-retry with refreshToken
   - **Modified**: No token check, no refresh logic - direct save call
   - Simply calls saveSessionToHistory with URL payload

3. **POST /api/history/save-session** (registerRoutes.ts)
   - **Current**: Uses `requireAuth` middleware, requires request.userId
   - **Modified**: Uses `optionalAuth` middleware, accepts anonymous/guest users
   - Falls back to placeholder owner ID when no authenticated user

---

## Classes
No class modifications required.

---

## Dependencies
No new dependencies required.

---

## Testing

### Validation Strategy
1. Test save button click from unauthenticated session - should save without error
2. Test save button click from authenticated session - should still work
3. Verify database write with anonymous owner flag
4. Verify existing authenticated history functionality unaffected

### Test Files
No new test files needed - existing component tests will verify functionality

---

## Implementation Order

### Step 1: Update frontend historyService.ts
- Remove token parameter from saveSessionToHistory
- Remove Authorization header from fetch call

### Step 2: Update useDashboardController.ts
- Remove token validation check
- Remove 401 catch-retry block with token refresh
- Update saveSession call to not pass token

### Step 3: Update backend registerRoutes.ts
- Change route from requireAuth to optionalAuth
- Add anonymous/guest owner fallback logic
- Use placeholder or generated ID for anonymous saves

### Step 4: Verify functionality
- Test save history button click
- Verify database entry created

---

## Task Progress

- [x] Step 1: Strip token header from historyService.ts saveSessionToHistory
- [x] Step 2: Remove auth checks from useDashboardController.ts saveSession  
- [x] Step 3: Whitelist /api/history/save-session with optionalAuth and fallback in registerRoutes.ts
- [x] Step 4: Fixed StartExplorationUseCase.ts manualSaveToHistory to accept optional ownerType for anonymous saves
