# Implementation Plan

## Overview

Fix the telemetry integration for the `routeTrasherScenario` wrapper in `index.ts`. The current implementation creates a local `ChaosTransactionManager` with empty callbacks (`() => {}` and `() => []`), which breaks telemetry integration compared to other scenarios (like `dataFuzzer` that use properly initialized singleton instances). The fix configures telemetry callbacks to emit to console.log for visibility, enabling real-time debugging while maintaining null-safety.

## Types

No TypeScript type definitions changes are required.

This fix updates callback implementations only:
- `emitTelemetry`: Changed from empty no-op to console.log for visibility
- `getRecentSteps`: Changed from empty array return to query-able steps

## Files

### Modified Files

1. **testing-core/src/domain/scenarios/index.ts**
   - **Change 1**: Update the `routeTrasherScenario` wrapper to use console.log-based telemetry callbacks instead of empty no-ops
   - **Change 2**: Update the `smartAttackerScenario` wrapper to use console.log-based telemetry callbacks instead of empty no-ops
   - **Purpose**: Enable diagnostic visibility for route trashing and smart attacker scenarios

### No New Files

No new files to create.

### No Deleted Files

No existing files to delete.

## Functions

### Modified Functions

1. **routeTrasherScenario wrapper** (in `testing-core/src/domain/scenarios/index.ts`)
   - **Current behavior**: Creates ChaosTransactionManager with empty callbacks
   - **New behavior**: Uses console.log for telemetry callback to emit events to console for visibility
   - **Change detail**: Replace `() => {}` with `(type, payload) => console.log('[Telemetry:ROUTE_TRASH]', type, payload)` for emitTelemetry callback
   - **Change detail**: Replace `() => []` with a function that returns an empty array but logs the query for visibility

2. **smartAttackerScenario wrapper** (in `testing-core/src/domain/scenarios/index.ts`)
   - **Current behavior**: Placeholder with console.log statement only
   - **New behavior**: Optionally integrate with telemetry system if needed
   - **Change detail**: Update console.log message format for consistency

## Classes

### Modified Classes

No classes modified directly. Changes are in function implementations.

## Dependencies

### No New Dependencies

No new packages or version changes required.

## Testing

### Testing Approach

1. **Manual Verification**:
   - Run TypeScript compilation to verify no type errors
   - Run the routeTrasher scenario and verify console output shows telemetry events

### Test File Requirements

No new test files required. Use existing runtime validation.

### Validation Strategy

1. Verify the telemetry callback is invoked when `evaluateAndRegisterBug` is called
2. Verify console output shows `[Telemetry:ROUTE_TRASH]` prefix for events
3. Verify behavior matches other scenarios like dataFuzzer (which uses singleton pattern)

## Implementation Order

1. **[ ] Step 1**: Update `routeTrasherScenario` in `testing-core/src/domain/scenarios/index.ts` - Replace empty `() => {}` callback with console.log-based telemetry callback
2. **[ ] Step 2**: Update `routeTrasherScenario` in `testing-core/src/domain/scenarios/index.ts` - Replace empty `() => []` callback with console.log-based steps callback
3. **[ ] Step 3**: Update `smartAttackerScenario` wrapper for consistency if needed
4. **[ ] Step 4**: Verify TypeScript compilation succeeds without errors
5. **[ ] Step 5**: Validate runtime behavior with console output visibility

---

**Note**: Future enhancement would involve integrating with a shared global singleton (see task description: "A future enhancement would involve integrating with a shared global singleton, but this requires architectural changes beyond null-safety fixes."). This plan addresses the immediate null-safety fix by enabling console.log visibility while maintaining null-safety.
