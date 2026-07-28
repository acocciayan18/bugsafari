import type { BugFinder } from '../types.js';
import { concurrentStressGuard } from './concurrentStress.js';
import { noSqlInjectionFinder } from './noSqlInjection.js';
import { spaRaceConditionsFinder } from './spaRaceConditions.js';
import { constraintBypassFinder } from './constraintBypass.js';

/**
 * Finders executed by BugFinderRunner, ordered cheapest-gate-first.
 *
 * The chaos-gated finder comes first: it self-gates on a short-lived transaction,
 * so its predicate is a cheap null-check. The active probes drive the page and are
 * sampled on the runner's cadence.
 *
 * fuzzGuard is deliberately absent: it is a payload-correlated oracle that must run
 * inside ActionExecutor's still-open FUZZ transaction with the injected payload in
 * hand, so a post-action sweep would both lose the correlation and under-sample it.
 *
 * structuralProbeFinder is absent too, for a harder reason: it self-gates on an
 * active ROUTE_TRASH transaction, and RouteTrasher is disabled engine-wide, so
 * nothing can ever open one. Listing it advertised a ROUTE_MUTATION_FAILURE class
 * the run could never detect. The module stays for forensic back-compat.
 */
export const BUG_FINDERS: readonly BugFinder[] = [
  concurrentStressGuard,
  noSqlInjectionFinder,
  spaRaceConditionsFinder,
  constraintBypassFinder,
];

export { setChaosManagerAccessor as setStructuralProbeAccessor } from './structuralProbe.js';
export { setChaosManagerAccessor as setConcurrentStressAccessor } from './concurrentStress.js';
export { resetConstraintBypassFinder } from './constraintBypass.js';
