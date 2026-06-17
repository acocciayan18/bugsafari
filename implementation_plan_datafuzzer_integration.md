# Implementation Plan

## [Overview]
Integrate the dataFuzzer.ts scenario into the unified ChaosTransactionManager framework and create a specialized fuzzGuard bug finder to detect vulnerabilities from injected fuzzing payloads.

This integration aims to:
1. Enable centralized transaction tracking for fuzzing activities via ChaosTransactionManager
2. Create a domain guard (fuzzGuard) that evaluates application responses to detect when injected payloads bypass sanitization
3. Provide type-safe metadata passing with category and strategy information

## [Types]

### Type Modifications Required

**1. Extended FuzzMetadata (in ChaosTransactionManager.ts)**

Current interface:
```typescript
interface FuzzMetadata {
  payload: string;
  fieldType: string;
}
```

New interface:
```typescript
interface FuzzMetadata {
  payload: string;           // The injected fuzzing payload
  fieldType: string;        // The field type (e.g., 'input', 'textarea')
  category: FieldCategory;  // Classification category (NUMERIC, DATABASE_AUTH, etc.)
  strategy: FuzzingStrategyType; // Strategy used (mutating, injection, boundary, etc.)
}
```

Where:
```typescript
type FieldCategory = 'NUMERIC' | 'TEXT_SEARCH' | 'DATABASE_AUTH' | 'CHAOS_FALLBACK' | 'EMAIL' | 'DATE' | 'JSON';
type FuzzingStrategyType = 'mutating' | 'injection' | 'boundary' | 'encoding' | 'chaos';
```

**2. New BugClass (in bugs/types.ts)**

Current type:
```typescript
type BugClass =
  | 'INPUT_SANITIZATION_FAILURE'
  | 'CLIENT_SIDE_CONSTRAINT_BYPASS'
  | 'NOSQL_INJECTION'
  | 'SPA_STATE_RACE_CONDITION'
  | 'STRUCTURAL_NAVIGATION_LOGIC'
  | 'RUNTIME_STABILITY_EXCEPTION'
  | 'BOUNDARY_STRESS_FAILURE';
```

New type:
```typescript
type BugClass =
  | 'INPUT_SANITIZATION_FAILURE'
  | 'CLIENT_SIDE_CONSTRAINT_BYPASS'
  | 'NOSQL_INJECTION'
  | 'SPA_STATE_RACE_CONDITION'
  | 'STRUCTURAL_NAVIGATION_LOGIC'
  | 'RUNTIME_STABILITY_EXCEPTION'
  | 'BOUNDARY_STRESS_FAILURE'
  | 'FUZZ_VULNERABILITY_LEAK';  // NEW - For fuzzing payload bypass detection
```

**3. FuzzGuard Context Type**

The fuzzGuard will receive context from ChaosTransactionManager including:
```typescript
interface FuzzGuardContext {
  page: Page;
  targetSelector: string;
  payloadInjected: string;
  category: FieldCategory;
  strategy: FuzzingStrategyType;
  timestamp: number;
}
```

## [Files]

### New Files to be Created

**1. testing-core/src/bugs/finders/fuzzGuard.ts**
- **Purpose**: Specialized domain guard to detect fuzzing payload bypass vulnerabilities
- **Key functionality**: 
  - Evaluates application's response to injected payloads
  - Checks for reflected XSS signatures in the DOM
  - Detects raw NoSQL syntax errors in API responses
  - Identifies server-side crash traces following injection
- **Returns**: BugFinding[] with 'FUZZ_VULNERABILITY_LEAK' classification

### Existing Files to be Modified

**1. testing-core/src/domain/fuzzing/ChaosTransactionManager.ts**
- **Changes**:
  - Extend `FuzzMetadata` interface to include `category` and `strategy` fields
  - Provide type exports for FieldCategory and FuzzingStrategyType

**2. testing-core/src/domain/scenarios/fuzzing/dataFuzzer.ts**
- **Changes**:
  - Import ChaosTransactionManager from domain/fuzzing
  - In `dataFuzzer.execute()` method:
    - Instantiate ChaosTransactionManager (or receive via injection)
    - Call `openTransaction(targetSelector, 'FUZZ', { payload, fieldType, category, strategy })` before injecting payload
    - Call `closeTransaction()` after fuzzing completes
  - For multi-pass iteration, open transaction at start, close at end

**3. testing-core/src/bugs/types.ts**
- **Changes**:
  - Add 'FUZZ_VULNERABILITY_LEAK' to BugClass union type

### Configuration File Updates

No new configuration files required. The existing type system will support the new fields.

## [Functions]

### New Functions

**1. fuzzGuard.isApplicable(ctx) - in fuzzGuard.ts**
- **Signature**: `async isApplicable(ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean>`
- **Purpose**: Determine if fuzzGuard should run based on context
- **Logic**: Returns true if there's an active FUZZ transaction in ChaosTransactionManager

