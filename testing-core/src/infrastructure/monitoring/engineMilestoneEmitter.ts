import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import type { EngineMilestoneEvent } from '../../../../shared/types.ts';

export class EngineMilestoneEmitter {
  private lastEmittedAt = 0;

  constructor(private readonly hub: TelemetryGateway, private readonly throttleMs = 2000) {}

  emit(event: EngineMilestoneEvent, opts?: { force?: boolean }): void {
    const now = Date.now();
    if (!opts?.force && now - this.lastEmittedAt < this.throttleMs) {
      return;
    }

    this.lastEmittedAt = now;
    
    // Defensive check: verify the method exists before calling
    if (typeof this.hub.emitEngineMilestone === 'function') {
      this.hub.emitEngineMilestone(event);
    } else {
      console.warn('[EngineMilestoneEmitter] emitEngineMilestone method not found on hub');
    }
  }
}

