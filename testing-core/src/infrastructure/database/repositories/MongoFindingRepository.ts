import { Types, isValidObjectId } from "mongoose";
import type {
  BugFinding,
  CreateSessionInput,
  FindingRepository,
  SaveActionTraceInput,
  SaveBrainConfigInput,
  SaveFindingInput,
  SessionHistoryRecord,
} from "../../../domain/repositories/FindingRepository.js";
import type { TelemetryMeta } from "../../../types.js";
import { ActionTraceModel } from "../models/ActionTraceModel.js";
import { BrainConfigModel } from "../models/BrainConfigModel.js";
import { FindingType, SessionStatus } from "../models/FindingType.js";
import { FindingModel } from "../models/FindingModel.js";
import { SessionModel } from "../models/SessionModel.js";

function toObjectId(id: string): Types.ObjectId | null {
  if (!isValidObjectId(id)) {
    return null;
  }
  return new Types.ObjectId(id);
}

/**
 * Telemetry that is never a finding (pure instrumentation, not an error).
 */
const NON_BUG_TYPES = ['ACTION', 'HEURISTIC_SCORE'] as const;

/**
 * 100% retention policy: every real finding is persisted. Only pure non-bug
 * telemetry (ACTION / HEURISTIC_SCORE) is skipped. Runtime exceptions, console
 * and server-side rejections, and ALL network faults (no longer gated on a
 * >= 400 status code or "critical string" allow-list) are retained so saved
 * history mirrors the live Errors Tab exactly — no over-aggressive filtering.
 */
function shouldSaveFinding(type: string, _meta?: TelemetryMeta): boolean {
  const bugType = type?.toUpperCase();

  if (bugType && NON_BUG_TYPES.includes(bugType as typeof NON_BUG_TYPES[number])) {
    return false;
  }

  // Retain every other finding type, known or novel — nothing is truncated.
  return Boolean(bugType);
}



export class MongoFindingRepository implements FindingRepository {
public async createSession(input: CreateSessionInput): Promise<string> {
    console.log(`[MongoFindingRepository] 📝 Creating session for: ${input.targetUrl}`);
    console.log(`[MongoFindingRepository] UserId: ${input.userId ?? 'none/unauthenticated'}`);
    
    // Ownership is mandatory: every session must belong to a real authenticated
    // user. Callers (ExplorationEngine) already gate on a valid id; throwing here
    // is defense-in-depth and is caught upstream to fall back to an in-memory run.
    if (!input.userId || !isValidObjectId(input.userId)) {
      throw new Error('createSession requires a valid authenticated userId');
    }
    const userIdToUse = new Types.ObjectId(input.userId);

    const session = await SessionModel.create({
      userId: userIdToUse,  // CRITICAL: Link session to user
      targetUrl: input.targetUrl,
      status: SessionStatus.RUNNING,
      startedAt: new Date(input.startedAt),
    });
    console.log(`[MongoFindingRepository] ✅ Session created: ${session._id} for userId: ${userIdToUse}`);
    return session._id.toString();
  }

  public async markSessionCompleted(
    sessionId: string,
    finishedAt: string,
  ): Promise<void> {
    const objectId = toObjectId(sessionId);
    if (!objectId) return;
    await SessionModel.updateOne(
      { _id: objectId },
      {
        $set: {
          status: SessionStatus.COMPLETED,
          finishedAt: new Date(finishedAt),
        },
      },
    );
  }

  public async markSessionCrashed(
    sessionId: string,
    finishedAt: string,
    reason: string,
  ): Promise<void> {
    const objectId = toObjectId(sessionId);
    if (!objectId) return;
    await SessionModel.updateOne(
      { _id: objectId },
      {
        $set: {
          status: SessionStatus.CRASHED,
          finishedAt: new Date(finishedAt),
          endedReason: reason.slice(0, 1500),
        },
      },
    );
  }

  public async save(input: SaveFindingInput): Promise<string> {
    if (!input.sessionId) {
      console.warn('[MongoFindingRepository] Skipping finding save — no active session (in-memory mode)');
      return '';
    }
    const objectId = toObjectId(input.sessionId);
    if (!objectId) {
      throw new Error(`Invalid session ID: ${input.sessionId}`);
    }

    // Filter out non-bug types before saving
    if (!shouldSaveFinding(input.event.type, input.event.meta)) {
      console.log(`[MongoFindingRepository] Skipping non-bug finding: ${input.event.type}`);
      return "";
    }

    // Promote the crash-time reproduction narrative to a first-class field on the
    // finding document (it also remains inside `meta` for backward compatibility).
    const reproductionPlaybook = Array.isArray(input.event.meta?.reproductionSteps)
      ? input.event.meta.reproductionSteps
      : [];

    const finding = await FindingModel.create({
      sessionId: objectId,
      timestamp: new Date(input.event.timestamp),
      type: input.event.type as FindingType,
      meta: input.event.meta,
      reproductionPlaybook,
    });

    await SessionModel.updateOne(
      { _id: objectId },
      { $inc: { findingCount: 1 } },
    );
    return finding._id.toString();
  }

