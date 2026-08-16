// Single mapping from the in-memory action trace to the replayable step timeline.
// Shared by save-time persistence and the in-run reproduction probe so a finding
// replays against exactly the steps that will later be stored against it. The mapping
// itself lives in shared/reproduction.ts so the live Errors tab produces byte-identical
// steps for the same trace — this module only pins it to the DB `ActionStepTrace` type.

import type { ActionRecord } from '../../../../../shared/types.js';
import { actionRecordsToSteps, mapReproductionActionType } from '../../../../../shared/reproduction.js';
import type { ActionStepTrace } from '../../../infrastructure/database/models/SessionModel.js';

export function mapActionType(type: ActionRecord['type']): ActionStepTrace['actionType'] {
  return mapReproductionActionType(type);
}

export function buildActionSteps(records: ActionRecord[]): ActionStepTrace[] {
  return actionRecordsToSteps(records);
}
