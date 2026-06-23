# Implementation Plan

## [Overview]
Fix the unhandled token authentication bug in `SavedEvaluationSafaris.tsx` where the `fetchHistory` method fails with a raw HTTP 401 exception when the user's authorization session expires. The fix will add proper lifecycle guard handling to gracefully detect authentication expiration, clear stale tokens, display an error toast, and redirect to login.

## [Types]
No new type definitions required. The existing types in `SavedEvaluationSafaris.tsx` are sufficient:
- `EvaluationSafari[]` - Already used for safari data
- `fetchError` state - Already exists for error handling

## [Files]
Single file to be modified:

### Modified Files:
1. **`developer-dashboard/src/components/SavedEvaluationSafaris.tsx`**
   - Location: `fetchHistory` async function (around line 240-295)
   - Current issue: No specific handling for HTTP 401 or token expiration
   - Required changes:
     - Add explicit 401 status detection before generic error handling
     - Parse error response for "Invalid or expired token" message
     - Clear stale token from localStorage
     - Display session expired toast using Sonner
     - Redirect to login page

## [Functions]

### Modified Functions:
1. **`fetchHistory`** - in `SavedEvaluationSafaris.tsx`
   - Signature: `const fetchHistory = async (showLoading = true) => { ... }`
   - Required changes:
     - After receiving response, check for 401 status before other error handling
     - Parse error response body to detect token expiration messages
     - Clear authentication tokens from localStorage (`bugsafari_token`, `bugsafari_user`)
     - Display error toast: `toast.error("Session expired. Please log in again.")`
     - Redirect to login page using `window.location.href = '/login'`
     - Wrap entire operation in try/catch to prevent component crash

## [Classes]
No class modifications required.

## [Dependencies]
No new dependencies required. The following are already available:
- `toast` from 'sonner' - Already imported in the file
- `localStorage` - Native browser API
- `window.location.href` - Native browser navigation

## [Testing]
Test validation strategy:
1. Manual test with expired token (logout and try to fetch history)
2. Verify toast displays "Session expired. Please log in again."
3. Verify redirect to `/login` happens automatically
4. Verify component doesn't crash (empty state shown or gracefully handled)

## [Implementation Order]

1. **Understand the current `fetchHistory` implementation** ✅
   - Done: Reviewed SavedEvaluationSafaris.tsx lines ~240-295
   - Current flow: response check → generic error throw → catch block sets error

2. **Modify `fetchHistory` function in SavedEvaluationSafaris.tsx**
   - Add 401 status detection logic
   - Add token-specific error message parsing
   - Add localStorage clear logic
   - Add toast.error with session expired message
   - Add redirect to /login

3. **Validate the implementation**
   - Test with valid token (normal operation)
   - Test with expired token (graceful handling)
   - Verify toast and redirect work correctly
   - Verify no component crash occurs

---

## [Technical Details]

### Current problematic code flow:
```javascript
const response = await fetch(`${API_BASE_URL}/api/history`, {
  headers: { 'Authorization': `Bearer ${token}` },
});

if (!response.ok) {  // This catches 401 but doesn't handle it specially
  const errorText = await response.text();
  throw new Error(`Failed to fetch history: ${response.status}`);
}
```

### Required fix implementation:
```javascript
// Check for 401 Unauthorized - token expired or invalid
if (response.status === 401) {
  // Try to parse error message for "Invalid or expired token"
  const errorText = await response.text();
  const isTokenError = errorText.includes('Invalid or expired token') || 
                       errorText.includes('expired token') ||
                       errorText.includes('Invalid token') ||
                       errorText.includes('401');
  
  if (isTokenError) {
    // Clear stale tokens from localStorage
    localStorage.removeItem('bugsafari_token');
    localStorage.removeItem('bugsafari_user');
    
    // Display session expired warning toast
    toast.error("Session expired. Please log in again.");
    
    // Redirect to login page
    window.location.href = '/login';
    return; // Exit early to prevent further processing
  }
}
```

### Error handling in catch block:
The existing catch block should remain but will now handle other errors differently since 401 is handled before.