  public async saveActionTrace(input: SaveActionTraceInput): Promise<string> {
    const objectId = toObjectId(input.sessionId);
    if (!objectId) {
      throw new Error(`Invalid session ID: ${input.sessionId}`);
    }

    const trace = await ActionTraceModel.create({
      sessionId: objectId,
      timestamp: new Date(input.trace.timestamp),
      selector: input.trace.selector,
      action: input.trace.action,
      payload: input.trace.payload,
      score: input.trace.score,
    });

    await SessionModel.updateOne(
      { _id: objectId },
      { $inc: { actionTraceCount: 1 } },
    );
    return trace._id.toString();
  }

  public async linkActionTracesToFinding(
    findingId: string,
    actionTraceIds: string[],
  ): Promise<void> {
    if (actionTraceIds.length === 0) {
      return;
    }

    const findingObjectId = toObjectId(findingId);
    if (!findingObjectId) {
      return;
    }

    const traceObjectIds = actionTraceIds
      .map((id) => toObjectId(id))
      .filter((id): id is Types.ObjectId => id !== null);

    if (traceObjectIds.length === 0) {
      return;
    }

    await Promise.all([
      FindingModel.updateOne(
        { _id: findingObjectId },
        { $set: { linkedActionTraceIds: traceObjectIds } },
      ),
      ActionTraceModel.updateMany(
        { _id: { $in: traceObjectIds } },
        { $set: { findingId: findingObjectId } },
      ),
    ]);
  }

  public async saveBrainConfig(input: SaveBrainConfigInput): Promise<string> {
    const objectId = toObjectId(input.sessionId);
    if (!objectId) {
      throw new Error(`Invalid session ID: ${input.sessionId}`);
    }

    const brain = await BrainConfigModel.create({
      sessionId: objectId,
      source: input.source,
      bias: input.bias,
      weights: input.weights,
    });

    await SessionModel.updateOne(
      { _id: objectId },
      { $inc: { brainSnapshotCount: 1 } },
    );
    return brain._id.toString();
  }

  public async markSessionSaved(sessionId: string): Promise<void> {
    const objectId = toObjectId(sessionId);
    if (!objectId) return;
    await SessionModel.updateOne(
      { _id: objectId },
      { $set: { savedManually: true } },
    );
  }

