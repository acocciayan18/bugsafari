# Implementation Plan: Component Directory Reorganization

## Overview

Refactor `developer-dashboard/src/components/` by reorganizing its flat file structure into semantically grouped subdirectories. This involves partitioning 31 component files into logical categories (auth/, control-panels/, forensics/, layout/, common/) and automatically updating all broken imports across the dashboard codebase.

## Rationale

The current flat structure makes it difficult to navigate and maintain. Semantic grouping improves:
- Developer onboarding and code discovery
- Logical separation of concerns  
- Future scalability as more components are added

## Current Component Inventory

| File | Purpose | Proposed Category |
|------|---------|------------------|
| AuthGuard.tsx | Route protection | auth/ |
| LoginForm.tsx | User login | auth/ |
| SignupForm.tsx | User registration | auth/ |
| ForgotPasswordForm.tsx | Password recovery | auth/ |
| ResetPasswordForm.tsx | Password reset | auth/ |
| CommandCenter.tsx | Test orchestration | control-panels/ |
| SessionTimer.tsx | Timer display | control-panels/ |
| TestingTypeSelector.tsx | Test type selection | control-panels/ |
| ClinicalForensicsDashboard.tsx | Main dashboard view | forensics/ |
| ForensicReport.tsx | Report view | forensics/ |
| ForensicTrail.tsx | Event trail | forensics/ |
| ReproductionTrail.tsx | Reproduction steps | forensics/ |
| ReproducibleSteps.tsx | Step playback | forensics/ |
| CoverageProgressBar.tsx | Coverage display | forensics/ |
| LiveFeed.tsx | Real-time feed | forensics/ |
| DeleteConfirmDialog.tsx | Confirmation modal | common/ |
| RowActionMenu.tsx | Row operations | common/ |
| HelpMenuIcon.tsx | Help icon | common/ |
| SupportModal.tsx | Support dialog | common/ |
| SessionHistoryTable.tsx | History table | history/ |
| SavedEvaluationSafaris.tsx | Saved safaris | history/ |
| Sidebar.tsx | Navigation sidebar | layout/ |
| SidebarLayout.tsx | Layout wrapper | layout/ |
| Settings.tsx | User settings | settings/ |
| TelemetryStream.tsx | Telemetry display | telemetry/ (already exists) |
| TelemetryLogStream.tsx | Log streaming | telemetry/ |
| ConsoleTabPanel.tsx | Console tab | telemetry/ |
| NetworkTabPanel.tsx | Network tab | telemetry/ |
| ErrorTabPanel.tsx | Error tab | telemetry/ |
| ReproductionChecklist.tsx | Checklist | telemetry/ |
| index.ts | Barrel export | (move to each folder) |

## Types

N/A - This is a file reorganization task, not a type system change.

## Files

### New Files to Create

- `developer-dashboard/src/components/auth/index.ts` - Barrel export
- `developer-dashboard/src/components/control-panels/index.ts` - Barrel export
- `developer-dashboard/src/components/forensics/index.ts` - Barrel export
- `developer-dashboard/src/components/layout/index.ts` - Barrel export
- `developer-dashboard/src/components/common/index.ts` - Barrel export
- `developer-dashboard/src/components/history/index.ts` - Barrel export
- `developer-dashboard/src/components/settings/index.ts` - Barrel export

### Existing Files to Move

All component files will be moved to their new semantic folders:

