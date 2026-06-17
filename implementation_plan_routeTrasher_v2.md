# Implementation Plan

[Overview]
Upgrade `routeTrasher.ts` to fully integrate into BugSafari's consolidated generic `ChaosTransactionManager` pipeline and expand its capabilities beyond simple history clicking to support full route mutation detection.

This implementation extends the existing chaos testing infrastructure following the same patterns as `fuzzGuard` and `concurrentStressGuard`, supporting route navigation stress testing with proper transaction tracking, bug detection, and enhanced metadata collection.

[Types]

## RouteTrashMetadata Enhancement
Update existing `RouteTrashMetadata` interface in ChaosTransactionManager.ts to include enhanced navigation context fields while maintaining backward compatibility:

```typescript
export interface RouteTrashMetadata {
  originPath: string;
  targetPath: string; // Keep for backward compatibility with older logs
  injectedPath?: string;
  navigationType?: 'history_back' | 'history_forward' | 'query_mutation' | 'malformed_push';
}
```

## BugClass Addition
Add `'ROUTE_MUTATION_FAILURE'` to the BugClass type in `testing-core/src/bugs/types.ts`:
```typescript
export type BugClass =
  | 'INPUT_SANITIZATION_FAILURE'
  | 'CLIENT_SIDE_CONSTRAINT_BYPASS'
  | 'NOSQL_INJECTION'
  | 'SPA_STATE_RACE_CONDITION'
  | 'STRUCTURAL_NAVIGATION_LOGIC'
  | 'RUNTIME_STABILITY_EXCEPTION'
  | 'BOUNDARY_STRESS_FAILURE'
  | 'FUZZ_VULNERABILITY_LEAK'
  | 'SECURITY_VULNERABILITY_LEAK'
  | 'CASCADING_STATE_FAILURE'
  | 'ROUTE_MUTATION_FAILURE';  // NEW
```

[Files]

## New Files to Create

- `testing-core/src/bugs/finders/structuralProbe.ts`
  - Purpose: Detects infinite redirect loops and component resolution failures during route mutation testing
  - Exports: `structuralProbeFinder` as BugFinder, `setChaosManagerAccessor()` function
  - Pattern: Follows same singleton accessor pattern as fuzzGuard

## Existing Files to Modify

1. **testing-core/src/domain/fuzzing/ChaosTransactionManager.ts**
   - Update `RouteTrashMetadata` interface with new optional fields
   - Add `'ROUTE_TRASH'` to ChaosContextType (already exists)

2. **testing-core/src/domain/scenarios/routeTrasher.ts**
   - Import ChaosTransactionManager and related types
   - Add optional chaosManager parameter to execute() for DI
   - Integrate transaction lifecycle: startTransaction/closeTransaction
   - Update metadata with navigationType and injectedPath

3. **testing-core/src/bugs/types.ts**
   - Add `'ROUTE_MUTATION_FAILURE'` to BugClass type union

4. **testing-core/src/bugs/registry.ts**
   - Import and add structuralProbeFinder to bug finders array

[Functions]

## New Functions

### setChaosManagerAccessor (in testing-core/src/bugs/finders/structuralProbe.ts)
```typescript
export function setChaosManagerAccessor(
  accessor: {
    getChaosType(): ChaosContextType | null;
    getActiveMetadata(): RouteTrashMetadata | undefined;
  } | null
): void
```

### structuralProbeFinder (in testing-core/src/bugs/finders/structuralProbe.ts)
```typescript
export const structuralProbeFinder: BugFinder = {
  bugClass: 'ROUTE_MUTATION_FAILURE',
  async isApplicable(ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean>
  async run(ctx: BugContext): Promise<BugFinding[]>
};
```

## Modified Functions

### routeTrasher.execute (in testing-core/src/domain/scenarios/routeTrasher.ts)
- Add parameter: `chaosManager?: ChaosTransactionManager<RouteTrashMetadata>`
- Open transaction at start: `chaosManager.startTransaction(page.url(), 'ROUTE_TRASH', metadata)`
- Update metadata with navigationType per iteration
- Close transaction at end: `chaosManager.closeTransaction()`

[Classes]

No new classes required. The implementation adds function exports following existing patterns.

[Dependencies]

No new npm dependencies required. The implementation uses existing:
- `ChaosTransactionManager` - Already exists
- `ChaosContextType` - Already includes 'ROUTE_TRASH'
- `RouteTrashMetadata` - Already defined (to be enhanced)
- Playwright - Already in use

