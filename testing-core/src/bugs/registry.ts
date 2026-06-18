import type { BugFinder } from './types.js';
import { inputSanitizationFinder } from './finders/inputSanitization.js';
import { noSqlInjectionFinder } from './finders/noSqlInjection.js';
import { spaRaceConditionsFinder } from './finders/spaRaceConditions.js';
import { structuralNavigationFinder } from './finders/structuralNavigation.js';
import { runtimeStabilityFinder } from './finders/runtimeStability.js';
import { fuzzGuard } from './finders/fuzzGuard.js';
import { concurrentStressGuard } from './finders/concurrentStress.js';
import { structuralProbeFinder } from './finders/structuralProbe.js';

export function getAllBugFinders(): BugFinder[] {
  return [
    inputSanitizationFinder,
    clientSideConstraintBypassFinder,
    noSqlInjectionFinder,
    spaRaceConditionsFinder,
    structuralNavigationFinder,
    runtimeStabilityFinder,
    boundaryStressFinder,
    fuzzGuard,
    concurrentStressGuard,
    structuralProbeFinder,
  ];
}

