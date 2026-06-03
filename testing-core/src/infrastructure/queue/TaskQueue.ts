import { Queue, type JobsOptions } from 'bullmq';

export const SAFARI_TASK_QUEUE_NAME = 'safari-tasks';

export interface SafariTaskPayload {
  targetUrl: string;
  requestedBy?: string;
  sessionId?: string;
  createdAt: string;
}

export interface EnqueueSafariTaskInput {
  targetUrl: string;
  requestedBy?: string;
  sessionId?: string;
}

export interface EnqueuedSafariTask {
  id: string;
  queueName: string;
  targetUrl: string;
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
      connection: {
        url: redisUrl,
      },
      defaultJobOptions,
    });
  }

  public async addSafariTask(input: EnqueueSafariTaskInput): Promise<EnqueuedSafariTask> {
    const targetUrl = input.targetUrl.trim();

    if (!targetUrl) {
      throw new Error('Cannot enqueue a Safari task without a target URL.');
    }

    const job = await this.queue.add('run-safari', {
      targetUrl,
      requestedBy: input.requestedBy,
      sessionId: input.sessionId,
      createdAt: new Date().toISOString(),
    });

    return {
      id: String(job.id),
      queueName: SAFARI_TASK_QUEUE_NAME,
      targetUrl,
    };
  }

  public async close(): Promise<void> {
    await this.queue.close();
  }
}
