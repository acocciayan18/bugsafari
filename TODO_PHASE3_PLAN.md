# Phase 3: Telemetry Collection - Implementation Plan

## Status Report

### ✅ Already Implemented (From Code Analysis)
1. ForensicTelemetryModel - Database model with all required fields
2. ForensicTelemetryRepository - Repository with create/find/update methods
3. PlaywrightBrowserEngine - Captures browser info at launch (browser, version, OS, viewport)
4. AutonomousExplorationEngine:
   - `persistTelemetry()` method exists
   - Called at test start with browser info
   - Called at test end with execution duration

### ❌ Needs Implementation
1. **Runtime metrics tracking** - requestsCount, pageCount, interactionCount, failureCount not being tracked
2. **UI display** - Telemetry not shown in forensic record details

---

## Implementation Steps

### Step 1: Track Runtime Metrics in AutonomousExplorationEngine
- Track page navigations (increment pageCount)
- Track interactions executed (increment interactionCount)
- Track network requests (increment requestsCount)  
- Track failures (increment failureCount)
- Update persistTelemetry() at end with actual metrics

### Step 2: Add UI Display for Telemetry
- Extend ForensicTrail.tsx or create TelemetryDisplay component
- Fetch and display telemetry data for selected session
- Show browser info, execution duration, counts

---

## Files to Edit
1. `testing-core/src/domain/services/AutonomousExplorationEngine.ts` - Add metric tracking
2. `developer-dashboard/src/components/ForensicTrail.tsx` - Add telemetry display OR
3. `developer-dashboard/src/components/ClinicalForensicsDashboard.tsx` - Add telemetry tab
