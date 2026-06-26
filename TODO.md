# TODO - History Page Auto-Logout Bug Fix

## Task
Fix the bug where navigating to `/history` automatically logs out the user.

## Root Cause Identified
In `SavedEvaluationSafaris.tsx`, when the history API (`/api/history`) returns a 401 or 403 error, the code immediately logs out the user without properly attempting token refresh first.

## Plan
1. [DONE] Analyze code to understand the flow: SavedEvaluationSafaris.tsx → historyService.ts → API
2. [IN PROGRESS] Fix the error handling in SavedEvaluationSafaris.tsx to properly attempt token refresh before logging out
3. [PENDING] Test the fix (manual verification)

## Issue Location
- File: `developer-dashboard/src/components/SavedEvaluationSafaris.tsx`
- Function: `fetchHistory` (inside `useEffect` callback and `attemptFetch` logic)
- Problem: When API returns 401/403, code calls `logout()` immediately instead of properly handling the session

## Fix Strategy
1. When API returns 401/403, try token refresh FIRST
2. If refresh succeeds, retry the API call with new token
3. Only logout if refresh fails or returns 401/403

## Implementation Needed
- The existing `refreshToken` function should be called before `logout()` 
- The retry should happen ONCE after refresh
- The user should NOT be logged out immediately on API 401/403 errors
