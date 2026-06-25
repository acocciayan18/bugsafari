# Session Expiry Bug Fix - /history Navigation Issue

## Problem Summary
When clicking the "Sessions History" button in the sidebar, the user is immediately logged out due to a session error (401/403). The bug occurs because:

1. **Wrong API Endpoint**: `SavedEvaluationSafaris.tsx` calls `/api/history` directly, while `historyService.ts` uses `/api/history/sessions`
2. **Race Condition**: Auth state isn't properly initialized before fetching history
3. **No Token Refresh**: On 401, the component logs out instead of attempting token refresh

## Suspected Files

| File | Issue |
|------|-------|
| `developer-dashboard/src/components/SavedEvaluationSafaris.tsx` | Uses wrong API endpoint (`/api/history`) and has auth race condition |
| `developer-dashboard/src/services/historyService.ts` | Has correct endpoint but not used by history component |
| `developer-dashboard/src/context/AuthContext.tsx` | Token refresh logic exists but history component doesn't use it |

## Fix Instructions

### 1. Fix SavedEvaluationSafaris.tsx

**Replace the fetch logic** to use `historyService.ts` functions instead of direct fetch:

```tsx
// Import at top
import { fetchSessionHistory } from '../services/historyService';

// Replace fetchHistory function (around line 175)
const fetchHistory = async (showLoading = true) => {
  if (!token) {
    console.log('[SavedEvaluations] No token, user not authenticated');
    setIsLoading(false);
    return;
  }

  if (showLoading) setIsLoading(true);
  setFetchError(null);

  try {
    // Use the centralized history service
    const sessions = await fetchSessionHistory(50);
    const transformed = transformToEvaluations(sessions);
    setSafariData(transformed);
  } catch (err) {
    // Handle 401/403 with token refresh instead of immediate logout
    if (err instanceof Error && err.message.includes('401')) {
      const refreshed = await refreshToken();
      if (refreshed) {
        // Retry with new token
        const newToken = localStorage.getItem('bugsafari_token');
        // Retry fetch with newToken - or just rely on the fresh token in historyService
        const sessions = await fetchSessionHistory(50);
        setSafariData(transformToEvaluations(sessions));
        return;
      }
    }
    setFetchError(err instanceof Error ? err.message : 'Unknown error');
    console.error('[SavedEvaluations] Fetch error:', err);
  } finally {
    setIsLoading(false);
  }
};
```

### 2. Fix Auth Race Condition in useEffect

**Update the useEffect hook** to properly wait for auth initialization:

```tsx
useEffect(() => {
  // Wait for auth to fully initialize
  if (isAuthLoading) return;
  
  // Only fetch if we have a valid token
  if (!token) {
    setIsLoading(false);
    return;
  }

  fetchHistory();
}, [token, isAuthLoading]); // Include isAuthLoading in deps
```

### 3. Ensure historyService.ts Uses Correct Endpoint

The `fetchSessionHistory` function should call `/api/history/sessions`. Verify this endpoint exists on the backend or adjust to match the working endpoint.

## Expected Behavior After Fix

1. User clicks "Sessions History" in sidebar
2. Navigate to `/history` route
3. Auth state is checked - if still loading, wait
4. When auth ready, fetch session history via `historyService.fetchSessionHistory()`
5. Display saved sessions/evaluations
6. On 401, attempt token refresh before logging out

## Navigation Flow

```
Sidebar "Sessions History" button
    ↓ navigate('/history')
App.tsx renders <SavedEvaluationSafaris />
    ↓ useEffect triggers
fetchHistory() → historyService.fetchSessionHistory()
    ↓
Display user's saved sessions
```

## Verification

After implementing, verify that:
- Clicking history button navigates to `/history`
- Session history loads without logout
- Token refresh works if session expired
- Manual refresh button works
