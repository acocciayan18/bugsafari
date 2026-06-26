# Implementation Plan

[Overview]
Consolidate session persistence to use only the `sessions` collection (SessionModel.ts) by adding `userId` and forensic tracking fields, then remove the separate `savedsafaris` collection. All session saves (both auto-completed and manual) will flow through a unified sessions collection with proper user association.

The current architecture has TWO separate collections:
- `sessions` collection - auto-created for runtime tracking (MISSING userId)
- `savedsafaris` collection - manual save on user click (HAS userId - correct)

Target: Merge savedsafaris fields INTO sessions, delete savedsafaris, use sessions for all history.

[Types]

## New/Fixed SessionModel.ts Types Required:

```typescript
// New subdocument: ForensicTrace (from SavedSafariModel)
export interface ICaughtBug {
  bugId: string;
  type: string;
  message: string;
  selector: string;
  payloadUsed: string;
  advice: string;
  timestamp: Date;
}

export interface IForensicTrace {
  finalBreadcrumbSteps: string[];
  caughtBugs: ICaughtBug[];
}

// New subdocument: Metrics (derived from SavedSafariModel)
export interface ISessionMetrics {
  totalActions: number;
  totalBugsFound: number;
  bugsByCategory: Record<string, number>;
}

// Extended ISession interface
export interface ISession extends Document {
  // EXISTING fields
  targetUrl: string;
  status: SessionStatus;
  startedAt: Date;
  finishedAt?: Date;
  savedManually: boolean;
  findingCount: number;
  actionTraceCount: number;
  brainSnapshotCount: number;
  config: ISessionConfig;
  stats: ISessionStats;
  error?: { message?: string; stackTrace?: string; timestamp?: Date };
  
  // NEW fields for consolidation
  userId: mongoose.Types.ObjectId & Required<{ type: 'User' }>;  // REQUIRED: true, ref: 'User'
  endedReason?: string;
  executionDate?: Date;        // Alias for startedAt - for backward compat
  timeElapsed?: number;       // Alias for stats.runtimeMs
  metrics?: ISessionMetrics;   // Alias for stats + forensic data
  forensicTrace?: IForensicTrace;  // Breadcrumbs + caught bugs
}
```

[Files]

## Files to Modify:

### 1. testing-core/src/infrastructure/database/models/SessionModel.ts
**Purpose:** Add userId and forensic fields to replace savedsafaris

**Changes:**
- Add `userId` field with `type: Schema.Types.ObjectId, ref: 'User', required: true`
- Add `endedReason` field (String, optional)
- Add `actionTraceCount` field (Number, default: 0)
- Add `brainSnapshotCount` field (Number, default: 0)
- Add `forensicTrace` subdocument (finalBreadcrumbSteps, caughtBugs)
- Add `metrics` subdocument (totalActions, totalBugsFound, bugsByCategory)
- Add compound index: `{ userId: 1, startedAt: -1 }`

### 2. testing-core/src/application/useCases/StartExplorationUseCase.ts
**Purpose:** Propagate userId to session creation

**Changes:**
- In `execute()` method: pass userId when calling `findingRepository.createSession()`
- The session creation already stores to sessions collection - add userId parameter
- Update `createSession()` call to include userId

### 3. testing-core/src/infrastructure/database/repositories/MongoFindingRepository.ts
**Purpose:** Accept userId in createSession method

**Changes:**
- `createSession(targetUrl, startedAt, userId?)` - add optional userId parameter
- Pass userId to SessionModel.create() when creating session

### 4. testing-core/src/presentation/api/registerRoutes.ts  
**Purpose:** Switch from savedsafaris to sessions collection

**Changes:**
- `/api/history/save-session` endpoint: Save to sessions collection (via useCase) instead of calling manualSaveToHistory which uses savedsafaris
- Update manualSaveToHistory to update existing session rather than create new document
- Remove dependency on SavedSafariRepository for history endpoints
- `/api/history` (GET) - query sessions by userId instead of savedsafaris
- `/api/history/:id` (DELETE) - delete from sessions by userId
- `/api/history/export/:id` - export from sessions by userId

### 5. developer-dashboard/src/services/historyService.ts
**Purpose:** Ensure client sends userId implicitly via auth

**Changes:**
- The service already sends Authorization headers
- Confirmed: No changes needed - backend handles userId from JWT

### 6. testing-core/src/infrastructure/database/repositories/SavedSafariRepository.ts
**Purpose:** Deprecate (will be removed after migration)

**Changes:**
- Add deprecation comment/warning
- No functional changes now - kept for backward compat during transition

### 7. testing-core/src/infrastructure/database/schemas/SavedSafariModel.ts
**Purpose:** Mark as deprecated

**Changes:**
- Add deprecation comment indicating sessions collection is now the source of truth

## Files to Delete:

### (After migration - not in this plan)
- testing-core/src/infrastructure/database/schemas/SavedSafariModel.ts
- testing-core/src/infrastructure/database/repositories/SavedSafariRepository.ts

