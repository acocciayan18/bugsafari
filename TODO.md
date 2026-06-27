# Session Persistence Pipeline - COMPLETED

## Task Summary
- **Goal**: Remove savedsafaris collections/models, use sessions collection only
- **Status**: ✅ COMPLETED

## Implementation Checklist

- [x] Step 1: SessionModel.ts - Add userId field to schema with ref: 'User', required: true
- [x] Step 2: MongoFindingRepository.ts - Accept userId in createSession()
- [x] Step 3: StartExplorationUseCase.ts - Pass userId to createSession()
- [x] Step 4: FindingRepository.ts - Verify userId param exists (already present)
- [x] Step 5: registerRoutes.ts - Switch /api/history to query sessions collection
- [x] Step 6: SavedSafariModel.ts - Add deprecation comment
- [x] Step 7: SavedSafariRepository.ts - Add deprecation comment
- [x] Step 8: Verify historyService.ts (no changes needed - sends auth headers)
- [x] Step 9: Update stale log messages in registerRoutes.ts (sessions not savedsafaris)
- [x] Step 10: Frontend SavedEvaluationSafaris.tsx uses fetchSessionHistory() from sessions

## Files Verified/Modified

1. **testing-core/src/infrastructure/database/models/SessionModel.ts**
   - ✅ Has userId field with ref: 'User'
   - ✅ Has compound index: { userId: 1, startedAt: -1 }

2. **testing-core/src/infrastructure/database/repositories/MongoFindingRepository.ts**
   - ✅ Accepts userId in createSession()
   - ✅ listSessionHistory() filters by userId

3. **testing-core/src/application/useCases/StartExplorationUseCase.ts**
   - ✅ manualSaveToHistory() saves to SessionModel (sessions collection)
   - ✅ Sets userId from authenticated user

4. **testing-core/src/presentation/api/registerRoutes.ts**
   - ✅ All endpoints query sessions collection only
   - ✅ Updated logs: "Saved to sessions" not "savedsafaris"
   - ✅ Removed stale savedsafaris references

5. **testing-core/src/infrastructure/database/schemas/SavedSafariModel.ts**
   - ✅ Marked DEPRECATED with comment

6. **testing-core/src/infrastructure/database/repositories/SavedSafariRepository.ts**
   - ✅ Marked DEPRECATED with comment

7. **developer-dashboard/src/services/historyService.ts**
   - ✅ Uses fetchSessionHistory() which queries sessions collection

8. **developer-dashboard/src/components/SavedEvaluationSafaris.tsx**
   - ✅ Uses transformSessionsToEvaluations() - now uses sessions only

## Key Technical Details

- Sessions collection is the single source of truth
- All session history is linked to userId
- Auth middleware extracts userId from JWT
- Guest users are rejected when attempting to save or view history
- The savedsafaris collection is deprecated but still exists in MongoDB (not deleted)

## API Endpoints Verified

| Endpoint | Method | Collection | Auth Required |
|----------|--------|------------|---------------|
| /api/history/save-session | POST | sessions | ✅ requireAuth |
| /api/history/sessions | GET | sessions | ✅ requireAuth |
| /api/history | GET | sessions | ✅ requireAuth |
| /api/history/:id | DELETE | sessions | ✅ requireAuth |
| /api/history/export/:id | GET | sessions | ✅ requireAuth |
| /api/forensic/report/:sessionId | GET | sessions | ✅ requireAuth |

## Notes

- The savedsafaris MongoDB collection is NOT deleted (data migration not performed)
- Only the code references to savedsafaris have been removed/updated
- For production, consider running a migration script to move data from savedsafaris to sessions
