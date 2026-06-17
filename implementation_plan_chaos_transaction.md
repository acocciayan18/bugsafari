# Implementation Plan: ChaosTransactionManager Refactoring

## [Overview]
Refactor the FuzzTransactionManager to ChaosTransactionManager - a generalized transaction layer supporting the entire stress-testing arsenal (FUZZ, NETWORK, STRESS_CLICK, ROUTE_TRASH, VULN_SCOUT) with a flexible type-safe ChaosContext.

The refactoring renames the class, updates the context schema to support multiple chaos types, and ensures backward compatibility for existing fuzzing workflows while enabling new chaos scenario tracking.

## [Types]

### ChaosContextType Enum
```typescript
export type ChaosContextType = 'FUZZ' | 'NETWORK' | 'STRESS_CLICK' | 'ROUTE_TRASH' | 'VULN_SCOUT';
```

### ChaosContext Interface
```typescript
export interface ChaosContext {
  type: ChaosContextType;
  timestamp: number;
  targetSelector?: string;
  metadata?: ChaosMetadata;
}
```

### ChaosMetadata Union Type
```typescript
export type ChaosMetadata = 
  | FuzzMetadata        // For FUZZ type
  | NetworkMetadata    // For NETWORK type
  | StressClickMetadata // For STRESS_CLICK type
  | RouteTrashMetadata // For ROUTE_TRASH type
  | VulnScoutMetadata; // For VULN_SCOUT type
```

### Specific Metadata Types
```typescript
// FUZZ: Data fuzzer payloads
export interface FuzzMetadata {
  payloadInjected: string;
  category: string; // 'email', 'date', 'numeric', 'json', etc.
  strategy: string;
}

// NETWORK: Network sabotage parameters
export interface NetworkMetadata {
  delayMs?: number;
  abortRatio?: number;       // 0-1 probability of abort
  sabotageMethod: 'delay' | 'abort' | 'timeout';
  affectedRequests: string[]; // URLs being sabotaged
}

// STRESS_CLICK: Rapid clicking parameters
export interface StressClickMetadata {
  clickCount: number;
  concurrentEvents: number;
  clickIntervalMs: number;
  targetElements: string[]; // Selectors being clicked
}

// ROUTE_TRASH: Route navigation parameters
export interface RouteTrashMetadata {
  routesAttempted: string[];
  currentRoute: string;
  navigationDepth: number;
  pathsExhausted: string[];
}

// VULN_SCOUT: Security vulnerability scout parameters
export interface VulnScoutMetadata {
  injectionType: string;   // 'sql', 'xss', 'nosql', etc.
  payloadsAttempted: number;
  constraintsStripped: boolean;
  vulnerabilityClass?: string;
}
```

### BugFindingType (preserve existing)
```typescript
export type BugFindingType = 'EXCEPTION' | 'NETWORK_500';
```

### LiveBugPayload (preserve existing)
```typescript
export interface LiveBugPayload {
  bugType: BugFindingType;
  message: string;
  elementId: string;
  payloadInjected: string;
  technicalDetails: any;
  timestamp: number;
  recentSteps: ActionBreadcrumb[];
}
```

### Legacy FuzzContext (deprecated, for backward compatibility)
```typescript
export interface FuzzContext {
  targetElementId: string;
  payloadInjected: string;
  timestamp: number;
}
```

## [Files]

### Files to be Modified:
1. **`testing-core/src/domain/fuzzing/FuzzTransactionManager.ts`** → Renamed to `ChaosTransactionManager.ts`
   - Rename class to `ChaosTransactionManager`
   - Replace `FuzzContext` with `ChaosContext` and metadata types
   - Add new chaos-specific methods
   - Maintain backward compatibility

2. **`testing-core/src/domain/fuzzing/index.ts`**
   - Export new `ChaosTransactionManager` as primary export
   - Export deprecated `FuzzTransactionManager` alias for backward compatibility
   - Export new type aliases

### Files that Import FuzzTransactionManager (need import path updates):
3. **`testing-core/src/domain/services/AutonomousExplorationEngine.ts`**
   - Update import: `FuzzTransactionManager` → `ChaosTransactionManager`
   - Update usage to support new chaos types

4. **`testing-core/src/infrastructure/monitoring/exceptionCatcher.ts`**
   - Update import path if needed
   - Ensure compatibility with new manager

## [Functions]

### New Public Methods in ChaosTransactionManager:
1. **`openTransaction(selector: string, type: ChaosContextType, metadata?: ChaosMetadata)`**
   - Opens a transaction with specified chaos type
   - Replaces: `openTransaction(elementId, payload)`

2. **`evaluateAndRegisterBug(type: BugFindingType, message: string, technicalDetails: any)`**
   - Unchanged signature, uses current context

3. **`getConfirmedBugs(): BugFinding[]`**
   - Unchanged

4. **`setChaosType(type: ChaosContextType): void`** (new)
   - Sets the current chaos type for the transaction

5. **`getChaosType(): ChaosContextType | null`** (new)
   - Gets current chaos type

### Private Methods (unchanged):
- `mapBugTypeToClass()`
- `determineSeverity()`

## [Classes]

### ChaosTransactionManager
- **File**: `testing-core/src/domain/fuzzing/ChaosTransactionManager.ts`
- **Extends**: N/A (replacement)
- **Key Methods**:
  - `openTransaction(selector: string, type: ChaosContextType, metadata?: ChaosMetadata)`
  - `closeTransaction(): void`
  - `evaluateAndRegisterBug(type: BugFindingType, message: string, technicalDetails: any): void`
  - `getConfirmedBugs(): BugFinding[]`
  - `setChaosType(type: ChaosContextType): void`
  - `getChaosType(): ChaosContextType | null`

### Deprecated Alias (for backward compatibility):
- Export `FuzzTransactionManager` as alias to `ChaosTransactionManager`

## [Dependencies]

No new dependencies required. This is purely a refactoring task.

### Package Updates:
- None

## [Testing]

### Test File Requirements:
1. **Update existing tests** if any tests reference `FuzzTransactionManager`:
   - Verify import paths work with both old and new names
   - Test new chaos type support

2. **Add new test scenarios** for ChaosTransactionManager:
   - Test each ChaosContextType
   - Test metadata serialization per type
   - Test backward compatibility

### Validation Strategies:
- Run existing test suite to ensure backward compatibility
- Manual verification of chaos scenarios through UI

## [Implementation Order]

1. **[Step 1]** Create new `ChaosTransactionManager.ts` with:
   - New type definitions (ChaosContextType, ChaosContext, etc.)
   - New class implementation
   - Backward compatibility exports

2. **[Step 2]** Update `index.ts` to export new types and class

3. **[Step 3]** Rename physical file:
   - Delete `FuzzTransactionManager.ts`
   - Create `ChaosTransactionManager.ts` with full content

4. **[Step 4]** Update `AutonomousExplorationEngine.ts`:
   - Change import to use new class
   - Update method calls if needed for new API

5. **[Step 5]** Update `exceptionCatcher.ts` if needed

6. **[Step 6]** Test compilation and run

7. **[Step 7]** Verify all import paths work

## [Migration Notes]

### Breaking Changes (minor):
- Method signature for `openTransaction()` changed
- Old `FuzzContext` type replaced with `ChaosContext`

### Backward Compatibility:
- Export `FuzzTransactionManager` as alias to `ChaosTransactionManager`
- Legacy code using `import { FuzzTransactionManager }` will still work