  public async markLatestSessionSaved(
    targetUrl?: string,
  ): Promise<string | null> {
    console.log(
      "[Repository] markLatestSessionSaved called with targetUrl:",
      targetUrl,
    );

    try {
      const filter = targetUrl ? { targetUrl } : {};
      console.log("[Repository] Query filter:", JSON.stringify(filter));

      const latest = await SessionModel.findOne(filter)
        .sort({ startedAt: -1 })
        .lean();
      console.log(
        "[Repository] Found session:",
        latest ? {
          _id: latest._id,
          targetUrl: latest.targetUrl,
          status: latest.status,
        }
          : null,
      );

      if (!latest?._id) {
        console.warn("[Repository] No session found to save");
        return null;
      }

      const sessionId = latest._id.toString();
      console.log("[Repository] Marking session as saved:", sessionId);

      await this.markSessionSaved(sessionId);
      console.log("[Repository] Session marked as saved successfully");

      return sessionId;
    } catch (error) {
      console.error("[Repository] Error in markLatestSessionSaved:", error);
      throw error;
    }
  }

public async listSessionHistory(limit = 50, userId?: string): Promise<SessionHistoryRecord[]> {
    console.log("[Repository] listSessionHistory called with limit:", limit, "userId:", userId ?? "none");

    try {
      // Build filter based on userId for multi-tenancy
      const filter: Record<string, unknown> = {};

      // CRITICAL: If userId provided, filter by userId for data isolation
      // If no userId (shouldn't happen with requireAuth but handle safely), return empty array
      if (userId && isValidObjectId(userId)) {
        filter.userId = new Types.ObjectId(userId);
        console.log("[Repository] Filtering sessions by userId:", userId);
      } else if (userId) {
        // Invalid userId provided - return empty array (safety check)
        console.log("[Repository] Invalid userId, returning empty array");
        return [];
      }
      // No userId = return empty for guests (multi-tenancy: guests see nothing)
      // This should be caught by requireAuth but handle edge cases
      else {
        console.log("[Repository] No userId provided, returning empty array");
        return [];
      }

      // Wrap in try/catch to handle database errors gracefully
      const sessions = await SessionModel.find(filter)
        .sort({ startedAt: -1 })
        .limit(Math.max(1, Math.min(limit, 200)))
        .lean();

      // Falsy/empty safe check - ensure sessions is an array before processing
      if (!Array.isArray(sessions)) {
        console.warn(
          "[Repository] listSessionHistory: sessions is not an array, returning empty array",
        );
        return [];
      }

      if (sessions.length === 0) {
        console.log(
          "[Repository] listSessionHistory: no sessions found in database (blank DB)",
        );
        return [];
      }

      console.log("[Repository] Found sessions count:", sessions.length);

      return await Promise.all(
        sessions.map(async (session) => {
          try {
            // Safely count brain snapshots with error handling
            const brainSnapshots = await BrainConfigModel.countDocuments({
              sessionId: session._id,
            }).catch(() => 0);

            return {
              id: session._id?.toString() ?? "",
              targetUrl: session.targetUrl ?? "",
              status:
                session.status === SessionStatus.CRASHED
                  ? "Crashed"
                  : session.status === SessionStatus.COMPLETED
                    ? "Completed"
                    : "Running",
              startedAt:
                session.startedAt?.toISOString() ?? new Date().toISOString(),
              finishedAt: session.finishedAt
                ? session.finishedAt.toISOString()
                : undefined,
              endedReason: session.endedReason ?? undefined,
              savedManually: Boolean(session.savedManually),
              findingCount: session.findingCount ?? 0,
              actionTraceCount: session.actionTraceCount ?? 0,
              brainSnapshots,
              runtimeMs: session.stats?.runtimeMs,
              coveragePercentage: session.stats?.coveragePercentage,
              maxActions: session.stats?.maxActions,
            };
          } catch (mapError) {
            console.error("[Repository] Error mapping session:", mapError);
            // Return a safe default session record instead of failing
            return {
              id: session._id?.toString() ?? "unknown",
              targetUrl: session.targetUrl ?? "",
              status: "Running",
              startedAt: new Date().toISOString(),
              savedManually: false,
              findingCount: 0,
              actionTraceCount: 0,
              brainSnapshots: 0,
            };
          }
        }),
      );
    } catch (error) {
      // Comprehensive error handling with explicit log message
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("[Repository] Error in listSessionHistory:", error);
      console.error(
        "[Repository] Error stack:",
        error instanceof Error ? error.stack : "no stack",
      );
      // Return empty array instead of throwing - lets the dashboard load even with DB issues
      return [];
    }
  }

  /**
     * Collect bug findings from the most recent session for the target URL.
     * Applies proper domain filtering - only returns actual bugs.
     * Uses centralized BugClassifier - single source of truth.
     */
  public async collectBugFindings(targetUrl: string): Promise<BugFinding[]> {
    try {
      // Find the most recent session for this target URL
      const session = await SessionModel.findOne({ targetUrl })
        .sort({ startedAt: -1 })
        .lean()
        .exec();

      if (!session || !session._id) {
        console.log("[MongoFindingRepository] No session found for target URL");
        return [];
      }

      // Query ALL findings for this session first
      const allFindings = await FindingModel.find({ sessionId: session._id })
        .lean()
        .exec();

      if (allFindings.length === 0) {
        console.log("[MongoFindingRepository] No findings for session:", session._id);
        return [];
      }

      console.log("[MongoFindingRepository] Raw findings count:", allFindings.length);

      // Filter to only include ACTUAL BUGS
      const filteredFindings = allFindings.filter((finding) =>
        shouldSaveFinding(finding.type as string, finding.meta as TelemetryMeta | undefined)
      );

      console.log("[MongoFindingRepository] Filtered findings:", allFindings.length, "->", filteredFindings.length);

      // Transform filtered findings to BugFinding format
      const bugFindings: BugFinding[] = filteredFindings.map((finding) => ({
        bugId: finding._id?.toString() || new Types.ObjectId().toString(),
        type: String(finding.type || "UNKNOWN"),
        message: String(finding.meta?.message || JSON.stringify(finding.meta || {})),
        selector: String(finding.meta?.selector || ""),
        payloadUsed: String(finding.meta?.payloadUsed || ""),
        advice: String(finding.meta?.advice || "Review and remediate based on findings."),
        timestamp: finding.timestamp || new Date(),
      }));

      console.log("[MongoFindingRepository] Collected", bugFindings.length, "actual bug findings after filtering");
      return bugFindings;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[MongoFindingRepository] Error collecting bug findings:", errorMessage);
      return [];
    }
  }
}
