# Implementation Plan

[Overview]
Update the Developer Dashboard UI component to parse and display the new sequentially numbered, human-executable bug reproduction playbooks created by the backend telemetry layer. Add a `reproductionPlaybook` field directly to `ForensicCrashReport` and refactor `ForensicTrail.tsx` to render a clean, high-contrast numbered checklist instead of the raw background activity blocks.

[Types]
Add optional `reproductionPlaybook?: string[]` field to the `ForensicCrashReport` interface in shared/types.ts to store the pre-generated narrative playbook strings from the backend.

Detailed type definitions:
```typescript
// In shared/types.ts - Add to existing ForensicCrashReport interface
export interface ForensicCrashReport {
  timestamp: string;
  reason: string;
  statusCode?: number;
  url: string;
  stackTrace?: string;
  breadcrumbs: ActionBreadcrumb[];
  // NEW: Pre-generated sequential narrative steps for human reproduction
  reproductionPlaybook?: string[];
}
```

[Files]
Modify shared/types.ts and ForensicTrail.tsx to add and render the new structured playbook.

Detailed breakdown:
- Modified files:
  1. `shared/types.ts` - Add optional `reproductionPlaybook?: string[]` field to ForensicCrashReport interface
  2. `developer-dashboard/src/components/ForensicTrail.tsx` - Update to parse and render reproductionPlaybook as clean numbered checklist

- No new files required.

[Functions]
Update ForensicTrail.tsx to conditionally parse reproductionPlaybook array and render clean checklist format.

Detailed breakdown:
- Modified functions:
  1. `ForensicTrail` component (in ForensicTrail.tsx):
     - Import `reproductionPlaybook` from report if available
     - Replace old two-section view (semantic + raw trail) with clean numbered checklist
     - Fallback to existing breadcrumb mapping if `reproductionPlaybook` is not present

[Classes]
No class modifications required.

[Dependencies]
No new dependencies required. The existing codebase already has all infrastructure in place:
- `ReproductionPlaybookStore.getNarrativeSteps()` in testing-core already generates the narrative strings
- `mapForensicReportToPlaybook()` already transforms breadcrumbs to PlaybookStep[]
- The socket gateway already sends ForensicCrashReport to frontend

[Testing]
Verify the TypeScript compilation succeeds after changes. The ForensicTrail component should display cleanly formatted steps when reproductionPlaybook data is present.

Implementation Order:
1. Update ForensicCrashReport interface in shared/types.ts to add reproductionPlaybook field
2. Update ForensicTrail.tsx to render reproductionPlaybook as clean numbered checklist
3. Verify TypeScript compilation succeeds

task_progress Items:
- [x] Step 1: Read and understand existing ForensicTrail.tsx implementation
- [x] Step 2: Analyze ForensicCrashReport type and related mapper utilities
- [x] Step 3: Review backend reproductionPlaybookStore for narrative generation
- [x] Step 4: Create implementation plan document
- [x] Step 5: Add reproductionPlaybook field to ForensicCrashReport in shared/types.ts
- [x] Step 6: Update ForensicTrail.tsx to render clean numbered checklist
- [x] Step 7: Verify TypeScript compilation succeeds
