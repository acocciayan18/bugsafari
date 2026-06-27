import { ReproductionPlaybookStore } from './reproductionPlaybookStore.js';

/**
 * An active scenario recording window. Holds the deliberate, payload-specific
 * steps a single stress scenario performs while it is executing.
 */
interface ScenarioWindow {
  scenario: string;
  targetUrl: string;
  steps: string[];
  openedAt: number;
}

/**
 * Scenario-Driven Intent Registry.
 *
 * When a stress scenario begins, it opens an active logging window and records
 * its deliberate browser manipulations (constraint stripping, payload injection,
 * concurrent clicks, navigation trashing, …) as human-readable steps.
 *
 * When any global monitor (exception, console, network, 500, freeze, lockup)
 * catches a fault it calls {@link flushPlaybook} to obtain the exact chronological
 * step progression created by the active scenario. If no scenario is executing
 * (idle phase), it falls back to a clean extraction of the rolling action log so
 * that no defect ever registers without sequentially numbered steps.
 */
export class ActiveScenarioTracker {
  private static active: ScenarioWindow | null = null;
  /** Retained briefly so a fault firing just AFTER a scenario closes still flushes its intent. */
  private static lastClosed: ScenarioWindow | null = null;

  /** Open an active recording window for a scenario. */
  public static begin(scenario: string, targetUrl: string): void {
    const steps: string[] = [];
    // Seed the navigation step when the rolling log has nothing yet, so the
    // playbook always opens with context even on the very first scenario.
    if (ReproductionPlaybookStore.snapshot().length === 0 && targetUrl) {
      steps.push(`Navigate to target interface view: ${targetUrl}`);
    }
    ActiveScenarioTracker.active = {
      scenario,
      targetUrl,
      steps,
      openedAt: Date.now(),
    };
  }

  /** Append a deliberate, human-readable step to the active window (no-op if none open). */
  public static record(description: string): void {
    if (!ActiveScenarioTracker.active || !description) {
      return;
    }
    ActiveScenarioTracker.active.steps.push(description);
  }

  /** Close the active window, retaining it as the most-recently-closed window. */
  public static end(): void {
    if (ActiveScenarioTracker.active) {
      ActiveScenarioTracker.lastClosed = ActiveScenarioTracker.active;
      ActiveScenarioTracker.active = null;
    }
  }

  public static isActive(): boolean {
    return ActiveScenarioTracker.active !== null;
  }

  public static reset(): void {
    ActiveScenarioTracker.active = null;
    ActiveScenarioTracker.lastClosed = null;
  }

  /**
   * The global flush rule. Prefer the active scenario's exact steps, then the
   * most-recently-closed scenario, then the rolling action log, and finally a
   * safe placeholder — guaranteeing the returned array is never empty.
   */
  public static flushPlaybook(): string[] {
    const window = ActiveScenarioTracker.active?.steps.length
      ? ActiveScenarioTracker.active
      : ActiveScenarioTracker.lastClosed?.steps.length
        ? ActiveScenarioTracker.lastClosed
        : null;

    if (window) {
      return window.steps.map((description, index) => `Step ${index + 1}. ${description}`);
    }

    const rolling = ReproductionPlaybookStore.getNarrativeSteps();
    if (rolling.length > 0) {
      return rolling;
    }

    return ['Step 1. No deterministic actions were recorded before this fault.'];
  }
}
