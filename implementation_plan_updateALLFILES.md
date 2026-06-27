# Implementation Plan - Update ALL_FILES_CODEBASE.md

[Overview]
Update ALL_FILES_CODEBASE.md to accurately reflect the current state of the BugSafari codebase. The file was generated on June 4, 2026 but is now missing ~50+ files that have been added since then. The comprehensive update will include all new components, services, scenarios, infrastructure, and repositories with descriptive documentation explaining each file's purpose, triggers, and downstream effects.

This documentation update is critical because developers rely on ALL_FILES_CODEBASE.md to understand the system's surface area. The current outdated version omits significant functionality including the fuzzing scenarios, rapid clicker scenarios, new forensic analysis services, and multiple new UI components.

[Types]
No type system changes required - this is a documentation-only task.

[Files]
Update the existing ALL_FILES_CODEBASE.md file with comprehensive documentation including all missing files.

Detailed breakdown:
- **Modified files:**
  1. `ALL_FILES_CODEBASE.md` - Comprehensive rewrite to include all current files

- **No new files created** - This is purely a documentation update task.

- **Missing files identified (by category):**

  DELEOPER-DASHBOARD NEW COMPONENTS:
  - components/ForgotPasswordForm.tsx - Password recovery flow form
  - components/ResetPasswordForm.tsx - Password reset confirmation form
  - components/CoverageProgressBar.tsx - Visual coverage indicator
  - components/RowActionMenu.tsx - Context menu for table rows
  - components/DeleteConfirmDialog.tsx - Deletion confirmation modal
  - components/SupportModal.tsx - Help/support modal
  - components/HelpMenuIcon.tsx - Help menu trigger icon
  - components/SessionTimer.tsx - Session duration timer display
  - components/LiveFeed.tsx - Live execution frame viewer
  - components/ClinicalForensicDashboard.tsx - Main forensics dashboard
  - components/ReproducibleSteps.tsx - Reproducible steps display
  - components/RowActionMenu.tsx - Table row context actions

  DEVELOPER-DASHBOARD NEW CONTEXT/HOOKS/INFRASTRUCTURE:
  - context/index.ts - Context exports barrel
  - hooks/useUserSettings.ts - User preferences hook
  - designs/globals.css - Global design tokens
  - designs/LandingPage.tsx - Landing page component
  - designs/GradientBlinds.tsx - Design effect component
  - designs/ThemeContext.tsx - Theme provider
  - designs/components/MagicBento.css - Bento grid styles
  - utils/semanticFormatter.ts - Semantic formatting utilities
  - infrastructure/notifications/ToastProvider.tsx - Toast notification provider
  - infrastructure/notifications/customToast.css - Toast custom styles

  TESTING-CORE NEW BUG FINDERS:
  - bugs/finders/concurrentStress.ts - Concurrent stress detection
  - bugs/finders/fuzzGuard.ts - Fuzzing guard detection
  - bugs/finders/structuralProbe.ts - Structural probing detection

  TESTING-CORE NEW DOMAIN ENTITIES:
  - domain/entities/InteractiveElement.ts - Interactive target entity model

  TESTING-CORE NEW DOMAIN HEURISTICS:
  - domain/heuristics/MemoryLeakDetector.ts - Memory leak detection
  - domain/heuristics/VisualRegressionDetector.ts - Visual regression detection

  TESTING-CORE NEW DOMAIN SCENARIOS (FUZZING):
  - domain/scenarios/fuzzing/dataFuzzer.ts - Main fuzzing scenario
  - domain/scenarios/fuzzing/elementClassifier.ts - Element classification
  - domain/scenarios/fuzzing/strategies/ - Strategy subdirectory
  - domain/scenarios/fuzzing/strategies/chaosFallbackStrategy.ts
  - domain/scenarios/fuzzing/strategies/dateStrategy.ts
  - domain/scenarios/fuzzing/strategies/emailStrategy.ts
  - domain/scenarios/fuzzing/strategies/index.ts
  - domain/scenarios/fuzzing/strategies/jsonStrategy.ts
  - domain/scenarios/fuzzing/strategies/noSqlInjectionStrategy.ts
  - domain/scenarios/fuzzing/strategies/numericBoundaryStrategy.ts
  - domain/scenarios/fuzzing/strategies/xssVectorStrategy.ts

  TESTING-CORE NEW DOMAIN SCENARIOS (RAPID CLICKER):
  - domain/scenarios/rapidClicker/ - New rapid clicker scenarios
  - domain/scenarios/rapidClicker/burstClicker.ts - Burst click scenario
  - domain/scenarios/rapidClicker/buttonSpammer.ts - Button spam detection
  - domain/scenarios/rapidClicker/coordinateBombing.ts - Coordinate bombing
  - domain/scenarios/rapidClicker/index.ts - Rapid clicker exports
  - domain/scenarios/rapidClicker/interactionSimulator.ts - Interaction simulator
  - domain/scenarios/rapidClicker/utils.ts - Rapid clicker utilities

  TESTING-CORE NEW DOMAIN SCENARIOS (OTHER):
  - domain/scenarios/networkSaboteur.ts - Network disruption scenario
  - domain/scenarios/rapidClickerStress.ts - Click stress scenario
  - domain/scenarios/routeTrasher.ts - Route churn scenario

  TESTING-CORE NEW DOMAIN SERVICES:
  - domain/services/BugClassifier.ts - Bug severity classification
  - domain/services/SeededRandomGenerator.ts - Deterministic random generation
  - domain/services/ForensicAnalysisService.ts - Forensic analysis orchestration
  - domain/fuzzing/ChaosTransactionManager.ts - Fuzzing transaction management
  - domain/fuzzing/index.ts - Fuzzing exports

  TESTING-CORE NEW INFRASTRUCTURE (DATABASE MODELS):
  - infrastructure/database/models/ForensicAnalysisModel.ts
  - infrastructure/database/models/ForensicErrorModel.ts
  - infrastructure/database/models/ForensicTelemetryModel.ts

  TESTING-CORE NEW INFRASTRUCTURE (DATABASE REPOSITORIES):
  - infrastructure/database/repositories/ForensicAnalysisRepository.ts
  - infrastructure/database/repositories/ForensicErrorRepository.ts
  - infrastructure/database/repositories/ForensicTelemetryRepository.ts

  TESTING-CORE NEW INFRASTRUCTURE (MONITORING):
  - infrastructure/monitoring/browserConsoleListener.ts - Console listening
  - infrastructure/monitoring/MemoryProfiler.ts - Memory profiling

  TESTING-CORE NEW PRESENTATION (AUTHENTICATION):
  - presentation/authentication/authConfig.ts - Auth configuration
  - presentation/authentication/authController.ts - Auth controller
  - presentation/authentication/userSettingsController.ts - User settings API

[Functions]
No function modifications - documentation only task.

[Classes]
No class modifications - documentation only task.

[Dependencies]
No new dependencies required - this is a pure documentation update.

[Testing]
No testing required for documentation updates. The task involves verification that all files in the repository are accounted for in the documentation.

[Implementation Order]
1. Review ALL_FILES_CODEBASE.md current structure and format
2. Use list_files output to enumerate all current files
3. Read key type definition files for context
4. Organize files by category matching existing document structure
5. Write comprehensive update to ALL_FILES_CODEBASE.md
6. Verify documentation completeness
