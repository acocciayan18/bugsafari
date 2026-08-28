// shared/bugCategory.ts - CENTRAL BUG CATEGORY POLICY
// Single source of truth for the broad, student-friendly bug FAMILY a finding
// belongs to (Security, Access Control, Stability, Navigation & State). Used by
// both packages so Findings and Forensic History group and label findings the
// same way. Pure and deterministic; string-keyed by bugClass to stay decoupled
// from the engine's BugClass type (a drift test guards the mapping).

// Broad families grouping the knowledge-base bug classes for display.
export type BugCategory = 'SECURITY' | 'ACCESS_CONTROL' | 'STABILITY' | 'NAVIGATION_STATE';

// Fixed display order, most safety-critical family first.
export const BUG_CATEGORY_ORDER: readonly BugCategory[] = [
  'SECURITY',
  'ACCESS_CONTROL',
  'STABILITY',
  'NAVIGATION_STATE',
];

export interface BugCategoryMeta {
  // Short operator-facing label rendered on chips and section headers.
  label: string;
  // Plain-English, student-friendly explanation of the family (tooltip copy).
  blurb: string;
}

export const BUG_CATEGORY_META: Record<BugCategory, BugCategoryMeta> = {
  SECURITY: {
    label: 'Security & Data',
    blurb: 'The app let dangerous input through or leaked private data, so an attacker could read or change things they should not.',
  },
  ACCESS_CONTROL: {
    label: 'Access Control',
    blurb: 'The app trusted the browser to enforce a rule or a login, so someone can get in or do something the server should have blocked.',
  },
  STABILITY: {
    label: 'Stability & Crashes',
    blurb: 'The app crashed, froze, or got stuck when something went wrong instead of failing gracefully.',
  },
  NAVIGATION_STATE: {
    label: 'Navigation & State',
    blurb: 'Moving around the app or firing actions quickly left it on a broken page or in a corrupted state.',
  },
};

// Fallback when a finding carries no bug class or an unmapped one (e.g. a raw
// runtime incident) — never undefined.
export const DEFAULT_CATEGORY: BugCategory = 'STABILITY';

// Bug-class → family. Mirrors testing-core BUG_CATALOG keys; string-keyed to stay
// decoupled from the engine's BugClass type. A drift test guards the two.
export const CATEGORY_BY_BUGCLASS: Record<string, BugCategory> = {
  INPUT_SANITIZATION_FAILURE: 'SECURITY',
  NOSQL_INJECTION: 'SECURITY',
  SQL_INJECTION: 'SECURITY',
  FUZZ_VULNERABILITY_LEAK: 'SECURITY',
  SECURITY_VULNERABILITY_LEAK: 'SECURITY',
  CLIENT_SIDE_CONSTRAINT_BYPASS: 'ACCESS_CONTROL',
  CLIENT_TRUST_BOUNDARY_VIOLATION: 'ACCESS_CONTROL',
  SESSION_SYNC_FAULT: 'ACCESS_CONTROL',
  RUNTIME_STABILITY_EXCEPTION: 'STABILITY',
  API_CONTRACT_VIOLATION: 'STABILITY',
  SERVER_API_FAILURE: 'STABILITY',
  BOUNDARY_STRESS_FAILURE: 'STABILITY',
  UNHANDLED_CLIENT_ERROR: 'STABILITY',
  CLIENT_RENDER_FREEZE: 'STABILITY',
  SPA_STATE_RACE_CONDITION: 'NAVIGATION_STATE',
  STRUCTURAL_NAVIGATION_LOGIC: 'NAVIGATION_STATE',
  CASCADING_STATE_FAILURE: 'NAVIGATION_STATE',
  ROUTE_MUTATION_FAILURE: 'NAVIGATION_STATE',
};

// Resolve any bug class to its display family, falling back to DEFAULT_CATEGORY.
export function resolveCategory(bugClass?: string | null): BugCategory {
  const key = (bugClass ?? '').trim();
  return (key && CATEGORY_BY_BUGCLASS[key]) || DEFAULT_CATEGORY;
}
