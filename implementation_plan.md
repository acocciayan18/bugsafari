# Implementation Plan: Accumulating Active Time Tracking for Timebox Enforcement

## [Overview]

Fix the severe asynchronous timing drift bug where the 3-minute testing timebox continues running in the backend even when an operator hits the PAUSE button on the developer-dashboard. The implementation converts fixed absolute epoch-based timeout tracking to accumulative active duration tracking that only counts when the engine is NOT paused.

## [Types]

Single sentence describing the type system changes.

The following new methods and properties are added to the existing interfaces:

### BrowserEngine Interface Changes (testing-core/src/application/ports/BrowserEngine.ts)

```typescript
export interface BrowserEngine {
  // Existing methods
  run(targetUrl: string, telemetry: TelemetryGateway, optimizationSettings?: OptimizationSettings): Promise<{ completed: boolean; reason: string }>;
  pause?(): void;
  resume?(): void;
  stop?(): Promise<void> | void;
  
  // NEW: Get accumulated active execution time in milliseconds. Only counts time when NOT paused.
  getElapsedActiveTimeMs?(): number;
  
  // NEW: Check if timebox has been exceeded. Returns true only when elapsed time >= timeboxMs AND NOT paused.
  isTimeboxExceeded?(timeboxMs?: number): boolean;
  
  // Existing getters
  getConfirmedBugsFromMemory?(): Array<{...}>;
  getConfig?(): BrowserEngineConfig;
}
```

### AutonomousExplorationEngine Class Properties

```typescript
// NEW: Accumulative active time tracking (only counts when NOT paused)
private elapsedActiveTimeMs: number = 0;           // Accumulator for active execution time
private timingInterval: ReturnType<typeof setInterval> | null = null;  // 100ms tick interval
private lastTickTimestamp: number = 0;           // Reference timestamp for delta calculation
private timeboxMs: number = 180000;              // Default 3 minutes (180000ms)
private timeboxExceeded: boolean = false;       // Flag to track if timebox has been triggered

// Existing pause state
private isPaused = false;
private isStopRequested = false;
```

## [Files]

Single sentence describing file modifications.

The implementation modifies 4 files to add accumulative active time tracking. No new files are created.

### Detailed Breakdown

- **testing-core/src/application/ports/BrowserEngine.ts**
  - Add `getElapsedActiveTimeMs()` method signature to interface
  - Add `isTimeboxExceeded(timeboxMs?: number): boolean` method signature to interface

- **testing-core/src/infrastructure/playwright/PlaywrightBrowserEngine.ts**
  - Implement `getElapsedActiveTimeMs()` delegating to AutonomousExplorationEngine
  - Implement `isTimeboxExceeded(timeboxMs)` delegating to AutonomousExplorationEngine

- **testing-core/src/domain/services/AutonomousExplorationEngine.ts**
  - Add `elapsedActiveTimeMs` private property accumulator
  - Add `timingInterval`, `lastTickTimestamp`, `timeboxMs`, `timeboxExceeded` properties
  - Implement `startTimingInterval()` to begin 100ms tick tracking
  - Implement `stopTimingInterval()` to cleanup interval
  - Implement `getElapsedActiveTimeMs()` getter
  - Implement `setElapsedActiveTimeMs(ms)` setter for resumable scenarios
  - Implement `isTimeboxExceeded()` check with pause condition
  - Modify pause/resume methods to properly handle time tracking
  - **CRITICAL**: Add timebox check inside the main exploration loop

- **testing-core/src/application/useCases/StartExplorationUseCase.ts**
  - Update result checking to detect timebox expiration
  - Preserve telemetry emission for timebox events

## [Functions]

Single sentence describing function modifications.

Three new functions are added, and one function is modified to include the critical timebox check.

### New Functions

1. **`startTimingInterval()`** - testing-core/src/domain/services/AutonomousExplorationEngine.ts
   - Signature: `private startTimingInterval(): void`
   - Purpose: Initialize 100ms interval that accumulates elapsedActiveTimeMs only when NOT paused
   - Implementation: Uses setInterval with 100ms ticks, calculates delta from lastTickTimestamp, increments accumulator only when `!isPaused && !isStopRequested`

2. **`stopTimingInterval()`** - testing-core/src/domain/services/AutonomousExplorationEngine.ts
   - Signature: `private stopTimingInterval(): void`
   - Purpose: Clean up the timing interval on engine stop

