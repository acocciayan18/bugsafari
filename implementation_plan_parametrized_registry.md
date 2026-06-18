# Implementation Plan

[Overview]
Evolve `testing-core/src/domain/scenarios/index.ts` to export a parameterized factory builder function that injects a unified `ChaosTransactionManager` instance into all stress scenarios, enabling centralized transaction management instead of per-scenario instance creation.

[Types]
Single sentence describing the type system changes.
The `StressScenario` interface will be extended with an optional `chaosManager` property to accept injected transaction managers.

Detailed type definitions:
```typescript
// New factory function signature
export function createStressScenarioRegistry(
  chaosManager: ChaosTransactionManager<any>
): StressScenario[]

// Optional chaosManager property on StressScenario interface
interface StressScenario {
  name: string;
  execute(page: Page, target?: InteractiveElement): Promise<void>;
  // NEW: Accept injected chaos manager
  setChaosManager?(manager: ChaosTransactionManager<any>): void;
}

// Map type for named access
export const stressScenarioMap: Record<string, StressScenario>
```

[Files]
Single sentence describing file modifications.
Three files will be modified to support the parameterized factory pattern.

Detailed breakdown:
- `testing-core/src/domain/scenarios/index.ts` - **MODIFIED**: Add factory function, update scenario wrappers to use injected chaosManager
- `testing-core/src/domain/scenarios/fuzzing/dataFuzzer.ts` - **MODIFIED**: Accept optional chaosManager parameter instead of using singleton
- `testing-core/src/domain/scenarios/securityVulnerabilityScout.ts` - **MODIFIED**: Accept optional chaosManager parameter for telemetry tracking

[Functions]
Single sentence describing function modifications.
New factory function and updated scenario functions to accept injected chaosManager.

Detailed breakdown:
- **NEW**: `createStressScenarioRegistry(chaosManager)` - Factory function in `index.ts` that creates StressScenario[] with injected chaosManager
- **NEW**: `setChaosManager(manager)` - Method added to dataFuzzer to receive injected manager
- **MODIFIED**: `dataFuzzer.execute()` - Now accepts optional chaosManager via setter or parameter
- **MODIFIED**: `securityVulnerabilityScout.execute()` - Accept optional chaosManager parameter with VulnScoutMetadata tracking
- **MODIFIED**: `routeTrasher` - Already accepts chaosManager (no changes needed, verify interface compatibility)

[Classes]
Single sentence describing class modifications.
No new classes; existing `ChaosTransactionManager` continues to be used.

Detailed breakdown:
- Existing `ChaosTransactionManager<T>` class remains unchanged (from `testing-core/src/domain/fuzzing/ChaosTransactionManager.ts`)
- No new classes required

[Dependencies]
Single sentence describing dependency modifications.
No new npm packages required; uses existing internal modules.

Details:
- `ChaosTransactionManager` from `@bugsafari/testing-core/domain/fuzzing` (existing)
- `StressScenario` from `@bugsafari/testing-core/domain/scenarios/types` (existing)
- `InteractiveElement` from `@bugsafari/testing-core/domain/entities` (existing)

[Testing]
Single sentence describing testing approach.
Existing test files will be verified for compatibility; no new tests required for this refactoring.

Test file requirements:
- Verify `stressScenarioRegistry` exports work correctly with factory pattern
- Verify backward compatibility for code using direct scenario exports

[Implementation Order]
Single sentence describing the implementation sequence.
Implementation follows a 3-step process: update individual scenarios first, then update index.ts factory, then verify exports.

Numbered steps:
1. **Step 1**: Modify `dataFuzzer.ts` to accept optional chaosManager via setter method instead of singleton
2. **Step 2**: Modify `securityVulnerabilityScout.ts` to accept optional chaosManager parameter
3. **Step 3**: Update `index.ts` to export `createStressScenarioRegistry(chaosManager)` factory function, update scenario wrappers to use injected manager
