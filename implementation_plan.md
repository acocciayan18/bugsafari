# Implementation Plan

[Overview]
Refactor authentication state desynchronization by making AuthContext.tsx the single source of truth and simplifying useAuth.ts to a pure wrapper hook that consumes the shared context, eliminating duplicate state management that causes the stale cache issue during logout/re-login loops.

[Scope & Context]
The BugSafari application has two authentication implementations:
1. `developer-dashboard/src/context/AuthContext.tsx` - React Context with centralized auth state (already has correct state update order)
2. `developer-dashboard/src/hooks/useAuth.ts` - Standalone hook with duplicate state management (causes desync issues)

The root cause: When logout occurs, localStorage updates can race with React state updates, causing memory states to lag behind persistent storage. This results in authentication loop bounce when users log out and immediately log back in.

Solution: Use AuthContext.tsx as the authoritative source and make useAuth.ts a thin wrapper that delegates to it - eliminating duplicate state that gets out of sync.

[Types]
No new types required. Existing types in AuthContext.tsx will be re-exported:
- `AuthUser { id: string, email: string }`
- `LoginCredentials { email: string, password: string }`
- `SignupCredentials { email: string, password: string }`
- `AuthContextValue` - Extended to include all context properties
- `NavigateCallback (path: string) => void`

[Files]

**New Files:**
- None required

**Modified Files:**
1. `developer-dashboard/src/hooks/useAuth.ts`
   - Complete refactor to become a thin wrapper hook
   - Remove all internal state (user, token, isLoading, emailError)
   - Remove login(), signup(), logout() implementations
   - Import and re-export all types from AuthContext.tsx
   - Import AuthContext and simply return useContext(AuthContext)

2. `developer-dashboard/src/context/AuthContext.tsx`
   - No functional changes (already has correct fix)
   - Export AuthContext directly so useAuth.ts can import it
   - Add re-export of types for useAuth.ts to import

**Deleted Files:**
- None

**Configuration Updates:**
- No config files needed

[Functions]

**New Functions:**
- None (delegating to AuthContext)

**Modified Functions:**
1. `useAuth` in `developer-dashboard/src/hooks/useAuth.ts`
   - Signature: `function useAuth(): AuthContextValue`
   - Current: Contains full auth logic with useState, useCallback, API calls
   - Required: Simple wrapper calling `useContext(AuthContext)`
   
**Removed Functions:**
- `login` - Removed from useAuth.ts (delegates to context)
- `signup` - Removed from useAuth.ts (delegates to context)
- `logout` - Removed from useAuth.ts (delegates to context)
- `setNavigate` - Removed from useAuth.ts (delegates to context)
- `isAuthenticated` - Removed from useAuth.ts (computed in context)
- `clearEmailError` - Removed from useAuth.ts (delegates to context)
- `decodeTokenExpiration` - Removed (duplicate in context)
- `isTokenExpired` - Removed (duplicate in context)

[Classes]
- No classes involved - this is a hooks-only refactor

[Dependencies]
- No new npm packages required
- Uses existing React Context API (built-in)

[Testing]

**Test Strategy:**
1. Verify all components using useAuth() still work after refactor
2. Test logout immediately followed by login - should not bounce
3. Verify token/user state is null after logout
4. Verify token/user state is populated after login
5. Test page refresh - should restore auth state from localStorage

**Files to Test:**
- LoginForm.tsx - Uses useAuth().login()
- SignupForm.tsx - Uses useAuth().signup()
- Sidebar.tsx - Uses useAuth().logout() and useAuth().user
- AuthGuard.tsx - Uses useAuth().isAuthenticated
- Any component importing from useAuth.ts

[Implementation Order]

1. **Step 1**: Update AuthContext.tsx - Export AuthContext and types
   - Export `AuthContext` directly for import
   - Re-export types so useAuth.ts can import them

2. **Step 2**: Refactor useAuth.ts - Convert to thin wrapper
   - Remove all state declarations
   - Remove all function implementations  
   - Import AuthContext and useContext
   - Import types from AuthContext (re-export)
   - Create simple wrapper function returning useContext(AuthContext)
   - Add proper error handling for context not being available

3. **Step 3**: Verify usage in dependent components
   - Check LoginForm.tsx imports
   - Check SignupForm.tsx imports
   - Check Sidebar.tsx imports
   - Check AuthGuard.tsx imports
   - Update any imports if needed

4. **Step 4**: Manual testing
   - Run dev server
   - Test logout → immediate login flow
   - Verify no authentication bounce

---
*Plan Version: 1.0*
*Created: Current Date*
