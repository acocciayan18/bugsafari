import type { BrowserEngine } from '../ports/BrowserEngine.js';
import type { TelemetryGateway } from '../ports/TelemetryGateway.js';
import type { OptimizationSettings, TestingTypeId } from '../../../../shared/types.js';
import type { FindingRepository } from '../../domain/repositories/FindingRepository.js';
import { setActiveEngine } from '../../presentation/socket/registerSocketHandlers.js';
import type { ActionRecord, FindingAttribution } from '../../../../shared/types.js';
import { Types, isValidObjectId } from 'mongoose';
import { SessionModel } from '../../infrastructure/database/models/SessionModel.js';
import type { ActionStepTrace } from '../../infrastructure/database/models/SessionModel.js';
import { SessionStatus } from '../../infrastructure/database/models/FindingType.js';

interface RunState {
    active: boolean;
}

/**
 * A finding transferred verbatim from the live dashboard Error Tab at save time.
 * This is the uncompromised, raw representation of what the operator saw live —
 * persisted without dedup, filtering, or truncation to guarantee history parity.
 */
export interface ClientFinding {
    bugId?: string;
    type?: string;
    message?: string;
    selector?: string;
    payloadUsed?: string;
    advice?: string;
    stackTrace?: string;
    reproductionSteps?: string[];
    timestamp?: string;
    attribution?: FindingAttribution;
}

interface ExecutionMetrics {
    totalActions: number;
    totalBugsFound: number;
    bugsByCategory: Record<string, number>;
}

export class StartExplorationUseCase {
    private currentUserId: string | null;
    private currentSessionId: string | null = null;
    private executionStartTime: number = 0;
    private optimizationSettings: OptimizationSettings | undefined;

    constructor(
        private readonly browserEngine: BrowserEngine,
        private readonly telemetry: TelemetryGateway,
        private readonly state: RunState,
        private readonly findingRepository?: FindingRepository,
        userId?: string,
    ) {
        this.currentUserId = userId && isValidObjectId(userId) ? userId : null;
    }

    public isActive(): boolean {
        return this.state.active;
    }

    /**
     * Set the authenticated userId for the current exploration session.
     * This should be called before execute() when the user is authenticated.
     */
    public setUserId(userId: string | null | undefined): void {
        if (userId && isValidObjectId(userId)) {
            this.currentUserId = userId;
            console.log(`[StartExplorationUseCase] UserId set to: ${userId}`);
        } else {
            // Clear to null (guest / unauthenticated) — prevents a singleton use case
            // from leaking the previous authenticated user's id into a later guest run.
            this.currentUserId = null;
            console.log(`[StartExplorationUseCase] UserId cleared (guest/unauthenticated)`);
        }
    }

    /**
     * Get the current userId for this exploration session.
     * Returns the authenticated userId if set, otherwise null for guests.
     */
    public getUserId(): string | null {
        return this.currentUserId;
    }

    private buildBreadcrumbSteps(records: ActionRecord[]): string[] {
        return records.map((record, index) => {
            const target = record.fallbackLabel ? `${record.selector} (${record.fallbackLabel})` : record.selector;
            const payloadPart = record.payload ? ` with payload "${record.payload.slice(0, 80)}"` : '';
            return `Step ${index + 1}: ${record.type} ${target} at ${record.url}${payloadPart}`;
        });
    }

    private mapActionType(type: ActionRecord['type']): ActionStepTrace['actionType'] {
        switch (type) {
            case 'CLICK':      return 'click';
            case 'INPUT':      return 'input';
            case 'TYPE':       return 'input';
            case 'NAVIGATION': return 'navigation';
            case 'NAVIGATE':   return 'navigation';
            case 'SUBMIT':     return 'bypass';
            case 'HOVER':      return 'click';
            default: {
                const _exhaustive: never = type;
                void _exhaustive;
                return 'click';
            }
        }
    }

