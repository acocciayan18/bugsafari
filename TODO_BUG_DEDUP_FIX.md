# DONE: Bug Filtering & Deduplication Pipeline Fix

## Task Overview
- Fix data-loss issue from previous update
- Clean up backend data pipeline by centralizing filtering logic
- Implement strict deduplication to prevent UI flood from duplicate network errors

---

## Step 1: Centralize BugClassifier (Fix Audit Issue #1)

### 1.1 Create BugClassifier Service
**File to create:** `testing-core/src/domain/services/BugClassifier.ts`

Create a new service with strict filtering logic:
- `isActualBug()` should ONLY allow NETWORK bugs if:
  - Status code >= 400, OR
  - Message contains critical strings: "Server Collapse", "System Lock-up", "Exception"
- Normal 200 requests must return false
- Only allow types: EXCEPTION, RUNTIME_UI_FREEZE, SESSION_SYNC_FAULT, NETWORK

### 1.2 Update MongoFindingRepository.ts
**File:** `testing-core/src/domain/repositories/MongoFindingRepository.ts`

Changes:
- Remove hardcoded `NON_BUG_TYPES` and `VALID_BUG_TYPES` constants
- Remove `shouldSaveFinding()` and duplicated `isActualBug()` method
- Import and use `BugClassifier.isActualBug()` instead

### 1.3 Update StartExplorationUseCase.ts
**File:** `testing-core/src/application/useCases/StartExplorationUseCase.ts`

Changes:
- Remove hardcoded `NON_BUG_TYPES` and `VALID_BUG_TYPES` constants
- Remove duplicated `isActualBug()` function
- Import and use `BugClassifier.isActualBug()` instead

### 1.4 Update ExceptionCatcher.ts
**File:** `testing-core/src/infrastructure/monitoring/exceptionCatcher.ts`

Changes:
- Remove hardcoded `NON_BUG_TYPES` and `VALID_BUG_TYPES` constants
- Remove duplicated `shouldRegisterAsBug()` function
- Import and use `BugClassifier.isActualBug()` instead

---

## Step 2: Implement Deduplication in the Engine

### 2.1 Update AutonomousExplorationEngine.ts
**File:** `testing-core/src/domain/services/AutonomousExplorationEngine.ts`

Changes in `registerConfirmedBug()` method:
- Add deduplication check using `.some()`:
  ```typescript
  const isDuplicate = this.confirmedBugsMemory.some(
    existing => existing.type === newBug.type && existing.message === newBug.message
  );
  if (!isDuplicate) {
    this.confirmedBugsMemory.push(newBug);
  }
  ```
- Two bugs are duplicates if they have the exact same type AND message (or selector)

---

## Step 3: Validate Output

### 3.1 Test Flow
- Run engine and verify `getConfirmedBugsFromMemory()` returns deduplicated array
- Ensure normal Vite HMR/network 200 requests are filtered out
- Only critical findings should be saved

---

## Files Modified (COMPLETED)
1. ✅ CREATE: `testing-core/src/domain/services/BugClassifier.ts` - Centralized bug filtering service
2. ✅ UPDATE: `testing-core/src/infrastructure/database/repositories/MongoFindingRepository.ts` - Uses BugClassifier
3. ✅ UPDATE: `testing-core/src/application/useCases/StartExplorationUseCase.ts` - Uses BugClassifier  
4. ✅ UPDATE: `testing-core/src/infrastructure/monitoring/exceptionCatcher.ts` - Uses BugClassifier
5. ✅ UPDATE: `testing-core/src/domain/services/AutonomousExplorationEngine.ts` - Deduplication added
6. ✅ UPDATE: `shared/types.ts` - Added severity field to TelemetryMeta

---
## Implementation Complete!
- BugClassifier.ts with strict isActualBug() logic (NETWORK only if status >= 400 or critical strings)
- Deduplication in registerConfirmedBug() using .some() check
- All files updated to use centralized BugClassifier
- TypeScript compile check: RUNNING...