[Functions]

## New/Modified Functions:

### 1. SessionModel.ts - Schema additions
```typescript
// NEW FIELDS to add to sessionSchema:
userId: {
  type: Schema.Types.ObjectId,
  ref: 'User',
  required: [true, 'userId is required — every session must belong to a user.'],
  index: true,
},
endedReason: {
  type: String,
  required: false,
  default: null,
  maxlength: [1500, 'Ended reason cannot exceed 1500 characters'],
},
actionTraceCount: {
  type: Number,
  required: true,
  default: 0,
},
brainSnapshotCount: {
  type: Number,
  required: true,
  default: 0,
},
forensicTrace: {
  type: {
    finalBreadcrumbSteps: [{ type: String }],
    caughtBugs: [{
      bugId: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
      type: String,
      message: String,
      selector: String,
      payloadUsed: String,
      advice: String,
      timestamp: { type: Date, default: Date.now },
    }],
  },
  required: false,
  default: { finalBreadcrumbSteps: [], caughtBugs: [] },
},
metrics: {
  type: {
    totalActions: { type: Number, default: 0 },
    totalBugsFound: { type: Number, default: 0 },
    bugsByCategory: { type: Map, of: Number, default: {} },
  },
  required: false,
  default: { totalActions: 0, totalBugsFound: 0, bugsByCategory: {} },
},
```

### 2. MongoFindingRepository.ts - createSession modification
```typescript
// Current:
async createSession(data: { targetUrl: string; startedAt: string }): Promise<string>

// Modified:
async createSession(data: { targetUrl: string; startedAt: string; userId?: string }): Promise<string>
```

### 3. StartExplorationUseCase.ts - propagate userId
```typescript
// In execute() method - current:
this.currentSessionId = await this.findingRepository.createSession({
  targetUrl,
  startedAt: new Date().toISOString(),
});

// Modified:
this.currentSessionId = await this.findingRepository.createSession({
  targetUrl,
  startedAt: new Date().toISOString(),
  userId: this.currentUserId,  // Use the authenticated userId
});
```

### 4. registerRoutes.ts - history endpoints
```typescript
// /api/history/save-session - current (uses savedsafaris):
const result = await useCase.manualSaveToHistory(targetUrl, userId, { ownerType });

// Modified (update existing session in sessions collection):
// Instead of manualSaveToHistory creating new document,
// update the current session in sessions collection with forensic data
await useCase.updateSessionWithForensicData(this.currentSessionId, {
  targetUrl,
  userId,
  forensicTrace,
  metrics,
});
```

[Classes]

## Modified Classes:

### 1. StartExplorationUseCase
**Modified:** Add new method for updating session with forensic data instead of manualSaveToHistory
  
- `public async updateSessionWithForensicData(sessionId: string, data: {...})`
- Updates existing session document in `sessions` collection with:
  - userId
  - endedReason  
  - actionTraceCount
  - brainSnapshotCount
  - forensicTrace (finalBreadcrumbSteps, caughtBugs)
  - metrics (totalActions, totalBugsFound, bugsByCategory)

### 2. MongoFindingRepository
**Modified:** Accept userId in createSession

- Add optional userId parameter
- Pass to SessionModel.create() for session association

### 3. SessionModel (Mongoose)
**Modified:** Add userId and forensic fields

- All new fields listed in Functions section above
- Add compound index: `{ userId: 1, startedAt: -1 }`

[Dependencies]

## Dependency Changes:

### testing-core/package.json
**Expected:** No new dependencies

The mongoose Types are already available. No additional packages required.

[Testing]

## Test Strategy:

### 1. Unit Tests
- Test SessionModel schema validates userId as required
- Test userId ref resolves to User model
- Test forensicTrace subdocument structure
- Test metrics subdocument structure

### 2. Integration Tests
- Test authenticated session creation includes userId
- Test session history returns only user's sessions
- Test delete rejects unauthorized access
- Test export returns correct session data

### 3. Manual Testing
- Login as user -> start test -> verify session has userId in MongoDB
- Login as user -> save session -> verify appears in history
- Login as different user -> verify can't see other user's sessions

[Implementation Order]

## Execution Sequence:

1. **Step 1:** Update SessionModel.ts - Add userId and forensic fields to schema
2. **Step 2:** Update MongoFindingRepository.ts - Accept userId in createSession
3. **Step 3:** Update StartExplorationUseCase.ts - Pass userId to createSession and add updateSessionWithForensicData method
4. **Step 4:** Update registerRoutes.ts - Switch history endpoints to use sessions collection
5. **Step 5:** Verify historyService.ts works (should be no changes needed)
6. **Step 6:** Add deprecation comments to SavedSafariModel.ts and SavedSafariRepository.ts
7. **Step 7:** Test end-to-end flow

Note: Actual deletion of SavedSafariRepository and SavedSafariModel should be done in a separate migration step after verifying the new flow works.
