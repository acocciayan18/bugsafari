# Implementation Plan

## [Overview]

Integrate rapidClickerStress.ts into the unified ChaosTransactionManager framework by using ChaosTransactionManager.startTransaction() with type 'STRESS_CLICK' and create a concurrentStress domain guard in testing-core/src/bugs/finders/concurrentStress.ts to detect UI hanging or frame reconciliation errors during rapid clicking operations.

---

## [Types]

### StressClickMetadata (Existing in ChaosTransactionManager.ts)

```typescript
interface StressClickMetadata {
  velocity: number;        // Click interval in ms (default: 50)
  elementChain: string[];   // Array of CSS selectors to click
}
```

### New Types to Add

**StabilityData** (from stabilityMonitor.ts - used by domain guard):
```typescript
interface StabilityData {
  hasUnhandledJsException: boolean;
  hasMainThreadLockup: boolean;
  hasServerCollapse: boolean;
  exceptionDetails?: {
    message: string;
    stackTrace: string;
  };
  lockupDetected?: boolean;
  serverStatusCode?: number;
}
```

**ConcurrentStressResult** (for guard findings):
```typescript
interface ConcurrentStressFinding {
  bugClass: 'RUNTIME_STABILITY_EXCEPTION' | 'BOUNDARY_STRESS_FAILURE';
  title: string;
  severity: 'MEDIUM' | 'HIGH' | 'CRITICAL';
  evidence: {
    message: string;
    selector: string;
    actionExecuted: string;
    clickVelocity?: number;
    clicksAttempted?: number;
    clicksCompleted?: number;
  };
}
```

---

## [Files]

### New Files to Create

1. **testing-core/src/bugs/finders/concurrentStress.ts**
   - Domain guard for detecting stress-related stability issues
   - Stateless evaluator using ChaosContext + StabilityData
   - Will detect UI hangs and frame reconciliation errors

### Files to Modify

1. **testing-core/src/domain/scenarios/rapidClickerStress.ts**
   - Import ChaosTransactionManager and StressClickMetadata
   - In buttonSpammer.execute(): Call startTransaction() before spam loop
   - Pass { type: 'STRESS_CLICK', metadata: { velocity, elementChain } }
   - Use target?.selector for elementChain
   - Add metadata parameter with click velocity and selector chain
   - Close transaction after spam completes

2. **testing-core/src/bugs/registry.ts** (if needed)
   - Register the new concurrentStress bug finder

---

## [Functions]

### New Functions

1. **concurrentStressGuard** (in testing-core/src/bugs/finders/concurrentStress.ts)
   - Signature: `(ctx: BugContext, stabilityData: StabilityData) => Promise<BugFinding[]>`
   - Stateless evaluator detecting:
     - Main thread lockup during rapid clicks
     - Frame reconciliation errors (React-like "nested update" errors)
     - Event handler crashes
   - Returns array of concurrent stress findings

### Modified Functions

1. **buttonSpammer.execute()** (in rapidClickerStress.ts)
   - Add ChaosTransactionManager integration
   - Call startTransaction() with type 'STRESS_CLICK'
   - Pass StressClickMetadata with velocity and elementChain
   - Call closeTransaction() after completion

2. **coordinateBombing.execute()** (in rapidClickerStress.ts)
   - Optionally integrate transaction manager
   - Pass elementChain as empty array for coordinate clicks

3. **burstClickElement()** (exported function)
   - Optionally integrate transaction manager
   - Pass element count for metadata

---

## [Classes]

### Existing Classes (No Changes)

1. **ChaosTransactionManager<T>**
   - Already supports STRESS_CLICK type
   - Methods: openTransaction(), closeTransaction(), startTransaction()
   - Type-safe with StressClickMetadata

2. **StressScenario** interface
   - Already implemented by buttonSpammer, coordinateBombing

### New Classes

1. **concurrentStressGuard** (in finders/)
   - Implements BugFinder interface (bugClass: 'RUNTIME_STABILITY_EXCEPTION')
   - Stateless - uses injected stability data
   - isApplicable(): checks for active STRESS_CLICK transaction
   - run(): evaluates stability data and returns findings

---

## [Dependencies]

### Existing Dependencies (No New Dependencies)

- testing-core/src/domain/fuzzing/ChaosTransactionManager.ts
- testing-core/src/infrastructure/monitoring/stabilityMonitor.ts
- testing-core/src/bugs/types.ts

### Package Dependencies

- No new npm packages required
- Uses existing Playwright types

---

## [Testing]

### Test Approach

1. Unit test concurrentStressGuard with mock BugContext
2. Integration test with rapidClickerStress + ChaosTransactionManager
3. Can reuse existing stability monitor setup

### Test Files to Create (optional)

- testing-core/src/bugs/finders/concurrentStress.test.ts

---

## [Implementation Order]

1. **Step 1:** Modify rapidClickerStress.ts - Add ChaosTransactionManager integration
   - Import ChaosTransactionManager and StressClickMetadata
   - Add transaction.startTransaction() in buttonSpammer.execute()
   - Pass { type: 'STRESS_CLICK', metadata: { velocity, elementChain } }
   - Call transaction.closeTransaction() on completion
   - Do same for coordinateBombing and burstClickElement

2. **Step 2:** Create testing-core/src/bugs/finders/concurrentStress.ts
   - Import BugFinder, BugContext types
   - Import ChaosContextType for type checking
   - Implement concurrentStressGuard with isApplicable() and run()
   - Check for active STRESS_CLICK transaction
   - Evaluate stability data for hang/error detection

3. **Step 3:** Optional - Register in bug registry
   - Add to testing-core/src/bugs/registry.ts exports

4. **Step 4:** Verify compilation
   - Run TypeScript compiler to check for errors
   - Ensure all imports resolve correctly

---

## [task_progress]

- [x] Step 1: Modify rapidClickerStress.ts to integrate ChaosTransactionManager
- [x] Step 2: Create concurrentStress.ts domain guard in finders/
- [x] Step 3: Register in bug registry (optional)
- [x] Step 4: Verify TypeScript compilation
