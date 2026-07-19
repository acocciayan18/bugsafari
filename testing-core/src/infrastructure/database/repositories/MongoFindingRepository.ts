import { Types, isValidObjectId } from "mongoose";
import type {
  BrainState,
  CreateSessionInput,
  FindingRepository,
  SaveBrainConfigInput,
  SessionHistoryRecord,
} from "../../../domain/repositories/FindingRepository.js";
import { BrainConfigModel } from "../models/BrainConfigModel.js";
import { SessionStatus } from "../models/FindingType.js";
import { SessionModel } from "../models/SessionModel.js";

function toObjectId(id: string): Types.ObjectId | null {
  if (!isValidObjectId(id)) {
    return null;
  }
  return new Types.ObjectId(id);
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
    userId: string,
    finishedAt: string,
  ): Promise<void> {
    const objectId = toObjectId(sessionId);
    const ownerId = toObjectId(userId);
    if (!objectId || !ownerId) return;
    await SessionModel.updateOne(
      { _id: objectId, userId: ownerId },
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
    userId: string,
    finishedAt: string,
    reason: string,
  ): Promise<void> {
    const objectId = toObjectId(sessionId);
    const ownerId = toObjectId(userId);
    if (!objectId || !ownerId) return;
    await SessionModel.updateOne(
      { _id: objectId, userId: ownerId },
      {
        $set: {
          status: SessionStatus.CRASHED,
          finishedAt: new Date(finishedAt),
          endedReason: reason.slice(0, 1500),
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
      console.error("[MongoFindingRepository] Error loading brain config:", error);
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
    console.log(
      "[Repository] markLatestSessionSaved called with targetUrl:",
      targetUrl,
    );

    const ownerId = toObjectId(userId);
    if (!ownerId) {
      console.warn("[Repository] markLatestSessionSaved requires a valid userId");
      return null;
    }

    try {
      // Owner-scoped: without userId this picked the newest session for the URL
      // across ALL tenants and flipped a stranger's run into their history.
      const filter: Record<string, unknown> = targetUrl
        ? { targetUrl, userId: ownerId }
        : { userId: ownerId };
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

      await this.markSessionSaved(sessionId, userId);
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
      // Build filter based on userId for multi-tenancy. Only sessions the
      // operator explicitly saved are "history" — auto-tracked runs (created
      // the instant a run starts, for forensic correlation) stay invisible
      // until the Save button flips this flag.
      const filter: Record<string, unknown> = { savedManually: true };

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
              pagesVisited: session.stats?.pagesVisited,
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

}
