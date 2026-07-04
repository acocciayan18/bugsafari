// ═══════════════════════════════════════════════════════════════
// knowledgeBase/FaultClassifier.ts — DETERMINISTIC CLASSIFICATION + ATTRIBUTION
// ═══════════════════════════════════════════════════════════════
// Pure, side-effect-free classifier. Given a caught fault plus the scenario that
// was active when it fired, it deterministically resolves the BugClass, severity,
// CWE, title, and remediation from the knowledge base, and attributes the finding
// to the scenario + testing type. Both live detection paths (StabilityMonitor and,
// if ever revived, ChaosTransactionManager) call this so classification is
// consistent platform-wide.

import type { BugClass } from '../types.js';
import type { TestingTypeId } from '../../../../shared/types.js';
import { BUG_CATALOG, type Severity } from './bugCatalog.js';
import {
  SCENARIO_CATALOG,
  EXPLORATORY_SCENARIO,
  resolveScenarioAttribution,
} from './scenarioCatalog.js';
import { matchesCategory, type SignalCategory } from './signalPatterns.js';

/** The raw fault kind reported by a detector before classification. */
export type FaultType = 'EXCEPTION' | 'CONSOLE' | 'NETWORK' | 'FREEZE';

export interface FaultInput {
  faultType: FaultType;
  /** Primary error message / reason text. */
  message: string;
  /** HTTP status when the fault is a response failure. */
  statusCode?: number;
  /** Current page/request URL, if known. */
  url?: string;
  /** Additional body/DOM content to scan for signatures. */
  content?: string;
  /** Name of the stress scenario active at fault time (undefined ⇒ exploratory). */
  scenario?: string;
  /** Chronological step index at fault time (playbook length). */
  stepIndex?: number;
}

export interface FaultClassification {
  bugClass: BugClass;
  severity: Severity;
  cwe: string;
  title: string;
  advice: string;
  scenario: string;
  testingType: TestingTypeId;
  stepIndex?: number;
}

/**
 * Which text source each signal category is tested against. QUERY_MUTATION tokens
 * (undefined/null/NaN) appear legitimately in page content, so it is URL-only —
 * preserving the original finders' behavior.
 */
const CATEGORY_SOURCE: Record<SignalCategory, 'url' | 'text' | 'both'> = {
  REDIRECT_LOOP: 'both',
  DEAD_END: 'both',
  CLIENT_CRASH: 'text',
  COMPONENT_FAIL: 'text',
  SERVER_ERROR: 'text',
  NOSQL_ERROR: 'text',
  XSS_REFLECTION: 'text',
  QUERY_MUTATION: 'url',
};

/**
 * Candidate bug classes per matched signal, in preference order. When a scenario
 * is active the classifier prefers a candidate that the scenario expects.
 */
const SIGNAL_TO_BUGCLASS: Record<SignalCategory, BugClass[]> = {
  NOSQL_ERROR: ['NOSQL_INJECTION', 'FUZZ_VULNERABILITY_LEAK'],
  XSS_REFLECTION: ['FUZZ_VULNERABILITY_LEAK', 'INPUT_SANITIZATION_FAILURE'],
  REDIRECT_LOOP: ['ROUTE_MUTATION_FAILURE', 'STRUCTURAL_NAVIGATION_LOGIC'],
  COMPONENT_FAIL: ['ROUTE_MUTATION_FAILURE', 'STRUCTURAL_NAVIGATION_LOGIC'],
  SERVER_ERROR: ['BOUNDARY_STRESS_FAILURE', 'SECURITY_VULNERABILITY_LEAK'],
  CLIENT_CRASH: ['RUNTIME_STABILITY_EXCEPTION'],
  DEAD_END: ['STRUCTURAL_NAVIGATION_LOGIC'],
  QUERY_MUTATION: ['ROUTE_MUTATION_FAILURE'],
};

/** Deterministic priority order in which matched categories are considered. */
const CATEGORY_PRIORITY: SignalCategory[] = [
  'NOSQL_ERROR',
  'XSS_REFLECTION',
  'REDIRECT_LOOP',
  'COMPONENT_FAIL',
  'SERVER_ERROR',
  'CLIENT_CRASH',
  'DEAD_END',
  'QUERY_MUTATION',
];

/** Fallback bug class when no runtime signal matches, keyed by the raw fault kind. */
const FAULT_TYPE_DEFAULT: Record<FaultType, BugClass> = {
  EXCEPTION: 'RUNTIME_STABILITY_EXCEPTION',
  CONSOLE: 'RUNTIME_STABILITY_EXCEPTION',
  NETWORK: 'BOUNDARY_STRESS_FAILURE',
  // Idle main-thread lockup/freeze is a stability failure; when a stress scenario
  // is active its own expected bugs (race/boundary) take precedence upstream.
  FREEZE: 'RUNTIME_STABILITY_EXCEPTION',
};

const SEVERITY_RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

function matchedCategories(input: FaultInput): SignalCategory[] {
  const url = input.url ?? '';
  const text = [input.message, input.content].filter(Boolean).join('\n');

  return CATEGORY_PRIORITY.filter((category) => {
    const source = CATEGORY_SOURCE[category];
    if (source === 'url') return matchesCategory(category, url);
    if (source === 'text') return matchesCategory(category, text);
    return matchesCategory(category, url) || matchesCategory(category, text);
  });
}

/**
 * Resolve the bug class from matched signals, biased toward what the active
 * scenario is expected to produce. Falls back to the scenario's primary expected
 * bug, then to the raw fault-type default — so a caught fault is ALWAYS classified.
 */
function resolveBugClass(
  input: FaultInput,
  categories: SignalCategory[],
  expectedBugs: BugClass[],
): BugClass {
  const expected = new Set(expectedBugs);

  // 1. A matched signal whose candidate the scenario expects — strongest evidence.
  for (const category of categories) {
    for (const candidate of SIGNAL_TO_BUGCLASS[category]) {
      if (expected.has(candidate)) return candidate;
    }
  }
  // 2. Any matched signal's primary candidate (signal present, scenario-agnostic).
  if (categories.length > 0) {
    return SIGNAL_TO_BUGCLASS[categories[0]][0];
  }
  // 3. No signal matched: the scenario's primary expected bug, if any.
  if (expectedBugs.length > 0) return expectedBugs[0];
  // 4. Last resort: the raw fault-type default.
  return FAULT_TYPE_DEFAULT[input.faultType];
}

/**
 * Classify a caught fault into a fully-attributed finding. Deterministic: the same
 * input always yields the same classification.
 */
export function classifyFault(input: FaultInput): FaultClassification {
  const scenarioKey =
    input.scenario && SCENARIO_CATALOG[input.scenario] ? input.scenario : EXPLORATORY_SCENARIO;
  const scenarioDef = SCENARIO_CATALOG[scenarioKey];

  const categories = matchedCategories(input);
  const bugClass = resolveBugClass(input, categories, scenarioDef.expectedBugs);
  const definition = BUG_CATALOG[bugClass];

  // Severity: catalog default, escalated to at least HIGH on a 5xx response.
  let severity: Severity = definition.defaultSeverity;
  if (input.statusCode !== undefined && input.statusCode >= 500 && SEVERITY_RANK[severity] < SEVERITY_RANK.HIGH) {
    severity = 'HIGH';
  }

  const attribution = resolveScenarioAttribution(scenarioKey);

  return {
    bugClass,
    severity,
    cwe: definition.cwe,
    title: definition.title,
    advice: definition.remediation,
    scenario: attribution.scenario,
    testingType: attribution.testingType,
    stepIndex: input.stepIndex,
  };
}
