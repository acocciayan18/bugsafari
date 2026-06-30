import type { ActionRecord } from '../../../../shared/types.ts';

import { narrateActionRecords } from '../../domain/services/forensics/narration.js';

/**
 * Persistent per-Safari-run action history.
 *
 * Needed because some fatal crashes bypass normal exception catcher flushing.
 */
export class ReproductionPlaybookStore {
  private static actions: ActionRecord[] = [];
  private static readonly capacity = 20;
  private static resetCounter = 0;

  public static reset(): void {
    ReproductionPlaybookStore.actions = [];
    ReproductionPlaybookStore.resetCounter += 1;
  }

  public static getResetCounter(): number {
    return ReproductionPlaybookStore.resetCounter;
  }

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
   * Uses same format as ActionRecorder.toNarrativeSteps().
   * 
   * @returns Array of formatted narrative strings
   */
  public static getNarrativeSteps(): string[] {
    return narrateActionRecords(ReproductionPlaybookStore.actions);
  }
}

