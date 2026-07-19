import type { BrowserEngine } from '../ports/BrowserEngine.js';
import type { TelemetryGateway } from '../ports/TelemetryGateway.js';
import { defaultOptimizationSettings } from '../../../../shared/types.js';
import type { OptimizationSettings, TestingTypeId } from '../../../../shared/types.js';
import type { FindingRepository } from '../../domain/repositories/FindingRepository.js';
import { sessionManager } from '../services/SessionManager.js';
import type { ActionRecord, FindingAttribution, NetworkLogEntry, ConsoleLogEntry, StateFingerprint } from '../../../../shared/types.js';
import { buildFaultSignature } from '../../../../shared/faultSignature.js';
import { randomUUID } from 'node:crypto';
import { Types, isValidObjectId } from 'mongoose';
import { SessionModel } from '../../infrastructure/database/models/SessionModel.js';
import type { ActionStepTrace } from '../../infrastructure/database/models/SessionModel.js';
import { SessionStatus } from '../../infrastructure/database/models/FindingType.js';
import { withScenarioRandomScope } from '../../domain/scenarios/seededRandom.js';

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
    reproductionActions?: ActionRecord[];
    timestamp?: string;
    attribution?: FindingAttribution;
    stateFingerprint?: StateFingerprint;
    severity?: string;
}

interface ExecutionMetrics {
    totalActions: number;
    totalBugsFound: number;
    bugsByCategory: Record<string, number>;
}

export class StartExplorationUseCase {
    private currentUserId: string | null;
    private currentSessionId: string | null = null;
    // Captured after run() returns and NOT cleared by execute()'s finally block —
    // it must survive until the operator's later, independent Save request.
    private lastCompletedSessionId: string | null = null;
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
     * Atomically claim the "active" slot: returns false without side effects if a
     * run is already active, otherwise marks active and returns true. Must be
     * called synchronously (no await between the caller's isActive()-equivalent
     * check and this call) so two concurrent POST /api/start-test requests can't
     * both observe `active === false` before either sets it — the TOCTOU window
     * that existed when `state.active = true` was only set deep inside execute()
     * after several awaited dynamic imports.
     * Callers that claim the slot but then bail out before invoking execute()
     * (e.g. request validation fails) MUST call releaseActivation() to roll back.
     */
    public tryActivate(): boolean {
        if (this.state.active) {
            return false;
        }
        this.state.active = true;
        return true;
    }

