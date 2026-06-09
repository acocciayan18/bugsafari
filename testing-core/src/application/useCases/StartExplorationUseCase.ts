import type { BrowserEngine } from '../ports/BrowserEngine.js';
import type { TelemetryGateway } from '../ports/TelemetryGateway.js';
import type { FindingRepository } from '../../domain/repositories/FindingRepository.js';
import { setActiveEngine } from '../../presentation/socket/registerSocketHandlers.js';
import { savedSafariRepository } from '../../infrastructure/database/repositories/SavedSafariRepository.js';
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

/**
 * Non-bug types that should NOT be counted as bugs.
 * These are healthy system telemetry, not actual bugs.
 */
const NON_BUG_TYPES = new Set(['ACTION', 'HEURISTIC_SCORE']);

/**
 * Valid bug types that should be counted as bugs.
 */
const VALID_BUG_TYPES = new Set(['EXCEPTION', 'RUNTIME_UI_FREEZE', 'SESSION_SYNC_FAULT', 'NETWORK']);

/**
 * Filter out non-bug telemetry types.
 * Only EXCEPTION, RUNTIME_UI_FREEZE, SESSION_SYNC_FAULT, and NETWORK (status >= 400) are actual bugs.
 */
function isActualBug(bug: { type?: string; meta?: Record<string, unknown> }): boolean {
    const bugType = bug.type?.toUpperCase();

    // Always exclude non-bug types
    if (bugType && NON_BUG_TYPES.has(bugType)) {
        return false;
    }

    // For NETWORK type, check status code
    if (bugType === 'NETWORK') {
        const statusCode = bug.meta?.statusCode ?? bug.meta?.status;
        if (typeof statusCode === 'number') {
            return statusCode >= 400;
        }
        // If no status code found, assume it's an unhandled network error
        return true;
    }

    // Include only valid bug types
    return !!(bugType && VALID_BUG_TYPES.has(bugType));
}

export class StartExplorationUseCase {
    private currentUserId: string;

    constructor(
        private readonly browserEngine: BrowserEngine,
        private readonly telemetry: TelemetryGateway,
        private readonly state: RunState,
        private readonly findingRepository?: FindingRepository,
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

    /**
     * Manual save triggered by user clicking "Save to History" button.
     * Called externally via the API endpoint /api/history/save-session
     */
    public async manualSaveToHistory(
        targetUrl: string,
        userId: string,
    ): Promise<{ success: boolean; message: string }> {
        const { ReproductionPlaybookStore } = await import('../../infrastructure/monitoring/reproductionPlaybookStore.js');
        const actionRecords = ReproductionPlaybookStore.snapshot();
        const finalBreadcrumbSteps = this.buildBreadcrumbSteps(actionRecords);

        // Fetch only verified bugs from the engine's confirmed memory
        const realBugsFound = this.browserEngine.getConfirmedBugsFromMemory?.() ?? [];

        // Map categories cleanly using the isolated memory fields
        const breakdownCategories: Record<string, number> = {
            EXCEPTION: 0,
            NETWORK: 0,
            RUNTIME_UI_FREEZE: 0,
            SESSION_SYNC_FAULT: 0,
        };
        realBugsFound.forEach((bug: { type?: string }) => {
            if (bug.type && breakdownCategories[bug.type] !== undefined) {
                breakdownCategories[bug.type]++;
            }
        });

        // Transform confirmed bugs to caughtBugs format for MongoDB
        const caughtBugs = realBugsFound.map((bug: {
            bugId: string;
            type: string;
            message: string;
            selector: string;
            payloadUsed: string;
            advice: string;
            timestamp: Date;
        }) => ({
            bugId: bug.bugId,
            type: bug.type,
            message: bug.message,
            selector: bug.selector,
            payloadUsed: bug.payloadUsed,
            advice: bug.advice,
            timestamp: bug.timestamp,
        }));

        // Validate userId
        if (!userId || !isValidObjectId(userId)) {
            return { success: false, message: 'Invalid userId' };
        }

        try {
            const userObjectId = new Types.ObjectId(userId);
            const totalDuration = Date.now();

            const savedDocument = await savedSafariRepository.saveSafariRun({
                userId: userObjectId,
                targetUrl,
                executionDate: new Date(),
                timeElapsed: totalDuration,
                status: 'COMPLETED',
                metrics: {
                    totalActions: actionRecords.length,
                    totalBugsFound: realBugsFound.length,
                    bugsByCategory: breakdownCategories,
                },
                forensicTrace: {
                    finalBreadcrumbSteps,
                    caughtBugs,
                },
            });

            console.log(`[StartExplorationUseCase] ✓ Manual save: ${savedDocument._id} | Actions: ${actionRecords.length} | Bugs: ${realBugsFound.length}`);
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
