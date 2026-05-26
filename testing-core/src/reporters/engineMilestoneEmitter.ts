import type { TelemetryHub } from './socketServer.js';
import type { EngineMilestoneEvent } from '../../../shared/types.ts';

export class EngineMilestoneEmitter {
  private lastEmittedAt = 0;

  constructor(private readonly hub: TelemetryHub, private readonly throttleMs = 2000) {}

  emit(event: EngineMilestoneEvent, opts?: { force?: boolean }): void {
    const now = Date.now();
    if (!opts?.force && now - this.lastEmittedAt < this.throttleMs) {
      return;
    }

    this.lastEmittedAt = now;
    this.hub.emitEngineMilestone(event);
  }
}

