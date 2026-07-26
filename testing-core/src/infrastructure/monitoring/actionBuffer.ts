import type { ActionRecord, ActionType, ActionOutcome, ReplayMacro } from '../../../../shared/types.js';

import { ReproductionPlaybookStore } from './reproductionPlaybookStore.js';
import { narrateActionRecords } from '../../domain/services/forensics/narration.js';

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

  /** Plain-English control type (button, link, field…) — narration reads it as the noun. */
  elementKind?: string;

  /** The exact text payload or fuzz string injected (if applicable) */
  value?: string;
  
  /** CSS selector for the element */
  selector: string;

  /** Current page URL */
  url: string;

  /** Optional timestamp (defaults to now) */
  timestamp?: string;

  /** Re-expandable stress-scenario descriptor (set only for a MACRO step). */
  macro?: ReplayMacro;

  /** Identical rapid repeats collapsed into this one step (>1 ⇒ "repeated N times"). */
  repeatCount?: number;

  /** Validation attributes stripped by a bypass/SUBMIT step. */
  strippedAttributes?: string[];

  /** Count of elements a bypass step affected. */
  affectedCount?: number;

  /** Observed result of the action (navigation, HTTP status, DOM change). */
  outcome?: ActionOutcome;

  /** True ⇒ narration masks the value (auth/password fields); replay keeps it verbatim. */
  redactValue?: boolean;
}

/**
 * Unified action recording interface.
 * Supports both legacy ActionEntryInput and enhanced ActionStepInput.
 */
export class ActionRecorder {
  private readonly records: ActionRecord[] = [];
  
  // Static instance for singleton pattern (enables static method calls)
  private static _instance: ActionRecorder | null = null;
  // Deep enough to hold a realistic causal chain before minimization runs (was 20).
  private static _defaultCapacity = 60;

  constructor(private readonly capacity = 60) {}

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
      elementLabel: step.humanIdentifier,
      elementKind: step.elementKind,
      repeatCount: step.repeatCount,
      macro: step.macro,
      strippedAttributes: step.strippedAttributes,
      affectedCount: step.affectedCount,
      outcome: step.outcome,
      redactValue: step.redactValue,
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
   * Generate sequentially numbered, human-actionable narrative instructions.
   * Delegates to the shared {@link narrateActionRecords} narrator so phrasing and
   * label resolution stay consistent across every reproduction playbook source.
   */
  public toNarrativeSteps(): string[] {
    return narrateActionRecords(this.records);
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
