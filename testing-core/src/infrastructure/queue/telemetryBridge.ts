import { Redis } from 'ioredis';
import type { Server } from 'socket.io';
import type { RoomEmitter } from '../socket/SocketTelemetryGateway.js';

import { resolveRedisUrl } from '../../config/env.js';
import { createRedisConnection, waitForRedisReady } from './redisConnection.js';
import { createLogger } from '../observability/logger.js';

const obsLog = createLogger('[TelemetryBridge]');

// Pub/sub channel carrying every worker-emitted telemetry frame to the API
// process, which owns the browser-facing Socket.IO server. Isolated worker
// processes stream live events to the dashboard without a Socket.IO adapter.
export const TELEMETRY_BRIDGE_CHANNEL = 'safari:telemetry';

// Bytes buffered in the publisher socket above which the screencast is told to back
// off — a stalled subscriber lets frames pile into this write queue and grow the heap.
const BACKPRESSURE_WRITE_BYTES = 8 * 1024 * 1024;

interface BridgeMessage {
  room: string; // always run:${runToken} — an unrouted worker emit is never bridged
  event: string;
  args: unknown[];
}

/** Worker-side RoomEmitter: every gateway emit is published to Redis instead of
 *  a dead process-local Socket.IO server. Room scoping is preserved verbatim. */
export class RedisTelemetryPublisher implements RoomEmitter {
  private readonly pub: Redis;
  private droppedUnrouted = 0;

  constructor(redisUrl = resolveRedisUrl()) {
    this.pub = createRedisConnection('[TelemetryBridge]', redisUrl);
  }

  /**
   * Unrouted emit — the gateway holds no room, which happens only outside a run
   * (before reserve, after teardown). A worker has no legitimate fleet-wide
   * audience: bridging this would re-emit one run's frame to EVERY connected
   * dashboard, so a late settling emit from a finished run would land in another
   * operator's live session. Dropped, not broadcast.
   */
  public emit(event: string, ..._args: unknown[]): boolean {
    this.droppedUnrouted += 1;
    // Rate-limited: a stuck producer must not flood the log with one line per frame.
    if (this.droppedUnrouted === 1 || this.droppedUnrouted % 100 === 0) {
      obsLog.warn(`[TelemetryBridge] dropped unrouted emit '${event}' (no run room bound; ${this.droppedUnrouted} total)`);
    }
    return true;
  }

  public to(room: string): { emit(event: string, ...args: unknown[]): boolean } {
    return {
      emit: (event: string, ...args: unknown[]): boolean => {
        this.publish(room, event, args);
        return true;
      },
    };
  }

  private publish(room: string, event: string, args: unknown[]): void {
    const message: BridgeMessage = { room, event, args };
    void this.pub.publish(TELEMETRY_BRIDGE_CHANNEL, JSON.stringify(message)).catch((error) => {
      obsLog.error('[TelemetryBridge] publish failed:', error instanceof Error ? error.message : error);
    });
  }

  // Congested when the ioredis socket's unflushed write buffer exceeds the threshold —
  // the screencast reads this to throttle capture to the drain rate. Best-effort; any
  // access failure degrades to "not backpressured".
  public backpressured(): boolean {
    try {
      const stream = (this.pub as unknown as { stream?: { writableLength?: number } }).stream;
      return (stream?.writableLength ?? 0) > BACKPRESSURE_WRITE_BYTES;
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    await this.pub.quit();
  }
}

/** API-side subscriber: re-emits each bridged frame into the browser-facing io,
 *  always scoped to the run room the worker wrote to — never a broadcast, so
 *  concurrent runs on different replicas cannot bleed into each other's rooms. */
export class TelemetryBridgeSubscriber {
  private readonly sub: Redis;

  constructor(private readonly io: Server, private readonly redisUrl = resolveRedisUrl()) {
    this.sub = createRedisConnection('[TelemetryBridge]', redisUrl);
  }

  public async start(): Promise<void> {
    // Fail fast if Redis is unreachable. subscribe() queues on the offline buffer and
    // never settles while Redis is down, which would hang API boot (the server never
    // starts listening). Bound the wait so a missing Redis surfaces as an actionable
    // error instead of a silent hang; in prod the orchestrator restarts a clean process.
    await waitForRedisReady(this.sub, this.redisUrl);
    await this.sub.subscribe(TELEMETRY_BRIDGE_CHANNEL);
    this.sub.on('message', (_channel, raw) => {
      try {
        const { room, event, args } = JSON.parse(raw) as BridgeMessage;
        // Defensive: an older worker build could still publish room:null. Drop it
        // rather than fanning one run's telemetry out to every dashboard.
        if (typeof room !== 'string' || !room) {
          obsLog.warn(`[TelemetryBridge] dropped unrouted frame '${event}' from the fleet.`);
          return;
        }
        this.io.to(room).emit(event, ...args);
      } catch (error) {
        obsLog.error('[TelemetryBridge] drop malformed frame:', error instanceof Error ? error.message : error);
      }
    });
    obsLog.info(`[TelemetryBridge] subscribed to ${TELEMETRY_BRIDGE_CHANNEL} — worker telemetry now reaches the dashboard.`);
  }

  public async close(): Promise<void> {
    await this.sub.quit();
  }
}
