// Single mapping from the in-memory action trace to the replayable step timeline.
// Shared by save-time persistence and the in-run reproduction probe so a finding
// replays against exactly the steps that will later be stored against it.

import type { ActionRecord } from '../../../../../shared/types.js';
import type { ActionStepTrace } from '../../../infrastructure/database/models/SessionModel.js';

export function mapActionType(type: ActionRecord['type']): ActionStepTrace['actionType'] {
  switch (type) {
    case 'CLICK':      return 'click';
    case 'INPUT':      return 'input';
    case 'TYPE':       return 'input';
    case 'NAVIGATION': return 'navigation';
    case 'NAVIGATE':   return 'navigation';
    case 'SUBMIT':     return 'bypass';
    case 'NETWORK':    return 'bypass';
    case 'HOVER':      return 'click';
    case 'MACRO':      return 'macro';
    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      return 'click';
    }
  }
}

export function buildActionSteps(records: ActionRecord[]): ActionStepTrace[] {
  return records.map((record, index) => ({
    stepNumber:         index + 1,
    timestamp:          record.timestamp,
    actionType:         mapActionType(record.type),
    selector:           record.selector && record.selector.trim() ? record.selector : 'N/A',
    // Human descriptors travel WITH the step so the saved report reads the same
    // named controls the live playbook did, never a bare CSS selector.
    label:              record.elementLabel || record.fallbackLabel,
    elementKind:        record.elementKind,
    payloadText:        record.payload,
    resultingStateHash: '',
    durationMs:         record.durationMs,
    repeatCount:        record.repeatCount,
    strippedAttributes: record.strippedAttributes,
    affectedCount:      record.affectedCount,
    redactValue:        record.redactValue,
    url:                record.url,
    containerLabel:     record.containerLabel,
    containerKind:      record.containerKind,
    outcome:            record.outcome,
    macro:              record.macro,
  }));
}
