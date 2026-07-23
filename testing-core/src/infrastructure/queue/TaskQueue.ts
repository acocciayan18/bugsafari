import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { OptimizationSettings, TestingTypeId } from '../../../../shared/types.js';

export const SAFARI_TASK_QUEUE_NAME = 'safari-tasks';

export function resolveQueueConnection(redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'): ConnectionOptions {
  return { url: redisUrl };
}

export interface SafariTaskPayload {
  targetUrl: string;
  requestedBy?: string;
  // Server-issued run token: the worker binds its telemetry room to run:${runToken}
  // and the client subscribes to the same token, so bridged live events line up.
  runToken: string;
  // Public RUN- code minted at enqueue: the worker stamps it on the DB session doc
  // and surfaces it as snapshot.runId, so queued runs keep live/history id parity.
  runCode: string;
  sessionId?: string;
  // Resolved infiltration-profile scenario gate — carried so the worker runs the
  // selected testing types instead of defaulting to all of them.
  selectedScenarios?: TestingTypeId[];
  // Operator tuning (timebox included) — without this the worker silently ran the
  // 600s default while the dashboard displayed the operator's chosen limit.
  optimizationSettings?: OptimizationSettings;
  // Marker only: the credentials themselves live encrypted in the AuthVault under
  // this run's id and are never written to the job payload.
  hasAuth?: boolean;
  createdAt: string;
}

export interface EnqueueSafariTaskInput {
  targetUrl: string;
  requestedBy?: string;
  runToken?: string;
  runCode: string;
  selectedScenarios?: TestingTypeId[];
  optimizationSettings?: OptimizationSettings;
  hasAuth?: boolean;
}

export interface EnqueuedSafariTask {
  id: string;
  queueName: string;
  targetUrl: string;
  runToken: string;
  runCode: string;
}

const defaultJobOptions: JobsOptions = {
  // No automatic retry for any safari job. A partial exploration is not
  // idempotently resumable — a retry re-invokes execute() with the same runToken,
  // relaunching a second browser, re-streaming telemetry into the live room, and
  // re-creating the run's session doc. Auth runs are additionally impossible to
  // retry (vault credentials are single-use). Fail once, visibly.
  attempts: 1,
  removeOnComplete: {
    age: 60 * 60,
    count: 100,
  },
  removeOnFail: {
    age: 24 * 60 * 60,
    count: 250,
  },
};

export class TaskQueue {
  private readonly queue: Queue<SafariTaskPayload>;

  constructor(redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379') {
    this.queue = new Queue<SafariTaskPayload>(SAFARI_TASK_QUEUE_NAME, {
      connection: resolveQueueConnection(redisUrl),
      defaultJobOptions,
    });
  }

  public async addSafariTask(input: EnqueueSafariTaskInput): Promise<EnqueuedSafariTask> {
    const targetUrl = input.targetUrl.trim();

    if (!targetUrl) {
      throw new Error('Cannot enqueue a Safari task without a target URL.');
    }

    const runToken = input.runToken ?? randomUUID();
    // attempts:1 comes from defaultJobOptions — every safari job is non-retryable.
    const job = await this.queue.add('run-safari', {
      targetUrl,
      requestedBy: input.requestedBy,
      runToken,
      runCode: input.runCode,
      selectedScenarios: input.selectedScenarios,
      optimizationSettings: input.optimizationSettings,
      hasAuth: input.hasAuth,
      createdAt: new Date().toISOString(),
    });

    return {
      id: String(job.id),
      queueName: SAFARI_TASK_QUEUE_NAME,
      targetUrl,
      runToken,
      runCode: input.runCode,
    };
  }

  // Live waiting/active snapshot used to compute each job's queue position. Waiting
  // jobs come back FIFO, so array index + 1 is the 1-based place in line.
  public async positions(): Promise<{ order: string[]; queueDepth: number; activeCount: number }> {
    const [waiting, activeCount] = await Promise.all([
      this.queue.getWaiting(),
      this.queue.getActiveCount(),
    ]);
    return {
      order: waiting.map((job) => String(job.id)),
      queueDepth: waiting.length,
      activeCount,
    };
  }

  // Authoritative BullMQ state of one job — drives recovery + initial pushes.
  public async getJobState(jobId: string): Promise<string> {
    return this.queue.getJobState(jobId);
  }

  // Cancel a job that no worker has claimed yet. BullMQ refuses to remove a
  // locked (active) job, so the caller must fall back to the control bridge for
  // those. Reports the state observed so the API can answer accurately.
  public async cancelQueuedJob(jobId: string): Promise<{ removed: boolean; state: string }> {
    const job = await this.queue.getJob(jobId);
    if (!job) return { removed: false, state: 'unknown' };

    const state = await job.getState();
    if (state === 'active') return { removed: false, state };

    try {
      await job.remove();
      return { removed: true, state };
    } catch (error) {
      console.warn(`[TaskQueue] cancel of job ${jobId} (${state}) failed:`, error instanceof Error ? error.message : error);
      return { removed: false, state };
    }
  }

  public async close(): Promise<void> {
    await this.queue.close();
  }
}
