# Implementation Plan

## Overview
Fix a race condition bug in PlaywrightBrowserEngine where stopping a test session immediately after starting causes `TypeError: Cannot read properties of null (reading 'run')`. The issue occurs because `stop()` nullifies `this.activeEngine` while `run()` is still progressing through its initialization sequence asynchronously.

## Types
No type system changes required. The existing TypeScript types are sufficient for this fix.

## Files
- **Modify**: `testing-core/src/infrastructure/playwright/PlaywrightBrowserEngine.ts`
  - Location: The `run()` method where `this.activeEngine.run()` is invoked
  - Changes: Add null safety check and try/catch for graceful abort handling

## Functions
- **Modified**: `PlaywrightBrowserEngine.run()` method
  - Current location: Lines ~86-177 in PlaywrightBrowserEngine.ts
  - Required changes:
    1. Add null check before `this.activeEngine.run(...)` call
    2. Wrap the engine execution in try/catch to handle rapid cancellation
    3. On TypeError (null property access), emit ACTION telemetry instead of EXCEPTION

## Classes
No class modifications required. The existing class structure is unchanged.

## Dependencies
No new dependencies required. The existing imports are sufficient:
- `TelemetryGateway` is already imported
- `AutonomousExplorationEngine` is already imported

## Testing
Test validation approach:
1. Start a test session and immediately cancel it within 1 second
2. Verify no TypeError is thrown
3. Verify ACTION telemetry is emitted ("🏁 Session initialization terminated safely by request")
4. Verify no EXCEPTION payload is broadcast

## Implementation Order

task_progress Items:
- [ ] Step 1: Read PlaywrightBrowserEngine.ts to locate the exact line where `this.activeEngine.run()` is called
- [ ] Step 2: Add null safety check before the engine.run() invocation
- [ ] Step 3: Wrap the execution in try/catch to handle TypeError gracefully
- [ ] Step 4: Emit ACTION status instead of EXCEPTION when cancellation occurs
- [ ] Step 5: Verify the implementation manually

---

## Detailed Implementation

### File: testing-core/src/infrastructure/playwright/PlaywrightBrowserEngine.ts

**Current code around line ~180:**
```typescript
let result: { completed: boolean; reason: string };
try {
  // Pass browserInfo to the engine for telemetry collection
  result = await this.activeEngine.run(this.activePage, targetUrl, telemetry, 60, this.currentBrowserInfo);
} finally {
  this.capturedConfirmedBugs = this.activeEngine?.getConfirmedBugsFromMemory() ?? [];
  await this.cleanupResources();
  this.activeEngine = null;
}
```

**Replaced code:**
```typescript
let result: { completed: boolean; reason: string };
try {
  // 🔒 RACE CONDITION FIX: Check if engine was nullified during rapid cancellation
  if (!this.explorationEngine) {
    // Gracefully abort - session was terminated by request
    telemetry.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'ACTION',
      meta: {
        actionExecuted: 'session-initialization-terminated',
        message: '🏁 Session initialization terminated safely by request',
      },
    });
    return { completed: false, reason: 'Session terminated by user' };
  }
  
  // Pass browserInfo to the engine for telemetry collection
  result = await this.explorationEngine.run(this.activePage, targetUrl, telemetry, 60, this.currentBrowserInfo);
} catch (err: unknown) {
  // 🔒 RACE CONDITION FIX: Catch null property access during rapid cancellation
  if (err instanceof TypeError && err.message.includes('Cannot read properties of null')) {
    // Gracefully suppress exception - this is expected during rapid cancellation
    telemetry.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'ACTION',
      meta: {
        actionExecuted: 'session-initialization-terminated',
        message: '🏁 Session initialization terminated safely by request',
      },
    });
    return { completed: false, reason: 'Session terminated by user' };
  }
  // Re-throw unexpected errors
  throw err;
} finally {
  this.capturedConfirmedBugs = this.explorationEngine?.getConfirmedBugsFromMemory() ?? [];
  await this.cleanupResources();
  this.explorationEngine = null;
}
```

**Notes:**
- Changed `this.activeEngine` to `this.explorationEngine` if that's the actual property name in use (need to verify exact name from file)
- The key change is adding the null check before calling `.run()` and catching TypeError to emit ACTION instead of EXCEPTION
