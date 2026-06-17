# Implementation Plan

## [Overview]
Refactor `ChaosTransactionManager.ts` to be a Generic class that supports scenario-specific transaction metadata with full type safety while maintaining backward compatibility with existing code.

This refactoring addresses the current limitation where the transaction manager stores metadata generically without proper typing for each scenario type. By making it generic, each scenario (Fuzzing, Network, StressClick, RouteTrash, etc.) can have strongly-typed metadata that matches its specific requirements.

## [Types]

### New Scenario-Specific Metadata Interfaces

```typescript
/**
 * FuzzMetadata - Data fuzzer payload information
 */
export interface FuzzMetadata {
  payload: string;
  fieldType: string;
  strategy?: string;
  category?: string;
}

/**
 * NetworkMetadata - Network sabotage parameters  
 */
export interface NetworkMetadata {
  affectedUrl: string;
  method: 'delay' | 'abort';
  delayMs?: number;
  abortRatio?: number;
  sabotageMode?: 'delayed' | 'aborted';
}

/**
 * StressClickMetadata - Rapid clicking parameters
 */
export interface StressClickMetadata {
  velocity: number;
  elementChain: string[];
  clickCount?: number;
  concurrentEvents?: number;
  clickIntervalMs?: number;
  targetElements?: string[];
}

/**
 * RouteTrashMetadata - Route navigation parameters
 */
export interface RouteTrashMetadata {
  originPath: string;
  targetPath: string;
  routesAttempted?: string[];
  navigationDepth?: number;
  currentRoute?: string;
  pathsExhausted?: string[];
}
```

### Updated ChaosContext Interface (Generic)

```typescript
/**
 * ChaosContext - Internal transaction memory state with generic metadata
 */
export interface ChaosContext<T = any> {
  type: ChaosContextType;
  timestamp: number;
  targetSelector?: string;
  metadata: T;
}
```

### Updated ChaosMetadata Union Type

```typescript
/**
 * ChaosMetadata - Union type for all scenario-specific metadata
 */
export type ChaosMetadata = 
  | FuzzMetadata
  | NetworkMetadata
  | StressClickMetadata
  | RouteTrashMetadata
  | VulnScoutMetadata;
```

### Existing Types to Preserve (Backward Compatibility)

- `ChaosContextType` - 'FUZZ' | 'NETWORK' | 'STRESS_CLICK' | 'ROUTE_TRASH' | 'VULN_SCOUT'
- `BugFindingType` - 'EXCEPTION' | 'NETWORK_500'
- `LiveBugPayload` - Telemetry for UI Watchtower
- `FuzzMetadata` - Preserve for backward compat (will be extended)
- `NetworkMetadata` - Preserve for backward compat (will be extended)
- `StressClickMetadata` - Preserve for backward compat (will be extended)
- `RouteTrashMetadata` - Preserve for backward compat (will be extended)
- `VulnScoutMetadata` - Preserve for backward compat

### Type for Generic Class

```typescript
/**
 * Constraint for generic metadata must extend one of the known metadata types
 */
export type ChaosMetadataConstraint = FuzzMetadata | NetworkMetadata | StressClickMetadata | RouteTrashMetadata | VulnScoutMetadata | object;
```

## [Files]

### File Modifications

- **testing-core/src/domain/fuzzing/ChaosTransactionManager.ts** - MODIFY
  - Convert class to generic: `class ChaosTransactionManager<T = any>`
  - Update `ChaosContext` interface to be generic: `ChaosContext<T>`
  - Update `openTransaction` to accept typed metadata parameter
  - Add new overloaded methods for scenario-specific transactions
  - Maintain backward compatibility aliases
  - Export new metadata types

- **testing-core/src/domain/fuzzing/index.ts** - VERIFY
  - Ensure exports include new typed metadata interfaces
  - No changes likely needed, just verify exports are correct

## [Functions]

### New Function Signatures

- **openTransaction** (modified)
  - File: `testing-core/src/domain/fuzzing/ChaosTransactionManager.ts`
  - New signature: `openTransaction(targetSelector: string, type: ChaosContextType, metadata?: T): void`
  - Added generic type parameter to accept scenario-specific metadata

### New Overloaded Methods

```typescript
// Type-safe method for FUZZ transactions
openFuzzTransaction(elementId: string, payload: string, fieldType: string): void

// Type-safe method for NETWORK transactions  
openNetworkTransaction(affectedUrl: string, method: 'delay' | 'abort'): void

// Type-safe method for STRESS_CLICK transactions
openStressClickTransaction(elementChain: string[], velocity: number): void

// Type-safe method for ROUTE_TRASH transactions
openRouteTrashTransaction(originPath: string, targetPath: string): void
```

