# TODO: Chaos Time-Decay Correlation Implementation

## task_progress Items:
- [x] Step 1: Create implementation plan (Done - Saved as implementation_plan_chaos_time_decay.md)
- [ ] Step 2: Update bugs/types.ts to add CASCADING_STATE_FAILURE to BugClass type
- [ ] Step 3: Add TransactionScope interface and transactionHistory state to ChaosTransactionManager.ts
- [ ] Step 4: Modify closeTransaction() to push to history buffer with microsecond timestamp
- [ ] Step 5: Implement getCorrelatableTransaction() and pruneExpiredHistory() methods
- [ ] Step 6: Add cascading detection logic to evaluateAndRegisterBug()
- [ ] Step 7: Modify exceptionCatcher.ts error handlers to check decaying history when no active transaction
- [ ] Step 8: Test the complete time-decay correlation flow

---

## Implementation Guide:

### Step 2: bugs/types.ts
Add 'CASCADING_STATE_FAILURE' to the existing BugClass union type:
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
  | 'CASCADING_STATE_FAILURE';  // NEW
```

Also update the evidence interface:
```typescript
export interface BugFinding {
  bugClass: BugClass;
  title: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  evidence?: {
    message?: string;
    selector?: string;
    actionExecuted?: string;
    stateHash?: string;
    statusCode?: number;
    durationMs?: number;
    isCascadingFailure?: boolean;        // NEW
    previousContext?: TransactionScope; // NEW
  };
}
```

### Step 3-5: ChaosTransactionManager.ts
Add the following state and methods:
- TransactionScope interface
- transactionHistory: TransactionScope[] (fixed-size 3)
- closeTransaction() modification to push history
- getCorrelatableTransaction(timeWindowMs)
- pruneExpiredHistory()

### Step 6: exceptionCatcher.ts
Modify error handlers to check for correlatable transaction when no active transaction exists.
