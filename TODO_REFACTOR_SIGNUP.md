# Refactor Signup Submission UX Flow - Implementation Plan

## Information Gathered:

### Files Analyzed:
- `developer-dashboard/src/components/SignupForm.tsx` - Form component with signup logic
- `developer-dashboard/src/hooks/useAuth.ts` - Auth hook with signup function
- `developer-dashboard/src/infrastructure/notifications/toastUtils.ts` - Toast utilities

### Current Issues:
1. **Loading Toast**: Uses `showAsyncToastPromise` (wraps toast.promise) - shows async loading toast during request
2. **In-Button Spinner**: Shows text "Please wait..." instead of spinner icon
3. **Redirection Bug**: navigate('/login') exists but may fail due to toast.promise async flow
4. **Toast on Success**: toast.success called inside promise but showAsyncToastPromise controls its own success message

---

## Plan:

### SignupForm.tsx Changes:
1. Remove `showAsyncToastPromise` import and usage
2. Keep local `isLoading` state for button tracking  
3. Replace button text with spinner icon when loading
4. Make direct API call without toast.promise wrapper
5. Trigger toast.success ONLY after successful API response (status 201/200)
6. Call navigate('/login') immediately after success
7. Keep console.log audit trail

### useAuth.ts Changes:
- The hook's signup function is used by LoginForm but NOT by SignupForm
- SignupForm calls API directly in component
- No changes needed to useAuth.ts unless LoginForm requires similar fix

### Implementation Steps:

1. **Update SignupForm.tsx:**
   - Replace `showAsyncToastPromise` import with just `toast` import
   - Track local `isLoading` state (already exists)
   - Update button to show spinner icon when loading
   - Replace registerPromise with direct async handler
   - Move toast.success to fire ONLY after HTTP 201 success
   - Ensure navigate('/login') fires immediately after success

2. **Testing:**
   - Verify button shows spinner during signup
   - Verify button is disabled during loading
   - Verify toast shows only on success
   - Verify redirect to /login works

---

## Dependent Files to Edit:
- `developer-dashboard/src/components/SignupForm.tsx` (PRIMARY)
- `developer-dashboard/src/hooks/useAuth.ts` (No changes needed - SignupForm doesn't use hook)

## Followup Steps:
- Test the signup flow manually or with Playwright
- Verify no console errors during redirect