[Testing]

## Test Requirements

1. Integration test for routeTrasher with ChaosTransactionManager via DI
2. Verify transaction opens with correct ROUTE_TRASH type and metadata
3. Verify metadata includes navigationType ('history_back', 'history_forward')
4. Verify structuralProbeFinder detects route mutation issues
5. Verify ROUTE_MUTATION_FAILURE findings are logged

## Validation Strategies

1. Test routeTrasher.startTransaction() is called with correct type
2. Test metadata contains navigationType matching the operation
3. Test structuralProbeFinder.isApplicable() returns true for ROUTE_TRASH transactions
4. Test findings include 'ROUTE_MUTATION_FAILURE' bugClass

[Implementation Order]

1. **Step 1**: Update RouteTrashMetadata in ChaosTransactionManager.ts (enhance interface with optional navigationType/injectedPath)
2. **Step 2**: Add 'ROUTE_MUTATION_FAILURE' to BugClass in types.ts
3. **Step 3**: Create new structuralProbeFinder BugFinder (testing-core/src/bugs/finders/structuralProbe.ts)
4. **Step 4**: Integrate ChaosTransactionManager into routeTrasher.ts (add chaosManager param, transaction lifecycle)
5. **Step 5**: Register structuralProbeFinder in registry.ts
6. **Step 6**: Validate - build and test the integration

---

## Technical Implementation Details

### RouteTrasher Integration Pattern (with DI)

```typescript
import type { Page } from 'playwright';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';
import type { StressScenario } from './types.js';
import type { ChaosTransactionManager, RouteTrashMetadata } from '../fuzzing/index.js';

// RouteTrasher stress scenario with ChaosTransactionManager integration
export const routeTrasher = {
  name: 'RouteTrasher',

  async execute(
    page: Page,
    target?: InteractiveElement | number,
    chaosManager?: ChaosTransactionManager<RouteTrashMetadata>
  ): Promise<RouteTrashResult> {
    const originPath = page.url();
    const repetitions = /* ... logic from existing code ... */;

    // Initialize enhanced metadata
    const metadata: RouteTrashMetadata = {
      originPath: originPath,
      targetPath: '',
      // New optional fields (will be populated during iteration)
      injectedPath: undefined,
      navigationType: undefined,
    };

    // Open transaction with enhanced metadata
    chaosManager?.startTransaction('page', 'ROUTE_TRASH', metadata);

    console.log(
      `[StressScenario:RouteTrasher] Starting route trashing with ${repetitions} repetitions`
    );

    let completed = 0;
    let attempted = 0;

    for (let i = 0; i < repetitions; i++) {
      attempted++;

      // goBack
      try {
        const backSuccess = await safeNavigation(page, 'goBack');
        if (backSuccess) {
          completed++;
          
          // Update metadata with navigation type
          if (chaosManager) {
            const activeMeta = chaosManager.getActiveMetadata();
            if (activeMeta) {
              activeMeta.injectedPath = page.url();
              activeMeta.navigationType = 'history_back';
              activeMeta.targetPath = page.url();
            }
          }
          
          console.log(
            `[StressScenario:RouteTrasher] Iteration ${i + 1}: goBack completed`
          );
        }
      } catch (error) {
        /* ... error handling ... */
      }

      // Small delay between nav operations
      await new Promise((resolve) => setTimeout(resolve, 50));

      attempted++;

      // goForward - same pattern with 'history_forward'
      try {
        const forwardSuccess = await safeNavigation(page, 'goForward');
        if (forwardSuccess) {
          completed++;
          
          // Update metadata with navigation type
          if (chaosManager) {
            const activeMeta = chaosManager.getActiveMetadata();
            if (activeMeta) {
              activeMeta.injectedPath = page.url();
              activeMeta.navigationType = 'history_forward';
              activeMeta.targetPath = page.url();
            }
          }
          
          console.log(
            `[StressScenario:RouteTrasher] Iteration ${i + 1}: goForward completed`
          );
        }
      } catch (error) {
        /* ... error handling ... */
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Close transaction
    chaosManager?.closeTransaction();

    console.log(
      `[StressScenario:RouteTrasher] Completed ${completed}/${attempted} navigation actions`
    );

    return { attempted, completed };
  },
};
```

