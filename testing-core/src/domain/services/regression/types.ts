// Internal shapes for the deterministic regression replay pipeline.
import type { FaultType } from '../../../bugs/knowledgeBase/FaultClassifier.js';
import type { ActionStepTrace, ICaughtBug } from '../../../infrastructure/database/models/SessionModel.js';

/** A single runtime fault observed by the FaultCollector during replay. */
export interface CollectedFault {
  faultType: FaultType;
  message: string;
  statusCode?: number;
  url?: string;
  /** Response body scanned for body-borne signatures (leaked Mongo/stack/soft-fail). */
  content?: string;
  /** Set by ported replay probes whose classes classifyFault cannot produce. */
  bugClassOverride?: string;
}

/**
 * A finding materialized from persisted history into everything the replay needs:
 * the original target, the recorded action timeline, and the fault identity.
 */
export interface LoadedFinding {
  targetUrl: string;
  actionSteps: ActionStepTrace[];
  bug: ICaughtBug;
  /** 'finding' = per-finding minimized timeline; 'session' = legacy session-global fallback. */
  timelineSource: 'finding' | 'session';
}
