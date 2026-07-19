import { QueueEvents } from 'bullmq';
import type { Server } from 'socket.io';
import { QUEUE_UPDATE_EVENT, type QueueJobState, type QueueUpdate } from '../../../../shared/types.js';
import { SAFARI_TASK_QUEUE_NAME, resolveQueueConnection, type TaskQueue } from './TaskQueue.js';

// Room a client joins (keyed by jobId) to receive its own queue position pushes.
export function queueRoom(jobId: string): string {
  return `queue:${jobId}`;
}

/**
 * Bridges BullMQ QueueEvents onto Socket.IO: on every queue transition it
 * recomputes waiting positions and pushes a QueueUpdate to each job's room, so
 * the dashboard shows live "queued (position N)" and the moment a run goes active.
 */
export class QueueStatusBroadcaster {
  private readonly events: QueueEvents;

  constructor(
    private readonly io: Server,
    private readonly queue: TaskQueue,
    redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  ) {
    this.events = new QueueEvents(SAFARI_TASK_QUEUE_NAME, { connection: resolveQueueConnection(redisUrl) });
  }

  public async start(): Promise<void> {
    await this.events.waitUntilReady();
    this.events.on('waiting', () => void this.broadcastPositions());
    this.events.on('active', ({ jobId }) => void this.onLifecycle(jobId, 'active'));
    this.events.on('completed', ({ jobId }) => void this.onLifecycle(jobId, 'completed'));
    this.events.on('failed', ({ jobId, failedReason }) => void this.onLifecycle(jobId, 'failed', failedReason));
    console.log(`[QueueStatus] broadcasting position updates for queue=${SAFARI_TASK_QUEUE_NAME}`);
  }

  // Push the current position of a specific job to a freshly-subscribed socket —
  // so a client learns its place immediately instead of waiting for the next event.
  public async pushInitial(emit: (update: QueueUpdate) => void, jobId: string): Promise<void> {
    const { order, queueDepth, activeCount } = await this.queue.positions();
    const index = order.indexOf(jobId);
    if (index >= 0) {
      emit({ jobId, state: 'waiting', position: index + 1, queueDepth, activeCount });
      return;
    }
    // Not waiting: report the job's TRUE BullMQ state so a re-subscribed client
    // never treats a completed/failed job as active.
    const state = await this.queue.getJobState(jobId).catch(() => 'unknown');
    const mapped: QueueJobState = state === 'active' ? 'active' : state === 'failed' ? 'failed' : 'completed';
    emit({ jobId, state: mapped, position: null, queueDepth, activeCount });
  }

  // Operator cancelled a still-waiting job: BullMQ emits no event for a removed
  // job, so the cancel path publishes the terminal push itself — every tab
  // tracking that job leaves the queued state at once.
  public async broadcastCancelled(jobId: string, message = 'Queued session cancelled by the operator.'): Promise<void> {
    await this.onLifecycle(jobId, 'cancelled', message);
  }

  private async onLifecycle(jobId: string, state: QueueJobState, message?: string): Promise<void> {
    const { queueDepth, activeCount } = await this.queue.positions();
    this.emit(jobId, { jobId, state, position: null, queueDepth, activeCount, message });
    // A job leaving/entering the running set shifts everyone else's place in line.
    await this.broadcastPositions();
  }

  private async broadcastPositions(): Promise<void> {
    const { order, queueDepth, activeCount } = await this.queue.positions();
    order.forEach((jobId, index) => {
      this.emit(jobId, { jobId, state: 'waiting', position: index + 1, queueDepth, activeCount });
    });
  }

  private emit(jobId: string, update: QueueUpdate): void {
    this.io.to(queueRoom(jobId)).emit(QUEUE_UPDATE_EVENT, update);
  }

  public async close(): Promise<void> {
    await this.events.close();
  }
}
