import type { Page } from 'playwright';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';

/**
 * Common interface for stress testing scenarios.
 * Each scenario implements this interface to provide a consistent
 * contract for the AutonomousExplorationEngine to execute.
 */
export interface StressScenario {
  /** Human-readable name for the scenario */
  name: string;

  /**
   * Execute the stress scenario against the given page.
   * @param page Playwright Page object to operate on
   * @param target Optional target element to stress test
   * @returns Promise that resolves when scenario completes
   */
  execute(page: Page, target?: InteractiveElement): Promise<void>;
}
