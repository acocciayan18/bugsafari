import type { ActionRecord } from '../../../../shared/types.js';

import { narrateActionRecords } from '../../domain/services/forensics/narration.js';

/**
 * Persistent per-Safari-run action history.
 *
 * Needed because some fatal crashes bypass normal exception catcher flushing.
 */
export class ReproductionPlaybookStore {
  private static actions: ActionRecord[] = [];
  // Deep enough to keep a long causal chain reachable by the minimizer (was 20).
  private static readonly capacity = 60;
  private static resetCounter = 0;
  // Frozen at crash time so post-fault scenario/traversal writes can't overwrite the
  // causal chain that led to the fault. Every write API respects it; reset() clears it.
  private static frozen = false;

  public static reset(): void {
    ReproductionPlaybookStore.actions = [];
    ReproductionPlaybookStore.resetCounter += 1;
    ReproductionPlaybookStore.frozen = false;
  }

  public static getResetCounter(): number {
    return ReproductionPlaybookStore.resetCounter;
  }

  // Stop accepting new records — called once a fault has been snapshotted so the
  // buffer preserves the pre-crash causal chain for the manual-save / later reads.
  public static freeze(): void {
    ReproductionPlaybookStore.frozen = true;
  }

  public static isFrozen(): boolean {
    return ReproductionPlaybookStore.frozen;
  }

  public static push(action: ActionRecord): void {
    if (ReproductionPlaybookStore.frozen) return;
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
   * Uses same format as ActionRecorder.toNarrativeSteps().
   * 
   * @returns Array of formatted narrative strings
   */
  public static getNarrativeSteps(): string[] {
    return narrateActionRecords(ReproductionPlaybookStore.actions);
  }
}

