# Implementation Plan

## [Overview]

Fix the network validation logic in `AuthContext.tsx` to prevent fatal `SyntaxError` crashes when Vite proxy returns 502 Bad Gateway. Currently, the `login` function calls `response.json()` without checking if the HTTP response is valid, causing crashes when the backend is unreachable.

## [Scope]

The login function in `AuthContext.tsx` executes `fetch('/api/auth/login')` and immediately parses the response via `await response.json()` without first validating `response.ok`. When the backend container on port 3000 is unreachable (502 Bad Gateway), Vite proxy returns an HTML error page or empty body, which cannot be parsed as JSON, throwing `SyntaxError: Failed to execute 'json' on 'Response'`.

**Target Context:**
- File: `developer-dashboard/src/context/AuthContext.tsx`
- Function: `login` (lines ~140-182)
- Issue: Calls `response.json()` before checking `response.ok`

## [Types]

No new types required. Using existing types:
- `LoginCredentials` - already defined
- `AuthResponse` - already defined  
- `AuthError` - already defined

## [Files]

**Existing files to be modified:**
1. `developer-dashboard/src/context/AuthContext.tsx`
   - Modify `login` function to check `response.ok` before parsing JSON
   - Add proper error handling for 502 Bad Gateway and other network errors

## [Functions]

**Modified functions:**
1. `login` (in `AuthContext.tsx`)
   - Current: Calls `response.json()` immediately after fetch without validation
   - Required changes:
     - Add `if (!response.ok)` check BEFORE calling `response.json()`
     - Log error with status code: `console.error('[AuthContext] Server returned status code:', response.status)`
     - Show toast error: `Server connection failed (${response.status}). Please verify that your backend container is healthy on port 3000!`
     - Return `false` to short-circuit execution
     - Keep existing network error catch block (already handles `TypeError` for unreachable)

## [Classes]

No class modifications required.

## [Dependencies]

No new dependencies required. Using existing:
- `sonner` toast (already imported)
- `fetch` API (built-in)

## [Testing]

**Validation strategy:**
1. Manual test: Trigger login with backend down (503/502 response)
2. Verify toast error displays with correct status code
3. Verify no `SyntaxError` in console
4. Verify login returns `false`

**Existing test files to verify:**
- `developer-dashboard/src/context/AuthContext.tsx` unit tests (if exist)

## [Implementation Order]

1. **Read the target file** - Confirm current state (already read)
2. **Add response.ok validation** - Insert check before `response.json()` in `login` function
3. **Add gateway error toast** - Specific message for port 3000 connectivity
4. **Verify existing signup validation** - Confirm it already has proper validation (confirmed)
5. **Test the fix** - Manual verification

## [Implementation Notes]

- The `signup` function already has proper validation (checks content-type and `response.ok` before parsing) - no changes needed
- The `login` function has a catch block that handles `TypeError` (network unreachable), but this only catches fetch network errors, NOT HTTP error responses (like 502) that return HTML
- The fix adds validation BEFORE the try-catch to catch HTTP-level errors (502, 503, etc.)
