import type { BrowserEngine } from '../ports/BrowserEngine.js';
import type { TelemetryGateway } from '../ports/TelemetryGateway.js';

interface RunState {
  active: boolean;
}

export class StartExplorationUseCase {
  constructor(
    private readonly browserEngine: BrowserEngine,
    private readonly telemetry: TelemetryGateway,
    private readonly state: RunState,
  ) {}

  public isActive(): boolean {
    return this.state.active;
  }

  public async execute(targetUrl: string): Promise<void> {
    // Reset persistent reproduction store at the beginning of each Safari run.
    const { ReproductionPlaybookStore } = await import('../../reporters/reproductionPlaybookStore.js');
    ReproductionPlaybookStore.reset();

    this.state.active = true;

    this.telemetry.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'ACTION',
      meta: {
        actionExecuted: 'engine-started',
        url: targetUrl,
        message: `Launching Playwright headless session for ${targetUrl}`,
      },
    });

    const { EngineMilestoneEmitter } = await import('../../reporters/engineMilestoneEmitter.js');
    const { makeMilestone } = await import('../../reporters/engineMilestones.js');
    const milestoneEmitter = new EngineMilestoneEmitter(this.telemetry as any);

    try {
      const result = await this.browserEngine.run(targetUrl, this.telemetry);

      this.telemetry.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: result.completed ? 'ACTION' : 'EXCEPTION',
        meta: {
          actionExecuted: result.completed ? 'engine-finished' : 'engine-halted',
          url: targetUrl,
          message: result.reason,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack ?? message : message;

      // Emergency flush: attach the last 20 actions captured so far.
      const { ReproductionPlaybookStore } = await import('../../reporters/reproductionPlaybookStore.js');
      const lastActions = ReproductionPlaybookStore.snapshot();

      this.telemetry.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'EXCEPTION',
        meta: {
          message: `Fatal engine error: ${message}`,
          exceptionDetails: { message, stackTrace },
        },
      });

      // Emit fatal milestone for UI red state.
      milestoneEmitter.emit(
        makeMilestone('FATAL_ENGINE_ERROR', {
          status: 'error',
          title: 'Fatal Engine Error',
          message: `Fatal engine error: ${message}`,
        }),
        { force: true },
      );

      this.telemetry.emitForensicReport({
        timestamp: new Date().toISOString(),
        reason: `Fatal engine error: ${message}`,
        url: targetUrl,
        stackTrace,
        breadcrumbs: lastActions.map((a) => ({
          timestamp: a.timestamp,
          selector: a.selector,
          action: a.type,
          payload: a.payload,
          score: undefined,
        })),
      });
    } finally {
      this.state.active = false;
    }
  }
}

