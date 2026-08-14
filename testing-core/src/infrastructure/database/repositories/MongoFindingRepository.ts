import { Types, isValidObjectId } from "mongoose";
import type {
  BrainState,
  CreateSessionInput,
  FindingRepository,
  SaveBrainConfigInput,
  SessionHistoryRecord,
  SessionTerminalStats,
} from "../../../domain/repositories/FindingRepository.js";
import type { PaginationParams, RunTerminationOutcome } from "../../../../../shared/types.js";
import { BrainConfigModel } from "../models/BrainConfigModel.js";
import { SessionStatus } from "../models/FindingType.js";
import { SessionModel } from "../models/SessionModel.js";
import { createWithRunCodeRetry } from "../runCodeGenerator.js";

import { createLogger } from '../../observability/logger.js';

const obsLog = createLogger('[MongoFindingRepository]');

function toObjectId(id: string): Types.ObjectId | null {
  if (!isValidObjectId(id)) {
    return null;
  }
  return new Types.ObjectId(id);
}

// Coarse persisted status per termination outcome. `boundary-saturated` is a clean
// finish; `graceful-shutdown` is an early bail-out, distinct from an engine crash.
const OUTCOME_STATUS: Record<RunTerminationOutcome, SessionStatus> = {
  completed: SessionStatus.COMPLETED,
  'boundary-saturated': SessionStatus.COMPLETED,
  'user-stopped': SessionStatus.STOPPED,
  timebox: SessionStatus.TIMED_OUT,
  'graceful-shutdown': SessionStatus.HALTED,
  'target-crash': SessionStatus.CRASHED,
  abandoned: SessionStatus.ABANDONED,
  'engine-error': SessionStatus.ENGINE_ERROR,
  // Inert: a queue cancellation never reaches the engine or persists a session.
  'queue-cancelled': SessionStatus.STOPPED,
  exception: SessionStatus.CRASHED,
};

// Persisted status → history record status. Non-terminal lifecycle states
// (Running/Paused/Interrupted/Disconnected) fall through to 'Running'.
const HISTORY_STATUS: Partial<Record<SessionStatus, SessionHistoryRecord['status']>> = {
  [SessionStatus.COMPLETED]: 'Completed',
  [SessionStatus.CRASHED]: 'Crashed',
  [SessionStatus.STOPPED]: 'Stopped',
  [SessionStatus.TIMED_OUT]: 'TimedOut',
  [SessionStatus.HALTED]: 'Halted',
  [SessionStatus.ABANDONED]: 'Abandoned',
  [SessionStatus.ENGINE_ERROR]: 'EngineError',
};


export class MongoFindingRepository implements FindingRepository {
public async createSession(input: CreateSessionInput): Promise<string> {
    obsLog.info(`[MongoFindingRepository]  Creating session for: ${input.targetUrl}`);
    obsLog.info(`[MongoFindingRepository] UserId: ${input.userId ?? 'none/unauthenticated'}`);
    
    // Ownership is mandatory: every session must belong to a real authenticated
    // user. Callers (ExplorationEngine) already gate on a valid id; throwing here
    // is defense-in-depth and is caught upstream to fall back to an in-memory run.
    if (!input.userId || !isValidObjectId(input.userId)) {
      throw new Error('createSession requires a valid authenticated userId');
    }
    const userIdToUse = new Types.ObjectId(input.userId);

    const session = await this.createSessionDoc(userIdToUse, new Date(input.startedAt), input);
    obsLog.info(`[MongoFindingRepository] Session created: ${session._id} (runId=${session.runId}) for userId: ${userIdToUse}`);
    return session._id.toString();
  }

  // Create the run's session doc. The code is always stamped explicitly and
  // retried against the unique index — the schema default is an unchecked random
  // mint, so leaving it to fill the field would surface E11000 to the caller.
  private async createSessionDoc(userId: Types.ObjectId, startedAt: Date, input: CreateSessionInput) {
    const base = {
      userId,
      targetUrl: input.targetUrl,
      status: SessionStatus.RUNNING,
      startedAt,
      infiltrationProfile: input.infiltrationProfile,
      activeTestingTypes: input.activeTestingTypes,
    };
    return createWithRunCodeRetry((code) => SessionModel.create({ ...base, runId: code }), input.runId);
  }