### StructuralProbeFinder Pattern (following fuzzGuard)

```typescript
import type { BugFinder, BugContext, BugFinding } from '../types.js';
import type { ChaosContextType, RouteTrashMetadata } from '../../domain/fuzzing/index.js';

// Singleton accessor following fuzzGuard pattern
let chaosManagerAccessor: {
  getChaosType(): ChaosContextType | null;
  getActiveMetadata(): RouteTrashMetadata | undefined;
} | null = null;

export function setChaosManagerAccessor(
  accessor: typeof chaosManagerAccessor
): void {
  chaosManagerAccessor = accessor;
}

function hasActiveRouteTrashTransaction(): boolean {
  return chaosManagerAccessor?.getChaosType() === 'ROUTE_TRASH';
}

// Redirect loop detection patterns
const REDIRECT_LOOP_PATTERNS = [
  /redirected/i,
  /too many redirects/i,
  /redirect loop/i,
  /ERR_TOO_MANY_REDIRECTS/i,
];

// Component resolution failure patterns
const COMPONENT_FAIL_PATTERNS = [
  /cannot read property .* of undefined/i,
  /is not a function/i,
  /failed to resolve/i,
  /module not found/i,
  /chunk.*not found/i,
  /loading failed/i,
  /network error/i,
];

export const structuralProbeFinder: BugFinder = {
  bugClass: 'ROUTE_MUTATION_FAILURE',

  async isApplicable(ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> {
    if (!chaosManagerAccessor) return false;
    return hasActiveRouteTrashTransaction();
  },

  async run(ctx: BugContext): Promise<BugFinding[]> {
    const findings: BugFinding[] = [];
    
    if (!hasActiveRouteTrashTransaction()) {
      return findings;
    }
    
    const page = ctx.page;
    const metadata = chaosManagerAccessor?.getActiveMetadata();
    
    // Check for redirect loops
    try {
      const url = page.url();
      const content = await page.content();
      
      for (const pattern of REDIRECT_LOOP_PATTERNS) {
        if (pattern.test(url) || pattern.test(content)) {
          findings.push({
            bugClass: 'ROUTE_MUTATION_FAILURE',
            title: 'Infinite Redirect Loop Detected',
            severity: 'CRITICAL',
            evidence: {
              message: `Redirect loop detected during route mutation. Origin: ${metadata?.originPath}`,
              actionExecuted: 'route-trasher-redirect-loop',
              selector: metadata?.injectedPath,
              stateHash: ctx.stateHash,
            }
          });
          break;
        }
      }
      
      // Check for component resolution failures
      for (const pattern of COMPONENT_FAIL_PATTERNS) {
        if (pattern.test(content)) {
          findings.push({
            bugClass: 'ROUTE_MUTATION_FAILURE',
            title: 'Component Resolution Failure',
            severity: 'HIGH',
            evidence: {
              message: `Component resolution failed after route mutation from ${metadata?.navigationType}`,
              actionExecuted: 'route-trasher-component-fail',
              selector: metadata?.injectedPath,
              stateHash: ctx.stateHash,
            }
          });
          break;
        }
      }
    } catch (e) {
      console.log('[StructuralProbe] Error during detection:', e);
    }
    
    return findings;
  }
};
```

---

## Quality Standards

1. **Transaction Integrity**: routeTrasher must always call closeTransaction() even on errors (use try/finally)
2. **Metadata Completeness**: Include originPath, targetPath, and navigationType in metadata
3. **Finder Pattern Compliance**: Follow same interface as fuzzGuard and concurrentStressGuard
4. **Error Isolation**: BugFinder.run() must not throw - emit findings instead
5. **Registry Integration**: Add to getAllBugFinders() for automatic discovery
6. **Backward Compatibility**: Keep existing exports (trashRoutes, RouteTrashResult) for legacy code
7. **Backward Compatibility for Metadata**: Keep targetPath field (not renamed to injectedPath) to avoid breaking dashboard ingestion

---

## Reference Documents

- Existing integration plan: `implementation_plan_route_trasher_integration.md`
- ChaosTransactionManager: `testing-core/src/domain/fuzzing/ChaosTransactionManager.ts`
- FuzzGuard pattern: `testing-core/src/bugs/finders/fuzzGuard.ts`
- Current routeTrasher: `testing-core/src/domain/scenarios/routeTrasher.ts`
