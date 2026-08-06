// ═══════════════════════════════════════════════════════════════
// knowledgeBase/scenarioCatalog.ts — SCENARIO → EXPECTED-BUG MAPPING
// ═══════════════════════════════════════════════════════════════
// Declares, for each testing scenario, which bug classes it is expected to
// surface and which runtime signal categories validate them. The classifier
// uses this to attribute a caught fault to the scenario that provoked it and to
// narrow the classification to what that scenario can actually produce.
//
// Keys are the exact `name` field of each backend StressScenario (so the
// mapping resolves the scenario the same way ScenarioGate does), plus a synthetic
// EXPLORATORY baseline for faults caught while no stress scenario is active.

import type { BugClass } from '../types.js';
import type { TestingTypeId } from '../../../../shared/types.js';
import type { SignalCategory } from './signalPatterns.js';

/**
 * Attribution bucket for a fault: a real operator-gated category, or the synthetic
 * 'exploratory' baseline for faults caught while no stress scenario was active.
 * 'exploratory' is NOT a TestingTypeId — it gates nothing and cannot be selected.
 */
export type AttributionTestingType = TestingTypeId | 'exploratory';

export interface ScenarioDefinition {
  /** Category that gates this scenario, or the exploratory attribution bucket. */
  testingType: AttributionTestingType;
  /** Bug classes this scenario is designed to provoke, in priority order. */
  expectedBugs: BugClass[];
  /** Runtime signal categories that confirm this scenario's expected bugs. */
  signalCategories: SignalCategory[];
  /** One-line description of the scenario's intent. */
  description: string;
}

/** Synthetic scenario id used when a fault fires outside any active stress scenario. */
export const EXPLORATORY_SCENARIO = 'Exploratory';

export const SCENARIO_CATALOG: Record<string, ScenarioDefinition> = {
  FormBypasser: {
    testingType: 'formBypass',
    expectedBugs: ['CLIENT_SIDE_CONSTRAINT_BYPASS', 'INPUT_SANITIZATION_FAILURE'],
    signalCategories: ['SERVER_ERROR', 'CLIENT_CRASH'],
    description: 'Removes the browser form rules to see whether the server still enforces them.',
  },
  DataFuzzer: {
    testingType: 'dataFuzzing',
    // SQL_INJECTION / NOSQL_INJECTION precede the generic FUZZ leak so a matched SQL/Mongo
    // error resolves to the precise datastore class (CWE-89 / CWE-943), not CWE-79.
    expectedBugs: ['SQL_INJECTION', 'NOSQL_INJECTION', 'FUZZ_VULNERABILITY_LEAK', 'INPUT_SANITIZATION_FAILURE'],
    signalCategories: ['XSS_REFLECTION', 'SQL_ERROR', 'NOSQL_ERROR', 'SERVER_ERROR', 'CLIENT_CRASH'],
    description: 'Types extreme, malformed, and injection values into input fields to see how they are handled.',
  },
  ButtonSpammer: {
    testingType: 'concurrency',
    expectedBugs: ['SPA_STATE_RACE_CONDITION', 'RUNTIME_STABILITY_EXCEPTION'],
    signalCategories: ['CLIENT_CRASH'],
    description: 'Clicks a control very fast with no wait to trigger timing bugs.',
  },
  CoordinateBombing: {
    testingType: 'concurrency',
    expectedBugs: ['SPA_STATE_RACE_CONDITION', 'RUNTIME_STABILITY_EXCEPTION'],
    signalCategories: ['CLIENT_CRASH'],
    description: 'Clicks across a grid of screen positions to catch overlays and hidden clickable edges.',
  },
  AsyncStateRacer: {
    testingType: 'asyncRace',
    expectedBugs: [
      'SPA_STATE_RACE_CONDITION',
      'CASCADING_STATE_FAILURE',
      'RUNTIME_STABILITY_EXCEPTION',
      'BOUNDARY_STRESS_FAILURE',
    ],
    signalCategories: ['CLIENT_CRASH', 'SERVER_ERROR'],
    description: 'Interrupts in-progress background requests to surface cleanup bugs, swallowed errors, and out-of-sync state.',
  },
  // Disabled engine-wide — retained so findings persisted by older runs still
  // resolve their attribution instead of falling back to EXPLORATORY.
  RouteTrasher: {
    testingType: 'navigation',
    expectedBugs: ['ROUTE_MUTATION_FAILURE', 'STRUCTURAL_NAVIGATION_LOGIC'],
    signalCategories: ['REDIRECT_LOOP', 'COMPONENT_FAIL', 'DEAD_END', 'QUERY_MUTATION'],
    description: 'Scrambles history and query values to try to break the routing logic.',
  },
  NetworkSaboteur: {
    testingType: 'navigation',
    expectedBugs: ['BOUNDARY_STRESS_FAILURE'],
    signalCategories: ['SERVER_ERROR', 'DEAD_END'],
    description: 'Delays, cancels, or corrupts the API call an interaction makes, to test how the app copes with network faults.',
  },
  StorageTamper: {
    testingType: 'authState',
    expectedBugs: ['CLIENT_TRUST_BOUNDARY_VIOLATION'],
    // No runtime signal category: this fault is self-asserted by the scenario's
    // own privileged-surface oracle (confirmed=true), not matched from page text.
    signalCategories: [],
    description: 'Fakes signed-in state in browser storage or the JWT to see if privileged screens unlock without a server check.',
  },
  [EXPLORATORY_SCENARIO]: {
    testingType: 'exploratory',
    expectedBugs: ['RUNTIME_STABILITY_EXCEPTION', 'STRUCTURAL_NAVIGATION_LOGIC', 'BOUNDARY_STRESS_FAILURE'],
    signalCategories: ['CLIENT_CRASH', 'DEAD_END', 'REDIRECT_LOOP', 'SERVER_ERROR'],
    description: 'Free exploration guided by the element scorer, with no stress scenario running.',
  },
};

/** Resolve a scenario `name` to its structured attribution, defaulting to EXPLORATORY. */
export function resolveScenarioAttribution(
  scenarioName?: string,
): { scenario: string; testingType: AttributionTestingType } {
  const key = scenarioName && SCENARIO_CATALOG[scenarioName] ? scenarioName : EXPLORATORY_SCENARIO;
  return { scenario: key, testingType: SCENARIO_CATALOG[key].testingType };
}
