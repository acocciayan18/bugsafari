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
    // Failed job payloads carry target URLs and user ids in an unauthenticated Redis
    // (SEC-20); retain them only long enough to inspect a failure, not a full day.
    age: 2 * 60 * 60,
    count: 250,
  },
};

// getWorkersCount() issues a Redis CLIENT LIST, which is O(connections) — cached
// because positions() runs on every queue transition, not once per request.
const WORKER_COUNT_TTL_MS = 5_000;
// positions() hydrates the full waiting list from Redis and runs twice per queue
// transition plus on a 10s resync. Queue positions are display-only, so sub-second
// staleness is invisible — a short TTL collapses those bursts to one fetch.
const POSITIONS_TTL_MS = 750;
// Backlog ceiling. Unbounded enqueue lets one burst pin every Redis job payload
// in memory and hand later operators a wait time no UI can honestly display.
const DEFAULT_MAX_QUEUE_DEPTH = 50;

export function readMaxQueueDepth(): number {
  const parsed = Number.parseInt(process.env.BUGSAFARI_MAX_QUEUE_DEPTH ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_QUEUE_DEPTH;
}

export interface QueuePositions {
  order: string[];
  queueDepth: number;
  activeCount: number;
  // Concurrent execution slots the fleet currently exposes; null when unavailable.
  workerCount: number | null;
}

export class TaskQueue {
  private readonly queue: Queue<SafariTaskPayload>;
  private workerCountCache: { value: number | null; at: number } = { value: null, at: 0 };
  private positionsCache: { value: QueuePositions; at: number } | null = null;

  constructor(redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379') {
    this.queue = new Queue<SafariTaskPayload>(SAFARI_TASK_QUEUE_NAME, {
      connection: resolveQueueConnection(redisUrl),
      defaultJobOptions,
    });
    // BullMQ's Queue is an EventEmitter that emits 'error' on a Redis blip; without a
    // listener that would crash the api process. Log-and-continue (it reconnects).
    this.queue.on('error', (err) => console.error('[TaskQueue] queue redis error:', err instanceof Error ? err.message : err));
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

  // Connected worker replicas = concurrent execution slots (per-worker concurrency
  // is clamped to 1). Cached, and never throws: managed Redis tiers disable CLIENT
  // LIST, and a missing capacity figure must degrade the display, not the queue.
  public async workerCount(): Promise<number | null> {
    const now = Date.now();
    if (now - this.workerCountCache.at < WORKER_COUNT_TTL_MS) return this.workerCountCache.value;
    const value = await this.queue.getWorkersCount().catch(() => null);
    this.workerCountCache = { value, at: now };
    return value;
  }

  // Live waiting/active snapshot used to compute each job's queue position. Waiting
  // jobs come back FIFO, so array index + 1 is the 1-based place in line.
  public async positions(): Promise<QueuePositions> {
    const now = Date.now();
    if (this.positionsCache && now - this.positionsCache.at < POSITIONS_TTL_MS) {
      return this.positionsCache.value;
    }
    const [waiting, activeCount, workerCount] = await Promise.all([
      this.queue.getWaiting(),
      this.queue.getActiveCount(),
      this.workerCount(),
    ]);
    const value: QueuePositions = {
      order: waiting.map((job) => String(job.id)),
      queueDepth: waiting.length,
      activeCount,
      workerCount,
    };
    this.positionsCache = { value, at: now };
    return value;
  }

  /** Waiting-job count only — the cheap pre-enqueue backlog check. */
  public async waitingCount(): Promise<number> {
    return this.queue.getWaitingCount();
  }

  // Authoritative BullMQ state of one job — drives recovery + initial pushes.
  public async getJobState(jobId: string): Promise<string> {
    return this.queue.getJobState(jobId);
  }

  // Liveness probe against the queue's own Redis connection — reused by /api/health
  // so the readiness check needs no second client. BullMQ's IRedisClient type omits
  // ping(); the concrete connection is ioredis, which has it.
  public async ping(): Promise<boolean> {
    const client = (await this.queue.client) as unknown as { ping(): Promise<string> };
    const reply = await client.ping();
    return reply === 'PONG';
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
