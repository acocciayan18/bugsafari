import { Redis } from 'ioredis';

// Pub/sub channel carrying operator run-controls (pause/resume/stop) from the API
// process — which owns the browser-facing Socket.IO server — to the isolated
// worker process actually running Playwright. The reverse of the telemetry
// bridge: without it, dashboard control clicks hit an API-process SessionManager
// that holds no run and silently no-op.
export const CONTROL_BRIDGE_CHANNEL = 'safari:control';

export type OperatorCommand = 'pause' | 'resume' | 'stop';

interface ControlMessage {
  runId: string | null; // scope to a specific run; null => apply to the local active run
  command: OperatorCommand;
}

function redisClient(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

// API-side: publishes operator control commands to the worker fleet.
export class ControlBridgePublisher {
  private readonly pub: Redis;

  constructor(redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379') {
    this.pub = redisClient(redisUrl);
  }

  public publish(command: OperatorCommand, runId: string | null): void {
    const message: ControlMessage = { runId, command };
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
    private readonly handler: (command: OperatorCommand, runId: string | null) => void,
    redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  ) {
    this.sub = redisClient(redisUrl);
  }

  public async start(): Promise<void> {
    await this.sub.subscribe(CONTROL_BRIDGE_CHANNEL);
    this.sub.on('message', (_channel, raw) => {
      try {
        const { runId, command } = JSON.parse(raw) as ControlMessage;
        this.handler(command, runId);
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
