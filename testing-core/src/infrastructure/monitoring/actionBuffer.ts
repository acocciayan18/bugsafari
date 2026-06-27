import type { ActionRecord, ActionType } from '../../../../shared/types.ts';

import { ReproductionPlaybookStore } from './reproductionPlaybookStore.js';

export interface ActionEntryInput {
  type: ActionType;
  selector: string;
  url: string;
  payload?: string;
  fallbackLabel?: string;
}

/**
 * Enhanced structured step input for buffer ingestion.
 * Provides human-readable metadata for narrative instruction generation.
 */
export interface ActionStepInput {
  /** Action type: 'NAVIGATE' | 'CLICK' | 'TYPE' | 'HOVER' | 'SUBMIT' */
  actionType: ActionType;
  
  /** Clear readable text label, DOM button inner text, or explicit element selector path */
  humanIdentifier: string;
  
  /** The exact text payload or fuzz string injected (if applicable) */
  value?: string;
  
  /** CSS selector for the element */
  selector: string;
  
  /** Current page URL */
  url: string;
  
  /** Optional timestamp (defaults to now) */
  timestamp?: string;
}

/**
 * Unified action recording interface.
 * Supports both legacy ActionEntryInput and enhanced ActionStepInput.
 */
export class ActionRecorder {
  private readonly records: ActionRecord[] = [];
  
  // Static instance for singleton pattern (enables static method calls)
  private static _instance: ActionRecorder | null = null;
  private static _defaultCapacity = 20;

  constructor(private readonly capacity = 20) {}

  /**
   * Get singleton instance of ActionRecorder.
   * Enables static method calls like ActionRecorder.recordStep(...) without explicit instantiation.
   */
  public static getInstance(): ActionRecorder {
    if (!ActionRecorder._instance) {
      ActionRecorder._instance = new ActionRecorder(ActionRecorder._defaultCapacity);
    }
    return ActionRecorder._instance;
  }

  /**
   * Static method: Record action using legacy input format (backward compatibility).
   * Delegates to singleton instance.
   */
  public static record(action: ActionEntryInput): void {
    ActionRecorder.getInstance().record(action);
  }

  /**
   * Static method: Record structured step with human-readable metadata.
   * Delegates to singleton instance. This is the preferred static method for stress scenarios.
   */
  public static recordStep(step: ActionStepInput): void {
    ActionRecorder.getInstance().recordStep(step);
  }

  /**
   * Record action using legacy input format (backward compatibility).
   */
  public record(action: ActionEntryInput): void {
    const record: ActionRecord = {
      timestamp: new Date().toISOString(),
      ...action,
    };

    this.records.push(record);
    ReproductionPlaybookStore.push(record);

    while (this.records.length > this.capacity) {
      this.records.shift();
    }
  }

  /**
   * Record structured step with human-readable metadata.
   * This is the preferred method for threat scenarios.
   */
  public recordStep(step: ActionStepInput): void {
    const record: ActionRecord = {
      timestamp: step.timestamp ?? new Date().toISOString(),
      type: step.actionType,
      selector: step.selector,
      url: step.url,
      payload: step.value,
      fallbackLabel: step.humanIdentifier,
    };

    this.records.push(record);
    ReproductionPlaybookStore.push(record);

    while (this.records.length > this.capacity) {
      this.records.shift();
    }
  }

  /**
   * Get current snapshot of recorded actions.
   */
  public snapshot(): ActionRecord[] {
    return [...this.records];
  }

  /**
   * Generate sequentially numbered narrative instructions.
   * Format aligned with specification (without square brackets):
   * - "Step 1. Navigate to target URL: https://..."
   * - "Step 2. Click on item '[humanIdentifier]'"
   * - "Step 3. Type text '[value]' into input field '[selector]'"
   */
  public toNarrativeSteps(): string[] {
    return this.records.map((record, index) => {
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

  /**
   * Backward compatible alias for toNarrativeSteps().
   * @deprecated Use toNarrativeSteps() for new code
   */
  public toReproductionSteps(): string[] {
    return this.toNarrativeSteps();
  }
}

// Backwards-compatible alias for existing imports.
export { ActionRecorder as ActionBuffer };
