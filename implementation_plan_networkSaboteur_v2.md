# Implementation Plan

[Overview]
Update `networkSaboteur.ts` to integrate with BugSafari's automated telemetry pipeline by replacing console.log() outputs with structured TelemetryType.NETWORK events, and expand the freeze detection heuristics to cover modern SPA blocking patterns including skeleton loaders, overlay screens, and aria-disabled input fields.

The current implementation uses console.log() for telemetry output which doesn't feed the MongoDB backend or visual dashboard. Additionally, the freeze detection only checks for spinners/busy indicators, missing common modern SPA patterns that block user interaction.

[Types]
Single sentence describing type system changes.

Add optional telemetry parameter to execute function and expand the stuckSelectors array with modern SPA patterns.

**Existing Types Modified:**
```typescript
// Add optional telemetry parameter - current execute signature
type ExecuteFunction = (page: Page, target?: InteractiveElement) => Promise<void>;

// Proposed new execute signature with telemetry
type ExecuteFunctionWithTelemetry = (page: Page, target?: InteractiveElement, telemetry?: TelemetryGateway) => Promise<void>;
```

**New Types to Add:**
```typescript
// Extended stuckSelectors for modern SPA freeze detection
const EXPANDED_STUCK_SELECTORS = [
  // Original spinners and loading states
  '[aria-busy="true"]',
  '.loading',
  '.spinner',
  '.infinite-spinner',
  '[data-loading="true"]',
  // NEW: Skeleton placeholder components
  '.skeleton',
  '[class*="skeleton"]',
  '[class*="skeleton-"]',
  '[data-skeleton="true"]',
  // NEW: Full-screen blocking overlays
  '.overlay',
  '.modal-overlay',
  '[class*="overlay"]',
  '[class*="backdrop"]',
  // NEW: Full-screen blocking containers
  '.blocker',
  '[class*="blocker"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
] as const;

// Input fields check - aria-disabled across iterations
const INPUT_BLOCK_SELECTORS = [
  'input[aria-disabled="true"]',
  'textarea[aria-disabled="true"]',
  'select[aria-disabled="true"]',
  'input[disabled]',
  'textarea[disabled]',
  'select[disabled]',
] as const;
```

[Files]
Single sentence describing file modifications.

- **Modified**: `testing-core/src/domain/scenarios/networkSaboteur.ts` - Replace console.log with telemetry and expand freeze detection

**Detailed breakdown:**
- Existing files to be modified:
  - `testing-core/src/domain/scenarios/networkSaboteur.ts` - Main implementation file with telemetry integration and expanded heuristics

**No new files required** - This is an enhancement of existing functionality within the same file.

[Functions]
Single sentence describing function modifications.

**Modified Function: execute() in networkSaboteur**
- Current behavior: Uses console.log() for output, limited stuckSelectors
- Required changes:
  1. Add optional `telemetry?: TelemetryGateway` parameter to execute function
  2. Replace all console.log() statements with telemetry.emitTelemetry() calls using TelemetryType.NETWORK
  3. Expand stuckSelectors array with skeleton, overlay, backdrop, and modal patterns
  4. Add aria-disabled input field detection with multiple iteration checks

**New Internal Helper Functions:**
- `buildNetworkTelemetryEvent(mode, url, message)` - Create properly typed TelemetryEvent for NETWORK type
- `checkForFreezeState(page)` - Unified freeze detection using expanded selectors
- `checkInputFieldsDisabled(page)` - Check if input fields stuck with aria-disabled

**Existing Functions Modified:**
- `safeAbort(route)` - Add telemetry emission on abort failure
- `safeContinue(route)` - Add telemetry emission on continue failure

**Existing Functions Unchanged:**
- `isNonFatalError(error: Error)` - Keep as is
- `randomDelayMs()` - Keep as is  
- `chooseMode()` - Keep as is
- `shouldExcludeRequest(url, excludeExtensions)` - Keep as is

[Classes]
Single sentence describing class modifications.

No class modifications required. The implementation uses module-based export pattern following existing architecture.

**Detailed breakdown:**
- No new classes
- No modified classes
- No removed classes

[Dependencies]
Single sentence describing dependency modifications.

Add TelemetryGateway type import. No new npm dependencies required.

**Detailed breakdown:**
- Import `TelemetryGateway` from `../../application/ports/TelemetryGateway.js`
- Import `TelemetryType` from `@bugsafari/shared` (or `../../../../shared/types.js`)
- Playwright 1.59.1 - Already in use
- No version changes required

[Testing]
Single sentence describing testing approach.

Test the implementation by running the stress scenario manually and verifying telemetry event emission and freeze detection behavior.

**Test File Requirements:**
- No new test files required
- Run manual testing in browser environment
- Verify network telemetry events in dashboard
- Verify expanded freeze detection works

**Validation Strategies:**
1. Test delayed mode - verify NETWORK telemetry is emitted with correct structure
2. Test aborted mode - verify NETWORK telemetry is emitted
3. Test freeze detection - verify skeleton/overlay/aria-disabled detection works
4. Run existing test suite to confirm no regressions
5. Verify telemetry format matches TelemetryEvent interface

[Implementation Order]
Single sentence describing implementation sequence.

Implement changes in coordinated single-file modification within networkSaboteur.ts.

