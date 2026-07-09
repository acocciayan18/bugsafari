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

export interface ScenarioDefinition {
  /** Operator-selectable category that gates this scenario. */
  testingType: TestingTypeId;
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
    description: 'Strips client-side validation to expose missing server-side enforcement.',
  },
  DataFuzzer: {
    testingType: 'dataFuzzing',
    expectedBugs: ['FUZZ_VULNERABILITY_LEAK', 'NOSQL_INJECTION', 'INPUT_SANITIZATION_FAILURE'],
    signalCategories: ['XSS_REFLECTION', 'NOSQL_ERROR', 'SERVER_ERROR', 'CLIENT_CRASH'],
    description: 'Injects boundary/malformed/injection payloads into classified input fields.',
  },
  ButtonSpammer: {
    testingType: 'concurrency',
    expectedBugs: ['SPA_STATE_RACE_CONDITION', 'RUNTIME_STABILITY_EXCEPTION'],
    signalCategories: ['CLIENT_CRASH'],
    description: 'Fires concurrent zero-wait click bursts to trigger state races.',
  },
  CoordinateBombing: {
    testingType: 'concurrency',
    expectedBugs: ['SPA_STATE_RACE_CONDITION', 'RUNTIME_STABILITY_EXCEPTION'],
    signalCategories: ['CLIENT_CRASH'],
    description: 'Fires deterministic grid clicks to hit overlays/hidden hit-test edges.',
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
    description: 'Interrupts in-flight async operations to surface teardown races, swallowed rejections, and state desync.',
  },
  RouteTrasher: {
    testingType: 'navigation',
    expectedBugs: ['ROUTE_MUTATION_FAILURE', 'STRUCTURAL_NAVIGATION_LOGIC'],
    signalCategories: ['REDIRECT_LOOP', 'COMPONENT_FAIL', 'DEAD_END', 'QUERY_MUTATION'],
    description: 'Trashes history and mutates query params to break routing logic.',
  },
  NetworkSaboteur: {
    testingType: 'navigation',
    expectedBugs: ['BOUNDARY_STRESS_FAILURE'],
    signalCategories: ['SERVER_ERROR', 'DEAD_END'],
    description: 'Delays or aborts an API call to test network-fault resilience.',
  },
  [EXPLORATORY_SCENARIO]: {
    testingType: 'exploratory',
    expectedBugs: ['RUNTIME_STABILITY_EXCEPTION', 'STRUCTURAL_NAVIGATION_LOGIC', 'BOUNDARY_STRESS_FAILURE'],
    signalCategories: ['CLIENT_CRASH', 'DEAD_END', 'REDIRECT_LOOP', 'SERVER_ERROR'],
    description: 'DOM-aware scorer-driven interaction with no stress scenario active.',
  },
};

/** Resolve a scenario `name` to its structured attribution, defaulting to EXPLORATORY. */
export function resolveScenarioAttribution(
  scenarioName?: string,
): { scenario: string; testingType: TestingTypeId } {
  const key = scenarioName && SCENARIO_CATALOG[scenarioName] ? scenarioName : EXPLORATORY_SCENARIO;
  return { scenario: key, testingType: SCENARIO_CATALOG[key].testingType };
}