    /**
     * Roll back a tryActivate() claim when the caller decides not to run
     * execute() after all (e.g. a validation check fails after claiming the slot).
     */
    public releaseActivation(): void {
        this.state.active = false;
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
            case 'NETWORK':    return 'bypass';
            case 'HOVER':      return 'click';
            case 'MACRO':      return 'macro';
            default: {
                const _exhaustive: never = type;
                void _exhaustive;
                return 'click';
            }
        }
    }

    // Coerce a client-transferred network row into a persisted NetworkLogEntry.
    private mapNetworkEntry(raw: Record<string, unknown>): NetworkLogEntry {
        const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
        const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
        return {
            timestamp: str(raw.timestamp) ?? new Date().toISOString(),
            method: str(raw.method) ?? 'GET',
            url: str(raw.url) ?? '',
            statusCode: num(raw.statusCode),
            durationMs: num(raw.durationMs),
            resourceType: str(raw.resourceType),
            ok: typeof raw.ok === 'boolean' ? raw.ok : (num(raw.statusCode) ?? 0) < 400,
            message: str(raw.message),
            repeatCount: num(raw.repeatCount),
        };
    }

    // Coerce a client-transferred console row into a persisted ConsoleLogEntry.
    private mapConsoleEntry(raw: Record<string, unknown>): ConsoleLogEntry {
        const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
        const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
        const level = str(raw.level);
        const allowed = ['log', 'error', 'warning', 'info', 'debug', 'trace', 'notice'];
        return {
            timestamp: str(raw.timestamp) ?? new Date().toISOString(),
            level: (allowed.includes(level ?? '') ? level : 'log') as ConsoleLogEntry['level'],
            type: str(raw.type) ?? 'log',
            message: str(raw.message) ?? '',
            url: str(raw.url),
            line: num(raw.line),
            column: num(raw.column),
            stackTrace: str(raw.stackTrace),
        };
    }

    private buildActionSteps(records: ActionRecord[]): ActionStepTrace[] {
        return records.map((record, index) => ({
            stepNumber:         index + 1,
            timestamp:          record.timestamp,
            actionType:         this.mapActionType(record.type),
            selector:           record.selector && record.selector.trim() ? record.selector : 'N/A',
            payloadText:        record.payload,
            resultingStateHash: '',
            durationMs:         record.durationMs,
            macro:              record.macro,
        }));
    }

    // Signature built on the SHARED normalization (shared/faultSignature) so the
    // save-time dedup collapses exactly what the live dashboard collapsed — same
    // volatile-token masking, same stack-frame disambiguation. `type` + `selector`
    // stay in the key as the backend's coarse discriminators (network vs exception,
    // element identity) since caught bugs carry no url/statusCode.
    private normalizeFaultSignature(type: string, message: string, selector: string, stackTrace?: string): string {
        return `${type}||${buildFaultSignature({ reason: message, stackTrace })}||${selector ?? ''}`;
    }

    // Collapse duplicate findings, keeping the first as representative and counting repeats.
    private dedupeCaughtBugs<T extends { type: string; message: string; selector: string; stackTrace?: string }>(
        bugs: T[],
    ): Array<T & { occurrences: number }> {
        const groups = new Map<string, T & { occurrences: number }>();
        for (const bug of bugs) {
            const key = this.normalizeFaultSignature(bug.type, bug.message, bug.selector, bug.stackTrace);
            const existing = groups.get(key);
            if (existing) existing.occurrences += 1;
            else groups.set(key, { ...bug, occurrences: 1 });
        }
        return [...groups.values()];
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
        options?: {
            ownerType?: string;
            elapsedTimeMs?: number;
            clientFindings?: ClientFinding[];
            clientNetworkLog?: Record<string, unknown>[];
            clientConsoleLog?: Record<string, unknown>[];
        },
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

        const rawCaughtBugs = engineBugs.length > 0
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
                reproductionActions?: ActionRecord[];
                attribution?: FindingAttribution;
                stateFingerprint?: StateFingerprint;
                severity?: string;
                resolvedStackTrace?: string;
            }) => ({
                bugId: bug.bugId,
                type: bug.type,
                message: bug.message,
                selector: bug.selector,
                payloadUsed: bug.payloadUsed,
                advice: bug.advice,
                stackTrace: bug.stackTrace ?? '',
                resolvedStackTrace: bug.resolvedStackTrace ?? '',
                reproductionSteps: Array.isArray(bug.reproductionSteps) ? bug.reproductionSteps : [],
                // Per-finding minimized, replayable timeline (empty ⇒ verifier falls
                // back to the session-global actionSteps below).
                actionSteps: this.buildActionSteps(Array.isArray(bug.reproductionActions) ? bug.reproductionActions : []),
                timestamp: bug.timestamp,
                attribution: bug.attribution,
                stateFingerprint: bug.stateFingerprint,
                severity: bug.severity,
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
                actionSteps: this.buildActionSteps(Array.isArray(finding.reproductionActions) ? finding.reproductionActions : []),
                timestamp: finding.timestamp ? new Date(finding.timestamp) : new Date(),
                attribution: finding.attribution,
                stateFingerprint: finding.stateFingerprint,
                severity: finding.severity,
            }));

        // Collapse duplicate findings (same fault repeated across the run) into one
        // representative carrying an occurrence count, so the persisted findingCount
        // matches what the report renders and the history list reports.
        const caughtBugs = this.dedupeCaughtBugs(rawCaughtBugs);

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

        // Use frontend-reported elapsed time first, then fall back to server-side start time.
        // Treat a 0/invalid reported value as absent (?? keeps 0), so a mid-run save still
        // records real elapsed from the server start time.
        const reportedElapsed = options?.elapsedTimeMs;
        // Prefer the frontend-reported elapsed; else the engine's paused-aware active
        // time (robust even when executionStartTime was never set); else wall-clock.
        const engineElapsed = this.browserEngine.getElapsedActiveTimeMs?.() ?? 0;
        const runtimeMs = reportedElapsed && reportedElapsed > 0
            ? reportedElapsed
            : engineElapsed > 0
                ? engineElapsed
                : (this.executionStartTime > 0 ? Date.now() - this.executionStartTime : 0);
        const startedAt = this.executionStartTime > 0
            ? new Date(this.executionStartTime)
            : new Date(Date.now() - runtimeMs);

        const maxActions = this.browserEngine.getConfig?.()?.maxActions ?? 100;
        const coveragePercentage = Math.min(100, Math.round((actionRecords.length / maxActions) * 100));

        // Session-global execution context for history hydration. Distinct visited
        // routes come from the engine; WCAG findings are ephemeral (never persisted),
        // so every caught bug here is a runtime fault matching the live Errors tab.
        const visitedRoutes = (this.browserEngine.getVisitedRoutes?.() ?? []).slice(0, 500);
        const errorsEncountered = caughtBugs.length;

        const sessionFields = {
            userId: userObjectId,
            targetUrl,
            status: SessionStatus.COMPLETED,
            startedAt,
            finishedAt: new Date(),
            savedManually: true,
            endedReason: 'Manually saved by operator',
            findingCount: findingsTotal,
            actionTraceCount: actionRecords.length,
            config: {
                maxActions,
            },
            stats: {
                runtimeMs,
                actionsExecuted: actionRecords.length,
                findingsFound: findingsTotal,
                pagesVisited: visitedRoutes.length,
                errorsEncountered,
                coveragePercentage,
                maxActions,
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
            visitedRoutes,
            executionDate: startedAt,
            timeElapsed: runtimeMs,
        };

        try {
            // Prefer updating the engine's own auto-created session document in
            // place — this is the SAME record used as the forensic correlation
            // id during the run, so saving no longer produces a second, duplicate
            // document. Only fall back to creating a new one if that document
            // doesn't exist (e.g. the initial DB write failed at run-start).
            let savedDocument = this.lastCompletedSessionId && isValidObjectId(this.lastCompletedSessionId)
                ? await SessionModel.findOneAndUpdate(
                    { _id: new Types.ObjectId(this.lastCompletedSessionId), userId: userObjectId },
                    { $set: sessionFields },
                    { new: true },
                )
                : null;

            let source = 'update-in-place';
            if (!savedDocument) {
                savedDocument = await SessionModel.create(sessionFields);
                source = 'fallback-create';
            }

            console.log(`[StartExplorationUseCase] ✓ Manual save to sessions (${source}): ${savedDocument._id} | Actions: ${actionRecords.length} | Findings: ${findingsTotal} (source: ${engineBugs.length > 0 ? 'engine-memory' : 'live-transfer'}) | Runtime: ${runtimeMs}ms`);

            // Flush the full network/console logs for this run so the saved report's
            // Network/Console tabs mirror the live dashboard. A flush failure must
            // never fail the save itself.
            try {
                const { NetworkLogStore } = await import('../../infrastructure/monitoring/NetworkLogStore.js');
                const { ConsoleLogStore } = await import('../../infrastructure/monitoring/ConsoleLogStore.js');
                const { networkLogRepository } = await import('../../infrastructure/database/repositories/NetworkLogRepository.js');
                const { consoleLogRepository } = await import('../../infrastructure/database/repositories/ConsoleLogRepository.js');
                // Client-transferred streams are authoritative (run executes out-of-process
                // under the queue); the in-process buffers are a same-process fallback.
                const netEntries = options?.clientNetworkLog?.length
                    ? options.clientNetworkLog.map((r) => this.mapNetworkEntry(r))
                    : NetworkLogStore.snapshot();
                const conEntries = options?.clientConsoleLog?.length
                    ? options.clientConsoleLog.map((r) => this.mapConsoleEntry(r))
                    : ConsoleLogStore.snapshot();
                await networkLogRepository.createMany(savedDocument._id as Types.ObjectId, netEntries);
                await consoleLogRepository.createMany(savedDocument._id as Types.ObjectId, conEntries);
                console.log(`[StartExplorationUseCase] ✓ Saved logs: network=${netEntries.length} console=${conEntries.length}`);
            } catch (logError) {
                console.error(`[StartExplorationUseCase] ⚠ Network/console log flush failed: ${logError instanceof Error ? logError.message : String(logError)}`);
            }

            return { success: true, message: `Saved as ${savedDocument._id}` };
        } catch (persistError) {
            const errorMessage = persistError instanceof Error ? persistError.message : String(persistError);
            console.error(`[StartExplorationUseCase] ✗ Manual save failed: ${errorMessage}`);
            return { success: false, message: errorMessage };
        }
    }

    // Wraps the run in a private RNG scope so concurrent runs cannot interleave
    // draws from the scenario PRNG. The engine seeds inside its constructor, so
    // the scope must enclose construction, not just the exploration loop.
    public async execute(targetUrl: string, optimizationSettings?: OptimizationSettings, selectedScenarios?: TestingTypeId[], runId?: string): Promise<void> {
        return withScenarioRandomScope(() => this.executeInScope(targetUrl, optimizationSettings, selectedScenarios, runId));
    }

    private async executeInScope(targetUrl: string, optimizationSettings?: OptimizationSettings, selectedScenarios?: TestingTypeId[], runId?: string): Promise<void> {
        // Store optimization settings for use during execution
        this.optimizationSettings = optimizationSettings;
        console.log(`[StartExplorationUseCase] Optimization settings received:`, optimizationSettings);
        console.log(`[StartExplorationUseCase] Selected scenarios received:`, selectedScenarios ?? '(all)');

        const { ReproductionPlaybookStore } = await import('../../infrastructure/monitoring/reproductionPlaybookStore.js');
        ReproductionPlaybookStore.reset();
        // Reset the fuzz-step forensic log so snapshots are scoped to this run.
        const { FuzzForensicLog } = await import('../../infrastructure/monitoring/fuzzForensics.js');
        FuzzForensicLog.reset();
        // Reset the navigation forensic log so route-trash snapshots are scoped to this run.
        const { NavForensicLog } = await import('../../infrastructure/monitoring/navForensics.js');
        NavForensicLog.reset();
        // Reset the full network/console log buffers so they're scoped to this run.
        const { NetworkLogStore } = await import('../../infrastructure/monitoring/NetworkLogStore.js');
        NetworkLogStore.reset();
        const { ConsoleLogStore } = await import('../../infrastructure/monitoring/ConsoleLogStore.js');
        ConsoleLogStore.reset();

        // Phase 3: Get timebox from optimization settings (default: 600000ms = 10 minutes)
        const DEFAULT_TIMEBOX_MS = defaultOptimizationSettings['execution-timebox-ms'] ?? 600000;
        const TIMEBOX_MS = this.optimizationSettings?.['execution-timebox-ms'] ?? DEFAULT_TIMEBOX_MS;
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

        // The engine auto-creates a DB session document for internal forensic
        // correlation (RUNNING -> COMPLETED/CRASHED), but it is never surfaced as
        // "history" and is not the record manualSaveToHistory() writes to unless
        // the operator explicitly clicks "Save to History".
        this.currentSessionId = null;

        // NOTE: state.active is already true here — the caller (registerRoutes.ts)
        // claimed it synchronously via tryActivate() before calling execute(), to
        // close the TOCTOU race that existed when this flag was set only at this
        // point, after the awaited dynamic imports above.

        // Register the run with the centralized SessionManager: it owns the
        // engine control surface, reconnect replay buffer, grace window, room
        // wiring, and target-health monitor for this run.
        const resolvedRunId = runId ?? randomUUID();
        sessionManager.beginRun({
            runId: resolvedRunId,
            userId: this.currentUserId,
            targetUrl,
            timeboxMs: TIMEBOX_MS,
            engine: this.browserEngine,
        });

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

            // Capture the engine's auto-created session id now, before it's
            // needed by a later, independent manualSaveToHistory() call.
            this.lastCompletedSessionId = this.browserEngine.getLastSessionId?.() ?? null;

// Check if the engine detected timebox exceeded (via its internal timing interval)
            if (result.outcome === 'timebox') {
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

            executionStatus = result.outcome === 'exception'
                ? 'CRASHED'
                : result.outcome === 'timebox'
                    ? 'TIMEOUT'
                    : result.completed ? 'COMPLETED' : 'HALTED';

            // Collect metrics from the reproduction playbook store (actions executed)
            const actionRecords = ReproductionPlaybookStore.snapshot();
            metrics.totalActions = actionRecords.length;
            // Note: Bug count would be collected from the finding repository in a full implementation

            // Only a genuine engine/Playwright/infrastructure exception is EXCEPTION-typed —
            // user stops, timebox, and graceful shutdowns are normal completions (ACTION).
            this.telemetry.emitTelemetry({
                timestamp: new Date().toISOString(),
                type: result.outcome === 'exception' ? 'EXCEPTION' : 'ACTION',
                meta: {
                    actionExecuted: 'engine-stopped',
                    url: targetUrl,
                    message: result.reason,
                },
            });
        } catch (error) {
            executionStatus = 'CRASHED';
            // Capture even on crash so a fatal engine error doesn't strand the
            // operator with no session to save.
            this.lastCompletedSessionId = this.browserEngine.getLastSessionId?.() ?? null;
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
            // Tear down the run in the SessionManager (stops health monitor, clears
            // grace timer, releases the room + replay buffer). No-op if a grace
            // expiry already ended it. CRASHED preserves the fatal-error lifecycle.
            sessionManager.endRun(executionStatus === 'CRASHED' ? 'CRASHED' : 'COMPLETED');

            console.log('[StartExplorationUseCase] Session terminated, status set to IDLE');
        }
    }
}
