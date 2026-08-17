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
  // Sub-Tree / Prefix Lock: confine exploration to the launch route and its
  // descendant paths only — blocks parent, sibling, and off-site navigation.
  subtreeLock?: boolean;
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
  subtreeLock: false,  // Off by default — whole-site scope; opt-in to confine to the launch route sub-tree
  'transition-repeat-budget': 3,  // Allow a few repeats, then block the loop source
  'page-saturation-visits': 8,  // gain-less revisits to a shell → fully explored
  'page-saturation-interactions': 25,  // repeat actuations on a shell → fully explored
  'form-fuzz-cap': 2,  // 2 fuzz submissions per form → excluded from further fuzzing
  'dialog-read-only': false,  // Answer dialogs so confirm-gated branches actually run
};

// Operator-facing single boundary choice. Maps to the two engine flags below:
//  • 'exact'   — pin to the launch URL (strictUrlLock).
//  • 'subtree' — pin to the launch route + descendants (subtreeLock).
//  • 'site'    — whole target host + subdomains + auth origins (neither flag). Default.
export type BoundaryLockMode = 'exact' | 'subtree' | 'site';

export const DEFAULT_BOUNDARY_LOCK_MODE: BoundaryLockMode = 'site';

// Resolve the UI mode into the two persisted engine flags (single source of truth).
export function boundaryModeToFlags(
  mode: BoundaryLockMode,
): Pick<OptimizationSettings, 'strictUrlLock' | 'subtreeLock'> {
  return { strictUrlLock: mode === 'exact', subtreeLock: mode === 'subtree' };
}

// Inverse of boundaryModeToFlags. Precedence exact > subtree > site.
export function boundaryModeFromFlags(settings?: Partial<OptimizationSettings>): BoundaryLockMode {
  if (settings?.strictUrlLock) return 'exact';
  if (settings?.subtreeLock) return 'subtree';
  return 'site';
}

// ─────────────────────────────────────────────────────────────
//  EXECUTION TIME-LIMIT (operator-selectable timebox presets)
// ─────────────────────────────────────────────────────────────
// A run holds a scarce fleet slot for its whole active duration, so the operator
// picks ONE bounded preset instead of a free-form value. Each maps to an
// `execution-timebox-ms`; the backend clamp (below) is the final authority.

// Hard server-side bounds on the timebox (SEC-09.3): a free-form client value is a
// DoS knob. Shared so the API clamp, the worker lock, and tests use one definition.
export const MIN_TIMEBOX_MS = 10_000;
export const MAX_TIMEBOX_MS = 1_800_000; // 30 minutes

export type TestDurationId = '5m' | '10m' | '20m' | '30m';

export interface TestDurationOption {
  id: TestDurationId;
  label: string;
  sublabel: string;
  minutes: number;
}

// Canonical preset catalog shared between the frontend selector and the mapping
// helpers. Every entry's ms must sit within [MIN_TIMEBOX_MS, MAX_TIMEBOX_MS].
export const TEST_DURATION_PRESETS: TestDurationOption[] = [
  { id: '5m', label: '5 min', sublabel: 'Quick smoke', minutes: 5 },
  { id: '10m', label: '10 min', sublabel: 'Standard', minutes: 10 },
  { id: '20m', label: '20 min', sublabel: 'Deep', minutes: 20 },
  { id: '30m', label: '30 min', sublabel: 'Thorough (max)', minutes: 30 },
];

export const DEFAULT_TEST_DURATION_ID: TestDurationId = '10m';

// Resolve a preset id into the timebox flag the engine/store consume.
export function durationIdToFlags(
  id: TestDurationId,
): Pick<OptimizationSettings, 'execution-timebox-ms'> {
  const preset = TEST_DURATION_PRESETS.find((option) => option.id === id)
    ?? TEST_DURATION_PRESETS.find((option) => option.id === DEFAULT_TEST_DURATION_ID)!;
  return { 'execution-timebox-ms': preset.minutes * 60_000 };
}

// Inverse: map a settings timebox back to the nearest preset id (for hydration and
// the pre-launch config summary). Falls back to the default when absent.
export function durationIdFromFlags(settings?: Partial<OptimizationSettings>): TestDurationId {
  const ms = settings?.['execution-timebox-ms'];
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return DEFAULT_TEST_DURATION_ID;
  let nearest = TEST_DURATION_PRESETS[0];
  for (const option of TEST_DURATION_PRESETS) {
    if (Math.abs(option.minutes * 60_000 - ms) < Math.abs(nearest.minutes * 60_000 - ms)) {
      nearest = option;
    }
  }
  return nearest.id;
}

// Clamp/strip the client-supplied execution timebox in place so the queue path, the
// synchronous path, and the worker all inherit the enforced ceiling. Backend authority.
export function clampTimebox(settings: OptimizationSettings | undefined): void {
  if (!settings) return;
  const raw: unknown = settings['execution-timebox-ms'];
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isFinite(n)) {
    settings['execution-timebox-ms'] = Math.min(MAX_TIMEBOX_MS, Math.max(MIN_TIMEBOX_MS, n));
  } else if (raw !== undefined) {
    delete settings['execution-timebox-ms'];
  }
}

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
    description: 'Launches every testing scenario simultaneously to maximize coverage and expose complex interactions across the application.',
    testingTypes: [...ALL_TESTING_TYPE_IDS],
  },
  {
    id: 'DEEP_SEMANTIC_DATA_ATTACK',
    label: 'Deep Semantic Data Attack',
    description: 'Focuses on intelligent data fuzzing and form constraint bypass using context-aware payloads that escalate through five levels of complexity.',
    testingTypes: ['dataFuzzing', 'formBypass'],
  },
  {
    id: 'HIGH_FREQUENCY_CONCURRENCY_STRAIN',
    label: 'High-Frequency Concurrency Strain',
    description: 'Stresses the application with rapid concurrent interactions and network disruption to uncover race conditions, duplicate submissions, and synchronization issues.',
    testingTypes: ['concurrency', 'navigation'],
  },
  {
    id: 'ASYNC_LIFECYCLE_ASSAULT',
    label: 'Async Lifecycle Assault',
    description: 'Targets asynchronous operations by interrupting requests and page transitions to reveal race conditions, state inconsistencies, and unhandled failures.',
    testingTypes: ['asyncRace'],
  },
  {
    id: 'AUTH_STATE_SUBVERSION',
    label: 'Auth-State Subversion',
    description: 'Evaluates broken access control by modifying client-side authentication state and verifying whether privileged functionality becomes accessible without server-side authorization.',
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
