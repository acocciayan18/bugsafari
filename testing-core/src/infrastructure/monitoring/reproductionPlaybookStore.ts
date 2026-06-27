import type { ActionRecord } from '../../../../shared/types.ts';

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
    return ReproductionPlaybookStore.actions.map((record, index) => {
      const stepNum = index + 1;
      const humanId = record.fallbackLabel || record.selector;
      
      switch (record.type) {
        case 'NAVIGATE':
        case 'NAVIGATION':
          return `Step ${stepNum}. Navigate to target URL: ${record.url}`;
        
        case 'TYPE':
        case 'INPUT':
          const payload = record.payload ? `'${record.payload.slice(0, 50)}'` : '';
          return `Step ${stepNum}. Type text ${payload} into input field '${record.selector}'`;
        
        case 'CLICK':
          return `Step ${stepNum}. Click on item '${humanId}'`;
        
        case 'SUBMIT':
          return `Step ${stepNum}. Submit form at '${record.selector}'`;
        
        case 'HOVER':
          return `Step ${stepNum}. Hover over element '${humanId}'`;
        
        default:
          return `Step ${stepNum}. ${record.type} ${record.selector} at ${record.url}`;
      }
    });
  }
}

