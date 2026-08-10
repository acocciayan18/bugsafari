// Ground-truth manifest for the seeded-bug fixture. Each defect maps a control the
// engine can reach to the BugClass the LIVE detection path should classify it as.
// The E2E scorer diffs the engine's actual findings against this.

export interface SeededDefect {
  /** Element id of the control that triggers the defect. */
  id: string;
  label: string;
  /** BugClass the live pipeline should attribute to this defect. */
  expectedBugClass: string;
}

export const SEEDED_DEFECTS: readonly SeededDefect[] = [
  { id: 'delete-account', label: 'Delete account → uncaught TypeError', expectedBugClass: 'RUNTIME_STABILITY_EXCEPTION' },
  { id: 'load-report', label: 'Load report → console error', expectedBugClass: 'RUNTIME_STABILITY_EXCEPTION' },
  { id: 'pay-now', label: 'Pay now → HTTP 500', expectedBugClass: 'SERVER_API_FAILURE' },
  { id: 'login-btn', label: 'Login → NoSQL error body', expectedBugClass: 'NOSQL_INJECTION' },
  { id: 'login-btn', label: 'Login → unguarded double-submit (no disable-on-submit)', expectedBugClass: 'SPA_STATE_RACE_CONDITION' },
  { id: 'search', label: 'Search → reflected XSS (innerHTML)', expectedBugClass: 'FUZZ_VULNERABILITY_LEAK' },
];

/** Controls that must NEVER produce a finding (precision anchors). */
export const BENIGN_SELECTORS: readonly string[] = ['about', 'toggle-theme', 'safe-search'];

/** Distinct BugClasses that should be surfaced by a full run. */
export const SEEDED_CLASSES: readonly string[] = [...new Set(SEEDED_DEFECTS.map((d) => d.expectedBugClass))];
