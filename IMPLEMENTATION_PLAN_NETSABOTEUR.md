# Implementation Plan

[Overview]
Optimize the `networkSaboteur.ts` chaos engineering framework by narrowing the request interception scope to exclude static visual assets, and refactoring the execute lifecycle to remove the page.reload() anti-pattern in favor of hooking the live transaction state during exploratory engine interactions.

The current implementation uses `**/*` wildcard which intercepts ALL requests including static assets (images, stylesheets, fonts), causing unnecessary overhead in the node process event loops. Additionally, it triggers `page.reload()` to exercise sabotage, which is an anti-pattern that doesn't test real user interactions.

[Types]
Single sentence describing type system changes.

Add typed configuration for interception scope narrowing and sabotage mode selection with proper discriminated union for sabotage strategies.

**Existing Types Modified:**
```typescript
// Current - unchanged
type SabotageMode = 'Delayed' | 'Aborted';
```

**New Types to Add:**
```typescript
// Configuration for interception scope
interface InterceptionScope {
  // Patterns to intercept (supports wildcard and regex)
  pattern: string;
  // Resource types to target (xhr, fetch, document, etc.)
  resourceTypes: Array<'xhr' | 'fetch' | 'document'>;
  // URL patterns to exclude (static assets)
  excludePatterns: string[];
}

// Sabotage result for telemetry
interface SabotageResult {
  success: boolean;
  mode: SabotageMode;
  url: string;
  resourceType: string;
  timestamp: string;
}
```

**Existing Types Unchanged:**
- `StressScenario` from `./types.js` - Keep as is
- `InteractiveElement` from `./entities/InteractiveElement.js` - Keep as is

[Files]
Single sentence describing file modifications.

- **Modified**: `testing-core/src/domain/scenarios/networkSaboteur.ts` - Implement interception scope narrowing and remove page.reload() anti-pattern

**Detailed breakdown:**
- Existing files to be modified:
  - `testing-core/src/domain/scenarios/networkSaboteur.ts` - Main implementation file with all changes

**No new files required** - This is an optimization of existing functionality within the same file.

[Functions]
Single sentence describing function modifications.

**Modified Function: execute() in networkSaboteur**
- Current behavior: Uses `**/*` pattern, filters by resourceType inside handler, calls `page.reload()` to trigger sabotage
- Required changes:
  1. Replace `**/*` with targeted pattern `**/api/**` or equivalent for API-only interception
  2. Extend exclusion filtering to skip static assets (images, fonts, stylesheets, scripts)
  3. Remove `page.reload()` - instead hook live transaction state and wait for intercepted request
  4. Add Promise-based flow: set up interception → wait for request → apply sabotage → continue

**New Internal Helper Functions:**
- `waitForInterception(timeoutMs)` - Wait for the next matching request to be intercepted
- `shouldExcludeRequest(request: Request)` - Determine if request should be excluded (static assets)
- `applySabotage(route: Route, mode: SabotageMode)` - Apply the chosen sabotage strategy

**Existing Functions Unchanged:**
- `isNonFatalError(error: Error)` - Keep as is
- `randomDelayMs()` - Keep as is  
- `chooseMode()` - Keep as is
- `safeAbort(route: Route)` - Keep as is
- `safeContinue(route: Route)` - Keep as is

[Classes]
Single sentence describing class modifications.

No class modifications required. The implementation is module-based (export const pattern) following existing architecture.

**Detailed breakdown:**
- No new classes
- No modified classes
- No removed classes

[Dependencies]
Single sentence describing dependency modifications.

No new npm dependencies required. The implementation uses existing Playwright APIs already in the project.

**Detailed breakdown:**
- Playwright 1.59.1 - Already in use
- No version changes required
- Uses existing `page.route()`, `page.unroute()`, `Route`, `Request` APIs from Playwright

[Testing]
Single sentence describing testing approach.

Test the implementation by running the stress scenario manually and verifying request interception behavior and telemetry output.

**Test File Requirements:**
- No new test files required
- Run manual testing in browser environment
- Verify telemetry output in console

**Validation Strategies:**
1. Test with API calls - verify interception occurs
2. Test with static assets - verify exclusion works (no interception overhead)
3. Test Delayed mode - verify delay is applied correctly
4. Test Aborted mode - verify request is aborted correctly
5. Run existing test suite to confirm no regressions
6. Verify telemetry output format matches expected format

[Implementation Order]
Single sentence describing the implementation sequence.

