// ═══════════════════════════════════════════════════════════════
// shared/types/testingType.ts - TESTING-TYPE SELECTOR & RUN-LAUNCH CONFIG
// ═══════════════════════════════════════════════════════════════
// Operator-gated scenario matrix (single source of truth shared between the
// frontend checklist and the backend execution gating) plus the optimization
// settings appended to a run-start request.

// ─────────────────────────────────────────────────────────────
// 🚀 OPTIMIZATION SETTINGS (Shared between backend and frontend)
// ─────────────────────────────────────────────────────────────

export interface OptimizationSettings {
  'adaptive-risk-scorer': boolean;
  'state-aware-hashing': boolean;
  'concurrent-spam-event': boolean;
  // Phase 3: Bounded Compute Integration
  'execution-timebox-ms'?: number;  // Time-based limit in milliseconds (default: 600000 = 10 minutes)
}

export const defaultOptimizationSettings: OptimizationSettings = {
  'adaptive-risk-scorer': true,
  'state-aware-hashing': true,
  'concurrent-spam-event': true,
  'execution-timebox-ms': 600000,  // 10 minutes default
};

// ─────────────────────────────────────────────────────────────
// 🎛️ TESTING TYPE SELECTOR (Operator-gated scenario matrix)
// ─────────────────────────────────────────────────────────────
// Single source of truth shared between the frontend checklist and the
// backend execution gating, so the two can never drift. Each strategy
// category maps to one or more backend stress-scenario `name`s.

/** Strategy categories an operator can toggle before launching a run. */
export type TestingTypeId =
  | 'exploratory'
  | 'formBypass'
  | 'dataFuzzing'
  | 'concurrency'
  | 'navigation';

export interface TestingTypeOption {
  /** Stable identifier transmitted in the run payload. */
  id: TestingTypeId;
  /** Operator-facing label rendered in the dashboard checklist. */
  label: string;
  /** Short description of what the category does. */
  description: string;
  /** Backend stress-scenario `name`s this category gates. */
  scenarios: string[];
}

/**
 * Canonical catalog of selectable testing strategies. The `scenarios` arrays
 * use the exact `name` field of each backend StressScenario so the gate can
 * resolve a scenario back to its owning category.
 */
export const TESTING_TYPE_CATALOG: TestingTypeOption[] = [
  {
    id: 'exploratory',
    label: 'Client-Side Exploratory Testing',
    description: 'DOM-aware targeting & scorer-driven normal interaction (payload injection + ordinary clicks).',
    scenarios: [],
  },
  {
    id: 'formBypass',
    label: 'Constraint Stripping & Form Bypass',
    description: 'Strips client-side validation/hardening to force interactions (FormBypasser).',
    scenarios: ['FormBypasser'],
  },
  {
    id: 'dataFuzzing',
    label: 'Context-Aware Data Fuzzing',
    description: 'Classifies inputs and injects boundary/malformed payloads (DataFuzzer).',
    scenarios: ['DataFuzzer'],
  },
  {
    id: 'concurrency',
    label: 'Overlapping Concurrency Stress',
    description: 'Rapid concurrent clicks & coordinate bombing to trigger race conditions.',
    scenarios: ['ButtonSpammer', 'CoordinateBombing'],
  },
  {
    id: 'navigation',
    label: 'Navigational Path Infiltration & Traversal',
    description: 'History trashing, URL mutation, and network sabotage (RouteTrasher, NetworkSaboteur).',
    scenarios: ['RouteTrasher', 'NetworkSaboteur'],
  },
];

/** All testing-type ids — the default selection (everything enabled). */
export const ALL_TESTING_TYPE_IDS: TestingTypeId[] = TESTING_TYPE_CATALOG.map((option) => option.id);

/**
 * Optional run-configuration payload appended to the exploration start request.
 * When `selectedScenarios` is omitted or empty the engine treats all categories
 * as enabled (backward compatible).
 */
export interface ExplorationRunConfig {
  selectedScenarios?: TestingTypeId[];
}