    private buildActionSteps(records: ActionRecord[]): ActionStepTrace[] {
        return records.map((record, index) => ({
            stepNumber:         index + 1,
            timestamp:          record.timestamp,
            actionType:         this.mapActionType(record.type),
            selector:           record.selector ?? '',
            payloadText:        record.payload,
            resultingStateHash: '',
        }));
    }

/**
     * Manual save triggered by user clicking "Save to History" button.
     * Called externally via the API endpoint /api/history/save-session.
     * This is the ONLY path that writes a session document to MongoDB.
     * @param targetUrl - The URL that was tested
     * @param userId - The authenticated user ID
     * @param options - Optional parameters including ownerType and elapsedTimeMs from the frontend
     */
    public async manualSaveToHistory(
        targetUrl: string,
        userId: string,
        options?: { ownerType?: string; elapsedTimeMs?: number; clientFindings?: ClientFinding[] },
    ): Promise<{ success: boolean; message: string }> {
        const { ReproductionPlaybookStore } = await import('../../infrastructure/monitoring/reproductionPlaybookStore.js');
        const actionRecords = ReproductionPlaybookStore.snapshot();
        const finalBreadcrumbSteps = this.buildBreadcrumbSteps(actionRecords);
        const actionSteps = this.buildActionSteps(actionRecords);

        // SINGLE SOURCE OF TRUTH: the engine's confirmed-bug memory is now a
        // lossless superset of the live Errors Tab (every JS exception, console
        // error, network failure and HTTP fault registers a distinct instance,
        // and dedup is identity-only). Persist that ENTIRE array verbatim — no
        // slice, no filter, no truncation. The client-transferred findings are
        // only a fallback for API-only saves where the engine memory is empty.
        const clientFindings = options?.clientFindings ?? [];
        const engineBugs = this.browserEngine.getConfirmedBugsFromMemory?.() ?? [];

        const caughtBugs = engineBugs.length > 0
            ? engineBugs.map((bug: {
                bugId: string;
                type: string;
                message: string;
                selector: string;
                payloadUsed: string;
                advice: string;
                timestamp: Date;
                stackTrace?: string;
                reproductionSteps?: string[];
                attribution?: FindingAttribution;
            }) => ({
                bugId: bug.bugId,
                type: bug.type,
                message: bug.message,
                selector: bug.selector,
                payloadUsed: bug.payloadUsed,
                advice: bug.advice,
                stackTrace: bug.stackTrace ?? '',
                reproductionSteps: Array.isArray(bug.reproductionSteps) ? bug.reproductionSteps : [],
                timestamp: bug.timestamp,
                attribution: bug.attribution,
            }))
            : clientFindings.map((finding, index) => ({
                bugId: finding.bugId && finding.bugId.trim() ? finding.bugId : `finding-${index + 1}`,
                type: finding.type ?? 'EXCEPTION',
                message: finding.message ?? '',
                selector: finding.selector ?? '',
                payloadUsed: finding.payloadUsed ?? '',
                advice: finding.advice ?? '',
                stackTrace: finding.stackTrace ?? '',
                reproductionSteps: Array.isArray(finding.reproductionSteps) ? finding.reproductionSteps : [],
                timestamp: finding.timestamp ? new Date(finding.timestamp) : new Date(),
                attribution: finding.attribution,
            }));

        // Derive the category breakdown dynamically from the *actual* persisted
        // findings so no category (known or novel) is ever silently zeroed out.
        const breakdownCategories: Record<string, number> = {};
        caughtBugs.forEach((bug) => {
            // Prefer the deterministic knowledge-base bug class; fall back to the
            // raw fault type so older/unclassified findings are never zeroed out.
            const category = bug.attribution?.bugClass || bug.type || 'UNKNOWN';
            breakdownCategories[category] = (breakdownCategories[category] ?? 0) + 1;
        });

        // The persisted count is exactly the number of findings stored — the same
        // count the operator saw live.
        const findingsTotal = caughtBugs.length;

        // Ownership guard: a session document must belong to a real authenticated
        // user. The route already enforces requireAuth, so this is defense-in-depth.
        if (!isValidObjectId(userId)) {
            return { success: false, message: 'A valid authenticated user is required to save history.' };
        }
        const userObjectId = new Types.ObjectId(userId);

        // Use frontend-reported elapsed time first, then fall back to server-side start time
        const runtimeMs = options?.elapsedTimeMs ??
            (this.executionStartTime > 0 ? Date.now() - this.executionStartTime : 0);
        const startedAt = this.executionStartTime > 0
            ? new Date(this.executionStartTime)
            : new Date(Date.now() - runtimeMs);

        const maxActions = this.browserEngine.getConfig?.()?.maxActions ?? 100;
        const coveragePercentage = Math.min(100, Math.round((actionRecords.length / maxActions) * 100));

        try {
            const savedDocument = await SessionModel.create({
                userId: userObjectId,
                targetUrl,
                status: SessionStatus.COMPLETED,
                startedAt,
                finishedAt: new Date(),
                savedManually: true,
                endedReason: 'Manually saved by operator',
                findingCount: findingsTotal,
                actionTraceCount: actionRecords.length,
                stats: {
                    runtimeMs,
                    actionsExecuted: actionRecords.length,
                    coveragePercentage,
                },
                metrics: {
                    totalActions: actionRecords.length,
                    totalBugsFound: findingsTotal,
                    bugsByCategory: breakdownCategories,
                },
                forensicTrace: {
                    finalBreadcrumbSteps,
                    caughtBugs,
                },
                actionSteps,
                executionDate: startedAt,
                timeElapsed: runtimeMs,
            });

            console.log(`[StartExplorationUseCase] ✓ Manual save to sessions: ${savedDocument._id} | Actions: ${actionRecords.length} | Findings: ${findingsTotal} (source: ${engineBugs.length > 0 ? 'engine-memory' : 'live-transfer'}) | Runtime: ${runtimeMs}ms`);
            return { success: true, message: `Saved as ${savedDocument._id}` };
        } catch (persistError) {
            const errorMessage = persistError instanceof Error ? persistError.message : String(persistError);
            console.error(`[StartExplorationUseCase] ✗ Manual save failed: ${errorMessage}`);
            return { success: false, message: errorMessage };
        }
    }

