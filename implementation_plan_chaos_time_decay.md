# Implementation Plan

## [Overview]
Harden `ChaosTransactionManager.ts` by adding a time-decay correlation matrix for asynchronous cascading faults. Replace the single active context variable with a sliding historical buffer of the last 3 transaction scopes, and enhance `exceptionCatcher.ts` to correlate errors to recently-closed transactions within a 2500ms decay window, flagging them as 'CASCADING_STATE_FAILURE'.

## [Types]
- Add `CASCADING_STATE_FAILURE` to the `BugClass` union type in `bugs/types.ts`
- Add new type definitions in `ChaosTransactionManager.ts`:
  - `TransactionScope`: Interface representing a single transaction with microsecond timestamp
  - `TransactionHistoryBuffer`: Fixed-size array (3 items max) of closed transaction scopes
- Modify `BugFinding.evidence` to include:
  - `isCascadingFailure`: boolean flag
  - `previousContext`: object containing the matched historical transaction metadata

## [Files]
### Existing files to modify:
- `testing-core/src/bugs/types.ts`
  - Add `CASCADING_STATE_FAILURE` to the BugClass type union
  
- `testing-core/src/domain/fuzzing/ChaosTransactionManager.ts`
  - Add `TransactionScope` interface with microsecond timestamp field
  - Add `transactionHistory` sliding buffer array (max 3 items)
  - Modify `closeTransaction()` to push closed context to history before clearing
  - Add new method `getCorrelatableTransaction(timeWindowMs: number)` to find recent closes within decay window
  - Add helper method `pruneExpiredHistory(currentTime: number)` to maintain sliding window
  
- `testing-core/src/infrastructure/monitoring/exceptionCatcher.ts`
  - In error handlers where `fuzzManager.evaluateAndRegisterBug()` is called:
    - First check if a transaction is active
    - If no active transaction, call `fuzzManager.getCorrelatableTransaction(2500)` to search history
    - If a matching recent transaction is found, pass a flag to evaluateAndRegisterBug() indicating this is a cascading failure context
  - Add cascading detection logic to the `emitException` and error/console handlers

## [Functions]
### Modified functions:
- In `ChaosTransactionManager.ts`:
  - `closeTransaction()`: Push closed context to `transactionHistory` array before nullifying active context
  - `evaluateAndRegisterBug()`: Add optional parameter for cascading context detection; when triggered, set `isCascadingFailure: true` in evidence
  
### New functions:
- In `ChaosTransactionManager.ts`:
  - `getCorrelatableTransaction(timeWindowMs: number)`: Returns the most recent closed transaction within the time window, or null if none exist
  - `pruneExpiredHistory(currentTime: number, timeWindowMs: number)`: Removes transaction entries that have expired beyond the decay window

## [Classes]
No new classes required. The existing `ChaosTransactionManager` class will be modified to include the new state management features.

## [Dependencies]
No external dependencies required. Uses existing microsecond timestamp capabilities via `Date.now()` and `performance.now()`.

## [Testing]
- Unit tests for `TransactionScope` timestamp accuracy
- Unit tests for sliding history buffer (push/prune) behavior  
- Integration test for time-decay correlation in `exceptionCatcher.ts`
- Verify BugFinding evidence structure includes the new cascading fields

## [Implementation Order]
1. Update `bugs/types.ts` to add `CASCADING_STATE_FAILURE` to BugClass type
2. Add `TransactionScope` interface and `transactionHistory` state to `ChaosTransactionManager.ts`
3. Modify `closeTransaction()` to push to history buffer with microsecond timestamp
4. Implement `getCorrelatableTransaction()` and `pruneExpiredHistory()` methods
5. Add cascading detection logic to `evaluateAndRegisterBug()` to accept optional cascading context
6. Modify `exceptionCatcher.ts` error handlers to check decaying history when no active transaction
7. Test the complete time-decay correlation flow

---

All planned changes preserve backward compatibility while adding the requested time-decay correlation matrix. The implementation follows the existing code patterns and integrates seamlessly with the current transaction lifecycle.
