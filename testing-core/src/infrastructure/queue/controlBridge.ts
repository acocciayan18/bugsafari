import { Redis } from 'ioredis';
import type { StopReason } from '../../../../shared/types.js';

// Pub/sub channel carrying operator run-controls (pause/resume/stop) from the API
// process — which owns the browser-facing Socket.IO server — to the isolated
// worker process actually running Playwright. The reverse of the telemetry
// bridge: without it, dashboard control clicks hit an API-process SessionManager
// that holds no run and silently no-op.
export const CONTROL_BRIDGE_CHANNEL = 'safari:control';

export type OperatorCommand = 'pause' | 'resume' | 'stop';

interface ControlMessage {
  runToken: string | null; // scope to a specific run by its token; null => apply to the local active run
  command: OperatorCommand;
  reason?: StopReason;      // stop-only: why the stop was issued (operator vs timebox vs shutdown)
}

function redisClient(redisUrl: string): Redis {
  const client = new Redis(redisUrl, { maxRetriesPerRequest: null });
  // Attach an 'error' listener so a transient Redis blip never becomes an unhandled
  // EventEmitter 'error' that crashes the process. ioredis auto-reconnects.
  client.on('error', (err) => console.error('[ControlBridge] redis connection error:', err instanceof Error ? err.message : err));
  return client;
}

// API-side: publishes operator control commands to the worker fleet.
export class ControlBridgePublisher {
  private readonly pub: Redis;

  constructor(redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379') {
    this.pub = redisClient(redisUrl);
  }

  public publish(command: OperatorCommand, runToken: string | null, reason?: StopReason): void {
    const message: ControlMessage = { runToken, command, reason };
    void this.pub.publish(CONTROL_BRIDGE_CHANNEL, JSON.stringify(message)).catch((error) => {
      console.error('[ControlBridge] publish failed:', error instanceof Error ? error.message : error);
    });
  }

  public async close(): Promise<void> {
    await this.pub.quit();
  }
}

// Worker-side: re-applies each bridged command to the local run via the handler.
export class ControlBridgeSubscriber {
  private readonly sub: Redis;

  constructor(
    private readonly handler: (command: OperatorCommand, runToken: string | null, reason?: StopReason) => void,
    redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  ) {
    this.sub = redisClient(redisUrl);
  }

  public async start(): Promise<void> {
    await this.sub.subscribe(CONTROL_BRIDGE_CHANNEL);
    this.sub.on('message', (_channel, raw) => {
      try {
        const { runToken, command, reason } = JSON.parse(raw) as ControlMessage;
        this.handler(command, runToken, reason);
      } catch (error) {
        console.error('[ControlBridge] drop malformed command:', error instanceof Error ? error.message : error);
      }
    });
    console.log(`[ControlBridge] subscribed to ${CONTROL_BRIDGE_CHANNEL} — dashboard controls now reach worker runs.`);
  }

  public async close(): Promise<void> {
    await this.sub.quit();
  }
}