### Methods to Modify

- **openTransaction** - Add generic type parameter
- **openFuzzTransaction** - Update signature to match new FuzzMetadata
- **closeTransaction** - No changes needed
- **evaluateAndRegisterBug** - Update to handle new typed metadata
- **getConfirmedBugs** - No changes needed

## [Classes]

### Modified Classes

- **ChaosTransactionManager** → **ChaosTransactionManager<T>**
  - File: `testing-core/src/domain/fuzzing/ChaosTransactionManager.ts`
  - Convert from: `class ChaosTransactionManager`
  - Convert to: `class ChaosTransactionManager<T = any>`
  - Key changes:
    - Add generic type parameter `T`
    - Update `activeChaosContext` to be `ChaosContext<T>`
    - Update `openTransaction` signature to accept `metadata: T`
    - Add overloaded methods for each scenario type
    - Add getter methods that return typed metadata

### Backward Compatibility Aliases (Preserve)

```typescript
// Keep these for backward compatibility
export const FuzzTransactionManager = ChaosTransactionManager;
export type FuzzTransactionManager = ChaosTransactionManager;
```

## [Dependencies]

No new dependencies required. This is purely a TypeScript refactoring with no external package changes.

Existing dependencies to verify are accessible:
- `@bugsafari/shared` - ActionBreadcrumb type
- `../../bugs/types.js` - BugFinding type

## [Testing]

### Test File Requirements

- Create new test file: `testing-core/src/domain/fuzzing/ChaosTransactionManager.generic.test.ts`
- Verify generic type constraints work correctly
- Verify backward compatibility with existing usage

### Validation Strategies

1. **Type Checking** - Ensure TypeScript compiles without errors
2. **Runtime Tests** - Test that transactions open/close correctly with typed metadata
3. **Backward Compatibility** - Ensure existing code still works after refactoring
4. **Integration Tests** - Test with actual scenario execution

### Test Scenarios to Cover

```typescript
// Test 1: Open FUZZ transaction with typed metadata
const fuzzManager = new ChaosTransactionManager<FuzzMetadata>();
fuzzManager.openTransaction('input#email', 'FUZZ', { payload: '<script>alert(1)</script>', fieldType: 'email' });

// Test 2: Open NETWORK transaction with typed metadata
const networkManager = new ChaosTransactionManager<NetworkMetadata>();
networkManager.openTransaction('api/users', 'NETWORK', { affectedUrl: '/api/users', method: 'delay' });

// Test 3: Open STRESS_CLICK transaction with typed metadata
const stressManager = new ChaosTransactionManager<StressClickMetadata>();
stressManager.openTransaction('button.submit', 'STRESS_CLICK', { velocity: 50, elementChain: ['button'] });

// Test 4: Backward compatibility - generic usage without type parameter
const genericManager = new ChaosTransactionManager();
genericManager.openTransaction('div.content', 'FUZZ', { payloadInjected: 'test', category: 'legacy' });
```

## [Implementation Order]

### Step-by-Step Implementation

1. **Step 1**: Update metadata interfaces
   - Add new field to FuzzMetadata (payload, fieldType)
   - Update NetworkMetadata (affectedUrl, method)
   - Add StressClickMetadata (velocity, elementChain)
   - Add RouteTrashMetadata (originPath, targetPath)

2. **Step 2**: Update ChaosContext interface to be generic
   - Change `ChaosContext` to `ChaosContext<T>`
   - Change `metadata?: ChaosMetadata` to `metadata: T`

3. **Step 3**: Convert ChaosTransactionManager to generic class
   - Add type parameter: `class ChaosTransactionManager<T = any>`
   - Update activeChaosContext type
   - Update openTransaction signature

4. **Step 4**: Add scenario-specific overloaded methods
   - openFuzzTransaction(elementId, payload, fieldType)
   - openNetworkTransaction(affectedUrl, method)
   - openStressClickTransaction(elementChain, velocity)
   - openRouteTrashTransaction(originPath, targetPath)

5. **Step 5**: Update evaluateAndRegisterBug for generic metadata
   - Handle typed metadata extraction
   - Maintain backward compatibility

6. **Step 6**: Export new types from index.ts
   - Ensure all new metadata types are exported

7. **Step 7**: Type check and verify compilation
   - Run TypeScript compiler to verify no errors
   - Fix any type errors

8. **Step 8**: Verify backward compatibility
   - Test existing code still works
   - Ensure FuzzTransactionManager alias works