  public async markSessionTerminated(
    sessionId: string,
    userId: string,
    finishedAt: string,
    outcome: RunTerminationOutcome,
    reason: string,
    stats?: SessionTerminalStats,
  ): Promise<void> {
    const objectId = toObjectId(sessionId);
    const ownerId = toObjectId(userId);
    if (!objectId || !ownerId) return;
    // Persist the engine's real run metrics here — this fires once for EVERY run
    // (saved or not), so history step count and forensic duration populate even when
    // the operator never presses Save. dot-paths patch the nested stats sub-doc without
    // replacing its other fields.
    const metricFields = stats
      ? {
          actionTraceCount: stats.actionsExecuted,
          timeElapsed: stats.runtimeMs,
          'stats.actionsExecuted': stats.actionsExecuted,
          'stats.runtimeMs': stats.runtimeMs,
          'stats.pagesVisited': stats.pageCount,
        }
      : {};
    await SessionModel.updateOne(
      { _id: objectId, userId: ownerId },
      {
        $set: {
          status: OUTCOME_STATUS[outcome] ?? SessionStatus.CRASHED,
          outcome,
          finishedAt: new Date(finishedAt),
          endedReason: reason.slice(0, 1500),
          ...metricFields,
        },
      },
    );
  }

  public async saveBrainConfig(input: SaveBrainConfigInput): Promise<string> {
    const objectId = toObjectId(input.sessionId);
    if (!objectId) {
      throw new Error(`Invalid session ID: ${input.sessionId}`);
    }
    const ownerId = toObjectId(input.userId);
    if (!ownerId) {
      throw new Error('saveBrainConfig requires a valid authenticated userId');
    }

    const brain = await BrainConfigModel.create({
      sessionId: objectId,
      userId: ownerId,
      targetUrl: input.targetUrl,
      source: input.source,
      bias: input.bias,
      weights: input.weights,
    });

    await SessionModel.updateOne(
      { _id: objectId, userId: ownerId },
      { $inc: { brainSnapshotCount: 1 } },
    );
    return brain._id.toString();
  }

  public async loadLatestBrainConfig(targetUrl: string, userId: string): Promise<BrainState | null> {
    const ownerId = toObjectId(userId);
    if (!targetUrl || !ownerId) return null;
    try {
      // Scoped to the owner: a brain trained on another tenant's run must never
      // seed this run's perceptron.
      const doc = await BrainConfigModel.findOne({ targetUrl, userId: ownerId })
        .sort({ capturedAt: -1 })
        .lean()
        .exec();
      if (!doc) return null;
      // lean() returns Map fields as either a Map or a plain object depending on driver.
      const rawWeights = doc.weights as unknown;
      const weights =
        rawWeights instanceof Map
          ? Object.fromEntries(rawWeights as Map<string, number>)
          : ((rawWeights as Record<string, number>) ?? {});
      if (Object.keys(weights).length === 0) return null;
      return { bias: doc.bias, weights };
    } catch (error) {
      obsLog.error("[MongoFindingRepository] Error loading brain config:", error);
      return null;
    }
  }

  public async markSessionSaved(sessionId: string, userId: string): Promise<void> {
    const objectId = toObjectId(sessionId);
    const ownerId = toObjectId(userId);
    if (!objectId || !ownerId) return;
    await SessionModel.updateOne(
      { _id: objectId, userId: ownerId },
      { $set: { savedManually: true } },
    );
  }

