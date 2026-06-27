import type { BrowserEngine } from '../ports/BrowserEngine.js';
import type { TelemetryGateway } from '../ports/TelemetryGateway.js';
import type { OptimizationSettings } from '../../../../shared/types.js';
import type { FindingRepository } from '../../domain/repositories/FindingRepository.js';
import { setActiveEngine } from '../../presentation/socket/registerSocketHandlers.js';
import type { ActionRecord } from '../../../../shared/types.js';
import { Types, isValidObjectId } from 'mongoose';
import { SessionModel, type ISession } from '../../infrastructure/database/models/SessionModel.js';
import { SessionStatus } from '../../infrastructure/database/models/FindingType.js';

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
    private currentSessionId: string | null = null;
    private executionStartTime: number = 0;
    private optimizationSettings: OptimizationSettings | undefined;

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
     * @param targetUrl - The URL that was tested
     * @param userId - The user ID or placeholder for anonymous users
     * @param options - Optional parameters including ownerType for tracking anonymous vs authenticated
     */
    public async manualSaveToHistory(
        targetUrl: string,
        userId: string,
        options?: { ownerType?: string },
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

// Handle userId validation - allow anonymous-guest-user placeholder
        const effectiveUserId = userId === 'anonymous-guest-user' ? '000000000000000000000000' : userId;
        if (!effectiveUserId || !isValidObjectId(effectiveUserId)) {
            console.warn('[StartExplorationUseCase] Invalid userId, using default for anonymous save');
            // Use default guest user for anonymous saves
        }

        try {
            // Use effectiveUserId (either the provided userId or default for anonymous)
            const userIdToSave = isValidObjectId(effectiveUserId) ? effectiveUserId : '000000000000000000000000';
            const userObjectId = new Types.ObjectId(userIdToSave);
            const totalDuration = Date.now();

            // Find the most recent session for this user+targetUrl to update (manual save flow)
            // If no running session exists, create a new document in sessions collection
            let savedDocument: ISession | null = await SessionModel.findOneAndUpdate(
                { targetUrl, userId: userObjectId, status: SessionStatus.RUNNING },
                {
                    $set: {
                        status: SessionStatus.COMPLETED,
                        finishedAt: new Date(),
                        endedReason: 'Manually saved by user',
                        metrics: {
                            totalActions: actionRecords.length,
                            totalBugsFound: realBugsFound.length,
                            bugsByCategory: breakdownCategories,
                        },
                        forensicTrace: {
                            finalBreadcrumbSteps,
                            caughtBugs,
                        },
                        executionDate: new Date(),
                        timeElapsed: totalDuration,
                    }
                },
                { new: true }
            );

            // If no running session found, create a new document
            if (!savedDocument) {
                savedDocument = await SessionModel.create({
                    userId: userObjectId,
                    targetUrl,
                    status: SessionStatus.COMPLETED,
                    startedAt: new Date(Date.now() - totalDuration),
                    finishedAt: new Date(),
                    endedReason: 'Manually saved by user',
                    findingCount: realBugsFound.length,
                    actionTraceCount: actionRecords.length,
                    metrics: {
                        totalActions: actionRecords.length,
                        totalBugsFound: realBugsFound.length,
                        bugsByCategory: breakdownCategories,
                    },
                    forensicTrace: {
                        finalBreadcrumbSteps,
                        caughtBugs,
                    },
                    executionDate: new Date(),
                    timeElapsed: totalDuration,
                });
            }

            console.log(`[StartExplorationUseCase] ✓ Manual save to sessions: ${savedDocument._id} | Actions: ${actionRecords.length} | Bugs: ${realBugsFound.length}`);
            return { success: true, message: `Saved as ${savedDocument._id}` };
        } catch (persistError) {
            const errorMessage = persistError instanceof Error ? persistError.message : String(persistError);
            console.error(`[StartExplorationUseCase] ✗ Manual save failed: ${errorMessage}`);
            return { success: false, message: errorMessage };
        }
    }

    public async execute(targetUrl: string, optimizationSettings?: OptimizationSettings): Promise<void> {
        // Store optimization settings for use during execution
        this.optimizationSettings = optimizationSettings;
        console.log(`[StartExplorationUseCase] Optimization settings received:`, optimizationSettings);

        const { ReproductionPlaybookStore } = await import('../../infrastructure/monitoring/reproductionPlaybookStore.js');
        ReproductionPlaybookStore.reset();

        // Phase 3: Get timebox from optimization settings (default: 180000ms = 3 minutes)
        const TIMEBOX_MS = this.optimizationSettings?.['execution-timebox-ms'] ?? 180000;
        console.log(`[StartExplorationUseCase] Timebox enforcement: ${TIMEBOX_MS}ms (${TIMEBOX_MS / 60000} minutes)`);

        const executionStartTime = Date.now();
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

// FIX: Create session in database BEFORE starting test
        // CRITICAL: This operation MUST NOT block safari initialization
        // If DB is down, we continue without forensic history - that's acceptable
        this.currentSessionId = null;
        if (this.findingRepository) {
          try {
            console.log(`[StartExplorationUseCase] Attempting to create session for ${targetUrl}...`);
            console.log(`[StartExplorationUseCase] UserId for session: ${this.currentUserId}`);
            this.currentSessionId = await this.findingRepository.createSession({
              targetUrl,
              startedAt: new Date().toISOString(),
              userId: this.currentUserId,  // CRITICAL: Bind session to authenticated user
            });
            console.log(`[StartExplorationUseCase] ✓ Session created: ${this.currentSessionId} for userId: ${this.currentUserId}`);
          } catch (sessionError) {
            const errorMessage = sessionError instanceof Error ? sessionError.message : String(sessionError);
            console.error(`[StartExplorationUseCase] ⚠️ Session creation failed: ${errorMessage}`);
            console.warn('[StartExplorationUseCase] Continuing launch WITHOUT forensic history - DB unavailable');
            // DO NOT re-throw - continue without session tracking
            // This ensures the safari can still launch even if DB is down
          }
        } else {
          console.log('[StartExplorationUseCase] No findingRepository - running without forensic history');
        }

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
            const result = await this.browserEngine.run(targetUrl, this.telemetry, this.optimizationSettings);

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
            const executionDuration = Date.now() - executionStartTime;

            // FIX: Auto-complete the session with execution duration
            // This ensures the session record is always persisted, even if user doesn't click Save
            if (this.currentSessionId && this.findingRepository) {
                try {
                    const completedAt = new Date().toISOString();
                    console.log(`[StartExplorationUseCase] Marking session ${this.currentSessionId} as ${executionStatus}, duration: ${executionDuration}ms`);

                    if (executionStatus === 'CRASHED') {
                        await this.findingRepository.markSessionCrashed(
                            this.currentSessionId,
                            completedAt,
                            `Test ${executionStatus.toLowerCase()} - ${metrics.totalActions} actions executed`
                        );
                    } else {
                        await this.findingRepository.markSessionCompleted(
                            this.currentSessionId,
                            completedAt
                        );
                    }

                    // Also update the stats with runtime and calculate coverage percentage
                    const { SessionModel } = await import('../../infrastructure/database/models/SessionModel.js');
                    const { Types } = await import('mongoose');

                    // Get maxActions from config (default 100 if not specified)
                    const maxActions = this.browserEngine.getConfig?.()?.maxActions ?? 100;

                    // Calculate coverage percentage (actions executed / maxActions * 100)
                    const coveragePercentage = Math.min(100, Math.round((metrics.totalActions / maxActions) * 100));

                    console.log(`[StartExplorationUseCase] Coverage: ${metrics.totalActions}/${maxActions} = ${coveragePercentage}%`);

                    await SessionModel.updateOne(
                        { _id: new Types.ObjectId(this.currentSessionId) },
                        {
                            $set: {
                                'stats.runtimeMs': executionDuration,
                                'stats.actionsExecuted': metrics.totalActions,
                                'stats.coveragePercentage': coveragePercentage,
                                'stats.maxActions': maxActions,
                            }
                        }
                    );
} catch (completionError) {
                    console.error('[StartExplorationUseCase] Failed to complete session:', completionError);
                }
            }

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
