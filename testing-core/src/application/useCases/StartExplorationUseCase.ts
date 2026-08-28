import type { BrowserEngine } from '../ports/BrowserEngine.js';
import type { TelemetryGateway } from '../ports/TelemetryGateway.js';
import { defaultOptimizationSettings, describeTermination, isActionableNetworkStatus, resolveSeverity } from '../../../../shared/types.js';
import type { OptimizationSettings, RunTerminationOutcome, TargetAuthConfig, TestingTypeId } from '../../../../shared/types.js';
import type { FindingRepository } from '../../domain/repositories/FindingRepository.js';
import { sessionManager } from '../services/SessionManager.js';
import type { ActionRecord, FindingAttribution, NetworkLogEntry, ConsoleLogEntry, StateFingerprint } from '../../../../shared/types.js';
import { maskPayload, resolveControlName } from '../../../../shared/reproduction.js';
import { randomUUID } from 'node:crypto';
import { Types, isValidObjectId } from 'mongoose';
import { createWithRunCodeRetry, generateRunCode, isDuplicateRunIdError } from '../../infrastructure/database/runCodeGenerator.js';
import { normalizeRunCode } from '../../../../shared/runCode.js';
import { SessionModel } from '../../infrastructure/database/models/SessionModel.js';
import type { ActionStepTrace, ICaughtBug } from '../../infrastructure/database/models/SessionModel.js';
import { buildActionSteps } from '../../domain/services/forensics/actionStepMapper.js';
import { dedupeCaughtBugsBySignature, toSavedCaughtBug, unionFindingsByBugId } from '../../domain/services/forensics/findingProjection.js';
import { SessionStatus } from '../../infrastructure/database/models/FindingType.js';
import { withScenarioRandomScope } from '../../domain/scenarios/seededRandom.js';
import { ReproductionPlaybookStore } from '../../infrastructure/monitoring/reproductionPlaybookStore.js';
import { resetBurstCounter } from '../../infrastructure/monitoring/burstCorrelation.js';
import { FuzzForensicLog } from '../../infrastructure/monitoring/fuzzForensics.js';
import { NavForensicLog } from '../../infrastructure/monitoring/navForensics.js';
import { NetworkLogStore } from '../../infrastructure/monitoring/NetworkLogStore.js';
import { ConsoleLogStore } from '../../infrastructure/monitoring/ConsoleLogStore.js';
import { classifyFaultOrigin } from '../../domain/services/verification/index.js';

import { createLogger } from '../../infrastructure/observability/logger.js';

const obsLog = createLogger('[StartExplorationUseCase]');

// Hard caps on the arrays embedded in the session document (SEC-27). The 16MB BSON
// ceiling is a per-document limit; exceeding it fails the whole save, so a pathological
// run is truncated (with a log) rather than lost entirely.
const MAX_EMBEDDED_CAUGHT_BUGS = 1000;
const MAX_EMBEDDED_ACTION_STEPS = 2000;

function capEmbedded<T>(items: T[], max: number, label: string): T[] {
  if (items.length <= max) return items;
  obsLog.warn(`[StartExplorationUseCase] ${label} ${items.length} exceeds ${max} — truncating to bound BSON document size (SEC-27).`);
  return items.slice(0, max);
}

interface RunState {
    active: boolean;
}

/** Coarse run status reported to the operator and used to settle the lifecycle. */
type ExecutionStatus = 'COMPLETED' | 'CRASHED' | 'HALTED' | 'TIMEOUT' | 'STOPPED' | 'ABANDONED';

// A user stop and an abandoned run are neither completions nor crashes; keeping them
// distinct is what lets History and Reports state the real termination reason.
const EXECUTION_STATUS_BY_OUTCOME: Record<RunTerminationOutcome, ExecutionStatus> = {
    completed: 'COMPLETED',
    'boundary-saturated': 'COMPLETED',
    'user-stopped': 'STOPPED',
    timebox: 'TIMEOUT',
    'graceful-shutdown': 'HALTED',
    'target-crash': 'CRASHED',
    abandoned: 'ABANDONED',
    'engine-error': 'CRASHED',
    // Inert: a queued run cancelled before pickup never enters execute().
    'queue-cancelled': 'STOPPED',
    exception: 'CRASHED',
};

