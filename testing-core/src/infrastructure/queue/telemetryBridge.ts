import { Redis } from 'ioredis';
import type { Server } from 'socket.io';
import type { RoomEmitter } from '../socket/SocketTelemetryGateway.js';

// Pub/sub channel carrying every worker-emitted telemetry frame to the API
// process, which owns the browser-facing Socket.IO server. Isolated worker
// processes stream live events to the dashboard without a Socket.IO adapter.
export const TELEMETRY_BRIDGE_CHANNEL = 'safari:telemetry';

interface BridgeMessage {
  room: string | null; // run:${runToken} room, or null for a legacy broadcast
  event: string;
  args: unknown[];
}

function redisClient(redisUrl: string): Redis {
  // maxRetriesPerRequest:null keeps the connection resilient like the worker's.
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

/** Worker-side RoomEmitter: every gateway emit is published to Redis instead of
 *  a dead process-local Socket.IO server. Room scoping is preserved verbatim. */
export class RedisTelemetryPublisher implements RoomEmitter {
  private readonly pub: Redis;

  constructor(redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379') {
    this.pub = redisClient(redisUrl);
  }

  public emit(event: string, ...args: unknown[]): boolean {
    this.publish(null, event, args);
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

  private publish(room: string | null, event: string, args: unknown[]): void {
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
 *  scoped to the same run room the worker wrote to (or broadcast when null). */
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
        const target = room ? this.io.to(room) : this.io;
        target.emit(event, ...args);
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