1. **auth/** (5 files)
   - LoginForm.tsx, SignupForm.tsx, ForgotPasswordForm.tsx, ResetPasswordForm.tsx, AuthGuard.tsx

2. **control-panels/** (3 files)
   - CommandCenter.tsx, SessionTimer.tsx, TestingTypeSelector.tsx

3. **forensics/** (9 files)
   - ClinicalForensicsDashboard.tsx, ForensicReport.tsx, ForensicTrail.tsx, ReproductionTrail.tsx, ReproducibleSteps.tsx, CoverageProgressBar.tsx, LiveFeed.tsx

4. **layout/** (2 files)
   - Sidebar.tsx, SidebarLayout.tsx

5. **common/** (4 files)
   - DeleteConfirmDialog.tsx, RowActionMenu.tsx, HelpMenuIcon.tsx, SupportModal.tsx

6. **history/** (2 files)
   - SessionHistoryTable.tsx, SavedEvaluationSafaris.tsx

7. **settings/** (1 file)
   - Settings.tsx

### Files to Delete

- `developer-dashboard/src/components/index.ts` - Only if it was a flat export (check before deleting)
- `developer-dashboard/src/components/icons/index.ts` - Keep, already organized
- `developer-dashboard/src/components/telemetry/index.ts` - Keep, already organized

### Files to Modify

1. **App.tsx** - Update all component import paths
2. **SidebarLayout.tsx** - Update Sidebar import path
3. **CommandCenter.tsx** - Update SessionTimer, TestingTypeSelector import paths

## Dependencies

N/A - No new dependencies required. This is purely a file reorganization.

## Testing

### Validation Strategy

1. Run TypeScript compiler to verify all imports resolve:
   ```bash
   cd developer-dashboard && npx tsc --noEmit
   ```

2. Verify build succeeds:
   ```bash
   cd developer-dashboard && npm run build
   ```

3. Test that application runs without console errors:
   ```bash
   cd developer-dashboard && npm run dev
   ```

### Test File Requirements

No test file modifications expected - imports are path-only changes that don't affect test logic.

## Implementation Order

### Phase 1: Create Directory Structure
1. Create empty directories: auth/, control-panels/, forensics/, layout/, common/, history/, settings/

### Phase 2: Move Files (in order to minimize conflicts)
2. Move auth/ components first (lowest dependencies)
3. Move layout/ components next 
4. Move control-panels/ components (depends on common/)
5. Move forensics/ components
6. Move remaining: history/, settings/, common/

### Phase 3: Create Barrel Exports
7. Create index.ts files in each new directory

### Phase 4: Update Import Paths
8. Update App.tsx imports
9. Update SidebarLayout.tsx imports
10. Update CommandCenter.tsx imports
11. Update any other files with cross-references

### Phase 5: Validation
12. Run TypeScript check
13. Run build
14. Test application runtime

## Import Path Migration Reference

| Original Import | New Import Path |
|-----------------|-----------------|
| ./components/LoginForm | ./components/auth/LoginForm |
| ./components/SignupForm | ./components/auth/SignupForm |
| ./components/ForgotPasswordForm | ./components/auth/ForgotPasswordForm |
| ./components/ResetPasswordForm | ./components/auth/ResetPasswordForm |
| ./components/AuthGuard | ./components/auth/AuthGuard |
| ./components/CommandCenter | ./components/control-panels/CommandCenter |
| ./components/SessionTimer | ./components/control-panels/SessionTimer |
| ./components/TestingTypeSelector | ./components/control-panels/TestingTypeSelector |
| ./components/ClinicalForensicsDashboard | ./components/forensics/ClinicalForensicsDashboard |
| ./components/ForensicReport | ./components/forensics/ForensicReport |
| ./components/ForensicTrail | ./components/forensics/ForensicTrail |
| ./components/ReproductionTrail | ./components/forensics/ReproductionTrail |
| ./components/ReproducibleSteps | ./components/forensics/ReproducibleSteps |
| ./components/CoverageProgressBar | ./components/forensics/CoverageProgressBar |
| ./components/LiveFeed | ./components/forensics/LiveFeed |
| ./components/Sidebar | ./components/layout/Sidebar |
| ./components/SidebarLayout | ./components/layout/SidebarLayout |
| ./components/DeleteConfirmDialog | ./components/common/DeleteConfirmDialog |
| ./components/RowActionMenu | ./components/common/RowActionMenu |
| ./components/HelpMenuIcon | ./components/common/HelpMenuIcon |
| ./components/SupportModal | ./components/common/SupportModal |
| ./components/SessionHistoryTable | ./components/history/SessionHistoryTable |
| ./components/SavedEvaluationSafaris | ./components/history/SavedEvaluationSafaris |
| ./components/Settings | ./components/settings/Settings |
| ./components/TelemetryStream | ./components/telemetry/TelemetryStream |
| ./components/icons | ./components/icons (unchanged) |
| ./components/telemetry | ./components/telemetry (unchanged) |

## Special Considerations

1. **Already Organized**: telemetry/ and icons/ directories already exist - keep their current structure
2. **Icons**: icons/index.ts re-exports from designs/icons - verify after move
3. **Backward Compatibility**: Consider adding barrel exports for each folder to maintain clean import paths
4. **No Breaking Changes**: Since this is internal refactoring, no API or contract changes
