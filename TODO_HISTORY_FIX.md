# TODO: Fix Launch Failure - Forensic History Persistence Blocking Safari Initialization

## ROOT CAUSE ANALYSIS

### Exact Failing Endpoint:
- **POST `/api/start-test`** - "Failed to fetch" is a network-level fetch error

### Root Cause:
The forensic history persistence code can cause/contribute to launch failure because:

1. **Synchronous DB session creation** in StartExplorationUseCase.execute() happens BEFORE browser launches
2. **AutonomousExplorationEngine.run()** makes a SECOND session creation call inside the engine
3. **Database operations** in the exploration loop (persistFinding, persistBrainSnapshot) can slow down execution and cause timeouts

### Note on "Failed to fetch" Error:
This is a **network-level error** that occurs when the server is unreachable. This is different from a database error during launch.
- Check if the backend server is running on the expected port
- Check network connectivity between client and server

### Fix Required:
1. Make forensic history persistence truly non-blocking
2. Add comprehensive error handling around all DB operations
3. Add detailed console logging

## PLAN

### Step 1: Fix StartExplorationUseCase.ts ✅ COMPLETED
- Add try/catch around session creation - FAILURE MUST NOT BLOCK LAUNCH
- Add console logging for session creation attempts
- Log: "Continuing launch WITHOUT forensic history - DB unavailable" when DB fails

### Step 2: Fix registerRoutes.ts ✅ COMPLETED
- Add detailed logging for API requests
- Log: POST /api/start-test received, accepted, starting in background

### Step 3: Fix SocketHttpEngineGateway.ts ✅ COMPLETED
- Add logging for HTTP requests with better error handling
- Added try/catch to detect network errors vs server errors
- Now provides helpful error message: "Cannot reach server at [URL]. Is the backend running?"

### Step 4: Fix MongoFindingRepository.ts ✅ COMPLETED
- Add logging for database inserts
- Log: Creating session, session created successfully

### Step 5: Fix historyService.ts ✅ COMPLETED
- Add logging for client-side save requests
- Log: Network errors marked with ❌

## STATUS: COMPLETED

All changes have been implemented. The key fix is:

**In StartExplorationUseCase.ts**: Session creation failure now logs a warning and CONTINUES the launch instead of failing. This ensures the safari can still launch even if the forensic history database is unavailable.

```javascript
catch (sessionError) {
    const errorMessage = sessionError instanceof Error ? sessionError.message : String(sessionError);
    console.error(`[StartExplorationUseCase] ⚠️ Session creation failed: ${errorMessage}`);
    console.warn('[StartExplorationUseCase] Continuing launch WITHOUT forensic history - DB unavailable');
    // DO NOT re-throw - continue without session tracking
}
```

**In SocketHttpEngineGateway.ts**: Network errors now give a helpful message instead of just "Failed to fetch":
```javascript
throw new Error(`Cannot reach server at ${this.apiBaseUrl}. Is the backend running?`);
```
