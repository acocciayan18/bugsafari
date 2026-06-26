# Implementation Plan: 401 Unauthorized Fix for Session History Save

[Overview]
Fix the persistent 401 Unauthorized and Invalid or expired token console errors appearing in historyService.ts when an exploration session is successfully saved. The frontend correctly sends `Authorization: Bearer <token>` with `credentials: 'include'`, but the backend auth middleware lacks sufficient debug logging to diagnose extraction failures, and the frontend needs better error recovery when receiving 401 from the API.

The root cause is TWO-FOLD:
1. **Frontend**: historyService.ts doesn't properly handle 401 responses from save-session endpoint - it attempts token refresh but doesn't distinguish between different 401 error types from the backend
2. **Backend**: authMiddleware.ts lacks debug logging to identify if token extraction from proxy-forwarded headers is failing

[Types]
No new types required. Existing types in shared/types.ts and developer-dashboard/src/types.ts are sufficient.

[Files]
**Modified:**
- `developer-dashboard/src/services/historyService.ts` - Fix saveSessionToHistory to handle 401 from /api/history/save-session properly
- `testing-core/src/presentation/authentication/authMiddleware.ts` - Add debug logging for token extraction/validation

**No changes needed:**
- `developer-dashboard/vite.config.ts` - Already correctly forwards authorization header
- `testing-core/src/presentation/api/registerRoutes.ts` - Already uses requireAuth correctly

[Functions]
- Modified: `saveSessionToHistory` in historyService.ts - Add proper 401 error handling for save-session specifically (the current code only handles 401 for refresh token but not for the main save endpoint)
- Modified: `requireAuth` and `optionalAuth` middleware - Add debug logging to log what headers are received

[Classes]
No new classes or modifications required.

[Dependencies]
No new dependencies required.

[Testing]
- Verify 401 error disappears when saving session
- Verify history entries are correctly mapped to userId in MongoDB
- Verify console errors about token expiration no longer appear

[Implementation Order]
1. Add debug logging to authMiddleware.ts to see what headers the backend receives
2. Fix historyService.ts to properly handle 401 when saving session (not just token refresh)
3. Test session save and verify userId mapping in MongoDB

Steps:
- [x] Step 1: Read authMiddleware.ts to understand token extraction logic
- [x] Step 2: Read historyService.ts to understand current token handling
- [x] Step 3: Add debug logging to authMiddleware.ts to diagnose if headers are received
- [x] Step 4: Fix historyService.ts to handle 401 from /api/history/save-session endpoint
- [ ] Step 5: Test session save and verify userId mapping
- [ ] Step 6: Verify console errors are resolved