// Why a manual save was refused. Lets the route map a domain refusal to its real
// status code and surface an actionable reason instead of a blanket 500 — a
// generic 500 is what made the production-only save failure undiagnosable.
export type SaveFailureCode =
    | 'INVALID_USER'
    | 'OWNED_BY_OTHER'
    | 'RUN_IN_PROGRESS'
    | 'VALIDATION_FAILED'
    | 'PERSIST_FAILED';

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
    /** Human name of the culprit control, resolved client-side alongside the selector. */
    culpritLabel?: string;
    /** Route the fault surfaced on — part of the canonical save-dedup signature. */
    url?: string;
    /** HTTP status for a network fault — kept so the save collapse matches the live grouping. */
    statusCode?: number;
    payloadUsed?: string;
    advice?: string;
    stackTrace?: string;
    reproductionSteps?: string[];
    reproductionActions?: ActionRecord[];
    timestamp?: string;
    attribution?: FindingAttribution;
    stateFingerprint?: StateFingerprint;
    severity?: string;
    /** Authoritative manifestation count the client displayed — the fallback ×N when the
     *  engine memory is empty (API-only save). */
    occurrences?: number;
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
    // Public RUN- code minted for the current run; survives into a later Save so the
    // fallback-created doc reuses the code the operator saw live.
    private lastRunCode: string | null = null;
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
            obsLog.info(`[StartExplorationUseCase] UserId set to: ${userId}`);
        } else {
            // Clear to null (guest / unauthenticated) — prevents a singleton use case
            // from leaking the previous authenticated user's id into a later guest run.
            this.currentUserId = null;
            obsLog.info(`[StartExplorationUseCase] UserId cleared (guest/unauthenticated)`);
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
            const target = resolveControlName({
                label: record.elementLabel ?? record.fallbackLabel,
                selector: record.selector,
                tagName: record.elementKind,
            });
            // maskPayload, not a raw slice: this string is persisted to MongoDB, and
            // an auth/credential field's record carries redactValue for exactly this.
            const payload = maskPayload(record.payload, record.redactValue);
            const payloadPart = payload ? ` with payload "${payload}"` : '';
            return `Step ${index + 1}: ${record.type} ${target} at ${record.url}${payloadPart}`;
        });
    }

    // Coerce a client-transferred network row into a persisted NetworkLogEntry.
    private mapNetworkEntry(raw: Record<string, unknown>): NetworkLogEntry {
        const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
        const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
        const headers = (v: unknown): Record<string, string> | undefined => {
            if (!v || typeof v !== 'object') return undefined;
            const out: Record<string, string> = {};
            for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
                if (typeof val === 'string') out[k] = val.slice(0, 256);
            }
            return Object.keys(out).length ? out : undefined;
        };
        return {
            timestamp: str(raw.timestamp) ?? new Date().toISOString(),
            method: str(raw.method) ?? 'GET',
            url: str(raw.url) ?? '',
            statusCode: num(raw.statusCode),
            durationMs: num(raw.durationMs),
            resourceType: str(raw.resourceType),
            ok: typeof raw.ok === 'boolean' ? raw.ok : (num(raw.statusCode) ?? 0) < 400,
            message: str(raw.message),
            errorText: str(raw.errorText),
            traceId: str(raw.traceId),
            requestHeaders: headers(raw.requestHeaders),
            responseHeaders: headers(raw.responseHeaders),
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
            /** Public RUN- code the client saw live — the run's identity for this save. */
            runCode?: string;
            clientFindings?: ClientFinding[];
            clientNetworkLog?: Record<string, unknown>[];
            clientConsoleLog?: Record<string, unknown>[];
        },
    ): Promise<{ success: boolean; message: string; runId?: string; code?: SaveFailureCode }> {
        // A run in progress owns the engine's live bug memory (getConfirmedBugsFromMemory
        // reads the active engine first). Serving a save for a DIFFERENT run while one is
        // active would persist the live run's findings under the requested run's identity.
        // Allow only a save whose runCode matches the active run; reject cross-run saves.
        if (this.state.active) {
            const requestedCode = normalizeRunCode(options?.runCode);
            const activeCode = normalizeRunCode(this.lastRunCode);
            if (!requestedCode || requestedCode !== activeCode) {
                return {
                    success: false,
                    message: 'A test run is currently in progress. Wait for it to finish before saving this session.',
                    code: 'RUN_IN_PROGRESS',
                };
            }
        }

        const { ReproductionPlaybookStore } = await import('../../infrastructure/monitoring/reproductionPlaybookStore.js');
        const actionRecords = ReproductionPlaybookStore.snapshot();
        const finalBreadcrumbSteps = this.buildBreadcrumbSteps(actionRecords);
        const actionSteps = capEmbedded(buildActionSteps(actionRecords), MAX_EMBEDDED_ACTION_STEPS, 'actionSteps');

        // Ownership guard: a session document must belong to a real authenticated
        // user. The route already enforces requireAuth, so this is defense-in-depth.
        if (!isValidObjectId(userId)) {
            return { success: false, message: 'A valid authenticated user is required to save history.', code: 'INVALID_USER' };
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

        // Session-global execution context for history hydration. Distinct visited
        // routes come from the engine; WCAG findings are ephemeral (never persisted),
        // so every caught bug here is a runtime fault matching the live Errors tab.
        const visitedRoutes = (this.browserEngine.getVisitedRoutes?.() ?? []).slice(0, 500);

        // Identity of the run being saved, most trustworthy first. The client's public
        // RUN- code is the only id that survives queue mode, a process restart, or a
        // second run started meanwhile; the in-process id is the legacy fallback for
        // clients that send no code.
        const requestedCode = normalizeRunCode(options?.runCode);
        const originalSessionId = this.lastCompletedSessionId && isValidObjectId(this.lastCompletedSessionId)
            ? new Types.ObjectId(this.lastCompletedSessionId)
            : null;

        // Resolve the run's own document once: it settles both which record this save
        // rewrites and whether a genuine termination verdict recorded by
        // markSessionTerminated must be preserved (a manual save must never rewrite a
        // crashed/timed-out run as Completed).
        const ownedBy = { userId: userObjectId };
        // targetUrl is included so the save preserves the authoritative URL the
        // worker recorded at run start (createSessionDoc) rather than overwriting
        // it with a possibly-stale client value from a remounted dashboard.
        // forensicTrace.caughtBugs rides along because the engine now checkpoints its
        // ledger there mid-run: that copy is the server's own record of what it observed,
        // and the save merges onto it instead of letting the client body replace it.
        const terminalFields = 'status outcome endedReason finishedAt targetUrl stats forensicTrace.caughtBugs';
        const existing = (requestedCode
            ? await SessionModel.findOne({ runId: requestedCode, ...ownedBy }).select(terminalFields).lean()
            : null)
            ?? (originalSessionId
                ? await SessionModel.findOne({ _id: originalSessionId, ...ownedBy }).select(terminalFields).lean()
                : null);

        // FINDING SOURCES, most authoritative first.
        //  1. The live engine ledger — present only for a same-process (sync) save.
        //  2. The mid-run checkpoint on this run's own document — the queue-mode
        //     equivalent, written by the worker that actually observed the faults.
        //  3. The client's transferred buffer.
        // (1)/(2) are the server's truth and win per bugId; (3) is unioned in rather than
        // discarded, because the ledger evicts under its own cap and a client can hold a
        // finding the checkpoint no longer carries. Before the checkpoint existed, a
        // queue-mode save had only (3) — so any gap in the browser's buffer became
        // permanent report loss.
        const clientFindings = options?.clientFindings ?? [];
        const engineBugs = this.browserEngine.getConfirmedBugsFromMemory?.() ?? [];
        const checkpointedBugs = existing?.forensicTrace?.caughtBugs ?? [];

        const serverBugs = engineBugs.length > 0
            ? engineBugs.map(toSavedCaughtBug)
            : checkpointedBugs;

        const clientBugs: ICaughtBug[] = clientFindings.map((finding, index) => ({
            bugId: finding.bugId && finding.bugId.trim() ? finding.bugId : `finding-${index + 1}`,
            type: finding.type ?? 'EXCEPTION',
            message: finding.message ?? '',
            selector: finding.selector ?? '',
            elementLabel: finding.culpritLabel ?? '',
            url: finding.url ?? '',
            statusCode: finding.statusCode,
            payloadUsed: finding.payloadUsed ?? '',
            advice: finding.advice ?? '',
            stackTrace: finding.stackTrace ?? '',
            occurrences: finding.occurrences ?? 1,
            reproductionSteps: Array.isArray(finding.reproductionSteps) ? finding.reproductionSteps : [],
            actionSteps: buildActionSteps(Array.isArray(finding.reproductionActions) ? finding.reproductionActions : []),
            timestamp: finding.timestamp ? new Date(finding.timestamp) : new Date(),
            attribution: finding.attribution,
            stateFingerprint: finding.stateFingerprint,
            severity: resolveSeverity({
                severity: finding.severity,
                bugClass: finding.attribution?.bugClass,
                confidence: finding.attribution?.confidence,
                verificationStatus: finding.attribution?.verificationStatus,
            }),
        }));

        const rawCaughtBugs = unionFindingsByBugId(serverBugs, clientBugs);

        // Collapse duplicate findings (same fault repeated across the run) into one
        // representative carrying an occurrence count, so the persisted findingCount
        // matches what the report renders and the history list reports.
        // Cap embedded arrays (SEC-27) so a finding-rich run cannot approach the 16MB
        // BSON limit and fail the ENTIRE save. Generous — only a pathological run trips it.
        const caughtBugs = capEmbedded(dedupeCaughtBugsBySignature(rawCaughtBugs), MAX_EMBEDDED_CAUGHT_BUGS, 'caughtBugs');

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
        const errorsEncountered = caughtBugs.length;

        // The reproduction buffer (actionRecords) is a capped ≤60 rolling window and is
        // empty for a cross-process (queue) save, so it under-counts steps. Prefer the
        // engine's uncapped interaction total, and never regress the authoritative value
        // markSessionTerminated already wrote at run end.
        const engineInteractions = this.browserEngine.getInteractionCount?.() ?? 0;
        const persistedActions = Math.max(engineInteractions, actionRecords.length, existing?.stats?.actionsExecuted ?? 0);
        const persistedRuntime = Math.max(runtimeMs, existing?.stats?.runtimeMs ?? 0);
        const persistedCoverage = Math.min(100, Math.round((persistedActions / maxActions) * 100));

        const lifecycleFields = existing?.outcome
            ? {
                status: existing.status,
                outcome: existing.outcome,
                endedReason: existing.endedReason ?? 'Manually saved by operator',
                finishedAt: existing.finishedAt ?? new Date(),
            }
            : {
                status: SessionStatus.COMPLETED,
                endedReason: 'Manually saved by operator',
                finishedAt: new Date(),
            };

        const sessionFields = {
            userId: userObjectId,
            // Preserve the worker-recorded target on an in-place update; use the
            // client value only when creating a run that never persisted a session.
            targetUrl: existing?.targetUrl ?? targetUrl,
            ...lifecycleFields,
            startedAt,
            savedManually: true,
            findingCount: findingsTotal,
            actionTraceCount: persistedActions,
            config: {
                maxActions,
            },
            stats: {
                runtimeMs: persistedRuntime,
                actionsExecuted: persistedActions,
                findingsFound: findingsTotal,
                pagesVisited: visitedRoutes.length,
                errorsEncountered,
                coveragePercentage: persistedCoverage,
                maxActions,
            },
            metrics: {
                totalActions: persistedActions,
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
            timeElapsed: persistedRuntime,
        };

        try {
            // Update the run's own document in place — the SAME record used as the
            // forensic correlation id during the run. Saving twice, double-clicking
            // Save, or retrying a failed save therefore rewrites one record instead
            // of minting a second. Only a run that never persisted a session falls
            // through to a create.
            let savedDocument = existing
                ? await SessionModel.findOneAndUpdate(
                    { _id: existing._id, ...ownedBy },
                    { $set: sessionFields },
                    { new: true },
                )
                : null;

            let source = 'update-in-place';
            if (!savedDocument) {
                // Neither identity resolved to a document of ours. If either is taken
                // by another account, refuse — creating over a live _id would collide,
                // and reusing its code would hand one user another's forensic children.
                const takenByOther = (requestedCode && (await SessionModel.exists({ runId: requestedCode })))
                    || (originalSessionId && (await SessionModel.exists({ _id: originalSessionId })));
                if (takenByOther) {
                    return { success: false, message: 'This run belongs to a different account and cannot be saved here.', code: 'OWNED_BY_OTHER' };
                }
                // Reuse the run's own id when we have one so forensic children written
                // during the run stay correctly keyed; only mint a fresh id when the run
                // never persisted a session (no children exist to orphan).
                const idField = originalSessionId ? { _id: originalSessionId } : {};
                const create = (code: string) => SessionModel.create({ ...idField, runId: code, ...sessionFields });
                // The code the operator saw live is this run's identity and must not be
                // swapped for a fresh one: an E11000 here means a concurrent save of the
                // same run won the race, so converge onto its document.
                const identityCode = requestedCode ?? normalizeRunCode(this.lastRunCode);
                if (identityCode) {
                    savedDocument = await create(identityCode).catch(async (error: unknown) => {
                        if (!isDuplicateRunIdError(error)) throw error;
                        return SessionModel.findOneAndUpdate(
                            { runId: identityCode, ...ownedBy },
                            { $set: sessionFields },
                            { new: true },
                        );
                    });
                    if (!savedDocument) {
                        return { success: false, message: 'This run belongs to a different account and cannot be saved here.', code: 'OWNED_BY_OTHER' };
                    }
                } else {
                    savedDocument = await createWithRunCodeRetry(create);
                }
                source = originalSessionId ? 'reuse-id-create' : 'fallback-create';
            }

            obsLog.info(`[StartExplorationUseCase] ✓ Manual save to sessions (${source}): ${savedDocument._id} | Actions: ${actionRecords.length} | Findings: ${findingsTotal} (source: ${engineBugs.length > 0 ? 'engine-memory' : 'live-transfer'}) | Runtime: ${runtimeMs}ms`);

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
                // Persist only actionable rows — successes are never stored (mirrors the
                // live Network tab). Guards legacy client payloads that still carry 2xx/3xx.
                const netEntries = (options?.clientNetworkLog?.length
                    ? options.clientNetworkLog.map((r) => this.mapNetworkEntry(r))
                    : NetworkLogStore.snapshot()
                ).filter((e) => isActionableNetworkStatus(e.statusCode));
                const conEntries = options?.clientConsoleLog?.length
                    ? options.clientConsoleLog.map((r) => this.mapConsoleEntry(r))
                    : ConsoleLogStore.snapshot();
                // Independent inserts to Atlas — run them concurrently instead of two
                // serial round-trips (both writes target different collections).
                await Promise.all([
                    networkLogRepository.createMany(savedDocument._id as Types.ObjectId, netEntries),
                    consoleLogRepository.createMany(savedDocument._id as Types.ObjectId, conEntries),
                ]);
                obsLog.info(`[StartExplorationUseCase] ✓ Saved logs: network=${netEntries.length} console=${conEntries.length}`);
            } catch (logError) {
                obsLog.error(`[StartExplorationUseCase]  Network/console log flush failed: ${logError instanceof Error ? logError.message : String(logError)}`);
            }

            return { success: true, message: `Saved as ${savedDocument._id}`, runId: savedDocument.runId };
        } catch (persistError) {
            const errorMessage = persistError instanceof Error ? persistError.message : String(persistError);
            const name = persistError instanceof Error ? persistError.name : 'UnknownError';
            // A schema rejection is a bounded, actionable fault the operator can be
            // told about verbatim; anything else stays opaque to the client and is
            // logged in full. Shape context is logged either way: the production
            // failure was a cap breached only on the in-process path, invisible
            // from the message alone.
            const code: SaveFailureCode = name === 'ValidationError' ? 'VALIDATION_FAILED' : 'PERSIST_FAILED';
            obsLog.error(
                `[StartExplorationUseCase] ✗ Manual save failed (${code}/${name}): ${errorMessage}`
                + ` | runCode=${requestedCode ?? 'none'} sessionId=${originalSessionId?.toString() ?? 'none'}`
                + ` findings=${caughtBugs.length} actionSteps=${actionSteps.length}`
                + ` breadcrumbs=${finalBreadcrumbSteps.length} visitedRoutes=${visitedRoutes.length}`
                + ` source=${engineBugs.length > 0 ? 'engine-memory' : 'live-transfer'}`,
                persistError,
            );
            return { success: false, message: errorMessage, code };
        }
    }

    // Wraps the run in a private RNG scope so concurrent runs cannot interleave
    // draws from the scenario PRNG. The engine seeds inside its constructor, so
    // the scope must enclose construction, not just the exploration loop.
    // `runId` is the live bearer TOKEN; `runCode` is the public RUN- code. On the
    // queue path the worker passes the code minted at enqueue so live/history stay
    // in parity; the synchronous path omits it and one is minted here.
    public async execute(targetUrl: string, optimizationSettings?: OptimizationSettings, selectedScenarios?: TestingTypeId[], runId?: string, targetAuth?: TargetAuthConfig, runCode?: string): Promise<void> {
        return withScenarioRandomScope(() => this.executeInScope(targetUrl, optimizationSettings, selectedScenarios, runId, targetAuth, runCode));
    }

    private async executeInScope(targetUrl: string, optimizationSettings?: OptimizationSettings, selectedScenarios?: TestingTypeId[], runId?: string, targetAuth?: TargetAuthConfig, providedRunCode?: string): Promise<void> {
        // Store optimization settings for use during execution
        this.optimizationSettings = optimizationSettings;
        obsLog.info(`[StartExplorationUseCase] Optimization settings received:`, optimizationSettings);
        obsLog.info(`[StartExplorationUseCase] Selected scenarios received:`, selectedScenarios ?? '(all)');

        // Phase 3: Get timebox from optimization settings (default: 600000ms = 10 minutes)
        const DEFAULT_TIMEBOX_MS = defaultOptimizationSettings['execution-timebox-ms'] ?? 600000;
        const TIMEBOX_MS = this.optimizationSettings?.['execution-timebox-ms'] ?? DEFAULT_TIMEBOX_MS;
        obsLog.info(`[StartExplorationUseCase] Timebox enforcement: ${TIMEBOX_MS}ms (${TIMEBOX_MS / 60000} minutes)`);

        this.executionStartTime = Date.now();
        let executionStatus: ExecutionStatus = 'COMPLETED';
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
        // point.

        // The incoming `runId` param IS the live bearer token (room key + ownership
        // proof), distinct from the public RUN- code minted next.
        const resolvedRunToken = runId ?? randomUUID();
        // One public RUN- code for the whole run: the SessionManager surfaces it as
        // snapshot.runId AND the engine stamps it as the DB doc's runId, so live,
        // telemetry, and history all show the same code. Reuse the queue-minted code
        // when provided so a worker-executed run keeps the same code the client saw.
        const runCode = providedRunCode ?? generateRunCode();
        this.lastRunCode = runCode;
        // Drop the previous run's document id now: this use case is a process-wide
        // singleton, and a stale id let a later save rewrite an earlier run's record.
        this.lastCompletedSessionId = null;
        this.browserEngine.setRunCode?.(runCode);

        // EVERYTHING from here on is inside the try, so the finally below always
        // releases state.active and ends the run. Setup that lived outside it used
        // to leak the activation slot permanently on any startup failure, 429-ing
        // every subsequent launch for the lifetime of the process.
        try {
            // Scope every forensic store to this run before the engine touches them.
            ReproductionPlaybookStore.reset();
            resetBurstCounter();
            FuzzForensicLog.reset();
            NavForensicLog.reset();
            NetworkLogStore.reset();
            ConsoleLogStore.reset();

            // Register the run with the centralized SessionManager: it owns the
            // engine control surface, reconnect replay buffer, grace window, room
            // wiring, and target-health monitor. Upgrades the reservation the API
            // created before responding, so the room and its buffers survive.
            sessionManager.beginRun({
                runToken: resolvedRunToken,
                runCode,
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
                    message: `Launching Playwright session for ${targetUrl}`,
                },
            });

            // Phase 3: Execute engine with engine-managed timebox (FIXED: uses accumulative active time tracking)
            // The engine now tracks elapsedActiveTimeMs internally and only counts time when NOT paused.
            // This prevents timebox from expiring during pause state.
            const result = await this.browserEngine.run(targetUrl, this.telemetry, this.optimizationSettings, selectedScenarios, this.currentUserId ?? undefined, targetAuth);

            // Capture the engine's auto-created session id now, before it's
            // needed by a later, independent manualSaveToHistory() call.
            this.lastCompletedSessionId = this.browserEngine.getLastSessionId?.() ?? null;

// Check if the engine detected timebox exceeded (via its internal timing interval)
            if (result.outcome === 'timebox') {
                executionStatus = 'TIMEOUT';
                obsLog.info(`[StartExplorationUseCase] ️ Timebox of ${TIMEBOX_MS}ms exceeded (active time) - engine self-terminated`);

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

            executionStatus = EXECUTION_STATUS_BY_OUTCOME[result.outcome]
                ?? (result.completed ? 'COMPLETED' : 'HALTED');

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
                    terminationOutcome: result.outcome,
                    // Bare reason for surfaces that render it under the outcome label; the
                    // composed message keeps the label prefix for single-line contexts.
                    ...(result.reason ? { terminationReason: result.reason } : {}),
                    message: describeTermination(result.outcome, result.reason),
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

            // Attribute the fatal error before it can become a finding. A Playwright /
            // browser / environment failure (page.goto timeout, launch failure, closed
            // context, DNS) is an ENGINE fault, not a target-app defect — it goes to
            // diagnostics/session status, never the Findings tab. Only a fault attributed
            // to the target app is emitted as a forensic finding.
            const origin = classifyFaultOrigin({ faultType: 'EXCEPTION', message, url: targetUrl, targetOrigin: targetUrl });

            this.telemetry.emitTelemetry({
                timestamp: new Date().toISOString(),
                type: 'EXCEPTION',
                meta: {
                    message: origin.isTargetApp
                        ? `Fatal engine error: ${message}`
                        : `Engine error (${origin.origin}) — not a target-app defect: ${message}`,
                    exceptionDetails: { message, stackTrace },
                },
            });

            if (origin.isTargetApp) {
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
            } else {
                // Engine/runtime failure — diagnostics only. No forensic report ⇒ no finding.
                obsLog.error(`[StartExplorationUseCase] Engine-level failure (${origin.origin}), suppressed from Findings: ${origin.reason} | ${message}`, error);
            }
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
            sessionManager.endRun(executionStatus === 'CRASHED' ? 'CRASHED' : 'COMPLETED', resolvedRunToken);

            obsLog.info('[StartExplorationUseCase] Session terminated, status set to IDLE');
        }
    }
}
