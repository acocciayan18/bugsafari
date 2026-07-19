import type { BugFinder } from '../types.js';
import { structuralProbeFinder } from './structuralProbe.js';
import { concurrentStressGuard } from './concurrentStress.js';
import { noSqlInjectionFinder } from './noSqlInjection.js';
import { spaRaceConditionsFinder } from './spaRaceConditions.js';

/**
 * Finders executed by BugFinderRunner, ordered cheapest-gate-first.
 *
 * The two chaos-gated finders come first: they self-gate on a short-lived
 * transaction, so their predicate is a cheap null-check. The two active probes drive
 * the page and are sampled on the runner's cadence.
 *
 * fuzzGuard is deliberately absent: it is a payload-correlated oracle that must run
 * inside ActionExecutor's still-open FUZZ transaction with the injected payload in
 * hand, so a post-action sweep would both lose the correlation and under-sample it.
 */
export const BUG_FINDERS: readonly BugFinder[] = [
  structuralProbeFinder,
  concurrentStressGuard,
  noSqlInjectionFinder,
  spaRaceConditionsFinder,
];

export { setChaosManagerAccessor as setStructuralProbeAccessor } from './structuralProbe.js';
export { setChaosManagerAccessor as setConcurrentStressAccessor } from './concurrentStress.js';
