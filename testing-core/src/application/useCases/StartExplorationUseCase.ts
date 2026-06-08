import type { BrowserEngine } from '../ports/BrowserEngine.js';
import type { TelemetryGateway } from '../ports/TelemetryGateway.js';
import { setActiveEngine } from '../../presentation/socket/registerSocketHandlers.js';
import { savedSafariRepository } from '../../infrastructure/database/repositories/SavedSafariRepository.js';
import { FindingModel } from '../../infrastructure/database/models/FindingModel.js';
import type { ActionRecord } from '../../../../shared/types.js';
import { Types, isValidObjectId } from 'mongoose';

interface RunState {
  active: boolean;
}

interface ExecutionMetrics {
  totalActions: number;
  totalBugsFound: number;
  bugsByCategory: Record<string, number>;
}

export class StartExplorationUseCase {
  private currentUserId: string;

  constructor(
    private readonly browserEngine: BrowserEngine,
    private readonly telemetry: TelemetryGateway,
    private readonly state: RunState,
    userId: string = '000000000000000000000000',
  ) {
    this.currentUserId = userId;
  }

  public isActive(): boolean {
    return this.state.active;
  }

  /**
   * Set the authenticated userId for the current exploration session.
   * This should be called before execute() when the user is authenticated.
   */
  public setUserId(userId: string): void {
    if (userId && isValidObjectId(userId)) {
      this.currentUserId = userId;
      console.log(`[StartExplorationUseCase] UserId set to: ${userId}`);
    } else {
      console.warn(`[StartExplorationUseCase] Invalid userId provided: ${userId}, keeping previous: ${this.currentUserId}`);
    }
  }

  /**
   * Get the current userId for this exploration session.
   * Returns the authenticated userId if set, otherwise the default.
   */
  public getUserId(): string {
    return this.currentUserId;
  }

  private buildBreadcrumbSteps(records: ActionRecord[]): string[] {
    return records.map((record, index) => {
      const target = record.fallbackLabel ? `${record.selector} (${record.fallbackLabel})` : record.selector;
      const payloadPart = record.payload ? ` with payload "${record.payload.slice(0, 80)}"` : '';
      return `Step ${index + 1}: ${record.type} ${target} at ${record.url}${payloadPart}`;
    });
  }

  private aggregateBugsByCategory(bugs: Array<{ type?: string }>): Record<string, number> {
    const categoryMap: Record<string, number> = {};
    for (const bug of bugs) {
      const category = bug.type || 'UNKNOWN';
      categoryMap[category] = (categoryMap[category] || 0) + 1;
    }
    return categoryMap;
  }

