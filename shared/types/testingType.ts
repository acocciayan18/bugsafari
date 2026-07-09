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
  // Strict Page Boundary Lock: confine exploration to the exact launch URL
  // (path + query + hash). Any action that drifts the page off it is reverted.
  strictUrlLock?: boolean;
}

export const defaultOptimizationSettings: OptimizationSettings = {
  'adaptive-risk-scorer': true,
  'state-aware-hashing': true,
  'concurrent-spam-event': true,
  'execution-timebox-ms': 600000,  // 10 minutes default
  strictUrlLock: false,  // Off by default — opt-in per run
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
  | 'navigation'
  | 'asyncRace';

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
  {
    id: 'asyncRace',
    label: 'Async Lifecycle & Race Probing',
    description: 'Interrupts in-flight async work to surface teardown races, swallowed promise rejections, and state desync (AsyncStateRacer).',
    scenarios: ['AsyncStateRacer'],
  },
];

/** All testing-type ids — the default selection (everything enabled). */
export const ALL_TESTING_TYPE_IDS: TestingTypeId[] = TESTING_TYPE_CATALOG.map((option) => option.id);

// ─────────────────────────────────────────────────────────────
// 🛰️ UNIFIED INFILTRATION PROFILES (operator-facing preset layer)
// ─────────────────────────────────────────────────────────────
// A profile is a named preset over the testing-type matrix above. The operator
// picks ONE profile instead of hand-toggling categories; the backend resolves it
// back into the same `TestingTypeId[]` the ScenarioGate already consumes, so the
// execution primitive is unchanged. NetworkSaboteur runs as an always-on
// background monitor independent of any profile and is not listed here.

/** The unified execution profiles an operator can launch. */
export type InfiltrationProfileId =
  | 'CHAOS_INFILTRATION'
  | 'DEEP_SEMANTIC_DATA_ATTACK'
  | 'HIGH_FREQUENCY_CONCURRENCY_STRAIN'
  | 'ASYNC_LIFECYCLE_ASSAULT'
  | 'CUSTOM_STRATEGY_PROFILE';

export interface InfiltrationProfileOption {
  /** Stable identifier transmitted in the run payload. */
  id: InfiltrationProfileId;
  /** Operator-facing label rendered in the dashboard. */
  label: string;
  /** Short description of the profile's focus. */
  description: string;
  /** Testing-type categories this profile activates (ignored for custom). */
  testingTypes: TestingTypeId[];
  /** When true the profile defers to operator-selected individual scenarios. */
  custom?: boolean;
}

/**
 * Canonical catalog of infiltration profiles. `testingTypes` reuses the exact
 * `TestingTypeId`s of TESTING_TYPE_CATALOG so a profile resolves straight into
 * the existing gate. NetworkSaboteur is intentionally absent — it is always-on.
 */
export const INFILTRATION_PROFILE_CATALOG: InfiltrationProfileOption[] = [
  {
    id: 'CHAOS_INFILTRATION',
    label: 'Chaos Infiltration',
    description: 'Full-spectrum assault — every testing scenario enabled simultaneously.',
    testingTypes: [...ALL_TESTING_TYPE_IDS],
  },
  {
    id: 'DEEP_SEMANTIC_DATA_ATTACK',
    label: 'Deep Semantic Data Attack',
    description: 'Data-focused — context-aware fuzzing and constraint/form bypass only.',
    testingTypes: ['dataFuzzing', 'formBypass'],
  },
  {
    id: 'HIGH_FREQUENCY_CONCURRENCY_STRAIN',
    label: 'High-Frequency Concurrency Strain',
    description: 'Concurrency-focused — rapid concurrent clicking and route/history thrashing.',
    testingTypes: ['concurrency', 'navigation'],
  },
  {
    id: 'ASYNC_LIFECYCLE_ASSAULT',
    label: 'Async Lifecycle Assault',
    description: 'Async-focused — interrupts in-flight requests/transitions to expose race conditions, teardown crashes, swallowed rejections, and state desync.',
    testingTypes: ['asyncRace'],
  },
  {
    id: 'CUSTOM_STRATEGY_PROFILE',
    label: 'Custom Strategy Profile',
    description: 'Manually select individual testing scenarios to run.',
    testingTypes: [],
    custom: true,
  },
];

/** Default profile when none is supplied — full-spectrum, matches legacy all-on. */
export const DEFAULT_INFILTRATION_PROFILE: InfiltrationProfileId = 'CHAOS_INFILTRATION';

/**
 * Structured run-configuration payload sent with an exploration start request.
 * The operator picks a `profile`; `customScenarios` is only meaningful for the
 * CUSTOM_STRATEGY_PROFILE and is ignored otherwise.
 */
export interface ExplorationRunConfig {
  profile: InfiltrationProfileId;
  customScenarios?: TestingTypeId[];
}

/**
 * Resolve an infiltration config into the concrete `TestingTypeId[]` the engine
 * gate consumes. Unknown/undefined config or an empty custom selection falls back
 * to the all-enabled default (backward compatible with the previous behavior).
 */
export function resolveInfiltrationProfile(config?: ExplorationRunConfig): TestingTypeId[] {
  if (!config) return [...ALL_TESTING_TYPE_IDS];
  const option = INFILTRATION_PROFILE_CATALOG.find((profile) => profile.id === config.profile);
  if (!option) return [...ALL_TESTING_TYPE_IDS];

  if (option.custom) {
    const allowed = new Set<string>(ALL_TESTING_TYPE_IDS);
    const custom = (config.customScenarios ?? []).filter(
      (value): value is TestingTypeId => typeof value === 'string' && allowed.has(value),
    );
    return custom.length > 0 ? custom : [...ALL_TESTING_TYPE_IDS];
  }

  return [...option.testingTypes];
}
