import type { BugFinder } from './types.js';
import { inputSanitizationFinder } from './finders/inputSanitization.js';
import { clientSideConstraintBypassFinder } from './finders/clientSideBypass.js';
import { noSqlInjectionFinder } from './finders/noSqlInjection.js';
import { spaRaceConditionsFinder } from './finders/spaRaceConditions.js';
import { structuralNavigationFinder } from './finders/structuralNavigation.js';
import { boundaryStressFinder } from './finders/boundaryStress.js';

export function getAllBugFinders(): BugFinder[] {
  return [
    inputSanitizationFinder,
    clientSideConstraintBypassFinder,
    noSqlInjectionFinder,
    spaRaceConditionsFinder,
    structuralNavigationFinder,
    boundaryStressFinder,
  ];
}

