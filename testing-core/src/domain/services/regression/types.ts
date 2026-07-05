// Internal shapes for the deterministic regression replay pipeline.
import type { FaultType } from '../../../bugs/knowledgeBase/FaultClassifier.js';
import type { ActionStepTrace, ICaughtBug } from '../../../infrastructure/database/models/SessionModel.js';

/** A single runtime fault observed by the FaultCollector during replay. */
export interface CollectedFault {
  faultType: FaultType;
  message: string;
  statusCode?: number;
  url?: string;
}

/**
 * A finding materialized from persisted history into everything the replay needs:
 * the original target, the recorded action timeline, and the fault identity.
 */
export interface LoadedFinding {
  targetUrl: string;
  actionSteps: ActionStepTrace[];
  bug: ICaughtBug;
}
