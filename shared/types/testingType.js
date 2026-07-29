// ═══════════════════════════════════════════════════════════════
// shared/types/testingType.ts - TESTING-TYPE SELECTOR & RUN-LAUNCH CONFIG
// ═══════════════════════════════════════════════════════════════
// Operator-gated scenario matrix (single source of truth shared between the
// frontend checklist and the backend execution gating) plus the optimization
// settings appended to a run-start request.
export const defaultOptimizationSettings = {
    'adaptive-risk-scorer': true,
    'state-aware-hashing': true,
    'concurrent-spam-event': true,
    'execution-timebox-ms': 600000, // 10 minutes default
    strictUrlLock: false, // Off by default — opt-in per run
    'transition-repeat-budget': 3, // Allow a few repeats, then block the loop source
    'page-saturation-visits': 8, // gain-less revisits to a shell → fully explored
    'page-saturation-interactions': 25, // repeat actuations on a shell → fully explored
    'form-fuzz-cap': 2, // 2 fuzz submissions per form → excluded from further fuzzing
    'dialog-read-only': false, // Answer dialogs so confirm-gated branches actually run
};
/**
 * Canonical catalog of selectable testing strategies. The `scenarios` arrays
 * use the exact `name` field of each backend StressScenario so the gate can
 * resolve a scenario back to its owning category.
 */
export const TESTING_TYPE_CATALOG = [
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
export const ALL_TESTING_TYPE_IDS = TESTING_TYPE_CATALOG.map((option) => option.id);
/**
 * Canonical catalog of infiltration profiles. `testingTypes` reuses the exact
 * `TestingTypeId`s of TESTING_TYPE_CATALOG so a profile resolves straight into
 * the existing gate. NetworkSaboteur rides the 'navigation' testing type.
 */
export const INFILTRATION_PROFILE_CATALOG = [
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
export const DEFAULT_INFILTRATION_PROFILE = 'CHAOS_INFILTRATION';
/**
 * Resolve an infiltration config into the concrete `TestingTypeId[]` the engine
 * gate consumes. Unknown/undefined config falls back to the all-enabled default
 * (backward compatible with the previous behavior).
 */
export function resolveInfiltrationProfile(config) {
    if (!config)
        return [...ALL_TESTING_TYPE_IDS];
    const option = INFILTRATION_PROFILE_CATALOG.find((profile) => profile.id === config.profile);
    if (!option)
        return [...ALL_TESTING_TYPE_IDS];
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
export function resolveProfileFromTestingTypes(types) {
    const key = [...types].sort().join('|');
    const matches = INFILTRATION_PROFILE_CATALOG.filter((option) => [...option.testingTypes].sort().join('|') === key);
    return matches.length === 1 ? matches[0].id : undefined;
}
