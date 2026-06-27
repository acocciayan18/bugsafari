# Implementation Plan: Race Condition Fix - Frontend/Backend State Synchronization

## [Overview]

Fix the race condition where frontend timeout triggers local state reset without notifying the backend, leaving orphaned Playwright browser processes running. Implement symmetric cleanup ensuring both UI and backend terminate gracefully when initialization timeout occurs or connection drops.

This implementation addresses the core issue: **frontend resets to READY (IDLE) state while backend headless browser continues running** by adding explicit stop command dispatch, cleanup state locking, and proper state handshake between components.

## [Types]

### New Status Type Addition
```typescript
// Extended TestSessionStatus with explicit cleanup state
export type TestSessionStatus = 'IDLE' | 'ACTIVE' | 'PAUSED' | 'STOPPED' | 'FINISHED' | 'CLEANUP';
```

### New Telemetry Event Types
```typescript
// Add to TelemetryMeta in shared/types.ts
interface TelemetryMeta {
  // ... existing fields
  // New fields for cleanup handshake
  requiresCleanup?: boolean;
  cleanupConfirmed?: boolean;
  orphanedProcessDetected?: boolean;
}
```

### Cleanup State Interface
```typescript
interface CleanupState {
  isCleaningUp: boolean;
  cleanupStartedAt: number | null;
  cleanupTimeoutId: ReturnType<typeof setTimeout> | null;
  lastCleanupAttempt: 'socket' | 'http' | 'none';
  orphansDetected: boolean;
}
```

### Engine Gateway Extension
```typescript
interface EngineGateway {
  // ... existing methods
  // New methods for explicit stop
  forceStop(): Promise<void>;
  checkHealth(): Promise<boolean>;
}
```

## [Files]

### Files to be Created

1. **developer-dashboard/src/infrastructure/api/stopEndpoint.ts**
   - Purpose: HTTP fallback endpoint for explicit Safari stop
   - Contains: `stopSafari()` function and `/api/safari/stop` route handler

2. **testing-core/src/presentation/api/safariStopRoute.ts**
   - Purpose: Backend endpoint to receive explicit stop commands
   - Contains: `/api/safari/stop` Express route registration

### Files to be Modified

1. **developer-dashboard/src/application/useCases/useDashboardController.ts**
   - Changes:
     - Add `'CLEANUP'` status to `TestSessionStatus` union
     - Add `CleanupState` management
     - Modify initialization timeout to dispatch explicit stop
     - Add `handleTimeoutCleanup()` method
     - Add `forceStop()` method that sends stop command before reset

2. **developer-dashboard/src/infrastructure/engine/SocketHttpEngineGateway.ts**
   - Changes:
     - Add `forceStop()` method with HTTP fallback
     - Add `checkHealth()` method
     - Implement retry logic for stop command

3. **developer-dashboard/src/components/CommandCenter.tsx**
   - Changes:
     - Display `CLEANUP` status in visibility matrix
     - Add visual indicator for cleanup state (locked inputs)

4. **developer-dashboard/src/types.ts**
   - Changes:
     - Export new status type if needed

5. **testing-core/src/presentation/api/registerRoutes.ts**
   - Changes:
     - Register `/api/safari/stop` endpoint

6. **testing-core/src/infrastructure/workers/SafariWorker.ts** (if exists)
   - Changes:
     - Add explicit termination on connection drop

7. **shared/types.ts**
   - Changes:
     - Add `CLEANUP` to related status types if needed

### Configuration Files
No configuration files need modification.

## [Functions]

### Key Finding: Backend Already Has Cleanup

The backend socket handlers already contain proper cleanup logic:
- `socket.on('stop-test', ...)` - calls engine.stop() and emits IDLE status
- `socket.on('disconnect', ...)` - stops engine when dashboard disconnects

**The gap**: Frontend timeout handler resets local state WITHOUT dispatching stop command.

### New Functions

1. **useDashboardController** (modified - add cleanup state)
   - Location: `developer-dashboard/src/application/useCases/useDashboardController.ts`
   - Signature: Existing hook now manages additional cleanup state
   - Purpose: Handle timeout → cleanup → state reset flow

2. **handleTimeoutCleanup** (NEW)
   - Location: `developer-dashboard/src/application/useCases/useDashboardController.ts`
   - Signature: `function handleTimeoutCleanup(): Promise<void>`
   - Purpose: Dispatch explicit stop command, wait for confirmation, then reset state

3. **forceStop** (NEW - in gateway)
   - Location: `developer-dashboard/src/infrastructure/engine/SocketHttpEngineGateway.ts`
   - Signature: `async forceStop(): Promise<void>`
   - Purpose: Send stop command via socket, fallback to HTTP if needed

4. **checkHealth** (NEW - in gateway)
   - Location: `developer-dashboard/src/infrastructure/engine/SocketHttpEngineGateway.ts`
   - Signature: `async checkHealth(): Promise<boolean>`
   - Purpose: Verify backend is responsive before sending commands

