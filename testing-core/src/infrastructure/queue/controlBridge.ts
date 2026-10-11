import { Redis } from 'ioredis';
import type { StopReason } from '../../../../shared/types.js';

import { resolveRedisUrl } from '../../config/env.js';
import { createRedisConnection } from './redisConnection.js';
import { createLogger } from '../observability/logger.js';

const obsLog = createLogger('[ControlBridge]');

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

// API-side: publishes operator control commands to the worker fleet.
export class ControlBridgePublisher {
  private readonly pub: Redis;

  constructor(redisUrl = resolveRedisUrl()) {
    this.pub = createRedisConnection('[ControlBridge]', redisUrl);
  }

  public publish(command: OperatorCommand, runToken: string | null, reason?: StopReason): void {
    const message: ControlMessage = { runToken, command, reason };
    void this.pub.publish(CONTROL_BRIDGE_CHANNEL, JSON.stringify(message)).catch((error) => {
      obsLog.error('[ControlBridge] publish failed:', error instanceof Error ? error.message : error);
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
    redisUrl = resolveRedisUrl(),
  ) {
    this.sub = createRedisConnection('[ControlBridge]', redisUrl);
  }

  public async start(): Promise<void> {
    await this.sub.subscribe(CONTROL_BRIDGE_CHANNEL);
    this.sub.on('message', (_channel, raw) => {
      try {
        const { runToken, command, reason } = JSON.parse(raw) as ControlMessage;
        this.handler(command, runToken, reason);
      } catch (error) {
        obsLog.error('[ControlBridge] drop malformed command:', error instanceof Error ? error.message : error);
      }
    });
    obsLog.info(`[ControlBridge] subscribed to ${CONTROL_BRIDGE_CHANNEL} — dashboard controls now reach worker runs.`);
  }

  public async close(): Promise<void> {
    await this.sub.quit();
  }
}
