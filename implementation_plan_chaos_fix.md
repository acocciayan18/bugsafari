# Implementation Plan

[Overview]
Fix TypeScript type errors in AutonomousExplorationEngine.ts where `openTransaction()` is called with incorrect parameter types. The second argument is a string (payload) but should be `ChaosContextType`.

[Types]
The issue is that `ChaosTransactionManager.openTransaction()` expects the following signature:
```typescript
openTransaction(targetSelector: string, type: ChaosContextType, metadata?: ChaosMetadata): void
```

Where `ChaosContextType` is `'FUZZ' | 'NETWORK' | 'STRESS_CLICK' | 'ROUTE_TRASH' | 'VULN_SCOUT'`.

The code incorrectly passes a string payload as the second argument instead of the ChaosContextType enum.

[Files]
Single file to modify:
- `testing-core/src/domain/services/AutonomousExplorationEngine.ts`

[Functions]
Two function calls to modify:
1. Line ~1395: `this.fuzzManager.openTransaction(target.selector, payload)` - when useDataFuzzer is true
2. Line ~1435: `this.fuzzManager.openTransaction(target.selector, payload)` - for standard payload injection

Both should use the backward-compatible method `openFuzzTransaction(elementId: string, payload: string)` instead, which accepts string parameters directly.

[Classes]
No class modifications required.

[Dependencies]
No dependency changes.

[Testing]
No test changes required. After the fix, compile the TypeScript to verify errors are resolved.

[Implementation Order]
1. Read the exact lines to verify the context around both `openTransaction` calls
2. Replace both calls with `this.fuzzManager.openFuzzTransaction(target.selector, payload)` for backward compatibility
3. Verify the fix compiles without errors
