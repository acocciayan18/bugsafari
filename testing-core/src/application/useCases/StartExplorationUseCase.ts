import type { BrowserEngine } from '../ports/BrowserEngine.js';
import type { TelemetryGateway } from '../ports/TelemetryGateway.js';
import { setActiveEngine } from '../../presentation/socket/registerSocketHandlers.js'; // 👈 Import the setter

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
    const { ReproductionPlaybookStore } = await import('../../infrastructure/monitoring/reproductionPlaybookStore.js');
    ReproductionPlaybookStore.reset();

    this.state.active = true;
    
    // Register the active engine so sockets can control it
    setActiveEngine(this.browserEngine); 

    this.telemetry.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'ACTION',
      meta: {
        actionExecuted: 'engine-started',
        url: targetUrl,
        message: `Launching Playwright headless session for ${targetUrl}`,
      },
    });

    const { EngineMilestoneEmitter } = await import('../../infrastructure/monitoring/engineMilestoneEmitter.js');
    const { makeMilestone } = await import('../../infrastructure/monitoring/engineMilestones.js');
    const milestoneEmitter = new EngineMilestoneEmitter(this.telemetry);

    try {
      const result = await this.browserEngine.run(targetUrl, this.telemetry);

      this.telemetry.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: result.completed ? 'ACTION' : 'EXCEPTION',
        meta: {
          actionExecuted: 'engine-stopped',
          url: targetUrl,
          message: result.reason,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack ?? message : message;

      const lastActions = ReproductionPlaybookStore.snapshot();

      this.telemetry.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'EXCEPTION',
        meta: {
          message: `Fatal engine error: ${message}`,
          exceptionDetails: { message, stackTrace },
        },
      });

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
      setActiveEngine(null); // 👈 Clear the reference so it doesn't leak memory
    }
  }
}
