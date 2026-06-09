import type { ActionRecord, ActionType } from '../../../../shared/types.ts';

import { ReproductionPlaybookStore } from '../../infrastructure/monitoring/reproductionPlaybookStore.js';

export interface ActionEntryInput {
  type: ActionType;
  selector: string;
  url: string;
  payload?: string;
  fallbackLabel?: string;
}


export class ActionRecorder {
  private readonly records: ActionRecord[] = [];

  constructor(private readonly capacity = 20) {}

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

  public snapshot(): ActionRecord[] {
    return [...this.records];
  }

  public toReproductionSteps(): string[] {
    return this.records.map((record: ActionRecord, index: number) => {
      const target = record.fallbackLabel ? `${record.selector} (${record.fallbackLabel})` : record.selector;
      const payloadPart = record.payload ? ` with payload "${record.payload.slice(0, 80)}"` : '';
      return `Step ${index + 1}: ${record.type} ${target} at ${record.url}${payloadPart}`;
    });
  }
}

// Backwards-compatible alias for existing imports.
export { ActionRecorder as ActionBuffer };