  public async markLatestSessionSaved(
    userId: string,
    targetUrl?: string,
  ): Promise<string | null> {
    obsLog.info(
      "[Repository] markLatestSessionSaved called with targetUrl:",
      targetUrl,
    );

    const ownerId = toObjectId(userId);
    if (!ownerId) {
      obsLog.warn("[Repository] markLatestSessionSaved requires a valid userId");
      return null;
    }

    try {
      // Owner-scoped: without userId this picked the newest session for the URL
      // across ALL tenants and flipped a stranger's run into their history.
      const filter: Record<string, unknown> = targetUrl
        ? { targetUrl, userId: ownerId }
        : { userId: ownerId };
      obsLog.info("[Repository] Query filter:", JSON.stringify(filter));

      const latest = await SessionModel.findOne(filter)
        .sort({ startedAt: -1 })
        .lean();
      obsLog.info(
        "[Repository] Found session:",
        latest ? {
          _id: latest._id,
          targetUrl: latest.targetUrl,
          status: latest.status,
        }
          : null,
      );

      if (!latest?._id) {
        obsLog.warn("[Repository] No session found to save");
        return null;
      }

      const sessionId = latest._id.toString();
      obsLog.info("[Repository] Marking session as saved:", sessionId);

      await this.markSessionSaved(sessionId, userId);
      obsLog.info("[Repository] Session marked as saved successfully");

      return sessionId;
    } catch (error) {
      obsLog.error("[Repository] Error in markLatestSessionSaved:", error);
      throw error;
    }
  }

public async listSessionHistory(
    params: PaginationParams,
    userId?: string,
  ): Promise<{ items: SessionHistoryRecord[]; total: number }> {
    const empty = { items: [] as SessionHistoryRecord[], total: 0 };

    // Multi-tenancy: guests and malformed ids see nothing. Only sessions the
    // operator explicitly saved are "history" — auto-tracked runs (created the
    // instant a run starts, for forensic correlation) stay invisible until the
    // Save button flips this flag.
    if (!userId || !isValidObjectId(userId)) return empty;

    try {
      const filter = { userId: new Types.ObjectId(userId), savedManually: true };

      // Projection matters as much as the limit here: without it every row drags
      // its full forensicTrace.caughtBugs array (stack traces) into memory.
      const [total, sessions] = await Promise.all([
        SessionModel.countDocuments(filter),
        SessionModel.find(filter)
          .sort({ startedAt: -1 })
          .skip(params.skip)
          .limit(params.pageSize)
          .select(
            '_id runId targetUrl status outcome startedAt finishedAt endedReason savedManually findingCount actionTraceCount stats',
          )
          .lean(),
      ]);

      if (!Array.isArray(sessions) || sessions.length === 0) {
        return { items: [], total };
      }

      // One grouped count for the whole page, replacing one countDocuments per row.
      const brainSnapshotCounts = new Map<string, number>();
      try {
        const grouped = await BrainConfigModel.aggregate<{ _id: Types.ObjectId; count: number }>([
          { $match: { sessionId: { $in: sessions.map((session) => session._id) } } },
          { $group: { _id: '$sessionId', count: { $sum: 1 } } },
        ]);
        for (const entry of grouped) {
          brainSnapshotCounts.set(entry._id.toString(), entry.count);
        }
      } catch (countError) {
        obsLog.error('[Repository] Brain snapshot count aggregation failed:', countError);
      }

      const items: SessionHistoryRecord[] = sessions.map((session) => {
        const id = session._id?.toString() ?? '';
        return {
          id,
          runId: session.runId ?? undefined,
          targetUrl: session.targetUrl ?? '',
          status: HISTORY_STATUS[session.status] ?? 'Running',
          outcome: session.outcome ?? undefined,
          infiltrationProfile: session.infiltrationProfile ?? undefined,
          startedAt: session.startedAt?.toISOString() ?? new Date().toISOString(),
          finishedAt: session.finishedAt ? session.finishedAt.toISOString() : undefined,
          endedReason: session.endedReason ?? undefined,
          savedManually: Boolean(session.savedManually),
          findingCount: session.findingCount ?? 0,
          actionTraceCount: session.actionTraceCount ?? 0,
          brainSnapshots: brainSnapshotCounts.get(id) ?? 0,
          runtimeMs: session.stats?.runtimeMs,
          coveragePercentage: session.stats?.coveragePercentage,
          maxActions: session.stats?.maxActions,
          pagesVisited: session.stats?.pagesVisited,
        };
      });

      return { items, total };
    } catch (error) {
      // Return an empty page rather than throwing — the dashboard still loads.
      obsLog.error('[Repository] Error in listSessionHistory:', error);
      return empty;
    }
  }

}