3. **`checkTimeboxAndTerminateifExceeded()`** - testing-core/src/domain/services/AutonomousExplorationEngine.ts
   - Signature: `private checkTimeboxAndTerminateifExceeded(telemetry: TelemetryGateway): boolean`
   - Purpose: Check if timebox is exceeded and terminate gracefully if so
   - Returns: true if timebox exceeded (caller should exit loop), false otherwise

### Modified Functions

1. **`run()` method** - testing-core/src/domain/services/AutonomousExplorationEngine.ts
   - Location: Main exploration loop (for step = 1 to maxSteps)
   - Change: Add timebox check inside the loop before each step
   - Implementation: Check `isTimeboxExceeded()` at start of each iteration; if true, emit timeout telemetry and return with TIMEOUT status

## [Classes]

Single sentence describing class modifications.

No new classes are created. Two existing classes are modified.

### Modified Classes

1. **AutonomousExplorationEngine** - testing-core/src/domain/services/AutonomousExplorationEngine.ts
   - Key modifications:
     - Add accumulative time tracking properties and methods
     - Modify pause() to stop time accumulation
     - Modify resume() to resume time accumulation  
     - Add timebox enforcement in main loop

2. **PlaywrightBrowserEngine** - testing-core/src/infrastructure/playwright/PlaywrightBrowserEngine.ts
   - Key modifications:
     - Delegate to AutonomousExplorationEngine for time tracking methods

## [Dependencies]

Single sentence describing dependency modifications.

No new dependencies are added. The implementation uses existing TypeScript and JavaScript runtime features:
- `setInterval` / `clearInterval` for timing
- `Date.now()` for timestamp calculations
- Existing optimizationSettings for configurable timebox

## [Testing]

Single sentence describing testing approach.

Test the fix by running a safari, pausing it for more than 3 minutes, then resuming. The engine should NOT timeout while paused.

### Test Scenarios

1. **Pause > 3 minutes**: Start safari, PAUSE immediately, wait 4 minutes, RESUME - engine should continue
2. **Active 3 minutes**: Start safari, let run for 3 minutes without pausing - engine should timeout
3. **Pause < 3 minutes, Resume**: Start safari, PAUSE for 1 minute, RESUME, run for 2 more minutes - should timeout at 3 minutes active time
4. **Multiple Pause/Resume cycles**: Pause/resume multiple times - should track total active time correctly

### Test File Requirements

No new test files required. Existing integration tests should be updated to verify pause behavior.

## [Implementation Order]

Single sentence describing the implementation sequence.

1. **Verify current implementation** - Review what code already exists
2. **Add missing timebox loop check** - Add enforcement in the main exploration loop (CRITICAL)
3. **Test the fix** - Verify pause behavior works correctly

### Implementation Steps

- [ ] Step 1: Verify current implementation in AutonomousExplorationEngine.ts
- [ ] Step 2: Add `checkTimeboxAndTerminateifExceeded()` method
- [ ] Step 3: Add timebox check inside the main for-loop in run() method
- [ ] Step 4: Verify PlaywrightBrowserEngine and BrowserEngine interfaces are complete
- [ ] Step 5: Clean up and document the final implementation

---

## Refactored Time Tracking Code Block

Below is the clean, refactored time tracking implementation for the backend engine:

### Core Timing Logic (AutonomousExplorationEngine.ts)

