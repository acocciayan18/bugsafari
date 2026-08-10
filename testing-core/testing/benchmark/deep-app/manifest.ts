// Ground-truth manifest for the deep fixture. Each defect maps a control to the
// BugClass the live pipeline should attribute to it. Beyond class detection, this
// fixture probes DEPTH — each defect carries the exploration capability it exercises,
// so a miss says WHICH depth dimension the engine failed (gate, wizard, dynamic, async).

export interface SeededDefect {
  id: string;
  label: string;
  expectedBugClass: string;
  /** Exploration capability this defect exercises — for reach-vs-detect diagnosis. */
  depth: 'flat' | 'multi-step' | 'dynamic' | 'async-lag';
}

export const SEEDED_DEFECTS: readonly SeededDefect[] = [
  { id: 'login-btn', label: 'Login → NoSQL error body', expectedBugClass: 'NOSQL_INJECTION', depth: 'flat' },
  { id: 'login-btn', label: 'Login → unguarded double-submit', expectedBugClass: 'SPA_STATE_RACE_CONDITION', depth: 'flat' },
  { id: 'search', label: 'Search → reflected XSS (innerHTML)', expectedBugClass: 'FUZZ_VULNERABILITY_LEAK', depth: 'flat' },
  { id: 'pay-now', label: 'Pay now → HTTP 500', expectedBugClass: 'SERVER_API_FAILURE', depth: 'flat' },
  { id: 'submit-order', label: 'Submit order → HTTP 500 (checkout step 3)', expectedBugClass: 'SERVER_API_FAILURE', depth: 'multi-step' },
  { id: 'delete-profile', label: 'Delete profile → uncaught TypeError (async-rendered)', expectedBugClass: 'RUNTIME_STABILITY_EXCEPTION', depth: 'dynamic' },
  { id: 'slow-pay', label: 'Slow pay → HTTP 500 settling ~1.5s later', expectedBugClass: 'SERVER_API_FAILURE', depth: 'async-lag' },
];

/** Controls that must NEVER produce a finding (precision anchors). */
export const BENIGN_SELECTORS: readonly string[] = ['about', 'toggle-theme', 'safe-search'];

/** Distinct BugClasses that should be surfaced by a full run. */
export const SEEDED_CLASSES: readonly string[] = [...new Set(SEEDED_DEFECTS.map((d) => d.expectedBugClass))];