    public async execute(targetUrl: string, optimizationSettings?: OptimizationSettings, selectedScenarios?: TestingTypeId[]): Promise<void> {
        // Store optimization settings for use during execution
        this.optimizationSettings = optimizationSettings;
        console.log(`[StartExplorationUseCase] Optimization settings received:`, optimizationSettings);
        console.log(`[StartExplorationUseCase] Selected scenarios received:`, selectedScenarios ?? '(all)');

        const { ReproductionPlaybookStore } = await import('../../infrastructure/monitoring/reproductionPlaybookStore.js');
        ReproductionPlaybookStore.reset();

        // Phase 3: Get timebox from optimization settings (default: 180000ms = 3 minutes)
        const TIMEBOX_MS = this.optimizationSettings?.['execution-timebox-ms'] ?? 180000;
        console.log(`[StartExplorationUseCase] Timebox enforcement: ${TIMEBOX_MS}ms (${TIMEBOX_MS / 60000} minutes)`);

        this.executionStartTime = Date.now();
        let executionStatus: 'COMPLETED' | 'CRASHED' | 'HALTED' | 'TIMEOUT' = 'COMPLETED';
        const metrics: ExecutionMetrics = {
            totalActions: 0,
            totalBugsFound: 0,
            bugsByCategory: {},
        };

        // Phase 3: Timeout error class for graceful termination
        class TimeboxExceededError extends Error {
            constructor() {
                super(`Execution timebox of ${TIMEBOX_MS}ms exceeded`);
                this.name = 'TimeboxExceededError';
            }
        }

        // Sessions are in-memory only during execution; no DB document is created automatically.
        // The operator must explicitly click "Save to History" to commit a record.
        this.currentSessionId = null;

        this.state.active = true;

        // Register the active engine so sockets can control it
        setActiveEngine(this.browserEngine);

        this.telemetry.emitTelemetry({
            timestamp: new Date().toISOString(),
            type: 'ACTION',
            meta: {
                actionExecuted: 'engine-started',
                url: targetUrl,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                sessionId: this.currentSessionId as any,
                message: `Launching Playwright headless session for ${targetUrl}`,
            },
        });

try {
            // Phase 3: Execute engine with engine-managed timebox (FIXED: uses accumulative active time tracking)
            // The engine now tracks elapsedActiveTimeMs internally and only counts time when NOT paused.
            // This prevents timebox from expiring during pause state.
            const result = await this.browserEngine.run(targetUrl, this.telemetry, this.optimizationSettings, selectedScenarios, this.currentUserId ?? undefined);

// Check if the engine detected timebox exceeded (via its internal timing interval)
            if (!result.completed && result.reason.includes('timebox')) {
                executionStatus = 'TIMEOUT';
                console.log(`[StartExplorationUseCase] ⚠️ Timebox of ${TIMEBOX_MS}ms exceeded (active time) - engine self-terminated`);

                this.telemetry.emitTelemetry({
                    timestamp: new Date().toISOString(),
                    type: 'ACTION',
                    meta: {
                        actionExecuted: 'timebox-exceeded',
                        url: targetUrl,
                        message: `Execution timebox of ${TIMEBOX_MS}ms exceeded (active execution time)`,
                    },
                });
                // Emit explicit IDLE status - ensures deterministic state handshake for frontend
                this.telemetry.emitTelemetry({
                    timestamp: new Date().toISOString(),
                    type: 'ACTION',
                    meta: {
                        actionExecuted: 'engine-status',
                        message: 'IDLE',
                    },
                });
            }

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
            // CRITICAL: Emit explicit IDLE status to ensure deterministic state handshake
            // This prevents zombie backend processes by synchronizing UI state with actual engine state
            this.telemetry.emitTelemetry({
                timestamp: new Date().toISOString(),
                type: 'ACTION',
                meta: {
                    actionExecuted: 'engine-status',
                    message: 'IDLE',
                },
            });

            this.state.active = false;
            this.currentSessionId = null;
            setActiveEngine(null);

            console.log('[StartExplorationUseCase] Session terminated, status set to IDLE');
        }
    }
}
