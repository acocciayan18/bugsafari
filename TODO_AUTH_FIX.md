# Authentication Flow Fix Plan

## Issues Identified:

### Issue 1: After successful login - redirects to Landing Page instead of Dashboard
**Files Affected**: LoginForm.tsx, useAuth.ts
**Root Cause**: Navigation conflict between LoginForm's navigate() and useAuth's doNavigate()
**Current Behavior**: Login redirects to Landing Page
**Expected Behavior**: Redirect to /dashboard

### Issue 2: After successful registration - auto-logs in instead of redirecting to Login
**Files Affected**: SignupForm.tsx, useAuth.ts (signup function), App.tsx (handleSignupSuccess)
**Root Cause**: Both SignupForm.tsx and useAuth's signup() store token/user in localStorage
**Current Behavior**: Auto-login after registration, redirects to /login AFTER storing token (wrong)
**Expected Behavior**: DO NOT store token/user, show success message, redirect to /login immediately

## Plan:

### Fix 1: LoginForm.tsx
- Keep the navigate('/dashboard') call - this is correct
- Remove redundant success check since useAuth already navigates
- Verify token is properly stored before navigating

### Fix 2: SignupForm.tsx
- Remove: localStorage.setItem('bugsafari_token', data.token)
- Remove: localStorage.setItem('bugsafari_user', JSON.stringify(data.user))
- Remove: onSignupSuccess(data.token, data.user) callback
- Add: Success toast message "Account created successfully. Please log in."
- Keep: navigate('/login') - this is correct

### Fix 3: useAuth.ts (signup function)
- Remove: localStorage.setItem('bugsafari_token', ...) 
- Remove: localStorage.setItem('bugsafari_user', ...)
- Remove: setToken() and setUser() state updates
- Add: Success toast message "Account created successfully. Please log in."
- Add: Navigate to /login after showing message (NOT auto-login)
- Remove: The 2000ms timeout (no auto-login delay)

### Fix 4: App.tsx
- Remove: handleSignupSuccess function (no longer needed)
- Update: SignupForm usage to not pass onSignupSuccess prop
- Verify: hasValidSession logic works correctly

### Fix 5: useAuth.ts (login function)
- The login function looks correct - it already navigates to /dashboard
- No changes needed for login navigation

## Files to Edit:
1. developer-dashboard/src/components/SignupForm.tsx
2. developer-dashboard/src/hooks/useAuth.ts  
3. developer-dashboard/src/App.tsx
