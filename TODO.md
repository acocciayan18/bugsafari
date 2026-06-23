# Token Authentication Bug Fix - TODO

## Implementation Progress

task_progress Items:
- [x] Step 1: Understand the current fetchHistory implementation in SavedEvaluationSafaris.tsx
- [x] Step 2: Modify fetchHistory function with 401 detection logic
- [x] Step 3: Add token-specific error message parsing
- [x] Step 4: Add localStorage clear logic (bugsafari_token, bugsafari_user)
- [x] Step 5: Add toast.error("Session expired. Please log in again.")
- [x] Step 6: Add redirect to /login using React Router navigate()
- [x] Step 7: Test the implementation

## Implementation Plan Summary

### Target File:
- `developer-dashboard/src/components/SavedEvaluationSafaris.tsx`

### Target Function:
- `fetchHistory` async function (around line 240-295)

### Required Changes:
1. Add explicit 401 status detection before generic error handling ✅
2. Parse error response for "Invalid or expired token" message ✅
3. Clear stale tokens from localStorage (`bugsafari_token`, `bugsafari_user`) ✅
4. Display error toast: `toast.error("Session expired. Please log in again.")` ✅
5. Redirect to login page using React Router `navigate('/login')` ✅
6. Wrap the trailing catch clause to handle authentication drops gracefully ✅

### Dependencies (already available):
- `toast` from 'sonner' - Already imported
- `localStorage` - Native browser API
- `useNavigate` from 'react-router-dom' - Added import ✅
