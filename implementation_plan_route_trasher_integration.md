# Implementation Plan

[Overview]
Integrate the `routeTrasher` scenario into the unified ChaosTransactionManager framework and implement `structuralProbeFinder` as a proper BugFinder to detect infinite redirect loops and component resolution failures during route mutation testing.

This implementation extends the existing chaos testing infrastructure following the same patterns as `fuzzGuard` and `concurrentStressGuard` to support route navigation stress testing with proper transaction tracking and bug detection.

[Types]

## BugClass Enum Addition
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
  | 'ROUTE_MUTATION_FAILURE';  // NEW
```

## RouteTrashMetadata Enhancement
Enhance the existing `RouteTrashMetadata` interface in ChaosTransactionManager.ts to include mutation detection fields:
```typescript
export interface RouteTrashMetadata {
  originPath: string;
  targetPath: string;
  mutationType?: 'back_forward' | 'redirect' | 'component_remount';
  navigationAttempts: number;
  failureDetected?: boolean;
  infiniteLoopDetected?: boolean;
  componentResolutionFailed?: boolean;
}
```

## StructuralProbeContext Type
New interface for the structuralProbe BugFinder context:
```typescript
export interface StructuralProbeContext {
  page: Page;
  previousUrl: string;
  currentUrl: string;
  navigationCount: number;
  redirectedUrls: string[];
  componentStateChanges: number;
  initialComponentCount: number;
  finalComponentCount: number;
}
```

[Files]

## New Files to Create
- `testing-core/src/bugs/finders/structuralProbe.ts` - NEW BugFinder implementation
  - Purpose: Detects infinite redirect loops and component resolution failures post-mutation
  - Exports: `structuralProbeFinder` as BugFinder, `setChaosManagerAccessor()` function

## Existing Files to Modify

1. **testing-core/src/domain/scenarios/routeTrasher.ts**
   - Add imports for ChaosTransactionManager and types
   - Add `startTransaction()` call at beginning of execute() with { type: 'ROUTE_TRASH' }
   - Include RouteTrashMetadata with source path and mutation details
   - Add `closeTransaction()` call at end
   - Track navigation success/failure in metadata

2. **testing-core/src/bugs/types.ts**
   - Add `'ROUTE_MUTATION_FAILURE'` to BugClass type union

3. **testing-core/src/bugs/registry.ts**
   - Import and add `structuralProbeFinder` to bug finders array

4. **testing-core/src/domain/fuzzing/ChaosTransactionManager.ts**
   - Optionally extend RouteTrashMetadata interface (if needed)

## Files to Delete
- `testing-core/src/bugs/stressAdapters/structuralProbe.ts` - Superseded by new BugFinder

[Functions]

## New Functions

### structuralProbeFinder (in testing-core/src/bugs/finders/structuralProbe.ts)
```typescript
export const structuralProbeFinder: BugFinder = {
  bugClass: 'ROUTE_MUTATION_FAILURE',
  
  async isApplicable(ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> {
    // Check if there's an active ROUTE_TRASH transaction
    if (!chaosManagerAccessor) return false;
    return chaosManagerAccessor.getChaosType() === 'ROUTE_TRASH';
  },

  async run(ctx: BugContext): Promise<BugFinding[]> {
    // Detect infinite redirect loops
    // Detect component resolution failures
    // Log ROUTE_MUTATION_FAILURE anomaly if detected
  }
};
```

### setChaosManagerAccessor (in testing-core/src/bugs/finders/structuralProbe.ts)
```typescript
export function setChaosManagerAccessor(
  accessor: { getChaosType(): ChaosContextType | null; getActiveMetadata(): RouteTrashMetadata | undefined } | null
): void {
  chaosManagerAccessor = accessor;
}
```

## Modified Functions

### routeTrasher.execute (in testing-core/src/domain/scenarios/routeTrasher.ts)
- Current: Executes navigation actions without transaction tracking
- Required: Wrap with ChaosTransactionManager.startTransaction()/closeTransaction()
- Add metadata: originPath, targetPath, navigationAttempts, mutationType

[Classes]

No class modifications required. The implementation adds new function exports.

[Dependencies]

No new npm dependencies required. The implementation uses existing:
- `ChaosTransactionManager` - Already exists
- `ChaosContextType` - Already includes 'ROUTE_TRASH'
- `RouteTrashMetadata` - Already defined
- Playwright - Already in use

[Testing]

## Test Requirements

1. Create integration test for routeTrasher with ChaosTransactionManager
2. Verify transaction opens with correct metadata
3. Verify structuralProbeFinder detects issues
4. Verify ROUTE_MUTATION_FAILURE findings are logged

## Validation Strategies

1. Test routeTrasher.startTransaction() is called with correct type
2. Test metadata contains originPath and targetPath
3. Test structuralProbeFinder.isApplicable() returns true for ROUTE_TRASH
4. Test findings include 'ROUTE_MUTATION_FAILURE' bugClass

[Implementation Order]

1. **Step 1**: Add `'ROUTE_MUTATION_FAILURE'` to BugClass in types.ts
2. **Step 2**: Create new `testing-core/src/bugs/finders/structuralProbe.ts` BugFinder
3. **Step 3**: Integrate ChaosTransactionManager in routeTrasher.ts
4. **Step 4**: Register structuralProbeFinder in registry.ts
5. **Step 5**: Delete old stressAdapters/structuralProbe.ts
6. **Step 6**: Test the implementation

---

## Technical Implementation Details

### Integration Pattern (routeTrasher → ChaosTransactionManager via DI)

Using Dependency Injection as confirmed by the user:

```typescript
import { ChaosTransactionManager, type RouteTrashMetadata } from '../domain/fuzzing/index.js';

// routeTrasher.execute with DI parameter
export const routeTrasher = {
  name: 'RouteTrasher',

  async execute(
    page: Page, 
    target?: InteractiveElement | number,
    chaosManager?: ChaosTransactionManager<RouteTrashMetadata>  // DI parameter
  ): Promise<RouteTrashResult> {
    const originPath = page.url();
    
    // Open transaction with ROUTE_TRASH type (DI approach)
    const metadata: RouteTrashMetadata = {
      originPath: originPath,
      targetPath: '',  // Will be updated after each navigation
      mutationType: 'back_forward',
      navigationAttempts: 0,
    };
    
    chaosManager?.startTransaction('page', 'ROUTE_TRASH', metadata);
    
    // ... execute navigation logic ...
    
    // Update metadata with results
    if (chaosManager) {
      const activeMeta = chaosManager.getActiveMetadata();
      if (activeMeta) {
        activeMeta.navigationAttempts = attempted;
        activeMeta.failureDetected = completed < attempted;
      }
    }
    
    chaosManager?.closeTransaction();
    
    return { attempted, completed };
  }
};
```

### Testing Strategy

As confirmed by the user, integration tests will verify the full flow:
1. routeTrasher.execute() with ChaosTransactionManager passed via DI
2. Transaction opens with correct ROUTE_TRASH type and metadata
3. structuralProbeFinder detects route mutation failures (via singleton accessor)
4. Findings are logged with 'ROUTE_MUTATION_FAILURE' bugClass

### structuralProbeFinder Implementation

Following the pattern from fuzzGuard:

```typescript
import type { BugFinder, BugContext, BugFinding } from '../types.js';
import type { ChaosContextType, RouteTrashMetadata } from '../../domain/fuzzing/index.js';

let chaosManagerAccessor: {
  getChaosType(): ChaosContextType | null;
  getActiveMetadata(): RouteTrashMetadata | undefined;
} | null = null;

export function setChaosManagerAccessor(accessor: typeof chaosManagerAccessor) {
  chaosManagerAccessor = accessor;
}

function hasActiveRouteTrashTransaction(): boolean {
  return chaosManagerAccessor?.getChaosType() === 'ROUTE_TRASH';
}

function getActiveRouteMetadata(): RouteTrashMetadata | undefined {
  return chaosManagerAccessor?.getActiveMetadata();
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
    
    const metadata = getActiveRouteMetadata();
    if (!metadata) return findings;
    
    const page = ctx.page;
    
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
              message: `Redirect loop detected during route mutation. Origin: ${metadata.originPath}`,
              actionExecuted: 'route-trasher-redirect-loop',
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
              message: `Component resolution failed after route mutation. Pattern: ${pattern.source}`,
              actionExecuted: 'route-trasher-component-fail',
              stateHash: ctx.stateHash,
            }
          });
          break;
        }
      }
    } catch (e) {
      // Log but don't crash
    }
    
    return findings;
  }
};
```

---

## Quality Standards

1. **Transaction Integrity**: routeTrasher must always call closeTransaction() even on errors
2. **Metadata Completeness**: Include originPath, targetPath, and mutationType in metadata
3. **Finder Pattern Compliance**: Follow same interface as fuzzGuard and concurrentStressGuard
4. **Error Isolation**: BugFinder.run() must not throw - emit findings instead
5. **Registry Integration**: Add to getAllBugFinders() for automatic discovery
6. **Backward Compatibility**: Keep the `trashRoutes` export for legacy code