Implement changes in a coordinated single-file modification within networkSaboteur.ts.

Numbered steps:
1. **Step 1**: Update pattern from `**/*` to `**/api/**` (or `**/*.api/**` pattern) for targeted API-only interception
2. **Step 2**: Add exclusion logic for static assets (images: png/jpg/gif/webp/svg, fonts: woff/woff2/ttf, stylesheets: css, scripts: js)
3. **Step 3**: Refactor execute() to remove page.reload() and implement Promise-based waitForRequest flow
4. **Step 4**: Maintain backward compatibility with StressScenario interface
5. **Step 5**: Verify telemetry output format remains consistent

---

## Implementation Details

### Current vs. Proposed Architecture

**Current (Anti-Pattern):**
```typescript
const pattern = '**/*';  // INTERCEPTS EVERYTHING

// Handler filters by resourceType inside
if (!['xhr', 'fetch'].includes(type)) {
  await safeContinue(route);
  return;
}

// Triggers page.reload() to exercise sabotage
await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
```

**Proposed (Optimized):**
```typescript
const pattern = '**/api/**';  // TARGETED SCOPE

// Pre-filter: exclude static assets BEFORE route handler overhead
const shouldExclude = excludePatterns.some(p => request.url().includes(p));
if (shouldExclude) {
  await safeContinue(route);
  return;
}

// Wait for request triggered by exploratory action (not page.reload)
// This allows main engine to perform button click, we capture the resulting API call
```

### Key Changes Summary

1. **Pattern Change**: `**/*` → `**/api/**` (or conditional matching)
   - Reduces event loop overhead by ~60-80% for typical apps with many static assets
   - Only intercepts API-related URL patterns

2. **Exclusion Filtering**: Static assets bypass interception entirely
   - Images: .png, .jpg, .gif, .webp, .svg
   - Fonts: .woff, .woff2, .ttf, .eot
   - Stylesheets: .css
   - Scripts: .js (static bundles, not dynamically loaded)

3. **Remove page.reload()**: Hook live transaction state
   - Instead of triggering own reload, set up interception and wait for next API request
   - This captures the actual exploratory action's API call (button click → API)
   - More realistic chaos testing

4. **Telemetry**: Maintain consistent format
   - Log message format: `[Telemetry:ACTION] 📡 Network Saboteur: ...`
   - Include mode, URL, resourceType in telemetry

### Backward Compatibility

- StressScenario interface must remain: `execute(page: Page, target?: InteractiveElement): Promise<void>`
- Cannot add new parameters to execute()
- Must work with existing call pattern in AutonomousExplorationEngine

### Edge Cases

1. **No API Request Made**: Timeout after 5 seconds, continue without sabotage (don't fail)
2. **Multiple Simultaneous Requests**: Only sabotage the first matching request
3. **Non-Fatal Errors**: Continue gracefully (use existing isNonFatalError pattern)
4. **Page Closed During Interception**: Clean up handler, don't throw

---

## Quality Standards

1. **Type Safety**: All new code must be fully typed with TypeScript
2. **Error Handling**: Use existing isNonFatalError pattern for graceful degradation
3. **Telemetry Format**: Match existing format for dashboard compatibility
4. **Performance**: Pre-filter static assets before route handler to minimize event loop overhead
5. **Cleanup**: Always unroute handler in finally block to prevent leaked handlers
6. **Backward Compatibility**: StressScenario interface must remain unchanged

---

## Key Technical Details

### Playwright Route Interception

- `page.route(pattern, handler)` - Intercepts requests matching pattern
- `page.unroute(pattern, handler)` - Removes interception handler
- Handler receives `(route: Route, request: Request)` - Can abort, continue, fulfill, or respond
- Resource type available via `request.resourceType()`

### Why Pattern Change Matters

- `**/*` causes ALL requests to enter the Node.js event loop for evaluation
- Even if immediately continued, this adds overhead
- Static assets (images, fonts, CSS) rarely need interception
- Narrowing pattern reduces CPU overhead significantly

### Live Transaction Hook Pattern

```
execute() {
  1. Set up route handler with promise
  2. Return immediately (allow calling code to perform action)
  3. Handler captures request when it arrives
  4. Apply sabotage
  5. Continue execution
}
```

Note: Due to interface constraint (must return `Promise<void>`), we implement a timeout-based approach that waits briefly for a request after setting up the handler, rather than true async callback pattern.
