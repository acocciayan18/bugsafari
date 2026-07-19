import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { TestingTypeId } from '../../../../shared/types.js';

export const SAFARI_TASK_QUEUE_NAME = 'safari-tasks';

export function resolveQueueConnection(redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'): ConnectionOptions {
  return { url: redisUrl };
}

export interface SafariTaskPayload {
  targetUrl: string;
  requestedBy?: string;
  // Server-issued run token: the worker binds its telemetry room to run:${runId}
  // and the client subscribes to the same id, so bridged live events line up.
  runId: string;
  sessionId?: string;
  // Resolved infiltration-profile scenario gate — carried so the worker runs the
  // selected testing types instead of defaulting to all of them.
  selectedScenarios?: TestingTypeId[];
  createdAt: string;
}

export interface EnqueueSafariTaskInput {
  targetUrl: string;
  requestedBy?: string;
  runId?: string;
  selectedScenarios?: TestingTypeId[];
}

export interface EnqueuedSafariTask {
  id: string;
  queueName: string;
  targetUrl: string;
  runId: string;
}

const defaultJobOptions: JobsOptions = {
  attempts: 2,
  backoff: {
    type: 'exponential',
    delay: 5_000,
  },
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

    const runId = input.runId ?? randomUUID();
    const job = await this.queue.add('run-safari', {
      targetUrl,
      requestedBy: input.requestedBy,
      runId,
      selectedScenarios: input.selectedScenarios,
      createdAt: new Date().toISOString(),
    });

    return {
      id: String(job.id),
      queueName: SAFARI_TASK_QUEUE_NAME,
      targetUrl,
      runId,
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

  public async close(): Promise<void> {
    await this.queue.close();
  }
}