5. **safariStopHandler** (NEW - backend endpoint)
   - Location: `testing-core/src/presentation/api/safariStopRoute.ts`
   - Signature: `async function safariStopHandler(req, res)`
   - Purpose: Handle explicit stop command from frontend

### Modified Functions

1. **useDashboardController** (existing)
   - Location: `developer-dashboard/src/application/useCases/useDashboardController.ts`
   - Changes: 
     - Add `useState` for cleanup tracking
     - Modify timeout effect to call `handleTimeoutCleanup`
     - Add cleanup state to returned state object

2. **SocketHttpEngineGateway.startTest** (existing)
   - Minor: Already properly handles errors, no changes needed

3. **SocketHttpEngineGateway.stopTest** (existing)
   - Purpose: Already exists, will be supplemented by `forceStop`

4. **PlaywrightBrowserEngine.stop** (existing)
   - Already proper, will be called by new endpoint

## [Classes]

### New Classes

No new classes required. Using composition over class creation.

### Modified Classes

1. **SocketHttpEngineGateway** (existing)
   - Location: `developer-dashboard/src/infrastructure/engine/SocketHttpEngineGateway.ts`
   - Modifications:
     - Add `forceStop()` method
     - Add `checkHealth()` method  
     - Add `STOP_TIMEOUT_MS` constant (5000ms)

2. **StartExplorationUseCase** (existing)
   - Location: `testing-core/src/application/useCases/StartExplorationUseCase.ts`
   - Minor: Already has proper cleanup, may add connection drop handler

## [Dependencies]

### New Dependencies

None required - existingSocket.IO and Express are sufficient.

### Version Changes

- No version changes needed

### Integration Requirements

- Socket.IO already configured in both frontend and backend
- Express already configured in backend

## [Testing]

### Test File Requirements

1. Create `developer-dashboard/testing/cleanupState.spec.ts` (optional - new)
   - Test cleanup state transitions
   - Test timeout → stop flow

2. Modify existing tests if applicable

### Validation Strategy

1. **Manual Testing**:
   - Start test, let timeout occur → verify backend process terminates
   - Start test, disconnect socket → verify cleanup occurs
   - Start test, explicit stop → verify symmetric cleanup

2. **Validation**:
   - Check `ps aux | grep chromium` shows no orphaned processes after timeout
   - Check socket connection closes properly
   - Check telemetry shows cleanup handshake events

## [Implementation Order]

### Step-by-Step Implementation

1. **Step 1**: Add `/api/safari/stop` endpoint to backend
   - File: `testing-core/src/presentation/api/registerRoutes.ts`
   - Add route: `app.post('/api/safari/stop', ...)`
   - Action: Call engine.stop() and emit cleanup telemetry

2. **Step 2**: Extend SocketHttpEngineGateway with forceStop
   - File: `developer-dashboard/src/infrastructure/engine/SocketHttpEngineGateway.ts`
   - Add `forceStop()` method with socket + HTTP fallback
   - Add `checkHealth()` method

3. **Step 3**: Modify useDashboardController with CLEANUP state
   - File: `developer-dashboard/src/application/useCases/useDashboardController.ts`
   - Add `'CLEANUP'` to status type
   - Add CleanupState tracking
   - Modify timeout effect to call cleanup handler
   - Add `handleTimeoutCleanup()` method

4. **Step 4**: Update CommandCenter visibility matrix
   - File: `developer-dashboard/src/components/CommandCenter.tsx`
   - Add CLEANUP to control visibility
   - Show locked state during cleanup

5. **Step 5**: Test the full flow
   - Manual verification
   - Verify no orphaned processes remain after timeout

### Expected Behavior After Implementation

```
Timeline:
1. User clicks Start → frontend ACTIVE, backend starts
2. 30 seconds pass → no live frame received
3. Frontend: CLEANUP state (inputs locked)
4. Frontend dispatches stop command (socket or HTTP)
5. Backend receives stop → cleanupResources() called
6. Backend emits cleanupConfirmed telemetry
7. Frontend receives confirmation → resets to IDLE
8. Both sides now symmetrical (no orphans)
```

## [Additional Notes]

### Edge Cases Handled

1. **Socket disconnection during stop**: HTTP fallback ensures reliability
2. **Backend already stopped**: Gracefully handle "already stopped" state
3. **Connection timeout**: 5 second timeout on stop command
4. **Multiple rapid stops**: Debounce/dedupe stop commands

### Security Considerations

- `/api/safari/stop` should require authentication (use requireAuth middleware)
- Rate limiting on stop endpoint to prevent abuse

### Performance Impact

- Minimal: Cleanup adds ~100-500ms to timeout flow
- No impact on normal operation (ACTIVE/PAUSED states)