  /**
   * Collects bug findings from the FindingModel for the most recent session
   * associated with the target URL.
   */
  private async collectBugFindings(targetUrl: string): Promise<Array<{
    bugId: string;
    type: string;
    message: string;
    selector: string;
    payloadUsed: string;
    advice: string;
    timestamp: Date;
  }>> {
    try {
      // Import SessionModel lazily to avoid circular dependencies
      const { SessionModel } = await import('../../infrastructure/database/models/SessionModel.js');
      
      // Find the most recent session for this target URL
      const session = await SessionModel.findOne({ targetUrl })
        .sort({ startedAt: -1 })
        .lean()
        .exec();

      if (!session || !session._id) {
        console.log('[StartExplorationUseCase] No session found for target URL');
        return [];
      }

      // Query findings for this session
      const findings = await FindingModel.find({ sessionId: session._id })
        .lean()
        .exec();

      if (findings.length === 0) {
        console.log('[StartExplorationUseCase] No findings for session:', session._id);
        return [];
      }

      // Transform findings to the caughtBugs format
      const caughtBugs = findings.map((finding) => ({
        bugId: finding._id?.toString() || new Types.ObjectId().toString(),
        type: String(finding.type || 'UNKNOWN'),
        message: String(finding.meta?.message || JSON.stringify(finding.meta || {})),
        selector: String(finding.meta?.selector || ''),
        payloadUsed: String(finding.meta?.payloadUsed || ''),
        advice: String(finding.meta?.advice || 'Review and remediate based on findings.'),
        timestamp: finding.timestamp || new Date(),
      }));

      console.log('[StartExplorationUseCase] Collected', caughtBugs.length, 'bug findings');
      return caughtBugs;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[StartExplorationUseCase] Error collecting bug findings:', errorMessage);
      return [];
    }
  }

/**
   * Manual save triggered by user clicking "Save to History" button.
   * Called externally via the API endpoint /api/history/save-session
   */
  public async manualSaveToHistory(
    targetUrl: string,
    userId: string,
  ): Promise<{ success: boolean; message: string }> {
    const { ReproductionPlaybookStore } = await import('../../infrastructure/monitoring/reproductionPlaybookStore.js');
    const breadcrumbRecords = ReproductionPlaybookStore.snapshot();
    const finalBreadcrumbSteps = this.buildBreadcrumbSteps(breadcrumbRecords);

    // Collect actual bug findings from the FindingModel for this session
    const caughtBugs = await this.collectBugFindings(targetUrl);

    // Calculate metrics
    const timeElapsed = Date.now() - Date.now(); // Will be set properly by caller
    const bugsByCategory = this.aggregateBugsByCategory(caughtBugs);
    const totalBugsFound = caughtBugs.length;

    // Validate userId
    if (!userId || !isValidObjectId(userId)) {
      return { success: false, message: 'Invalid userId' };
    }

    try {
      const userObjectId = new Types.ObjectId(userId);
      
      const savedDocument = await savedSafariRepository.saveSafariRun({
        userId: userObjectId,
        targetUrl,
        executionDate: new Date(),
        timeElapsed,
        status: 'COMPLETED',
        metrics: {
          totalActions: breadcrumbRecords.length,
          totalBugsFound,
          bugsByCategory,
        },
        forensicTrace: {
          finalBreadcrumbSteps,
          caughtBugs,
        },
      });

      console.log(`[StartExplorationUseCase] ✓ Manual save: ${savedDocument._id} | Actions: ${breadcrumbRecords.length} | Bugs: ${totalBugsFound}`);
      return { success: true, message: `Saved as ${savedDocument._id}` };
    } catch (persistError) {
      const errorMessage = persistError instanceof Error ? persistError.message : String(persistError);
      console.error(`[StartExplorationUseCase] ✗ Manual save failed: ${errorMessage}`);
      return { success: false, message: errorMessage };
    }
  }

  public async execute(targetUrl: string): Promise<void> {
    const { ReproductionPlaybookStore } = await import('../../infrastructure/monitoring/reproductionPlaybookStore.js');
    ReproductionPlaybookStore.reset();

    const executionStartTime = new Date();
    let executionStatus: 'COMPLETED' | 'CRASHED' | 'HALTED' = 'COMPLETED';
    const metrics: ExecutionMetrics = {
      totalActions: 0,
      totalBugsFound: 0,
      bugsByCategory: {},
    };

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

    try {
      const result = await this.browserEngine.run(targetUrl, this.telemetry);

      executionStatus = result.completed ? 'COMPLETED' : 'HALTED';

      // Collect metrics from the reproduction playbook store (actions executed)
      const actionRecords = ReproductionPlaybookStore.snapshot();
      metrics.totalActions = actionRecords.length;
      // Note: Bug count would be collected from the finding repository in a full implementation

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
      executionStatus = 'CRASHED';
      const message = error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack ?? message : message;

      const lastActions = ReproductionPlaybookStore.snapshot();
      metrics.totalActions = lastActions.length;

      this.telemetry.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'EXCEPTION',
        meta: {
          message: `Fatal engine error: ${message}`,
          exceptionDetails: { message, stackTrace },
        },
      });

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
      setActiveEngine(null);
      // Auto-save removed - user must manually click "Save to History" button
    }
  }
}
