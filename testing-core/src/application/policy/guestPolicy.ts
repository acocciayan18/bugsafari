import type { OptimizationSettings, TestingTypeId } from '../../../../shared/types.js';
import { defaultOptimizationSettings, GUEST_MAX_TIMEBOX_MS } from '../../../../shared/types.js';

export { GUEST_MAX_TIMEBOX_MS };

// Testing-type categories a guest may run. The heavy categories — 'concurrency'
// (ButtonSpammer/CoordinateBombing) and 'navigation' (NetworkSaboteur) — are the
// most resource- and disruption-intensive, so anonymous runs are denied them.
export const GUEST_ALLOWED_TESTING_TYPES: readonly TestingTypeId[] = [
  'dataFuzzing',
  'formBypass',
  'asyncRace',
  'authState',
];

// Scope/scenario caps forced onto every guest run, overriding client-supplied
// values so the guest envelope is authoritative regardless of payload.
const GUEST_SCOPE_OVERRIDES: Partial<OptimizationSettings> = {
  subtreeLock: true,            // confine to the launch route sub-tree
  'transition-repeat-budget': 2,
  'page-saturation-visits': 4,
  'page-saturation-interactions': 12,
  'form-fuzz-cap': 1,
  'dialog-read-only': true,     // never execute confirm-gated destructive branches
};

// Apply the full guest launch envelope in one place: concrete scope locks, a
// trimmed scenario set, and a settings object even when the client sent none.
export function applyGuestLaunchPolicy(
  settings: OptimizationSettings | undefined,
  selectedScenarios: TestingTypeId[],
): { settings: OptimizationSettings; selectedScenarios: TestingTypeId[] } {
  const effective: OptimizationSettings = { ...defaultOptimizationSettings, ...settings, ...GUEST_SCOPE_OVERRIDES };
  const allowed = new Set(GUEST_ALLOWED_TESTING_TYPES);
  const trimmed = selectedScenarios.filter((id) => allowed.has(id));
  return {
    settings: effective,
    selectedScenarios: trimmed.length ? trimmed : [...GUEST_ALLOWED_TESTING_TYPES],
  };
}
