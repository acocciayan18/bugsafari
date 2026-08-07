import type { ActionRecord } from '../../../../shared/types.js';

import { narrateActionRecords } from '../../domain/services/forensics/narration.js';
import { minimizeActionRecords } from '../../domain/services/forensics/stepMinimizer.js';

// Depth of the causal chain kept for one run. Every save-path derivative of this
// buffer (session actionSteps, forensicTrace.finalBreadcrumbSteps) is bounded by
// it, so the SessionModel validators read this constant rather than restating a
// number — a stale restatement is what made the save fail validation in
// production while queue-mode local runs (empty store) never reached it.
export const ACTION_TRACE_CAPACITY = 60;

/**
 * Persistent per-Safari-run action history.
 *
 * Needed because some fatal crashes bypass normal exception catcher flushing.
 */
export class ReproductionPlaybookStore {
  private static actions: ActionRecord[] = [];
  // Deep enough to keep a long causal chain reachable by the minimizer (was 20).
  private static readonly capacity = ACTION_TRACE_CAPACITY;
  private static resetCounter = 0;

  public static reset(): void {
    ReproductionPlaybookStore.actions = [];
    ReproductionPlaybookStore.resetCounter += 1;
  }

  public static getResetCounter(): number {
    return ReproductionPlaybookStore.resetCounter;
  }

  // The buffer records EVERY action for the whole run — it must NOT stop at the first
  // fault. Each finding snapshots this rolling buffer at its own fault instant, and the
  // minimizer's fault-time cutoff (not a global freeze) drops post-fault noise per fault.
  // Freezing here made every finding after the first inherit the first fault's timeline.
  public static push(action: ActionRecord): void {
    ReproductionPlaybookStore.actions.push(action);
    while (ReproductionPlaybookStore.actions.length > ReproductionPlaybookStore.capacity) {
      ReproductionPlaybookStore.actions.shift();
    }
  }

  public static snapshot(): ActionRecord[] {
    return [...ReproductionPlaybookStore.actions];
  }

  /**
   * Generate sequentially numbered narrative instructions from stored actions.
   *
   * Minimized first so the playbook ALWAYS opens with a navigation (the initial
   * target URL a developer can actually reach) and consecutive identical actions —
   * rapid clicks on the same control — collapse into a single "repeated N times"
   * burst step instead of flooding the list with duplicates.
   */
  public static getNarrativeSteps(): string[] {
    return narrateActionRecords(minimizeActionRecords(ReproductionPlaybookStore.actions));
  }
}

