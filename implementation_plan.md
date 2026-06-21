# Implementation Plan

## Overview
Clean up the `startTimingInterval` method in `AutonomousExplorationEngine.ts` by removing telemetry emissions for infrastructure time updates while preserving internal time tracking logic for the 3-minute hard stop enforcement.

## Context
The `startTimingInterval` method runs a 100ms interval that accumulates active execution time. Every 10 ticks (1 second), it emits `actionExecuted: 'time-remaining'` telemetry. This floods the console telemetry feed with unnecessary numeric streams ("179999", "178999", etc.) that clutter user action telemetry logs. The internal time tracking must continue to enforce the 3-minute hard stop.

## Changes Required

### Files
- **Modified**: `testing-core/src/domain/services/AutonomousExplorationEngine.ts`

### Method Changes
- **Modified**: `startTimingInterval` method - Remove the `telemetry.emitTelemetry` call inside the `tickCounter >= 10` block while preserving:
  - `remainingTimeMs` calculation
  - `this.elapsedActiveTimeMs` update logic
  - `this.lastTickTimestamp` tracking
  - The interval itself continues to run normally

### Implementation Order
1. Read the current `startTimingInterval` method
2. Edit the method to remove/comment out only the `telemetry.emitTelemetry` call inside the `if (tickCounter >= 10)` block
3. Keep all internal variable calculations (`remainingTimeMs`, `elapsedActiveTimeMs`, `tickCounter`, etc.)
4. Verify the changes compile correctly

## Detailed Implementation

### Current Block (Lines to modify):
```typescript
tickCounter++;
if (tickCounter >= 10) {
  tickCounter = 0;
  const remainingTimeMs = Math.max(0, this.timeboxMs - this.elapsedActiveTimeMs);
  telemetry.emitTelemetry({
    timestamp: new Date().toISOString(),
    type: 'ACTION',
    meta: {
      actionExecuted: 'time-remaining',
      message: `${remainingTimeMs}`,
      remainingTimeMs,
      elapsedTimeMs: this.elapsedActiveTimeMs,
    },
  });
}
```

### New Block (After modification):
```typescript
tickCounter++;
if (tickCounter >= 10) {
  tickCounter = 0;
  const remainingTimeMs = Math.max(0, this.timeboxMs - this.elapsedActiveTimeMs);
  // INFRASTRUCTURE TIME UPDATES REMOVED - Internal tracking continues for hard stop enforcement
  // The time tracking logic still runs below to enforce 3-minute timeout
  // Note: remainingTimeMs calculated but not emitted to reduce console noise
}
```

## Task Progress
- [ ] Step 1: Verify the exact location of the code to modify
- [ ] Step 2: Apply the edit to remove telemetry.emitTelemetry from the tickCounter >= 10 block
- [ ] Step 3: Verify the code compiles correctly
- [ ] Step 4: Complete the implementation
