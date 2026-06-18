# Implementation Plan: Button Deadlock Fix for BugSafari

## [Overview]

Fix the severe button deadlock issue where dashboard buttons (Start Testing, Pause, Resume) freeze or remain locked in corrupted boolean disabled states after a testing session terminates (either via manual STOP, natural expiration, or crash forces). This implementation establishes a guaranteed global session cleanup method `terminateAndResetSafariSession()` in both backend and frontend layers to ensure deterministic state boundaries.

## [Types]

Single sentence describing the type system changes.

Adding explicit 'IDLE' status type to the EngineGateway and DashboardState status union, plus expanding terminal action detection to include timebox expiration.

### Detailed Type Definitions

```typescript
// Frontend Status Type Expansion
type DashboardStatus = 'READY' | 'RUNNING' | 'PAUSED' | 'IDLE';

// Backend Terminal Status Emission
interface StatusPayload {
  status: 'IDLE' | 'STOPPED';
  timestamp: string;
}

// Expanded Terminal Actions Set
const ENGINE_TERMINAL_ACTIONS = new Set([
  'engine-stopped',
  'engine-finished',
  'engine-halted',
  'timebox-expired',  // NEW: Timebox natural expiration
]);
```

## [Files]

Single sentence describing file modifications.

Modify 3 core files in testing-core and developer-dashboard to implement bidirectional cleanup and status reset.

### Detailed Breakdown

#### Backend Files (testing-core/)

1. **testing-core/src/application/services/runController.ts**
   - Add `terminateAndResetSafariSession()` method with strict try/catch for browser cleanup
   - Add explicit 'IDLE' status emission via telemetry
   - Ensure all browser instances are closed gracefully

2. **testing-core/src/presentation/socket/registerSocketHandlers.ts**
   - Modify stop-test handler to emit explicit STATUS: 'IDLE' after cleanup
   - Add timebox-expiration handler to emit both terminal action and IDLE status
   - Ensure socket clears activeEngineSession atomically

3. **testing-core/src/application/useCases/StartExplorationUseCase.ts**
   - Emit 'timebox-expired' action when timebox countdown completes naturally
   - Ensure cleanup flow matches manual stop flow

#### Frontend Files (developer-dashboard/)

4. **developer-dashboard/src/application/useCases/useDashboardController.ts**
   - Add 'timebox-expired' to ENGINE_TERMINAL_ACTIONS set
   - Add explicit IDLE status handling in telemetry listener
   - Reset all action component states: isLaunching, isTestRunning, isThinking, isInitializing
   - Ensure 'Start Testing' button re-enabled after any terminal action

## [Functions]

Single sentence describing function modifications.

Add 2 new functions and modify 3 existing functions.

### New Functions

1. **`terminateAndResetSafariSession()`** - testing-core/src/application/services/runController.ts
   - Signature: `(telemetry: TelemetryGateway, browserEngine?: BrowserEngine) => Promise<void>`
   - Purpose: Guarantee global session cleanup with strict try/catch for browser.close()
   - Implementation: Wraps cleanup in try/catch/finally, emits IDLE status

2. **`emitIdleStatus()`** - testing-core/src/presentation/socket/registerSocketHandlers.ts
   - Signature: `(io: Server) => void`
   - Purpose: Send explicit STATUS: 'IDLE' payload to dashboard
   - Implementation: io.emit('engine-status', { status: 'IDLE', timestamp: ... })

### Modified Functions

1. **`requestStop()`** - testing-core/src/application/services/runController.ts
   - Change: Call terminateAndResetSafariSession() after stopRequested = true
   - Ensure browser.close() wrapped in strict try/catch

2. **`stop-test` socket handler** - testing-core/src/presentation/socket/registerSocketHandlers.ts
   - Change: After engine.stop(), emit explicit IDLE status
   - Ensure atomic cleanup: clear session → emit status

3. **telemetry listener** - developer-dashboard/src/application/useCases/useDashboardController.ts
   - Change: Handle all ENGINE_TERMINAL_ACTIONS uniformly
   - Change: Add 'IDLE' status case to reset all button states
   - Change: Force isTestRunning = false, status = 'READY', unlock buttons

## [Classes]

Single sentence describing class modifications.

No new classes. Two existing classes are modified.

### Modified Classes

1. **RunController** - testing-core/src/application/services/runController.ts
   - Add terminateAndResetSafariSession() method
   - Modify requestStop() to call cleanup with IDLE emission

2. **useDashboardController** - developer-dashboard/src/application/useCases/useDashboardController.ts
   - Add timebox-expired to terminal actions
   - Add IDLE status handling for complete state reset
   - Ensure all button states reset to baseline

## [Dependencies]

Single sentence describing dependency modifications.

No new dependencies. Uses existing socket.io and React state management patterns.

## [Testing]

Single sentence describing testing approach.

Test by running safaris with multiple termination scenarios: manual stop, natural timebox expiration, and crash simulation.

### Test Scenarios

