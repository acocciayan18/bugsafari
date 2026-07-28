// ═══════════════════════════════════════════════════════════════
// shared/types/testingType.ts - TESTING-TYPE SELECTOR & RUN-LAUNCH CONFIG
// ═══════════════════════════════════════════════════════════════
// Operator-gated scenario matrix (single source of truth shared between the
// frontend checklist and the backend execution gating) plus the optimization
// settings appended to a run-start request.

// ─────────────────────────────────────────────────────────────
//  OPTIMIZATION SETTINGS (Shared between backend and frontend)
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
  // Session-wide transition-repeat budget: max times one control may re-navigate
  // its structural shell back to an already-seen view before it is blocked
  // session-wide as a navigation-loop source. 0 disables the cap (default: 3).
  'transition-repeat-budget'?: number;
  // Page-saturation caps (keyed by the normalized structural shell). A page is
  // marked Fully Explored — skipped before any re-parse/re-test and pruned from
  // the exploration frontier — once all its controls are triggered OR either cap
  // below is hit. Both count only REDUNDANT activity (a visit/actuation that
  // gained no new coverage); any coverage gain resets them, so a control-dense
  // page is never skipped early. 0 disables that cap.
  // Consecutive gain-less revisits to one structural shell before it saturates.
  'page-saturation-visits'?: number;
  // Repeat actuations (re-triggering an already-triggered control) on one shell
  // before it saturates — bounds input-fuzz / interactive churn on a spent page.
  'page-saturation-interactions'?: number;
  // Per-form fuzz cap: max fuzz submissions committed against one <form> before it
  // is excluded from further fuzzing and the engine advances to unexplored elements
  // (prevents input over-fuzzing on multi-field forms). 0 disables (default: 2).
  'form-fuzz-cap'?: number;
  // Reproducibility seed. When set, edge-selection softmax AND fuzz payload/vector
  // choice become deterministic (same seed + target → same action sequence) for
  // thesis-panel replays. Omitted (default) → Math.random, non-reproducible.
  'exploration-seed'?: number;
  // Read-only dialogs: cancel every native confirm/alert/prompt instead of
  // answering it. Default false — confirm-gated destructive branches (delete,
  // destroy, pay) are the highest-scored controls in the heuristic, and cancelling
  // them made that whole defect class unreachable while still counting the control
  // as covered. Enable when running against an environment where those branches
  // must not execute.
  'dialog-read-only'?: boolean;
}

export const defaultOptimizationSettings: OptimizationSettings = {
  'adaptive-risk-scorer': true,
  'state-aware-hashing': true,
  'concurrent-spam-event': true,
  'execution-timebox-ms': 600000,  // 10 minutes default
  strictUrlLock: false,  // Off by default — opt-in per run
  'transition-repeat-budget': 3,  // Allow a few repeats, then block the loop source
  'page-saturation-visits': 8,  // gain-less revisits to a shell → fully explored
  'page-saturation-interactions': 25,  // repeat actuations on a shell → fully explored
  'form-fuzz-cap': 2,  // 2 fuzz submissions per form → excluded from further fuzzing
  'dialog-read-only': false,  // Answer dialogs so confirm-gated branches actually run
};

// ─────────────────────────────────────────────────────────────
// ️ TESTING TYPE SELECTOR (Operator-gated scenario matrix)
// ─────────────────────────────────────────────────────────────
// Single source of truth shared between the frontend checklist and the
// backend execution gating, so the two can never drift. Each strategy
// category maps to one or more backend stress-scenario `name`s.

/**
 * Strategy categories an operator can toggle before launching a run.
 *
 * There is deliberately no 'exploratory' member: ordinary navigation and clicking
 * are unconditional (ActionExecutor always traverses the navigator-chosen edge),
 * so a category gating zero scenarios could never change a run's behavior. It
 * survives only as the default ATTRIBUTION bucket — see EXPLORATORY_SCENARIO.
 */
export type TestingTypeId =
  | 'formBypass'
  | 'dataFuzzing'
  | 'concurrency'
  | 'navigation'
  | 'asyncRace'
  | 'authState';

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
    id: 'formBypass',
    label: 'Constraint Stripping & Form Bypass',
    description: 'Strips client-side validation/hardening (FormBypasser), then confirms whether the server re-validates by submitting a value the browser would have rejected.',
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
    description: 'Zero-wait concurrent click bursts to trigger race conditions and double-submits, plus blind grid clicking to reach overlay and hit-test edges.',
    scenarios: ['ButtonSpammer', 'CoordinateBombing'],
  },
  {
    id: 'navigation',
    label: 'Navigational Path Infiltration & Traversal',
    description: 'Delays, aborts, or corrupts the API call an interaction triggers, to test network-fault resilience (NetworkSaboteur).',
    scenarios: ['NetworkSaboteur'],
  },
  {
    id: 'asyncRace',
    label: 'Async Lifecycle & Race Probing',
    description: 'Interrupts in-flight async work to surface teardown races, swallowed promise rejections, and state desync (AsyncStateRacer).',
    scenarios: ['AsyncStateRacer'],
  },
  {
    id: 'authState',
    label: 'Auth-State & Storage Tampering',
    description: 'Escalates client-trusted auth state (localStorage/sessionStorage/JWT claims) and checks whether privileged UI unlocks purely from tampered client state (StorageTamper).',
    scenarios: ['StorageTamper'],
  },
];

