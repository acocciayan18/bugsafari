import { Types, isValidObjectId } from 'mongoose';
import type {
  CreateSessionInput,
  FindingRepository,
  SaveActionTraceInput,
  SaveBrainConfigInput,
  SaveFindingInput,
  SessionHistoryRecord,
} from '../../../domain/repositories/FindingRepository.js';
import { ActionTraceModel } from '../models/ActionTraceModel.js';
import { BrainConfigModel } from '../models/BrainConfigModel.js';
import { FindingType, SessionStatus } from '../models/FindingType.js';
import { FindingModel } from '../models/FindingModel.js';
import { SessionModel } from '../models/SessionModel.js';

function toObjectId(id: string): Types.ObjectId | null {
  if (!isValidObjectId(id)) {
    return null;
  }
  return new Types.ObjectId(id);
}

export class MongoFindingRepository implements FindingRepository {
  public async createSession(input: CreateSessionInput): Promise<string> {
    const session = await SessionModel.create({
      targetUrl: input.targetUrl,
      status: SessionStatus.RUNNING,
      startedAt: new Date(input.startedAt),
    });
    return session._id.toString();
  }

  public async markSessionCompleted(sessionId: string, finishedAt: string): Promise<void> {
    const objectId = toObjectId(sessionId);
    if (!objectId) return;
    await SessionModel.updateOne(
      { _id: objectId },
      { $set: { status: SessionStatus.COMPLETED, finishedAt: new Date(finishedAt) } },
    );
  }

  public async markSessionCrashed(sessionId: string, finishedAt: string, reason: string): Promise<void> {
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
    const objectId = toObjectId(input.sessionId);
    if (!objectId) {
      throw new Error(`Invalid session ID: ${input.sessionId}`);
    }

    const finding = await FindingModel.create({
      sessionId: objectId,
      timestamp: new Date(input.event.timestamp),
      type: input.event.type as FindingType,
      meta: input.event.meta,
    });

    await SessionModel.updateOne({ _id: objectId }, { $inc: { findingCount: 1 } });
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

    await SessionModel.updateOne({ _id: objectId }, { $inc: { actionTraceCount: 1 } });
    return trace._id.toString();
  }

  public async linkActionTracesToFinding(findingId: string, actionTraceIds: string[]): Promise<void> {
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
      FindingModel.updateOne({ _id: findingObjectId }, { $set: { linkedActionTraceIds: traceObjectIds } }),
      ActionTraceModel.updateMany({ _id: { $in: traceObjectIds } }, { $set: { findingId: findingObjectId } }),
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

    await SessionModel.updateOne({ _id: objectId }, { $inc: { brainSnapshotCount: 1 } });
    return brain._id.toString();
  }

  public async markSessionSaved(sessionId: string): Promise<void> {
    const objectId = toObjectId(sessionId);
    if (!objectId) return;
    await SessionModel.updateOne({ _id: objectId }, { $set: { savedManually: true } });
  }

  public async markLatestSessionSaved(targetUrl?: string): Promise<string | null> {
    const filter = targetUrl ? { targetUrl } : {};
    const latest = await SessionModel.findOne(filter).sort({ startedAt: -1 }).lean();
    if (!latest?._id) return null;
    await this.markSessionSaved(latest._id.toString());
    return latest._id.toString();
  }

  public async listSessionHistory(limit = 50): Promise<SessionHistoryRecord[]> {
    const sessions = await SessionModel.find({})
      .sort({ startedAt: -1 })
      .limit(Math.max(1, Math.min(limit, 200)))
      .lean();

    return await Promise.all(
      sessions.map(async (session) => {
        const brainSnapshots = await BrainConfigModel.countDocuments({ sessionId: session._id });
        return {
          id: session._id.toString(),
          targetUrl: session.targetUrl,
          status: session.status === SessionStatus.CRASHED
            ? 'Crashed'
            : session.status === SessionStatus.COMPLETED
              ? 'Completed'
              : 'Running',
          startedAt: session.startedAt.toISOString(),
          finishedAt: session.finishedAt ? session.finishedAt.toISOString() : undefined,
          endedReason: session.endedReason ?? undefined,
          savedManually: Boolean(session.savedManually),
          findingCount: session.findingCount ?? 0,
          actionTraceCount: session.actionTraceCount ?? 0,
          brainSnapshots,
        };
      }),
    );
  }
}
