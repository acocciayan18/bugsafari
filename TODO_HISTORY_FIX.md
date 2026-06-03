# Fix "Save to History" Functionality - Plan

## Information Gathered

### Current Architecture:
1. **Frontend Flow:**
   - `App.tsx` → `handleSaveSessionToHistory` → `saveSession(targetUrl)` from `useDashboardController`
   - Controller calls `gateway.saveSession(targetUrl)` → `SocketHttpEngineGateway.saveSession()`
   - POSTs to `/api/history/save-session`

2. **Backend Flow (index.ts):**
   - `connectDB()` checks MongoDB connection
   - If successful: `findingRepository = new MongoFindingRepository()`
   - Routes registered with `registerRoutes(app, useCase, port, findingRepository)`

3. **API Route (registerRoutes.ts):**
   - POST `/api/history/save-session` - requires auth (`requireAuth` middleware)
   - Calls `findingRepo.markLatestSessionSaved(targetUrl)`

4. **Repository (MongoFindingRepository.ts):**
   - `markLatestSessionSaved()` - finds latest session by targetUrl only (NO user filtering!)

### Identified Issues:
1. **CRITICAL: No User Filtering in markLatestSessionSaved()** - queries ALL sessions, not user-specific
2. **Backend 503 if MongoDB fails** - findingRepo undefined
3. **No logging** - cannot trace payload or failures
4. **Integrated code** - saveSession is in useDashboardController, not a separate service
5. **API requires auth but frontend may not send token correctly in all cases**

## Plan

### Step 1: Create historyService.ts
- Create `developer-dashboard/src/services/historyService.ts`
- Extract `saveSessionToHistory(targetUrl)` as exported utility
- Add comprehensive console.log statements for debugging
- Import from EngineGateway for API calls

### Step 2: Update useDashboardController
- Remove saveSession logic (move to service)
- Import and use saveSessionToHistory from new service

### Step 3: Update ControlPanel Component  
- Import saveSessionToHistory from new service
- Wire up button click to call the service function

### Step 4: Backend Debugging (in registerRoutes.ts)
- Add logging to trace req.body, req.user
- Add try/catch for error handling
- Log validation errors

### Step 5: Backend Fix (in MongoFindingRepository.ts)
- Add userId filtering to markLatestSessionSaved()
- Add logging for ValidationError and save failures

## Files to Edit:
1. `developer-dashboard/src/services/historyService.ts` - CREATE
2. `developer-dashboard/src/application/useCases/useDashboardController.ts` - EDIT
3. `developer-dashboard/src/components/ControlPanel.tsx` - EDIT  
4. `testing-core/src/presentation/api/registerRoutes.ts` - EDIT
5. `testing-core/src/infrastructure/database/repositories/MongoFindingRepository.ts` - EDIT

## Follow-up Steps:
1. Install dependencies (none needed - using existing fetch)
2. Test: Click "Save to History" button and check console for logs
3. Verify backend logs show received payload
