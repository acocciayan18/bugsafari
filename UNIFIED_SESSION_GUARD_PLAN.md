# Unified Session Guard Implementation Plan

## [Overview]
Implement a centralized, unified session validation system to eliminate race conditions caused by dual state management (React state vs localStorage) in the authentication flow.

This fix addresses path synchronization delays by creating a single source of truth for session validation that all route protection components can use.

## [Current Architecture Issues Identified]
- **App.tsx**: Uses React state (`useState`) for token/user - can become stale
- **useAuth hook**: Maintains separate React state - may desync from localStorage
- **AuthGuard.tsx**: Already uses localStorage directly (correct approach!)
- **SavedEvaluationSafaris.tsx**: Uses useAuth hook (problematic for race conditions)

## [Types]
New utility type to be created:
```typescript
interface SessionState {
  isValid: boolean;
  isGuest: boolean;
  token: string | null;
  user: AuthUser | null;
}
```

## [Files]
### New file to create:
- **developer-dashboard/src/utils/sessionValidator.ts**
  - Contains `validateSession()` helper function
  - Contains `getSessionState()` helper function
  - Single source of truth for session validation

### Files to modify:
- **developer-dashboard/src/components/AuthGuard.tsx**
  - Import and use `validateSession()` utility instead of inline localStorage checks
- **developer-dashboard/src/App.tsx**
  - Import and use `validateSession()` utility for route protection checks
  - Remove duplicate React state variables for token/user where possible

## [Functions]
### New functions (in sessionValidator.ts):
1. **validateSession(): boolean**
   - Returns true if valid authenticated session exists
   - Checks both bugsafari_token and bugsafari_user in localStorage
   
2. **getSessionState(): SessionState**
   - Returns full session state object
   - Includes token, user, isValid, isGuest flags

### Modified functions:
1. **AuthGuard component** - Update to use validateSession()
2. **App component** - Update to use validateSession() in route logic

## [Classes]
No class modifications required.

## [Dependencies]
No new dependencies required - uses existing localStorage API.

## [Testing]
- Verify AuthGuard correctly blocks/allows access using unified validator
- Verify App.tsx route protection works with unified validator
- Verify no race conditions occur during logout/navigation

## [Implementation Order]
1. Create sessionValidator.ts utility file
2. Update AuthGuard.tsx to use validateSession()
3. Update App.tsx to use validateSession() for route checks
4. Test the unified session validation system
