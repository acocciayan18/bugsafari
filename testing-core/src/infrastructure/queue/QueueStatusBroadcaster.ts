import { QueueEvents } from 'bullmq';
import type { Server } from 'socket.io';
import { QUEUE_UPDATE_EVENT, type QueueJobState, type QueueUpdate } from '../../../../shared/types.js';
import { SAFARI_TASK_QUEUE_NAME, resolveQueueConnection, type QueuePositions, type TaskQueue } from './TaskQueue.js';

// Room a client joins (keyed by jobId) to receive its own queue position pushes.
export function queueRoom(jobId: string): string {
  return `queue:${jobId}`;
}

// Backstop resync. QueueEvents is Redis pub/sub: a reconnect or a dropped frame
// silently strands every waiting client on a position that never advances again.
// Re-deriving from the authoritative waiting list on a timer bounds that staleness
// without changing the event-driven path that normally delivers the update.
const RESYNC_INTERVAL_MS = 10_000;

/** One `waiting` update per queued job, positions 1-based in BullMQ's FIFO order. */
export function waitingUpdates(positions: QueuePositions): QueueUpdate[] {
  const { order, queueDepth, activeCount, workerCount } = positions;
  return order.map((jobId, index) => ({
    jobId,
    state: 'waiting' as const,
    position: index + 1,
    queueDepth,
    activeCount,
    workerCount,
  }));
}

/**
 * Collapse a raw BullMQ state onto the client contract for a job that is NOT in
 * the waiting list. Anything not explicitly active or failed is terminal — a
 * re-subscribed client must never render a finished job as still running.
 */
export function mapSettledState(state: string): QueueJobState {
  if (state === 'active') return 'active';
  if (state === 'failed') return 'failed';
  return 'completed';
}

/**
 * Bridges BullMQ QueueEvents onto Socket.IO: on every queue transition it
 * recomputes waiting positions and pushes a QueueUpdate to each job's room, so
 * the dashboard shows live "queued (position N)" and the moment a run goes active.
 */
export class QueueStatusBroadcaster {
  private readonly events: QueueEvents;
  private resyncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly io: Server,
    private readonly queue: TaskQueue,
    redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  ) {
    this.events = new QueueEvents(SAFARI_TASK_QUEUE_NAME, { connection: resolveQueueConnection(redisUrl) });
    // QueueEvents emits 'error' on a Redis blip; an unhandled EventEmitter 'error'
    // crashes the api process. Log-and-continue — it reconnects on its own.
    this.events.on('error', (err) => console.error('[QueueStatus] queue-events redis error:', err instanceof Error ? err.message : err));
  }

  public async start(): Promise<void> {
    await this.events.waitUntilReady();
    this.events.on('waiting', () => void this.broadcastPositions());
    this.events.on('active', ({ jobId }) => void this.onLifecycle(jobId, 'active'));
    this.events.on('completed', ({ jobId }) => void this.onLifecycle(jobId, 'completed'));
    this.events.on('failed', ({ jobId, failedReason }) => void this.onLifecycle(jobId, 'failed', failedReason));
    // Emits nothing when the queue is empty — the waiting list drives the fan-out.
    this.resyncTimer = setInterval(() => {
      void this.broadcastPositions().catch((error: unknown) =>
        console.error('[QueueStatus] resync failed:', error instanceof Error ? error.message : error));
    }, RESYNC_INTERVAL_MS);
    this.resyncTimer.unref();
    console.log(`[QueueStatus] broadcasting position updates for queue=${SAFARI_TASK_QUEUE_NAME} (resync every ${RESYNC_INTERVAL_MS / 1000}s)`);
  }

  // Push the current position of a specific job to a freshly-subscribed socket —
  // so a client learns its place immediately instead of waiting for the next event.
  public async pushInitial(emit: (update: QueueUpdate) => void, jobId: string): Promise<void> {
    const positions = await this.queue.positions();
    const mine = waitingUpdates(positions).find((update) => update.jobId === jobId);
    if (mine) {
      emit(mine);
      return;
    }
    // Not waiting: report the job's TRUE BullMQ state so a re-subscribed client
    // never treats a completed/failed job as active.
    const state = await this.queue.getJobState(jobId).catch(() => 'unknown');
    const { queueDepth, activeCount, workerCount } = positions;
    emit({ jobId, state: mapSettledState(state), position: null, queueDepth, activeCount, workerCount });
  }

  // Operator cancelled a still-waiting job: BullMQ emits no event for a removed
  // job, so the cancel path publishes the terminal push itself — every tab
  // tracking that job leaves the queued state at once.
  public async broadcastCancelled(jobId: string, message = 'Queued session cancelled by the operator.'): Promise<void> {
    await this.onLifecycle(jobId, 'cancelled', message);
  }

  private async onLifecycle(jobId: string, state: QueueJobState, message?: string): Promise<void> {
    // Compute positions ONCE and reuse it for both the job's own push and the
    // shift-everyone-else fan-out — the old code fetched the waiting list twice.
    const positions = await this.queue.positions();
    const { queueDepth, activeCount, workerCount } = positions;
    this.emit(jobId, { jobId, state, position: null, queueDepth, activeCount, workerCount, message });
    // A job leaving/entering the running set shifts everyone else's place in line.
    await this.broadcastPositions(positions);
  }

  private async broadcastPositions(positions?: QueuePositions): Promise<void> {
    const resolved = positions ?? await this.queue.positions();
    for (const update of waitingUpdates(resolved)) {
      this.emit(update.jobId, update);
    }
  }

  private emit(jobId: string, update: QueueUpdate): void {
    this.io.to(queueRoom(jobId)).emit(QUEUE_UPDATE_EVENT, update);
  }

  public async close(): Promise<void> {
    if (this.resyncTimer) {
      clearInterval(this.resyncTimer);
      this.resyncTimer = null;
    }
    await this.events.close();
  }
}
