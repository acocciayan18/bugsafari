# TODO - 401 Unauthorized Fix for Save Session

## Current state: Enhanced both frontend and backend with debug logging

### Changes Applied (2025):
1. ✅ historyService.ts: Updated isTokenExpired buffer from 5000ms to 30000ms (30s)
2. ✅ AuthContext.tsx: Updated isTokenExpired buffer from 5000ms to 30000ms (30s)
3. ✅ historyService.ts: Enhanced saveSessionToHistory with multiple retry logic for 401 handling
4. ✅ authMiddleware.ts: Added debug logging to trace exact token validation failure
5. ✅ optionalAuth: Added debug logging for token extraction diagnostics

### Backend debug logging added:
- `[AUTH] requireAuth - Headers received:` - Logs all auth headers from request
- `[AUTH] requireAuth - Token received (first 20 chars):` - Logs token extraction
- `[AUTH] requireAuth - Token verification failed:` - Logs token validation failures
- `[AUTH] requireAuth - Token verified for userId:` - Logs successful verification

### Frontend improvements:
- Multiple retry attempts on 401 (up to 3 tries)
- Fallback to localStorage token if refresh API fails
- Better 403 error handling for access denial scenarios
- Detailed response body logging for debugging

### Next steps:
- [ ] Test by saving session - check backend console for `[AUTH]` log entries
- [ ] See if token is received by backend or missing after proxy forwarding
- [ ] Verify if JWT_SECRET matches between frontend and backend
