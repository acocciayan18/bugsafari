# TODO - Update Documentation Files

## Goal
Update ALL_FILES_CODEBASE.md and CODEBASE_DOCUMENTATION.md to match the current codebase

## Analysis Completed

### Discrepancies Found:

1. **developer-dashboard/components/**
   - ❌ AuthForm.tsx → ✅ LoginForm.tsx + SignupForm.tsx
   - ✅ ThinkingIndicator.tsx (missing in docs)
   - ✅ ThoughtStream.tsx (missing in docs)

2. **testing-core/domain/scenarios/**
   - ✅ smartAttacker.ts listed
   - ✅ rapidClickerStress.ts consolidates buttonSpammer, coordinateBombing, concurrentClicker
   - ✅ Existing: dataFuzzer, formBypasser, networkSaboteur, routeTrasher, securityVulnerabilityScout

3. **testing-core/domain/services/**
   - ✅ RiskScorer.ts exists (NOT scorer.ts in heuristics)
   - ❌ ElementScorer, InteractionSimulator, RecursiveDomParser, StructuralHashManager don't exist

4. **testing-core/domain/heuristics/**
   - ✅ domParser.ts exists
   - ❌ hashUtils.ts doesn't exist

5. **testing-core/infrastructure/monitoring/**
   - ✅ actionBuffer.ts
   - ✅ reproductionPlaybookStore.ts
   - ✅ socketServer.ts
   - ✅ RuntimeMonitor.ts (ADD)
   - ✅ BinaryFrameServer.ts (ADD)

6. **testing-core/bugs/finders/**
   - ✅ boundaryStress.ts
   - ✅ clientSideBypass.ts
   - ✅ inputSanitization.ts
   - ✅ noSqlInjection.ts
   - ✅ runtimeStability.ts
   - ✅ spaRaceConditions.ts
   - ✅ structuralNavigation.ts

## Plan

1. Update ALL_FILES_CODEBASE.md:
   - Replace AuthForm reference with LoginForm + SignupForm
   - Add ThinkingIndicator and ThoughtStream components
   - Update domain/scenarios to reflect rapidClickerStress consolidation
   - Update domain/services to only list existing files (RiskScorer, AutonomousExplorationEngine)
   - Update domain/heuristics to only list domParser.ts
   - Add RuntimeMonitor and BinaryFrameServer to infrastructure/monitoring
   - Add smartAttacker to scenarios

2. Update CODEBASE_DOCUMENTATION.md:
   - Update scenario list to reflect rapidClickerStress
   - Move RiskScorer to domain services (not heuristics)
   - Update detection layer to reflect actual finders

## Status: [PENDING]
