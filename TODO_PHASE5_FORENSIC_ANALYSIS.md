# Phase 5: AI-Powered Forensic Analysis - IMPLEMENTATION PLAN

## Goal
Analyze collected forensic data and generate insights including:
1. Root Cause Analysis
2. Risk Scoring (0-100)
3. Recommendations

---

## Current State Assessment

### Already Implemented (Available for Analysis):
| Data Type | Model | Repository | Status |
|------------|-------|------------|--------|
| Error logs | ForensicErrorModel | ForensicErrorRepository | ✅ |
| Telemetry | ForensicTelemetryModel | ForensicTelemetryRepository | ✅ |
| API failures | ForensicErrorModel | ForensicErrorRepository | ✅ |
| Screenshots | ForensicScreenshotModel | ForensicScreenshotRepository | ✅ |
| Test history | FindingModel | MongoFindingRepository | ✅ |

### Missing Components:
- ❌ ForensicAnalysisModel (new)
- ❌ ForensicAnalysisRepository (new)
- ❌ ForensicAnalysisService (new - core logic)
- ❌ API endpoint (new)
- ❌ UI display integration (update ClinicalForensicsDashboard)

---

## Implementation Plan

### Step 1: Create ForensicAnalysisModel
**File:** `testing-core/src/infrastructure/database/models/ForensicAnalysisModel.ts`

**Schema Fields:**
- `id` - auto-generated
- `forensicRunId` - reference to test session
- `rootCause` - human-readable cause description
- `riskScore` - 0-100 numeric score
- `riskLevel` - LOW | MEDIUM | HIGH | CRITICAL
- `recommendations` - array of actionable suggestions
- `createdAt` - timestamp

### Step 2: Create ForensicAnalysisRepository
**File:** `testing-core/src/infrastructure/database/repositories/ForensicAnalysisRepository.ts`

**Methods:**
- `create()` - save analysis result
- `findByRunId()` - get analysis for specific run
- `findLatest()` - get most recent analysis
- `deleteByRunId()` - cleanup

### Step 3: Create ForensicAnalysisService
**File:** `testing-core/src/domain/services/ForensicAnalysisService.ts`

**Core Logic:**
1. **Collect forensic data:**
   - Fetch errors by run ID
   - Fetch telemetry events
   - Fetch screenshots count

2. **Root Cause Analysis:**
   - Analyze error patterns
   - Identify API failure chains
   - Generate natural language description
   - Example: "Registration failed because API endpoint /register returned HTTP 500"

3. **Risk Scoring Algorithm:**
   ```
   Base Score = 0
   + Error Count * 2 (capped at 30)
   + API Failures * 10 (capped at 30)
   + Critical Errors * 15
   + JS Exceptions * 8
   + Missing Screenshots * 5 (if no screenshot for error)
   
   Risk Level Thresholds:
   - 0-25: LOW
   - 26-50: MEDIUM  
   - 51-75: HIGH
   - 76-100: CRITICAL
   ```

4. **Recommendations Generation:**
   - Based on error types and patterns
   - Actionable fixes with examples:
     - "Fix missing API route /register"
     - "Handle null response from authentication service"
     - "Improve input validation on registration form"

### Step 4: Update API Routes
**File:** `testing-core/src/presentation/api/registerRoutes.ts`

**New Endpoints:**
```
GET /api/forensic/analysis?sessionId=:id
- Returns forensic analysis for a completed test run

POST /api/forensic/analyze
- Triggers analysis generation after test completion
- Called automatically when test run completes
```

### Step 5: Update UI
**File:** `developer-dashboard/src/components/ClinicalForensicsDashboard.tsx`

**Add to UI:**
- Risk Score display (gauge/chart)
- Root Cause section
- Recommendations list

---

## File Structure Summary

```
testing-core/src/
├── infrastructure/database/
│   ├── models/
│   │   └── ForensicAnalysisModel.ts  [NEW]
│   └── repositories/
│       └── ForensicAnalysisRepository.ts  [NEW]
└── domain/services/
    └── ForensicAnalysisService.ts  [NEW]

testing-core/src/presentation/api/
└── registerRoutes.ts  [UPDATE]

developer-dashboard/src/components/
└── ClinicalForensicsDashboard.tsx  [UPDATE]
```

---

## Success Criteria

1. ✅ After test run completes, analysis is automatically generated
2. ✅ Root cause shows specific failure reason (e.g., "API /register returned 500")
3. ✅ Risk score 0-100 with correct level mapping
4. ✅ At least 1 actionable recommendation per analysis
5. ✅ UI displays all three components clearly

---

## Implementation Priority

1. **P0 (Must Have):** ForensicAnalysisModel + Repository + Service basic logic
2. **P1 (Should Have):** Risk scoring algorithm with thresholds
3. **P2 (Nice to Have):** Advanced root cause patterns, UI polish
