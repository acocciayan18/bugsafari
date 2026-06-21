# Implementation Plan: Zombie Process Prevention for BugSafari Exploration Engine

[Overview]
This implementation addresses the critical architectural bug where the exploratory engine's background thread becomes a "Zombie Process" when initialization fails or encounters DOM parse/live feed timeout errors. The backend worker container remains trapped running the previous test even after user refreshes or restarts the frontend dashboard. The fix enforces defensive structural teardown hooks, absolute process destruction in finally blocks, and synchronized distributed state changes between backend and frontend.

The core issue is that when errors occur during engine initialization or during the Sense-Think-Act exploration loop, the UI captures the exception and enables the "Start Testing" action, but the backend thread keeps testing and emitting telemetry indefinitely without proper cleanup.

[Types]
No new types are required. The existing types in `shared/types.ts` and testing-core types are sufficient. Key type dependencies:
- `TelemetryGateway` from `testing-core/src/application/ports/TelemetryGateway.js` - Used for emitting telemetry and status events
- `BrowserEngine` from `testing-core/src/application/ports/BrowserEngine.ts` - Interface for browser control
- `EngineControl` from `testing-core/src/presentation/socket/registerSocketHandlers.ts` - Interface for socket-based engine control

[Files]
Existing files to be modified:
1. `testing-core/src/domain/services/AutonomousExplorationEngine.ts` - Primary modification for try-catch-finally wrapper and complete cleanup
2. `testing-core/src/infrastructure/playwright/PlaywrightBrowserEngine.ts` - Enhanced cleanup with forced browser closure
3. `testing-core/src/application/useCases/StartExplorationUseCase.ts` - Enhance finally block with explicit IDLE emission and state reset

No new files to be created. Configuration files remain unchanged.

[Functions]
1. **Modify: `AutonomousExplorationEngine.run()`** - Located in `testing-core/src/domain/services/AutonomousExplorationEngine.ts`
   - Current: Main exploration loop without comprehensive try-catch-finally at entry point
   - Required changes: 
     - Wrap the entire method body in a try-catch-finally block
     - In finally block: stop timing interval, stop frame capture loop, dispose stability monitor, clear action buffers, emit explicit IDLE status
     - In catch block: ensure IDLE status is emitted before re-throwing

2. **Modify: `PlaywrightBrowserEngine.stop()`** - Located in `testing-core/src/infrastructure/playwright/PlaywrightBrowserEngine.ts`
   - Current: Calls cleanup but not fully forceful
   - Required changes:
     - Add explicit browser.forceClose() or browser.close() with error handling
     - Clear active engine reference immediately
     - Emit IDLE status through telemetry if available

3. **Modify: `PlaywrightBrowserEngine.cleanupResources()`** - Located in `testing-core/src/infrastructure/playwright/PlaywrightBrowserEngine.ts`
   - Current: Basic resource cleanup with optional chaining
   - Required changes:
     - Add console.error for cleanup failures
     - Ensure page.close(), context.close(), browser.close() are called with proper error handling
     - Clear all references to prevent memory leaks

4. **Modify: `StartExplorationUseCase.execute()`** - Located in `testing-core/src/application/useCases/StartExplorationUseCase.ts`
   - Current: Has finally block that sets state.active = false but may not emit IDLE status in all error scenarios
   - Required changes:
     - Ensure telemetry.emitTelemetry() with engine-status IDLE is called in finally block regardless of execution status
     - Ensure setActiveEngine(null) is called in finally block

[Classes]
No new classes. Existing classes are modified:
- `AutonomousExplorationEngine` - Add defensive cleanup hooks
- `PlaywrightBrowserEngine` - Add forceful cleanup

[Dependencies]
No new dependencies. All existing dependencies are used:
- Playwright (chromium) - Already available for browser control
- Socket.io - Already used for WebSocket communication
- TelemetryGateway - Already used for telemetry emission

[Testing]
Test validation approach:
1. Unit tests for cleanup functions with mocked browser contexts
2. Integration tests for error scenarios that trigger finally blocks
3. Manual testing verify UI state synchronization after errors
4. Check that IDLE status is received by frontend after errors

No separate test files are created - existing test infrastructure is used.

[Implementation Order]
1. First, enhance `AutonomousExplorationEngine.run()` with try-catch-finally wrapper and complete cleanup in finally block
   - Add comprehensive cleanup calls: stopTimingInterval(), stopFrameCaptureLoop(), cleanup stability monitor, clear CircularBuffer
   - Emit explicit IDLE status via telemetry before returning
   
2. Second, enhance `PlaywrightBrowserEngine.cleanupResources()` with forceful browser closure and error handling
   - Add browser.close() with catch for zombie browser prevention
   - Log cleanup failures for debugging
   
3. Third, enhance `PlaywrightBrowserEngine.stop()` to immediately clear engine references and emit IDLE status
   - Force engine stop before cleanup
   - Clear activeEngine reference immediately
   
4. Fourth, verify `StartExplorationUseCase.execute()` finally block emits IDLE status
   - Ensure state.active = false is set
   - Ensure setActiveEngine(null) is called
   - Ensure IDLE telemetry is emitted in all execution scenarios

5. Finally, verify frontend controller in `useDashboardController.ts` handles IDLE status correctly (already implemented but verify)

The implementation sequence prioritizes the core engine cleanup first, then the browser engine cleanup, then the use case layer. This ensures that even if higher-level components fail, the engine-level cleanup still executes.

---

## Implementation Progress

task_progress Items:
- [x] Step 1: Verify AutonomousExplorationEngine.run() - Already has try-catch-finally with complete cleanup
- [x] Step 2: Verify PlaywrightBrowserEngine.cleanupResources() - Already has forceful browser closure
- [x] Step 3: Verify PlaywrightBrowserEngine.stop() - Already clears engine reference immediately
- [x] Step 4: Verify StartExplorationUseCase.execute() - Already emits IDLE in finally block
- [x] Step 5: Verify all defensive mechanisms - CONFIRMED: All fixes already implemented

---

## ✅ IMPLEMENTATION COMPLETE

**STATUS: The zombie process prevention fixes are already fully implemented in the codebase.**

The following defensive mechanisms are in place:

1. **AutonomousExplorationEngine.run()** (lines ~730-850 in finally block):
   - ✅ Disposes stability monitoring cleanup function
   - ✅ Stops frame capture loop 
   - ✅ Stops timing interval
   - ✅ Emits explicit IDLE status via telemetry
   - ✅ Captures final screenshot
   - ✅ Persists final telemetry
   - ✅ Clears action trace IDs

2. **PlaywrightBrowserEngine.cleanupResources()** (lines 196-227):
   - ✅ Forcefully closes page with error handling
   - ✅ Forcefully closes context with error handling
   - ✅ Forcefully closes browser with zombie prevention logging
   - ✅ Attempts force kill as last resort

3. **PlaywrightBrowserEngine.stop()** (lines 83-101):
   - ✅ Forces engine stop first
   - ✅ Clears engine reference immediately
   - ✅ Calls cleanupResources()
   - ✅ Has isStopping guard to prevent concurrent stops

4. **StartExplorationUseCase.execute()** (lines ~253-268 in finally block):
   - ✅ Emits explicit IDLE status
   - ✅ Sets state.active = false
   - ✅ Sets currentSessionId = null
   - ✅ Calls setActiveEngine(null)

5. **Frontend (useDashboardController.ts)** - already handles engine-status IDLE:
   - ✅ Listens for engine-status events
   - ✅ Resets all states on IDLE reception