```typescript
// ═══════════════════════════════════════════════════════════════════════
// ACCUMULATIVE ACTIVE TIME TRACKING FOR TIMEBOX ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════

// Properties (add to class)
private elapsedActiveTimeMs: number = 0;           // Accumulates active execution time (ms)
private timingInterval: ReturnType<typeof setInterval> | null = null;  // 100ms tick interval
private lastTickTimestamp: number = 0;            // Last tick for delta calculation
private timeboxMs: number = 180000;              // Default 3 minutes
private timeboxExceeded: boolean = false;          // Flag: true after timeout

/**
 * Get accumulated active execution time in milliseconds.
 * Only counts time when the engine is NOT paused.
 */
public getElapsedActiveTimeMs(): number {
  return this.elapsedActiveTimeMs;
}

/**
 * Set accumulated active execution time (for resumable scenarios).
 */
public setElapsedActiveTimeMs(ms: number): void {
  this.elapsedActiveTimeMs = ms;
}

/**
 * Check if timebox has been exceeded.
 * Timebox exceeded ONLY triggers when NOT paused.
 * 
 * @param timeboxMs - Optional custom timebox (defaults to 180000 = 3 min)
 * @returns true if elapsedActiveTimeMs >= timeboxMs AND NOT paused
 */
public isTimeboxExceeded(timeboxMs: number = 180000): boolean {
  return this.elapsedActiveTimeMs >= timeboxMs && !this.isPaused;
}

/**
 * Start the timing interval that accumulates active time.
 * Time only accumulates when NOT paused.
 */
private startTimingInterval(): void {
  this.elapsedActiveTimeMs = 0;
  this.lastTickTimestamp = Date.now();
  this.timeboxExceeded = false;
  
  this.timingInterval = setInterval(() => {
    if (!this.isPaused && !this.isStopRequested) {
      const now = Date.now();
      const delta = now - this.lastTickTimestamp;
      this.elapsedActiveTimeMs += delta;
      this.lastTickTimestamp = now;
    } else {
      // When paused or stopped, just update tick reference without accumulating
      this.lastTickTimestamp = Date.now();
    }
  }, 100);
}

/**
 * Stop the timing interval.
 */
private stopTimingInterval(): void {
  if (this.timingInterval) {
    clearInterval(this.timingInterval);
    this.timingInterval = null;
  }
}

/**
 * Pause the engine.
 * When paused, time accumulation stops.
 */
public pause() {
  this.isPaused = true;
  // Note: timing interval continues running but skips accumulation when isPaused is true
}

/**
 * Resume the engine.
 * When resumed, time accumulation continues.
 */
public resume() {
  this.isPaused = false;
  // Note: lastTickTimestamp is updated by the interval to prevent time jump
}

/**
 * Stop the engine completely.
 */
public stop() {
  this.isStopRequested = true;
  this.isPaused = false;
  this.stopTimingInterval();
}

/**
 * Check if timebox exceeded and terminate gracefully if so.
 * Should be called at the start of each loop iteration.
 * 
 * @param telemetry - Telemetry gateway for emitting timeout event
 * @returns true if timebox exceeded (caller should exit loop), false otherwise
 */
private checkTimeboxAndTerminateIfExceeded(telemetry: TelemetryGateway): boolean {
  if (this.isTimeboxExceeded(this.timeboxMs) && !this.timeboxExceeded) {
    this.timeboxExceeded = true;
    this.stopTimingInterval();
    
    // Emit timeout telemetry
    telemetry.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'ACTION',
      meta: {
        actionExecuted: 'timebox-exceeded',
        message: `Execution timebox of ${this.timeboxMs}ms (${this.timeboxMs / 60000}min) exceeded - active time only`,
      },
    });
    
    return true;
  }
  return false;
}
```

### Integration in Main Exploration Loop

```typescript
// In the run() method, at the start of each iteration:
for (let step = 1; step <= maxSteps; step++) {
  // Check for stop request
  if (this.isStopRequested) {
    return { completed: false, reason: 'Safari session manually stopped by user.' };
  }

  // ─────────────────────────────────────────────────────────────
  // TIMEBOX CHECK - CRITICAL: Must check at each iteration
  // ─────────────────────────────────────────────────────────────
  if (this.checkTimeboxAndTerminateIfExceeded(telemetry)) {
    return { 
      completed: false, 
      reason: `Timebox of ${this.timeboxMs}ms (${this.timeboxMs / 60000}min) exceeded - active execution time only` 
    };
  }

  // Handle pause state - wait while paused
  while (this.isPaused) {
    if (this.isStopRequested) {
      return { completed: false, reason: 'Safari session manually stopped by user.' };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // ... rest of exploration logic
}
```

### Cleanup in Finally Block

```typescript
// In the run() method's finally block:
finally {
  // Clean up timing interval (critical to prevent ghost intervals)
  this.stopTimingInterval();
  
  // ... other cleanup
}
```

---

## Summary

The refactored implementation ensures:

1. **Accumulative Tracking**: `elapsedActiveTimeMs` only increments when `isPaused === false`
2. **Pause-Aware Timeout**: `isTimeboxExceeded()` returns true ONLY when both conditions are met:
   - `elapsedActiveTimeMs >= timeboxMs`
   - `isPaused === false` (engine is NOT paused)
3. **Graceful Termination**: Timebox exceeded triggers a clean exit with TIMEOUT telemetry
4. **No Ghost Intervals**: Proper cleanup of timing interval in finally block

This fix prevents the bug where pausing a safari for >3 minutes would cause the backend to forcefully kill the engine context.
