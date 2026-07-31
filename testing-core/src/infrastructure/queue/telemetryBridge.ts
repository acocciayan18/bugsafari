import { Redis } from 'ioredis';
import type { Server } from 'socket.io';
import type { RoomEmitter } from '../socket/SocketTelemetryGateway.js';

// Pub/sub channel carrying every worker-emitted telemetry frame to the API
// process, which owns the browser-facing Socket.IO server. Isolated worker
// processes stream live events to the dashboard without a Socket.IO adapter.
export const TELEMETRY_BRIDGE_CHANNEL = 'safari:telemetry';

interface BridgeMessage {
  room: string; // always run:${runToken} — an unrouted worker emit is never bridged
  event: string;
  args: unknown[];
}

function redisClient(redisUrl: string): Redis {
  // maxRetriesPerRequest:null keeps the connection resilient like the worker's.
  const client = new Redis(redisUrl, { maxRetriesPerRequest: null });
  // MUST attach an 'error' listener: an ioredis client emits 'error' on every
  // transient blip (reconnect, ECONNRESET), and an EventEmitter 'error' with no
  // listener throws → uncaught exception → the api process exits (ECONNREFUSED for
  // every proxied request until it restarts). ioredis auto-reconnects, so log-and-continue.
  client.on('error', (err) => console.error('[TelemetryBridge] redis connection error:', err instanceof Error ? err.message : err));
  return client;
}

/** Worker-side RoomEmitter: every gateway emit is published to Redis instead of
 *  a dead process-local Socket.IO server. Room scoping is preserved verbatim. */
export class RedisTelemetryPublisher implements RoomEmitter {
  private readonly pub: Redis;
  private droppedUnrouted = 0;

  constructor(redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379') {
    this.pub = redisClient(redisUrl);
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
      console.warn(`[TelemetryBridge] dropped unrouted emit '${event}' (no run room bound; ${this.droppedUnrouted} total)`);
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
      console.error('[TelemetryBridge] publish failed:', error instanceof Error ? error.message : error);
    });
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

  constructor(private readonly io: Server, redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379') {
    this.sub = redisClient(redisUrl);
  }

  public async start(): Promise<void> {
    await this.sub.subscribe(TELEMETRY_BRIDGE_CHANNEL);
    this.sub.on('message', (_channel, raw) => {
      try {
        const { room, event, args } = JSON.parse(raw) as BridgeMessage;
        // Defensive: an older worker build could still publish room:null. Drop it
        // rather than fanning one run's telemetry out to every dashboard.
        if (typeof room !== 'string' || !room) {
          console.warn(`[TelemetryBridge] dropped unrouted frame '${event}' from the fleet.`);
          return;
        }
        this.io.to(room).emit(event, ...args);
      } catch (error) {
        console.error('[TelemetryBridge] drop malformed frame:', error instanceof Error ? error.message : error);
      }
    });
    console.log(`[TelemetryBridge] subscribed to ${TELEMETRY_BRIDGE_CHANNEL} — worker telemetry now reaches the dashboard.`);
  }

  public async close(): Promise<void> {
    await this.sub.quit();
  }
}