1. **Manual STOP**: Start → Stop manually → Buttons should unlock immediately
2. **Timebox Expiration**: Start → Wait 3 min → Natural timeout → Buttons should unlock
3. **Crash Recovery**: Start → Force crash → Reconnect → Buttons should unlock
4. **Multiple Cycles**: Start → Stop → Start → Stop → All cycles should allow restart

### Validation Criteria

- Start Testing button enabled after ANY termination
- Pause/Resume buttons correctly disabled during RUNNING state
- Status shows 'READY' or 'IDLE' after termination
- No console errors on restart attempts

## [Implementation Order]

Single sentence describing the implementation sequence.

Implement backend cleanup first ( Steps 1-3), then frontend state reset (Step 4), then integration testing (Step 5).

### Implementation Steps

- [ ] Step 1: Add terminateAndResetSafariSession() to runController.ts with browser.close() in try/catch
- [ ] Step 2: Add emitIdleStatus() helper and modify socket handlers to emit IDLE status
- [ ] Step 3: Modify StartExplorationUseCase to emit timebox-expired on natural timeout
- [ ] Step 4: Expand ENGINE_TERMINAL_ACTIONS in useDashboardController.ts and add IDLE status reset
- [ ] Step 5: Verify all state transitions and test end-to-end

---

## Implementation Details

### Backend: terminateAndResetSafariSession()

```typescript
// testing-core/src/application/services/runController.ts

export async function terminateAndResetSafariSession(
  telemetry: TelemetryGateway,
  browserEngine?: BrowserEngine
): Promise<void> {
  console.log('[runController]terminateAndResetSafariSession: Cleaning up...');

  // 1. Strict try/catch for browser cleanup
  if (browserEngine) {
    try {
      await browserEngine.stop();
    } catch (browserError) {
      console.error('[runController] Browser cleanup error:', browserError);
    }
  }

  // 2. Flush memory queues (if any)
  // (Add any queue flushing logic here)

  // 3. Emit explicit IDLE status
  telemetry.emitTelemetry({
    timestamp: new Date().toISOString(),
    type: 'ACTION',
    meta: {
      actionExecuted: 'engine-status',
      message: 'IDLE',
    },
  });

  console.log('[runController]terminateAndResetSafariSession: Session reset complete, status IDLE');
}
```

### Socket Handler: Stop with IDLE Emission

```typescript
// testing-core/src/presentation/socket/registerSocketHandlers.ts

socket.on('stop-test', () => {
  console.log('[Socket] Session STOPPED manually');
  if (activeEngineSession?.engine && typeof activeEngineSession.engine.stop === 'function') {
    void Promise.resolve(activeEngineSession.engine.stop()).finally(() => {
      activeEngineSession = null;
      activeEngineInstance = null;
      // NEW: Emit explicit IDLE status after cleanup
      emitEngineAction(io, 'engine-stopped', 'Safari session stopped by user.');
      emitEngineStatus(io, 'IDLE'); // <-- NEW: Explicit IDLE handshake
    });
  }
});

function emitEngineStatus(io: Server, status: 'IDLE' | 'STOPPED'): void {
  io.emit('engine-status', {
    timestamp: new Date().toISOString(),
    status,
  });
}
```

### Frontend: Expanded Terminal Actions

```typescript
// developer-dashboard/src/application/useCases/useDashboardController.ts

const ENGINE_TERMINAL_ACTIONS = new Set([
  'engine-stopped',
  'engine-finished',
  'engine-halted',
  'timebox-expired',  // <-- NEW: Timebox natural expiration
]);

// In telemetry handler - expanded terminal action handling
if (event.type === 'ACTION' && event.meta.actionExecuted && ENGINE_TERMINAL_ACTIONS.has(event.meta.actionExecuted)) {
  // Reset ALL button states - UNLOCK buttons
  setIsTestRunning(false);
  setStatus('READY');
  setHasRunCompleted(true);
  setLiveFrame(null);
  setIsInitializing(false);
  setIsThinking(false);
  setIsLaunching(false);
  // CRITICAL: Telemetry confirms backend is IDLE, safe to restart
  void gateway.fetchSessionHistory(60).then(setSessionHistory).catch(() => undefined);
}

// NEW: Handle explicit IDLE status from backend
if (event.type === 'ACTION' && event.meta.actionExecuted === 'engine-status' && event.meta.message === 'IDLE') {
  // Double-ensure all states reset
  setIsTestRunning(false);
  setStatus('IDLE');
  setIsThinking(false);
}
```

---

## Summary

This implementation ensures:

1. **Backend Cleanup Guarantee**: `terminateAndResetSafariSession()` wraps all browser cleanup in strict try/catch
2. **Explicit Status Handshake**: Backend emits explicit STATUS: 'IDLE' after cleanup, forcing clean state transition
3. **Frontend State Reset**: All button states reset uniformly on ANY terminal action (manual stop, crash, timebox expiration)
4. **Timebox Integration**: Natural timebox expiration goes through same reset flow as manual stop
5. **Button Unlo ck Guarantee**: 'Start Testing' button re-enabled after ANY session termination

The bidirectional handshake (backend cleanup → IDLE emission → frontend reset) ensures deterministic button state recovery across all termination scenarios.