**2. fuzzGuard.run(ctx) - in fuzzGuard.ts**
- **Signature**: `async run(ctx: BugContext): Promise<BugFinding[]>`
- **Purpose**: Execute vulnerability detection
- **Logic**:
  1. Check if FUZZ transaction is active
  2. Examine DOM for reflected XSS signatures (check innerHTML, script tags, event handlers)
  3. Check for NoSQL/MongoDB syntax errors in console or API responses
  4. Check for server crash traces (stack traces, 500 errors)
  5. Package findings as 'FUZZ_VULNERABILITY_LEAK'

### Modified Functions

**1. dataFuzzer.execute() - in dataFuzzer.ts**
- **Current behavior**: Standalone fuzzing scenario with no transaction tracking
- **New behavior**: 
  - Uses ChaosTransactionManager.openTransaction() with full metadata before payload injection
  - Includes category and strategy in metadata object
  - Properly closes transaction after fuzzing completes

**2. ChaosTransactionManager.openTransaction() - already exists**
- No changes needed - already accepts type: 'FUZZ' and arbitrary metadata
- Will be called with extended FuzzMetadata

### Removed Functions

None - backward compatibility is maintained.

## [Classes]

### New Classes

**1. FuzzGuard (BugFinder implementation) - in fuzzGuard.ts**
- **File path**: `testing-core/src/bugs/finders/fuzzGuard.ts`
- **Key methods**:
  - `isApplicable()`: Check if context has FUZZ transaction
  - `run()`: Execute vulnerability detection logic
- **Inheritance**: Implements `BugFinder` interface from `bugs/types.ts`

### Modified Classes

**1. ChaosTransactionManager - in ChaosTransactionManager.ts**
- **File path**: `testing-core/src/domain/fuzzing/ChaosTransactionManager.ts`
- **Specific modifications**:
  - Update FuzzMetadata interface with new fields
  - Export FieldCategory and FuzzingStrategyType types

**2. dataFuzzer (StressScenario) - in dataFuzzer.ts**
- **File path**: `testing-core/src/domain/scenarios/fuzzing/dataFuzzer.ts`
- **Specific modifications**:
  - Integrate ChaosTransactionManager lifecycle calls
  - Pass complete metadata including category and strategy

### Removed Classes

None.

## [Dependencies]

### New Packages/Versions

No new external dependencies required. The implementation uses existing modules:
- Playwright Page API (already in dependencies)
- BugFinder interface (already in bugs/types.ts)
- ChaosTransactionManager (already exists)

### Integration Requirements

The fuzzGuard must:
1. Have access to the active ChaosTransactionManager instance (via singleton or dependency injection)
2. Have access to Playwright page context for DOM inspection
3. Have access to network interceptor context or console for error detection

## [Testing]

### Test File Requirements

1. **Unit tests for FuzzMetadata extension**
   - Test type safety for new fields

2. **Integration tests for dataFuzzer + ChaosTransactionManager**
   - Test that transaction is opened before fuzzing
   - Test that correct metadata is passed
   - Test that transaction is closed after fuzzing

3. **Unit tests for fuzzGuard**
   - Test isApplicable returns true when FUZZ transaction active
   - Test XSS signature detection in DOM
   - Test NoSQL error detection
   - Test crash trace detection

### Existing Test Modifications

May need to update existing tests to account for new transaction lifecycle in dataFuzzer.

### Validation Strategies

1. Type checking: Ensure TypeScript compiles without errors
2. Runtime validation: Log test showing transaction open/close
3. Integration validation: Create a test scenario with vulnerable endpoint

## [Implementation Order]

### Logical Order of Changes (to minimize conflicts)

1. **Step 1**: Update `bugs/types.ts` - Add 'FUZZ_VULNERABILITY_LEAK' to BugClass union
   - File: `testing-core/src/bugs/types.ts`
   - Change: Add new type to BugClass union

2. **Step 2**: Update `ChaosTransactionManager.ts` - Extend FuzzMetadata interface
   - File: `testing-core/src/domain/fuzzing/ChaosTransactionManager.ts`
   - Changes: 
     - Add FieldCategory type import (or re-export from elementClassifier)
     - Add FuzzingStrategyType type
     - Extend FuzzMetadata interface with category and strategy fields

3. **Step 3**: Create `fuzzGuard.ts` - New bug finder
   - File: `testing-core/src/bugs/finders/fuzzGuard.ts`
   - Create: New bug finder implementing BugFinder interface
   - Implement: XSS detection, NoSQL error detection, crash trace detection

4. **Step 4**: Update `dataFuzzer.ts` - Integrate ChaosTransactionManager
   - File: `testing-core/src/domain/scenarios/fuzzing/dataFuzzer.ts`
   - Changes:
     - Import ChaosTransactionManager
     - Add transaction lifecycle calls
     - Pass complete metadata

5. **Step 5**: Review and validate implementation
   - Run TypeScript compilation
   - Verify all exports are correct

---

## Implementation Complete

This plan provides a comprehensive roadmap for integrating dataFuzzer with ChaosTransactionManager and creating the fuzzGuard bug finder. Each step builds upon the previous one, ensuring type safety and proper integration throughout the codebase.