Numbered steps:
1. **Step 1**: Add TelemetryGateway import and optional parameter to execute function signature
2. **Step 2**: Replace console.log() statements with telemetry.emitTelemetry() using TelemetryType.NETWORK
3. **Step 3**: Expand stuckSelectors array with skeleton, overlay, backdrop patterns
4. **Step 4**: Add aria-disabled input field detection with iteration checking
5. **Step 5**: Update helper functions for consistent telemetry emission
6. **Step 6**: Verify backward compatibility - execute still works without telemetry parameter
7. **Step 7**: Test and verify all changes work correctly

---

## Implementation Details

### Current vs. Proposed Architecture

**Current (console.log Output):**
```typescript
console.log(
  `[Telemetry:ACTION] 📡 Network Saboteur: Intentionally Delayed API call to ${sabotagedUrl} to test error resilience.`
);
console.log('[StressScenario:NetworkSaboteur] UI appears "System Locked" (frozen) after sabotage');
```

**Proposed (Telemetry Pipeline):**
```typescript
// Replace with structured telemetry
const emitNetworkTelemetry = (message: string, meta?: TelemetryMeta) => {
  if (telemetry) {
    telemetry.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'NETWORK',
      meta: {
        url: sabotageUrl,
        message,
        ...meta,
      },
    });
  }
};

emitNetworkTelemetry(`Network Saboteur: ${mode} API call to ${sabotagedUrl}`);
```

### Current vs. Proposed Freeze Detection

**Current (Limited):**
```typescript
const stuckSelectors = [
  '[aria-busy="true"]',
  '.loading',
  '.spinner',
  '.infinite-spinner',
  '[data-loading="true"]',
];
```

**Proposed (Expanded):**
```typescript
const STUCK_SELECTORS = [
  // Original - keep
  '[aria-busy="true"]',
  '.loading',
  '.spinner',
  '.infinite-spinner',
  '[data-loading="true"]',
  // NEW: Skeleton components
  '.skeleton',
  '[class*="skeleton"]',
  '[data-skeleton="true"]',
  // NEW: Overlays and backdrops
  '.overlay',
  '.modal-overlay',
  '[class*="overlay"]',
  '[class*="backdrop"]',
  // NEW: Blocking containers
  '[role="alertdialog"]',
  '[aria-modal="true"]',
] as const;

// NEW: Input field stuck detection
const INPUT_BLOCK_SELECTORS = [
  'input[aria-disabled="true"]',
  'textarea[aria-disabled="true"]',
  'select[aria-disabled="true"]',
  'input[disabled]',
] as const;
```

### TelemetryEvent Structure

```typescript
// Required structure per shared/types.ts
interface TelemetryEvent {
  timestamp: string;
  type: TelemetryType;  // 'NETWORK' | 'ACTION' | 'EXCEPTION' | 'HEURISTIC_SCORE' | 'BUG'
  meta: TelemetryMeta;
}

interface TelemetryMeta {
  url?: string;
  method?: string;
  statusCode?: number;
  message?: string;
  // ... other optional fields
}
```

### Backward Compatibility

- Execute function signature: `(page: Page, target?: InteractiveElement)` - Keep optional second parameter only
- New optional parameter `telemetry?: TelemetryGateway` - MUST be optional (last parameter, default undefined)
- If telemetry is undefined, degrade gracefully (silent operation or console.log fallback)
- StressScenario interface must remain unchanged in types.ts

### Edge Cases

1. **No Telemetry Provided**: Continue silently without telemetry (backward compatible)
2. **Multiple Iteration Checks**: Track aria-disabled state across multiple checks to detect stuck state
3. **Non-Fatal Errors**: Continue gracefully using existing isNonFatalError pattern
4. **Page Closed During Interception**: Clean up handler, don't throw
5. **Null Page/Undefined**: Handle gracefully with null checks

---

## Quality Standards

1. **Type Safety**: All new code must be fully typed with TypeScript
2. **Error Handling**: Use existing isNonFatalError pattern for graceful degradation
3. **Telemetry Format**: Match TelemetryEvent interface exactly for dashboard compatibility
4. **Performance**: Pre-filter static assets before route handler (existing optimization)
5. **Cleanup**: Always unroute handler in finally block to prevent leaked handlers
6. **Backward Compatibility**: Execute works without telemetry parameter

---

## Key Technical Details

### TelemetryGateway Interface

```typescript
interface TelemetryGateway {
  emitTelemetry(event: TelemetryEvent): void;
  emitTargets(targets: DiscoveredElement[]): void;
  emitLiveFrame(base64Jpeg: string): void;
  emitForensicReport(report: ForensicCrashReport): void;
  emitIncidentReport(report: IncidentReport): void;
  emitUrlChanged(url: string): void;
}
```

### Why TelemetryType.NETWORK

- Network events should use type 'NETWORK' per shared/types.ts
- This feeds both MongoDB FindingModel and visual dashboard stream
- Dashboard filters by type for visualization

### How Network Saboteur is Called

```typescript
// In AutonomousExplorationEngine.ts
await networkSaboteur.execute(page);

// Proposed new call with telemetry
await networkSaboteur.execute(page, undefined, telemetry);
```

The telemetry parameter will be added as an optional third parameter to maintain backward compatibility.
