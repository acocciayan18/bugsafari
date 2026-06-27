import {
  TESTING_TYPE_CATALOG,
  ALL_TESTING_TYPE_IDS,
  type TestingTypeId,
} from '../../../../shared/types.js';

/**
 * ScenarioGate — resolves the operator's Testing Type Selector choices into
 * fast runtime lookups the exploration engine consults before injecting any
 * stress/fuzz/bypass behavior.
 *
 * Gating lives purely at the action-execution layer; the ML Scorer/perceptron
 * ("vision") is never consulted here, so online weights are unaffected by which
 * categories are enabled.
 *
 * An empty or undefined selection enables every category (backward compatible
 * with the previous always-on behavior).
 */
export class ScenarioGate {
  private readonly enabled: Set<TestingTypeId>;
  /** Reverse map: backend scenario `name` → owning category id. */
  private readonly scenarioToCategory: Map<string, TestingTypeId>;

  constructor(selected?: TestingTypeId[]) {
    const effective =
      selected && selected.length > 0 ? selected : ALL_TESTING_TYPE_IDS;
    this.enabled = new Set<TestingTypeId>(effective);

    this.scenarioToCategory = new Map<string, TestingTypeId>();
    for (const option of TESTING_TYPE_CATALOG) {
      for (const scenarioName of option.scenarios) {
        this.scenarioToCategory.set(scenarioName, option.id);
      }
    }
  }

  /** Whether a strategy category is active for this run. */
  public isEnabled(id: TestingTypeId): boolean {
    return this.enabled.has(id);
  }

  /**
   * Whether a specific backend stress scenario (by its `name`) may run. Scenarios
   * not mapped to any category are treated as enabled so unknown/auxiliary
   * scenarios are never silently suppressed.
   */
  public isScenarioEnabled(scenarioName: string): boolean {
    const category = this.scenarioToCategory.get(scenarioName);
    if (!category) return true;
    return this.enabled.has(category);
  }

  /** The active category ids (for operator-facing telemetry/logging). */
  public activeCategories(): TestingTypeId[] {
    return ALL_TESTING_TYPE_IDS.filter((id) => this.enabled.has(id));
  }
}
