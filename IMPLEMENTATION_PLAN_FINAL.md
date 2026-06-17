# Implementation Plan - Network Saboteur Refactor

[Overview]
Refactor `networkSaboteur.ts` to implement interception scope restriction for static visual assets, remove page.reload() anti-pattern in favor of hooking live mid-flight asynchronous transaction states, and ensure complete alignment with monorepo type safety contracts.

[Types]
**No new types required** - Existing types are sufficient:
- `InterceptionConfig` - Already defined with pattern, targetResourceTypes, excludeExtensions
- `SabotageMode` - Already defined as 'Delayed' | 'Aborted'
- `TelemetryEvent`, `TelemetryMeta`, `TelemetryType` - Already imported from shared/types.js

**Type refinement:**
- Current `pattern: '**/api/**'` is too narrow - many APIs don't include `/api/` in path
- Need to expand pattern to catch more API endpoints or use multiple patterns

[Files]
**Single File Modified:**
- `testing-core/src/domain/scenarios/networkSaboteur.ts`

**Changes:**
1. Expand routing patterns to catch API endpoints (not just `/api/**`)
2. Ensure pre-filter optimization for static assets is working correctly
3. Maintain backward compatibility with StressScenario interface

[Functions]
**Modified: execute() in networkSaboteur**
- Current behavior: Uses `**/api/**` pattern, wait timeout for interception
- Required changes:
  1. Expand pattern to catch more API endpoints (e.g., `**/api/**`, `**/*.api/**`, `**/graphql`, `**/v[0-9]/**`)
  2. Add fallback patterns for common API prefixes
  3. Maintain current timeout-based live transaction hook pattern
  4. Continue using telemetry integration when available

**Existing Functions Unchanged:**
- `isNonFatalError(error: Error)` - Keep as is
- `randomDelayMs()` - Keep as is  
- `chooseMode()` - Keep as is
- `safeAbort(route: Route)` - Keep as is
- `safeContinue(route: Route)` - Keep as is
- `shouldExcludeRequest(url, excludeExtensions)` - Keep as is
- `checkForFreezeState(page)` - Keep as is
- `checkInputFieldsDisabled(page)` - Keep as is

[Classes]
**No class modifications required** - Using module-based export pattern

[Dependencies]
**No new dependencies required**
- Playwright - Already in use
- Existing types - Already imported

[Testing]
**Validation Strategy:**
1. Test with various API endpoints - verify interception occurs
2. Test with static assets - verify exclusion works
3. Test Delayed mode - verify delay applied correctly
4. Test Aborted mode - verify request aborted correctly
5. Verify telemetry output in dashboard

[Implementation Order]
1. Expand InterceptionConfig with additionalPatterns array for broader API coverage
2. Add support for common API prefixes (GraphQL, REST versioning)
3. Register multiple patterns in execute() using try-catch for non-matching patterns
4. Ensure static asset pre-filter continues working optimally
5. Verify backward compatibility with StressScenario interface

---

## Detailed Implementation

### Current vs. Proposed Pattern Change

**Current (Too Narrow):**
```typescript
pattern: '**/api/**',
```

**Proposed (Expanded Coverage):**
```typescript
// Primary pattern for REST APIs
pattern: '**/api/**',

// Additional patterns for GraphQL and versioned APIs
// These will be registered via multiple page.route() calls
const ADDITIONAL_PATTERNS = [
  '**/*.api',
  '**/graphql',
  '**/v[0-9]/*',
  '**/v[0-9][0-9]/*',
];
```

### Implementation Details

The key insight from analyzing AutonomousExplorationEngine.ts is:
- `networkSaboteur.execute(page)` is called WITHOUT telemetry parameter currently
- The telemetry is passed as a separate call in the main engine
- Need to ensure the updated code works with existing call patterns

### Current Code Already Implements:

✅ Interception scope narrowing via pattern `'**/api/**'`
✅ Static asset exclusion via `excludeExtensions` array  
✅ Pre-filter via `shouldExcludeRequest()` function
✅ Expanded STUCK_SELECTORS for freeze detection
✅ INPUT_BLOCK_SELECTORS for aria-disabled detection
✅ Telemetry integration via optional `_telemetry` parameter
✅ Timeout-based live transaction hook (no page.reload())
✅ Proper cleanup in finally block via `page.unroute()`

### What Needs Enhancement:

1. **Pattern Expansion** - Current `'**/api/**'` misses many APIs
2. **Multiple Pattern Support** - Need to register additional patterns

### Final Code Structure

```typescript
const DEFAULT_CONFIG: InterceptionConfig = {
  // Expanded: include multiple common API patterns
  pattern: '**/api/**',
  additionalPatterns: [
    '**/*.api',
    '**/graphql',
    '**/v[0-9]/*',
  ],
  targetResourceTypes: ['xhr', 'fetch'],
  excludeExtensions: [...], // Already comprehensive
  interceptionTimeoutMs: 5000,
};
```

[Quality Standards]
1. **Type Safety** - Fully typed
2. **Error Handling** - isNonFatalError pattern for graceful degradation
3. **Telemetry Format** - Match TelemetryEvent interface
4. **Performance** - Pre-filter static assets before route handler
5. **Cleanup** - Always unroute in finally block
6. **Backward Compatibility** - execute works without telemetry