/** All testing-type ids — the default selection (everything enabled). */
export const ALL_TESTING_TYPE_IDS: TestingTypeId[] = TESTING_TYPE_CATALOG.map((option) => option.id);

// ─────────────────────────────────────────────────────────────
// ️ UNIFIED INFILTRATION PROFILES (operator-facing preset layer)
// ─────────────────────────────────────────────────────────────
// A profile is a named preset over the testing-type matrix above. The operator
// picks ONE profile instead of hand-toggling categories; the backend resolves it
// back into the same `TestingTypeId[]` the ScenarioGate already consumes, so the
// execution primitive is unchanged. NetworkSaboteur is gated by the 'navigation'
// testing type — it runs only under profiles that select navigation.

/** The unified execution profiles an operator can launch. */
export type InfiltrationProfileId =
  | 'CHAOS_INFILTRATION'
  | 'DEEP_SEMANTIC_DATA_ATTACK'
  | 'HIGH_FREQUENCY_CONCURRENCY_STRAIN'
  | 'ASYNC_LIFECYCLE_ASSAULT'
  | 'AUTH_STATE_SUBVERSION';

export interface InfiltrationProfileOption {
  /** Stable identifier transmitted in the run payload. */
  id: InfiltrationProfileId;
  /** Operator-facing label rendered in the dashboard. */
  label: string;
  /** Short description of the profile's focus. */
  description: string;
  /** Testing-type categories this profile activates. */
  testingTypes: TestingTypeId[];
}

/**
 * Canonical catalog of infiltration profiles. `testingTypes` reuses the exact
 * `TestingTypeId`s of TESTING_TYPE_CATALOG so a profile resolves straight into
 * the existing gate. NetworkSaboteur rides the 'navigation' testing type.
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
    description: 'Data-focused — context-aware fuzzing and constraint/form bypass only, escalating payloads across five levels from base cases to polyglot amplification.',
    testingTypes: ['dataFuzzing', 'formBypass'],
  },
  {
    id: 'HIGH_FREQUENCY_CONCURRENCY_STRAIN',
    label: 'High-Frequency Concurrency Strain',
    description: 'Concurrency-focused — zero-wait concurrent clicking paired with network sabotage, to surface double-submit and race defects.',
    testingTypes: ['concurrency', 'navigation'],
  },
  {
    id: 'ASYNC_LIFECYCLE_ASSAULT',
    label: 'Async Lifecycle Assault',
    description: 'Async-focused — interrupts in-flight requests/transitions to expose race conditions, teardown crashes, swallowed rejections, and state desync.',
    testingTypes: ['asyncRace'],
  },
  {
    id: 'AUTH_STATE_SUBVERSION',
    label: 'Auth-State Subversion',
    description: 'Broken-access-control focused — forges client-trusted auth state (localStorage/ sessionStorage/ JWT) once per route and checks whether privileged UI unlocks without server authorization.',
    testingTypes: ['authState'],
  },
];

/** Default profile when none is supplied — full-spectrum, matches legacy all-on. */
export const DEFAULT_INFILTRATION_PROFILE: InfiltrationProfileId = 'CHAOS_INFILTRATION';

/**
 * Structured run-configuration payload sent with an exploration start request.
 * BugSafari runs only the named automated profiles — the retired
 * CUSTOM_STRATEGY_PROFILE and its per-category selection are gone. A payload
 * still carrying the old id resolves through the unknown-profile branch below.
 */
export interface ExplorationRunConfig {
  profile: InfiltrationProfileId;
}

/**
 * Resolve an infiltration config into the concrete `TestingTypeId[]` the engine
 * gate consumes. Unknown/undefined config falls back to the all-enabled default
 * (backward compatible with the previous behavior).
 */
export function resolveInfiltrationProfile(config?: ExplorationRunConfig): TestingTypeId[] {
  if (!config) return [...ALL_TESTING_TYPE_IDS];
  const option = INFILTRATION_PROFILE_CATALOG.find((profile) => profile.id === config.profile);
  if (!option) return [...ALL_TESTING_TYPE_IDS];
  return [...option.testingTypes];
}

/**
 * Reverse-resolve the profile a run ACTUALLY executed from the testing types its
 * gate enforced. Recording this on the session (rather than echoing the requested
 * field) means history reports what ran: a legacy/unknown profile id that fell back
 * to all-on is reported as CHAOS_INFILTRATION, which is the truth.
 *
 * Every catalog profile has a distinct `testingTypes` set, so the match is exact.
 * Returns undefined only if a future profile duplicates another's set or the gate
 * was handed an ad-hoc selection.
 */
export function resolveProfileFromTestingTypes(
  types: readonly TestingTypeId[],
): InfiltrationProfileId | undefined {
  const key = [...types].sort().join('|');
  const matches = INFILTRATION_PROFILE_CATALOG.filter(
    (option) => [...option.testingTypes].sort().join('|') === key,
  );
  return matches.length === 1 ? matches[0].id : undefined;
}
