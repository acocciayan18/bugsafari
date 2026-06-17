# Implementation Plan

[Overview]
Integrate securityVulnerabilityScout scenario into the unified ChaosTransactionManager system and create a new stateless heuristic evaluator bug finder (securityVulnerabilityScout.ts) that detects security vulnerabilities during chaos transactions by inspecting metadata for database error signatures or sanitization leaks.

[Types]
Single sentence describing the type system changes.

Extend BugClass type to include 'SECURITY_VULNERABILITY_LEAK' for unified security vulnerability detection across both FUZZ and VULN_SCOUT transactions. Also add corresponding metadata fields.

Detailed type definitions:
```typescript
// In testing-core/src/bugs/types.ts
export type BugClass =
  | 'INPUT_SANITIZATION_FAILURE'
  | 'CLIENT_SIDE_CONSTRAINT_BYPASS'
  | 'NOSQL_INJECTION'
  | 'SPA_STATE_RACE_CONDITION'
  | 'STRUCTURAL_NAVIGATION_LOGIC'
  | 'RUNTIME_STABILITY_EXCEPTION'
  | 'BOUNDARY_STRESS_FAILURE'
  | 'FUZZ_VULNERABILITY_LEAK'
  | 'SECURITY_VULNERABILITY_LEAK';  // NEW: Unified security vulnerability detection
```

```typescript
// In testing-core/src/domain/fuzzing/ChaosTransactionManager.ts
// Update VulnScoutMetadata to include targetSelector and attackPayloadVector
export interface VulnScoutMetadata {
  targetSelector: string;      // Field: element selector being tested
  attackPayloadVector: string; // Attack payload injected
  injectionType: string;       // 'sql', 'xss', 'nosql', etc.
  payloadsAttempted: number;
  constraintsStripped: boolean;
  vulnerabilityClass?: string;
}
```

[Files]
Single sentence describing file modifications.

Detailed breakdown:
1. **New files to be created:**
   - `testing-core/src/bugs/finders/securityVulnerabilityScout.ts` - Stateless heuristic evaluator for security vulnerability detection
   
2. **Existing files to be modified:**
   - `testing-core/src/bugs/types.ts` - Add SECURITY_VULNERABILITY_LEAK to BugClass type
   - `testing-core/src/domain/scenarios/securityVulnerabilityScout.ts` - Integrate with ChaosTransactionManager.startTransaction()
   - `testing-core/src/domain/fuzzing/ChaosTransactionManager.ts` - Update VulnScoutMetadata interface
   - `testing-core/src/domain/fuzzing/index.ts` - Export updated VulnScoutMetadata with new fields
   - `testing-core/src/bugs/registry.ts` - Register the new securityVulnerabilityScout finder

[Functions]
Single sentence describing function modifications.

Detailed breakdown:
1. **New functions (in securityVulnerabilityScout.ts):**
   - `detectDatabaseErrorSignatures(page)` - Inspects DOM/network for database error signatures (SQL, NoSQL)
   - `detectSanitizationLeaks(page, payload)` - Checks if injected payload bypasses sanitization
   - `logSecurityVulnerabilityLeak(metadata, findings)` - Logs explicit 'SECURITY_VULNERABILITY_LEAK' trace

2. **Modified functions:**
   - `securityVulnerabilityScout.execute()` - Update to call ChaosTransactionManager.startTransaction() with VULN_SCOUT type and metadata

[Classes]
Single sentence describing class modifications.

Detailed breakdown:
1. **New classes:**
   - `securityVulnerabilityScout` (BugFinder) - Stateless heuristic evaluator at testing-core/src/bugs/finders/securityVulnerabilityScout.ts
   
2. **Modified classes:**
   - `ChaosTransactionManager` - No changes needed, but will be used with new VulnScoutMetadata

[Dependencies]
Single sentence describing dependency modifications.

No new external dependencies required. Uses existing:
- Playwright Page type
- ChaosTransactionManager from @bugsafari/testing-core/domain/fuzzing
- BugFinder, BugContext, BugFinding types from ../types.js

[Testing]
Single sentence describing testing approach.

Test file requirements:
- Unit tests for detectDatabaseErrorSignatures() pattern matching
- Unit tests for detectSanitizationLeaks() XSS/Injection detection
- Integration test verifying VULN_SCOUT transaction triggers finder
- Verify 'SECURITY_VULNERABILITY_LEAK' trace is logged

[Implementation Order]
Single sentence describing the implementation sequence.

Numbered steps:
1. [x] Update testing-core/src/bugs/types.ts - Add SECURITY_VULNERABILITY_LEAK to BugClass
2. [x] Update testing-core/src/domain/fuzzing/ChaosTransactionManager.ts - Extend VulnScoutMetadata with targetSelector and attackPayloadVector
3. [x] Update testing-core/src/domain/fuzzing/index.ts - Export updated VulnScoutMetadata
4. [x] Update testing-core/src/domain/scenarios/securityVulnerabilityScout.ts - Integrate with ChaosTransactionManager.startTransaction()
5. [x] Create testing-core/src/bugs/finders/securityVulnerabilityScout.ts - Implement stateless heuristic evaluator bug finder
6. [x] Update testing-core/src/bugs/registry.ts - Register securityVulnerabilityScout finder
