import type { Express, Request, Response } from 'express';
import { parseTargetUrl, resolveEngineTargetUrl } from '../../serverUtils.js';
import { StartExplorationUseCase } from '../../application/useCases/StartExplorationUseCase.js';
import { readMaxQueueDepth, type TaskQueue } from '../../infrastructure/queue/TaskQueue.js';
import type { RunRegistry, RunRegistryEntry } from '../../infrastructure/queue/RunRegistry.js';
import type { ControlBridgePublisher } from '../../infrastructure/queue/controlBridge.js';
import type { QueueStatusBroadcaster } from '../../infrastructure/queue/QueueStatusBroadcaster.js';
import type { AuthVault } from '../../infrastructure/queue/AuthVault.js';
import type { FindingRepository } from '../../domain/repositories/FindingRepository.js';
import { requireAuth, optionalAuth, type AuthRequest } from '../authentication/authMiddleware.js';
import { startTestLimiter, analyzeLimiter, writeLimiter, readLimiter } from '../middleware/rateLimiter.js';
import { sessionManager } from '../../application/services/SessionManager.js';
import { randomUUID } from 'node:crypto';
import { forensicAnalysisRepository } from '../../infrastructure/database/repositories/ForensicAnalysisRepository.js';
import { forensicAnalysisService } from '../../domain/services/ForensicAnalysisService.js';
import { generateRemediation } from '../../infrastructure/ai/GeminiRemediationAdvisor.js';
import { determineRiskLevel } from '../../infrastructure/database/models/ForensicAnalysisModel.js';
import { forensicErrorRepository } from '../../infrastructure/database/repositories/ForensicErrorRepository.js';
import { forensicTelemetryRepository } from '../../infrastructure/database/repositories/ForensicTelemetryRepository.js';
import { networkLogRepository } from '../../infrastructure/database/repositories/NetworkLogRepository.js';
import { consoleLogRepository } from '../../infrastructure/database/repositories/ConsoleLogRepository.js';
import { SessionModel } from '../../infrastructure/database/models/SessionModel.js';
import { generateRunCode, generateUniqueRunCode } from '../../infrastructure/database/runCodeGenerator.js';
import { normalizeRunCode } from '../../../../shared/runCode.js';
import { Types } from 'mongoose';
import { extractStringParam, extractIntParam } from './queryParams.js';
import { parsePagination, buildPage, isPaginatedRequest } from './pagination.js';
import { deleteSessionCascade } from '../../infrastructure/database/retentionReaper.js';
import {
  INFILTRATION_PROFILE_CATALOG,
  resolveInfiltrationProfile,
  type TestingTypeId,
  type InfiltrationProfileId,
  type TargetAuthConfig,
  type OptimizationSettings,
  type ExplorationRunConfig,
  type FindingAttribution,
  type StateFingerprint,
  type ActionRecord,
  type RunTerminationOutcome,
  coerceClientStopReason,
  parseStorageState,
  type SuggestFixRequest,
  type SuggestFixResponse,
} from '../../../../shared/types.js';

// Ceiling on the "recent sessions" window used to scope ownership lookups.
const RECENT_SESSION_LOOKUP_LIMIT = 500;

// Resolve a URL id param to a Mongo query selector: a RUN- code targets `runId`,
// a 24-char ObjectId targets `_id`, anything else is unresolvable (null → 400/404).
function resolveSessionSelector(idOrCode: string): { _id: Types.ObjectId } | { runId: string } | null {
  const code = normalizeRunCode(idOrCode);
  if (code) return { runId: code };
  if (Types.ObjectId.isValid(idOrCode)) return { _id: new Types.ObjectId(idOrCode) };
  return null;
}

// Lazy Phase-3 safety net: a legacy doc served by id may still lack a runId; mint
// and persist one before returning so the caller always sees a public code.
async function ensureRunId(doc: { _id: Types.ObjectId; runId?: string | null }): Promise<string | undefined> {
  if (doc.runId) return doc.runId;
  try {
    const code = await generateUniqueRunCode(async (candidate) => !!(await SessionModel.exists({ runId: candidate })));
    await SessionModel.updateOne({ _id: doc._id, runId: { $in: [null, undefined] } }, { $set: { runId: code } });
    doc.runId = code;
    return code;
  } catch (error) {
    console.error('[API] Lazy runId backfill failed for', String(doc._id), error instanceof Error ? error.message : error);
    return undefined;
  }
}

/**
 * Interpret the client-supplied Unified Infiltration Profile into the concrete
 * TestingTypeId[] the ScenarioGate consumes. An unknown/absent profile resolves
 * to the all-enabled default; a CUSTOM profile honors its individual selection.
 */
function parseSelectedScenarios(body: unknown): TestingTypeId[] {
  const raw = (body as { infiltration?: unknown })?.infiltration as Partial<ExplorationRunConfig> | undefined;
  const knownProfiles = new Set<string>(INFILTRATION_PROFILE_CATALOG.map((profile) => profile.id));
  const profile = typeof raw?.profile === 'string' && knownProfiles.has(raw.profile)
    ? (raw.profile as InfiltrationProfileId)
    : undefined;

  if (!profile) return resolveInfiltrationProfile(undefined);
  const customScenarios = Array.isArray(raw?.customScenarios)
    ? (raw!.customScenarios as TestingTypeId[])
    : undefined;
  return resolveInfiltrationProfile({ profile, customScenarios });
}

/**
 * Extract ephemeral target-app authentication from the request body.
 *
 * Two modes: a form login (both username and password required — a partial
 * credential can only produce a failed login) or a pre-authenticated Playwright
 * storageState, structurally validated here so a malformed blob is rejected before
 * a browser is ever launched. Never log the returned object: it is the one value in
 * the request that must not reach a log line, a database, or the job queue.
 */
function parseTargetAuth(body: unknown): TargetAuthConfig | 'invalid' | undefined {
  const raw = (body as { targetAuth?: unknown })?.targetAuth as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return undefined;

  const optionalString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined;

  if (raw.mode === 'storageState') {
    const state = typeof raw.storageState === 'string' ? raw.storageState : '';
    // Malformed state is rejected, never downgraded: an unauthenticated run against
    // an authenticated target reports a clean result that is silently wrong.
    if (!state || !parseStorageState(state)) return 'invalid';
    return { mode: 'storageState', storageState: state, successIndicator: optionalString(raw.successIndicator) };
  }

  // Enforce the union discriminant: an absent or unknown mode used to fall
  // through and be silently treated as a credentials login.
  if (raw.mode !== 'credentials') return 'invalid';
  if (typeof raw.username !== 'string' || typeof raw.password !== 'string') return 'invalid';
  if (!raw.username || !raw.password) return 'invalid';

  return {
    mode: 'credentials',
    username: raw.username,
    password: raw.password,
    loginUrl: optionalString(raw.loginUrl),
    usernameSelector: optionalString(raw.usernameSelector),
    passwordSelector: optionalString(raw.passwordSelector),
    submitSelector: optionalString(raw.submitSelector),
    successIndicator: optionalString(raw.successIndicator),
  };
}

// ──────────────────────────────────────────────���──────────────────────────────
// Safe Parameter Extraction Utilities
// Addresses: string|string[] type issues from Express req.query/req.params
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sanitize and validate targetUrl to prevent NoSQL injection and XSS attacks
 * Ensures input is a plain string URL
 */
/**
 * Interface for session data used in forensic reports.
 * Represents the shape of session data from both savedsafaris and sessions collections.
 */
interface SessionReportData {
  _id?: unknown;
  targetUrl?: string;
  executionDate?: Date;
  timeElapsed?: number;
  status?: string;
  outcome?: RunTerminationOutcome;
  endedReason?: string;
  coveragePercentage?: number;
  metrics?: {
    totalActions?: number;
    totalBugsFound?: number;
    bugsByCategory?: Record<string, number>;
  };
  forensicTrace?: {
    finalBreadcrumbSteps?: string[];
    caughtBugs?: Array<{ type?: string }>;
  };
  actionSteps?: Array<{
    stepNumber: number;
    timestamp: string;
    actionType: string;
    selector: string;
    payloadText?: string;
    resultingStateHash: string;
  }>;
}



function sanitizeTargetUrl(targetUrl: unknown): string | null {
  if (typeof targetUrl !== 'string') {
    console.error('[SECURITY] targetUrl is not a string');
    return null;
  }
  const trimmed = targetUrl.trim();
  if (!trimmed) {
    console.error('[SECURITY] targetUrl is empty');
    return null;
  }
  // Check for NoSQL injection patterns
  if (trimmed.includes('$') && trimmed.match(/\$\w+/)) {
    console.error('[SECURITY] Potential NoSQL injection in targetUrl');
    return null;
  }
  // Basic URL format check - must start with http:// or https://
  if (!trimmed.match(/^https?:\/\/.+/)) {
    console.error('[SECURITY] Invalid URL format in targetUrl');
    return null;
  }
  return trimmed;
}

export function registerRoutes(
  app: Express,
  useCase: StartExplorationUseCase,
  port: number,
  findingRepo?: FindingRepository,
  // Opt-in distributed path: when a queue is supplied (index.ts builds it only
  // if BUGSAFARI_USE_QUEUE=1), /api/start-test enqueues the run for the Safari
  // worker fleet instead of executing it in-process. Undefined => sync default.
  taskQueue?: TaskQueue,
  // Redis-backed run index/snapshots for distributed recovery; present iff taskQueue is.
  runRegistry?: RunRegistry,
  // Reverse control channel to the worker fleet — lets the HTTP stop path reach a
  // run already executing out-of-process (socket-less fallback).
  controlPublisher?: ControlBridgePublisher,
  // Terminal queue push for a cancelled job (BullMQ emits none for a removal).
  queueBroadcaster?: QueueStatusBroadcaster,
  // Encrypted single-use handoff for target credentials on the distributed path.
  authVault?: AuthVault,
): void {
  // BullMQ states meaning "still waiting for a worker".
  const WAITING_STATES = new Set(['waiting', 'delayed', 'prioritized', 'waiting-children']);
  // Lifecycle states in which the run is still live (controls stay bound to it).
  const LIVE_LIFECYCLES = new Set(['QUEUED', 'STARTING', 'RUNNING', 'PAUSING', 'PAUSED', 'STOPPING', 'INTERRUPTED']);

  // Backlog ceiling for the distributed path, read once at wiring time.
  const maxQueueDepth = readMaxQueueDepth();

  // Minimal QUEUED snapshot for a job still in line (no engine, no buffers yet).
  const queuedSnapshot = (entry: RunRegistryEntry, position: number | null, queueDepth: number, fleet?: { activeCount: number; workerCount: number | null }) => ({
    runId: entry.runCode,
    runToken: entry.runToken,
    jobId: entry.jobId,
    ownerType: entry.userId ? 'authenticated' as const : 'guest' as const,
    targetUrl: entry.targetUrl,
    currentUrl: entry.targetUrl,
    status: 'QUEUED' as const,
    startedAt: entry.createdAt,
    elapsedTimeMs: 0,
    timeboxMs: entry.timeboxMs,
    telemetry: [],
    reports: [],
    incidents: [],
    accessibility: [],
    lastFrame: null,
    queuePosition: position,
    queueDepth,
    queueActiveCount: fleet?.activeCount ?? 0,
    queueWorkerCount: fleet?.workerCount ?? null,
  });
// Health check - public
  app.get('/api/health', (_request: Request, response: Response) => {
    response.json({ status: "healthy" });
  });

  // Explicit Safari stop endpoint — cancels a QUEUED job or terminates a RUNNING
  // one, in either the distributed (worker fleet) or synchronous topology.
  // Uses the same optionalAuth as /api/start-test (guests may still stop a run),
  // but scopes the stop to the session's own owner: possession of the server-issued
  // runId, or a matching authenticated identity, so an unrelated caller can't kill
  // someone else's session. `ok` reflects the ACTUAL outcome — a failed stop never
  // reports success, so the dashboard can trust it before resetting its own state.
  app.post('/api/safari/stop', writeLimiter, optionalAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    const knownRunToken = typeof request.body?.runToken === 'string' && request.body.runToken ? request.body.runToken : undefined;
    const userId = request.userId ?? null;
    // Client may assert operator/timebox only; anything else coerces to operator.
    const stopReason = coerceClientStopReason(request.body?.reason);
    console.log(`[API]  POST /api/safari/stop received (runToken=${knownRunToken ?? 'n/a'}, reason=${stopReason})`);

    // ── Distributed topology: the run lives in Redis/BullMQ, not in this process.
    if (taskQueue && runRegistry && (knownRunToken || userId)) {
      try {
        // Without a run token an authenticated operator is still resolvable by
        // identity. Falling straight through used to answer {ok:true,
        // alreadyStopped:true} while the worker kept running — a false success.
        const entry = knownRunToken
          ? await runRegistry.findByRunToken(knownRunToken)
          : await runRegistry.findByOwner(userId!);
        // A guest entry is possession-proven (its userId is null); an authenticated
        // one demands the matching identity.
        if (entry && entry.userId && entry.userId !== userId) {
          console.warn('[API]  Stop rejected: requester does not own the queued run');
          response.status(403).json({ ok: false, error: 'You do not have permission to stop this session.' });
          return;
        }

        if (entry) {
          const state = await taskQueue.getJobState(entry.jobId).catch(() => 'unknown');

          if (WAITING_STATES.has(state)) {
            const { removed, state: observed } = await taskQueue.cancelQueuedJob(entry.jobId);
            if (!removed && observed === 'active') {
              // Raced a worker between the state read and the removal — fall through
              // to the running path rather than reporting a cancel that didn't happen.
              controlPublisher?.publish('stop', entry.runToken, stopReason);
              response.json({ ok: true, stopping: true, message: 'Run started before cancellation; stop dispatched to the worker.' });
              return;
            }
            if (!removed) {
              console.error(`[API]  Could not remove queued job ${entry.jobId} (state=${observed})`);
              response.status(409).json({ ok: false, error: 'The queued session could not be cancelled. Please retry.' });
              return;
            }
            await runRegistry.clear(entry.runToken, entry.userId);
            // No worker will ever consume the sealed credentials now.
            await authVault?.discard(entry.runToken);
            await queueBroadcaster?.broadcastCancelled(entry.jobId).catch(() => undefined);
            console.log(`[API] Queued job ${entry.jobId} cancelled before pickup`);
            response.json({ ok: true, cancelled: true, jobId: entry.jobId, message: 'Queued session cancelled.' });
            return;
          }

          if (state === 'active') {
            if (!controlPublisher) {
              response.status(503).json({ ok: false, error: 'Stop channel to the worker fleet is unavailable.' });
              return;
            }
            controlPublisher.publish('stop', entry.runToken, stopReason);
            console.log(`[API]  Stop bridged to worker for run ${entry.runToken} (reason=${stopReason})`);
            response.json({ ok: true, stopping: true, message: 'Stop dispatched to the executing worker.' });
            return;
          }

          // Terminal/vanished job — clean the stale index and report it idempotently.
          await runRegistry.clear(entry.runToken, entry.userId);
          response.json({ ok: true, alreadyStopped: true, message: 'This session had already finished.' });
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[API]  Distributed stop failed:', message);
        response.status(502).json({ ok: false, error: 'Could not reach the run queue to stop this session.' });
        return;
      }
    }

    // ── Synchronous topology: the engine runs in this process.
    const activeEngine = sessionManager.getActiveEngine();
    if (!activeEngine) {
      console.log('[API] No active engine to stop - already IDLE');
      response.json({ ok: true, alreadyStopped: true, message: 'No active session to stop.' });
      return;
    }

    if (!sessionManager.ownsActiveRun(userId, knownRunToken)) {
      console.warn('[API]  Stop rejected: requester does not own the active session');
      response.status(403).json({ ok: false, error: 'You do not have permission to stop this session.' });
      return;
    }

    try {
      await sessionManager.stopByOperator(stopReason);
      console.log('[API] Engine stopped successfully via HTTP endpoint');
      response.json({ ok: true, stopped: true, message: 'Safari session stopped.' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[API] Error stopping engine:', errorMessage);
      response.status(500).json({ ok: false, error: `Failed to stop the session: ${errorMessage}` });
    }
  });

  // Start test - allowed for guests (optional auth)
  // IMPORTANT: Set the authenticated userId before executing so it persists to saved documents
  app.post('/api/start-test', startTestLimiter, optionalAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    console.log(`[API]  POST /api/start-test received`);
    console.log(`[API] Auth user: ${request.userId ?? 'guest'}`);

    const targetUrl = parseTargetUrl(request.body);
    if (!targetUrl) {
      console.warn(`[API]  Invalid URL in request`);
      response.status(400).json({ error: 'A valid url is required.' });
      return;
    }

    // Resolve the operator-selected Unified Infiltration Profile into gated scenario
    // categories BEFORE the queue branch, so a distributed run carries the same gate
    // as a synchronous one (otherwise the worker defaults to all testing types).
    const selectedScenarios = parseSelectedScenarios(request.body);
    console.log(`[API] Infiltration profile resolved to:`, selectedScenarios);

    // Run token the client already holds from a previous launch (localStorage) —
    // possession proves ownership, letting a refreshed client (incl. guests)
    // resume its live run instead of double-submitting.
    const knownRunId = typeof request.body?.knownRunToken === 'string' && request.body.knownRunToken
      ? (request.body.knownRunToken as string)
      : undefined;

    // Ephemeral target-app credentials. Never logged here or anywhere downstream.
    const parsedAuth = parseTargetAuth(request.body);
    if (parsedAuth === 'invalid') {
      response.status(400).json({
        error: 'AUTH_CONFIG_INVALID',
        message: 'Target authentication is incomplete: supply both a username and a password, or a valid Playwright storageState.',
      });
      return;
    }
    const targetAuth = parsedAuth;

    // Resolved before the queue branch so a distributed run enforces the same
    // timebox and tuning as a synchronous one.
    const optimizationSettings = request.body?.optimization as OptimizationSettings | undefined;
    console.log(`[API] Optimization settings:`, optimizationSettings);

    // Opt-in distributed path: hand the run to the Safari worker fleet instead of
    // running it in this process. Deliberately BEFORE tryActivate — the queue path
    // owns no in-process engine slot; admission is the worker's concern, so this
    // must not touch the synchronous use case's active flag. Target routing is left
    // to the worker (resolveEngineTargetUrl runs there against the browser's own
    // network view). Guest runs (no userId) enqueue too; the worker persists nothing.
    if (taskQueue) {
      // Credentials never enter the job payload: BullMQ retains failed jobs in
      // Redis for 24h in plaintext. They travel through the AuthVault instead —
      // AES-256-GCM, 10-minute TTL, destroyed on first read by the worker. With
      // no vault key configured we refuse rather than downgrade to an
      // unauthenticated run, which would report a clean result for an app whose
      // authenticated surface was never tested.
      if (targetAuth && !authVault) {
        response.status(400).json({
          error: 'AUTH_UNSUPPORTED_ON_QUEUE',
          message: 'Authenticated queued runs require BUGSAFARI_AUTH_KEY (32-byte hex or base64) so credentials can be encrypted in transit. Set it, or run with the queue disabled.',
        });
        return;
      }
      try {
        // Duplicate-submission guard: if this requester already owns a queued or
        // running job, hand back its identifiers so the client resumes it.
        if (runRegistry) {
          const existing = request.userId
            ? await runRegistry.findByOwner(request.userId)
            : (knownRunId ? await runRegistry.findByRunToken(knownRunId) : null);
          if (existing && (!existing.userId || existing.userId === (request.userId ?? null))) {
            const state = await taskQueue.getJobState(existing.jobId).catch(() => 'unknown');
            if (state === 'active' || WAITING_STATES.has(state)) {
              console.log(`[API] ️ Requester already owns job ${existing.jobId} (${state}) — resuming instead of enqueueing.`);
              // runToken re-joins run:${runToken}; runId is the public code for display.
              response.status(202).json({ accepted: true, resumed: true, url: existing.targetUrl, jobId: existing.jobId, runToken: existing.runToken, runId: existing.runCode, queued: state !== 'active' });
              return;
            }
            await runRegistry.clear(existing.runToken, existing.userId);
          }
        }

        // Bounded backlog. Without a ceiling one burst pins every job payload in
        // Redis and hands later operators a wait no UI can honestly display; the
        // duplicate-submission guard above already let this requester resume, so
        // anyone reaching here is genuinely adding to the line.
        const waiting = await taskQueue.waitingCount();
        if (waiting >= maxQueueDepth) {
          console.warn(`[API] Queue full: ${waiting}/${maxQueueDepth} waiting — rejecting launch for ${targetUrl}`);
          response.status(503).json({
            error: 'QUEUE_FULL',
            message: `The testing fleet is saturated (${waiting} runs already waiting). Please retry shortly.`,
            queueDepth: waiting,
          });
          return;
        }

        // Issue the run token AND the public code up front so the registry entry and
        // the sealed credentials both exist BEFORE a worker can possibly claim the job.
        const queuedRunToken = randomUUID();
        const queuedRunCode = generateRunCode();
        const timeboxMs = optimizationSettings?.['execution-timebox-ms'] ?? 600_000;
        const entry = {
          runToken: queuedRunToken,
          runCode: queuedRunCode,
          userId: request.userId ?? null,
          targetUrl,
          timeboxMs,
          createdAt: new Date().toISOString(),
        };

        // Register first, enqueue second. The reverse order left a live job with
        // no registry entry whenever register() failed: invisible to
        // /api/session/active, unstoppable, unresumable — a true orphan.
        await runRegistry?.register({ ...entry, jobId: 'pending' });
        if (targetAuth && authVault) await authVault.put(queuedRunToken, targetAuth);

        let enqueued;
        try {
          enqueued = await taskQueue.addSafariTask({
            targetUrl,
            requestedBy: request.userId ?? undefined,
            runToken: queuedRunToken,
            runCode: queuedRunCode,
            selectedScenarios,
            optimizationSettings,
            hasAuth: Boolean(targetAuth),
          });
        } catch (error) {
          // Compensate so a failed enqueue leaves neither a phantom entry nor
          // orphaned ciphertext behind.
          await runRegistry?.clear(queuedRunToken, entry.userId).catch(() => undefined);
          await authVault?.discard(queuedRunToken);
          throw error;
        }

        await runRegistry?.register({ ...entry, jobId: enqueued.id });
        console.log(`[API]  Enqueued safari job ${enqueued.id} runToken=${enqueued.runToken} runCode=${enqueued.runCode} for ${targetUrl} (queue=${enqueued.queueName}, auth=${targetAuth ? 'sealed' : 'none'})`);
        // runToken lets the client join run:${runToken} for bridged worker telemetry;
        // jobId lets it subscribe to queue:${jobId} position pushes; runId is the public code.
        response.status(202).json({ accepted: true, url: targetUrl, jobId: enqueued.id, runToken: enqueued.runToken, runId: enqueued.runCode, queued: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[API]  Failed to enqueue safari job:', message);
        response.status(502).json({ error: 'Failed to enqueue the run on the worker fleet.' });
      }
      return;
    }

    // Atomically claim the "active" slot right here, synchronously, so two
    // concurrent requests can't both pass this check before either marks the
    // use case active (see StartExplorationUseCase.tryActivate() for why).
    if (!useCase.tryActivate()) {
      // If the busy run belongs to THIS requester, resume it instead of erroring —
      // a refreshed client that re-submits reconnects to its own live session.
      const owned = sessionManager.getSnapshotFor(request.userId ?? null, knownRunId);
      if (owned && LIVE_LIFECYCLES.has(owned.status)) {
        console.log(`[API] ️ Requester owns the active run ${owned.runId} — resuming instead of rejecting.`);
        response.json({ accepted: true, resumed: true, url: owned.targetUrl, runToken: owned.runToken, runId: owned.runId, queued: false });
        return;
      }
      console.warn(`[API]  Safari already running - rejecting request`);
      response.status(429).json({ error: 'A BugSafari run is already active.' });
      return;
    }

    // Always (re)set the userId from auth middleware — this ensures saved documents
    // use the real operator ID and resets the singleton's context so a guest run
    // never inherits a previous authenticated user's id. Undefined => guest (no persist).
    useCase.setUserId(request.userId ?? null);
    console.log(request.userId
      ? `[API] ✓ Set userId for exploration session: ${request.userId}`
      : `[API] No authenticated userId - guest session (no persistence)`);

    // (optimizationSettings and selectedScenarios resolved above, before the queue branch.)

    // Route the target for the active RUN_ENVIRONMENT before launch: bridge
    // loopback in DOCKER_LOCAL, or reject an unreachable private address in
    // CLOUD_HOSTED with a clear operator message. Reject BEFORE accepting.
    const routing = resolveEngineTargetUrl(targetUrl);
    if (!routing.ok) {
      console.warn(`[API]  Target rejected: ${routing.message}`);
      // Roll back the slot claimed above — we're bailing out without ever
      // calling execute(), so nothing else will reset it to false.
      useCase.releaseActivation();
      response.status(422).json({ error: routing.message });
      return;
    }
    const engineUrl = routing.url;
    if (routing.rewritten) {
      console.log(`[API]  Routed target for engine: ${targetUrl} -> ${engineUrl} (${routing.note})`);
    }

    // Server-issued run token: returned to the client (stored client-side) so a
    // returning socket — including a guest after a full refresh — can prove
    // ownership and re-attach to this exact run. The public RUN- code is minted
    // alongside it and threaded into execute() so the reservation, the DB doc, and
    // the response all carry the SAME code (no live/history drift).
    const runToken = randomUUID();
    const runCode = generateRunCode();

    // Create the run's room and replay buffers BEFORE responding. The client
    // attaches the instant it sees this response; without the reservation it
    // raced the engine's async boot, was told 'no-active-session', never joined
    // run:${runToken}, and stayed deaf for the whole run (the "stuck loading" bug).
    const timeboxMs = optimizationSettings?.['execution-timebox-ms'] ?? 600_000;
    sessionManager.reserveRun({
      runToken,
      runCode,
      userId: request.userId ?? null,
      targetUrl,
      timeboxMs,
      onAbandoned: () => useCase.releaseActivation(),
    });

    console.log(`[API] Accepting safari launch for: ${targetUrl} (runToken=${runToken}, runCode=${runCode})`);
    // Operator sees their original URL; the engine dials the routed one.
    response.json({ accepted: true, url: targetUrl, runToken, runId: runCode });
    console.log(`[API] Starting safari in background...`);
    // Fire-and-forget, but never unhandled: a rejection here means the run died
    // before its own finally could report anything, so we must publish the
    // terminal handshake ourselves or the dashboard waits forever.
    void useCase.execute(engineUrl, optimizationSettings, selectedScenarios, runToken, targetAuth, runCode)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[API]  Safari run ${runToken} failed to start:`, message);
        sessionManager.failRun(`Engine failed to start: ${message}`);
        useCase.releaseActivation();
      });
  });

  // Restore-on-load: a returning client asks whether it owns an active run and,
  // if so, gets the full replay snapshot to rebuild the live dashboard. Uses the
  // same optionalAuth as start-test — authed users are matched by identity, guests
  // by the runToken they present. Returns { snapshot: null } when nothing is owned.
  app.get('/api/session/active', readLimiter, optionalAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    const runToken = extractStringParam(request.query.runToken);
    const local = sessionManager.getSnapshotFor(request.userId ?? null, runToken);
    if (local || !taskQueue || !runRegistry) {
      response.json({ snapshot: local });
      return;
    }

    // Distributed mode: the run (if any) lives in a worker process — resolve it
    // through the Redis registry, with BullMQ as the authority on job state.
    try {
      const entry = runToken
        ? await runRegistry.findByRunToken(runToken)
        : (request.userId ? await runRegistry.findByOwner(request.userId) : null);
      // An authenticated run demands a matching identity. Previously the check
      // was skipped whenever the CALLER was anonymous, so presenting the runToken
      // with no token returned another user's live snapshot. Guest-owned entries
      // stay possession-proven (entry.userId is null).
      if (!entry || (entry.userId && entry.userId !== (request.userId ?? null))) {
        response.json({ snapshot: null });
        return;
      }

      const state = await taskQueue.getJobState(entry.jobId).catch(() => 'unknown');
      if (WAITING_STATES.has(state)) {
        const { order, queueDepth, activeCount, workerCount } = await taskQueue.positions();
        const index = order.indexOf(entry.jobId);
        response.json({ snapshot: queuedSnapshot(entry, index >= 0 ? index + 1 : null, queueDepth, { activeCount, workerCount }) });
        return;
      }
      if (state === 'active') {
        // Worker publishes a throttled replay snapshot to Redis; fall back to a
        // minimal RUNNING shell if the run just started and none exists yet.
        const workerSnapshot = await runRegistry.readSnapshot(entry.runToken);
        const snapshot = workerSnapshot
          ? { ...workerSnapshot, jobId: entry.jobId }
          : { ...queuedSnapshot(entry, null, 0), status: 'RUNNING' as const };
        response.json({ snapshot });
        return;
      }

      // Job finished/failed/vanished: serve the worker-published FINAL state if
      // one exists (post-completion refresh restores the finished dashboard);
      // otherwise the entry is stale — clean it up.
      const finalSnapshot = await runRegistry.readSnapshot(entry.runToken);
      if (finalSnapshot && !LIVE_LIFECYCLES.has(finalSnapshot.status)) {
        response.json({ snapshot: { ...finalSnapshot, jobId: entry.jobId } });
        return;
      }
      await runRegistry.clear(entry.runToken, entry.userId);
      response.json({ snapshot: null });
    } catch (error) {
      console.error('[API] /api/session/active distributed lookup failed:', error instanceof Error ? error.message : error);
      response.json({ snapshot: null });
    }
  });

// Save session - REQUIRES authentication (no guest saves allowed)
  app.post('/api/history/save-session', writeLimiter, requireAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    console.log('[API] POST /api/history/save-session called');
    console.log('[API] Auth user:', request.userId ?? 'none');
    console.log('[API] Is guest:', request.isGuest);

    // GUEST CHECK: requireAuth already validated JWT, but double-check for safety
    // If somehow we reached here without a valid userId, reject as guest
    if (!request.userId) {
      console.warn('[API]  Guest save attempt rejected: No authenticated userId');
      response.status(403).json({
        error: 'Registration required to save history.',
        code: 'GUEST_FORBIDDEN',
        requiresRegistration: true,
      });
      return;
    }

    const userId = request.userId;
    const ownerType = 'authenticated';

    try {
      // SECURITY: Sanitize both URLs to prevent NoSQL injection.
      // Bug A fix: anchor the session header to the baseline *input* URL
      // (initialUrl) rather than the runtime sub-route captured at save time.
      // Older clients that don't send initialUrl fall back to targetUrl.
      const baseUrl = sanitizeTargetUrl(request.body?.initialUrl) ?? sanitizeTargetUrl(request.body?.targetUrl);
      console.log('[API] Base target URL to save:', baseUrl);

      if (!baseUrl) {
        console.warn('[API] No targetUrl provided in request body or invalid format');
        response.status(400).json({ error: 'targetUrl is required and must be a valid URL.' });
        return;
      }

      const elapsedTimeMs = typeof request.body?.elapsedTimeMs === 'number'
        ? request.body.elapsedTimeMs as number
        : undefined;

      // Parity fix: accept the complete, uncompressed findings array transferred
      // from the live dashboard Error Tab and pass it straight through. No
      // dedup/filter/slice here — every finding is preserved.
      const rawFindings: unknown = request.body?.findings;
      const clientFindings = (Array.isArray(rawFindings) ? rawFindings : [])
        .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
        .map((f) => ({
          bugId: typeof f.bugId === 'string' ? f.bugId : undefined,
          type: typeof f.type === 'string' ? f.type : undefined,
          message: typeof f.message === 'string' ? f.message : undefined,
          selector: typeof f.selector === 'string' ? f.selector : undefined,
          payloadUsed: typeof f.payloadUsed === 'string' ? f.payloadUsed : undefined,
          advice: typeof f.advice === 'string' ? f.advice : undefined,
          stackTrace: typeof f.stackTrace === 'string' ? f.stackTrace : undefined,
          reproductionSteps: Array.isArray(f.reproductionSteps)
            ? f.reproductionSteps.filter((s): s is string => typeof s === 'string')
            : undefined,
          // Replayable per-finding timeline (with MACRO) transferred client-side so
          // queue-mode saves preserve what Verify Fix replays.
          reproductionActions: Array.isArray(f.reproductionActions)
            ? (f.reproductionActions as unknown as ActionRecord[])
            : undefined,
          timestamp: typeof f.timestamp === 'string' ? f.timestamp : undefined,
          // Carry the knowledge-base attribution through so the saved report's
          // finding cards show bugClass / scenario / CWE / step badges (Mongoose
          // strips any unknown keys against the caughtBugs.attribution sub-schema).
          attribution: f.attribution && typeof f.attribution === 'object'
            ? (f.attribution as unknown as FindingAttribution)
            : undefined,
          stateFingerprint: f.stateFingerprint && typeof f.stateFingerprint === 'object'
            ? (f.stateFingerprint as unknown as StateFingerprint)
            : undefined,
          severity: typeof f.severity === 'string' ? f.severity : undefined,
        }));
      console.log(`[API] Transferred live findings count: ${clientFindings.length}`);

      // Full live Network + Console streams transferred from the dashboard so the
      // saved report mirrors the live tabs (the run executes out-of-process, so the
      // client buffers are the authoritative source at save time). Capped defensively.
      const asArray = (v: unknown): Record<string, unknown>[] =>
        (Array.isArray(v) ? v : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
      const clientNetworkLog = asArray(request.body?.networkLog).slice(0, 2000);
      const clientConsoleLog = asArray(request.body?.consoleLog).slice(0, 1000);
      console.log(`[API] Transferred network rows: ${clientNetworkLog.length} | console rows: ${clientConsoleLog.length}`);

      // Call manualSaveToHistory to save to sessions collection
      const result = await useCase.manualSaveToHistory(baseUrl, userId, { ownerType, elapsedTimeMs, clientFindings, clientNetworkLog, clientConsoleLog });

      if (!result.success) {
        console.warn('[API] Manual save failed:', result.message);
        response.status(500).json({ error: 'Failed to save the session.' });
        return;
      }

console.log('[API] Saved to sessions:', result.message, '| runId:', result.runId ?? 'n/a', '| ownerType:', ownerType, '| userId:', userId);
      // Explicitly return 201 Created status for resource creation. runId is the
      // saved doc's public RUN- code for the client to display/deep-link.
      response.status(201).json({ ok: true, message: result.message, runId: result.runId, ownerType });
    } catch (error) {
      console.error('[API] Error saving session:', error);
      response.status(500).json({ error: 'Failed to save the session.' });
    }
  });

// Session history - REQUIRES authentication (returns only user's sessions)
  app.get('/api/history/sessions', readLimiter, requireAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    console.log('[API] GET /api/history/sessions called with query:', request.query);
    console.log('[API] Auth user:', request.userId ?? 'none');
    console.log('[API] Is guest:', request.isGuest);

    // GUEST CHECK: requireAuth already validated JWT, but double-check for safety
    if (!request.userId) {
      console.warn('[API]  Guest history access rejected: No authenticated userId');
      response.status(403).json({
        error: 'Registration required to view session history.',
        code: 'GUEST_FORBIDDEN',
        requiresRegistration: true,
        sessions: [],
      });
      return;
    }

    // Wrap entire endpoint in try/catch for comprehensive error handling
    try {
      if (!findingRepo) {
        console.warn('[API] findingRepo is undefined - database not connected');
        response.json({ sessions: [] });
        return;
      }

      // Legacy ?limit= maps onto pageSize so pre-pagination clients keep working.
      const params = parsePagination(request.query, extractIntParam(request.query.limit));

      // CRITICAL: Pass userId to filter only this user's sessions
      const { items, total } = await findingRepo.listSessionHistory(params, request.userId);
      const page = buildPage(items, total, params);

      // Dual envelope: `sessions` keeps existing clients working, the paginated
      // fields let new ones page. Both are always present.
      response.json({ sessions: page.items, ...page });
    } catch (error) {
      // Comprehensive error handling with explicit log message
      console.error('[API] Error in /api/history/sessions:', error);
      response.status(500).json({ error: 'Failed to fetch session history.', sessions: [] });
    }
  });

// Safari run history - requires authentication
  // UPDATED: Query sessions collection instead of savedsafaris for unified history
  app.get('/api/history', readLimiter, requireAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    console.log('[API] GET /api/history called');
    console.log('[API] Authenticated user:', request.userId ?? 'none');
    console.log('[API] Auth email:', request.userEmail ?? 'none');

    try {
      const userId = request.userId;
      if (!userId) {
        console.warn('[API] No userId in authenticated request');
        response.status(401).json({ error: 'Authentication required.' });
        return;
      }

      // Query sessions collection by userId (unified history). Only manually
      // saved sessions count as "history" — auto-tracked runs stay invisible
      // until the operator explicitly clicks Save.
      const params = parsePagination(request.query);
      const filter = { userId: new Types.ObjectId(userId), savedManually: true };

      // forensicTrace.caughtBugs carries full stack traces and dominates the
      // payload, so it ships only when explicitly requested.
      const includeBugs = extractStringParam(request.query.include) === 'bugs';
      const query = SessionModel.find(filter)
        .sort({ startedAt: -1 })
        .skip(params.skip)
        .limit(params.pageSize);

      const [total, sessions] = await Promise.all([
        SessionModel.countDocuments(filter),
        (includeBugs ? query : query.select('-forensicTrace.caughtBugs')).lean(),
      ]);

      const page = buildPage(sessions, total, params);

      // Legacy shape is a bare array; the envelope ships only when asked for.
      response.json(isPaginatedRequest(request.query) ? page : page.items);
    } catch (error) {
      console.error('[API] Error in /api/history:', error);
      response.status(500).json({ error: 'Failed to fetch safari history.' });
    }
  });

// Delete a session by ID (using sessions collection)
  app.delete('/api/history/:id', writeLimiter, requireAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    console.log('[API] DELETE /api/history/:id called');
    console.log('[API] Record ID:', request.params.id);
    console.log('[API] Authenticated user:', request.userId ?? 'none');

    try {
      const userId = request.userId;
      // Accept either an ObjectId or a public RUN- code.
      const selector = resolveSessionSelector(extractStringParam(request.params.id) ?? '');

      if (!userId) {
        response.status(401).json({ error: 'Authentication required.' });
        return;
      }

      if (!selector) {
        response.status(400).json({ error: 'Invalid record ID format.' });
        return;
      }

      console.log('[API] Deleting session record:', selector, 'for user:', userId);

      // findOneAndDelete resolves the doc's _id (needed for the cascade) while its
      // filter proves ownership — a RUN- code alone never yields a foreign _id.
      const deleted = await SessionModel.findOneAndDelete({
        ...selector,
        userId: new Types.ObjectId(userId),
      }).lean();

      if (!deleted) {
        console.warn('[API] Delete failed: Record not found or not owned by user');
        response.status(404).json({ error: 'Record not found or access denied.' });
        return;
      }

      // Ownership was proven by the filter above, so the cascade is safe. Without
      // it the run's forensic errors, telemetry, logs and brain configs would
      // linger forever with no parent session.
      const cascaded = await deleteSessionCascade(deleted._id).catch((error: unknown) => {
        console.error('[API] Cascade delete failed for session', String(deleted._id), error);
        return null;
      });

      console.log('[API] Record deleted successfully:', String(deleted._id), 'cascade:', cascaded ?? 'failed');
      response.json({ ok: true, message: 'Record deleted successfully.' });
    } catch (error) {
      console.error('[API] Error in DELETE /api/history/:id:', error);
      response.status(500).json({ error: 'Failed to delete the record.' });
    }
  });

// Export a session record as JSON (using sessions collection)
  app.get('/api/history/export/:id', readLimiter, requireAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    console.log('[API] GET /api/history/export/:id called');
    console.log('[API] Record ID to export:', request.params.id);
    console.log('[API] Authenticated user:', request.userId ?? 'none');

    try {
      const userId = request.userId;
      if (!userId) {
        console.warn('[API] No userId in authenticated request');
        response.status(401).json({ error: 'Authentication required.' });
        return;
      }

      // Accept either an ObjectId or a public RUN- code.
      const selector = resolveSessionSelector(extractStringParam(request.params.id) ?? '');
      if (!selector) {
        response.status(400).json({ error: 'Invalid record ID format.' });
        return;
      }

      console.log('[API] Fetching session record for export:', selector, 'for user:', userId);

      // Use SessionModel.findOne with userId for ownership check
      const record = await SessionModel.findOne({
        ...selector,
        userId: new Types.ObjectId(userId),
      }).lean();

      if (!record) {
        console.warn('[API] Record not found or access denied:', selector);
        response.status(404).json({ error: 'Record not found or access denied.' });
        return;
      }

      // Prefer the public code in the filename; fall back to the _id for legacy docs.
      const exportName = record.runId ?? String(record._id);
      console.log('[API] Record found for export:', exportName);
      // Strip internal identifiers from the downloaded payload — the export keys
      // off the public runId, never the Mongo _id / owner userId.
      const { _id: _ignoredId, userId: _ignoredUser, __v: _ignoredVersion, ...safeRecord } =
        record as typeof record & { __v?: unknown };
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Content-Disposition', `attachment; filename="safari-${exportName}.json"`);
      response.json(safeRecord);
    } catch (error) {
      console.error('[API] Error in GET /api/history/export/:id:', error);
      response.status(500).json({ error: 'Failed to export the record.' });
    }
  });

  //  Phase 5: Forensic Analysis API - Get analysis for a test run
  // requireAuth + tenant scoping: forensic analyses expose rootCause/riskScore/recommendations,
  // so a run's analysis is readable only by the user who owns that run's session.
  app.get('/api/forensic/analysis', readLimiter, requireAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    console.log('[API] GET /api/forensic/analysis called with query:', request.query);

    try {
      const userId = request.userId;
      if (!userId) {
        response.status(401).json({ error: 'Authentication required.' });
        return;
      }
      const sessionId = typeof request.query.sessionId === 'string' ? request.query.sessionId : undefined;

      if (!sessionId) {
        // No session id → latest analysis among THIS user's own sessions only.
        // Bounded to the most recent sessions: an unbounded fetch built an $in
        // that grew with the account's entire history. Trade-off: an analysis
        // attached to a session older than this window is not surfaced here.
        const ownSessions = await SessionModel.find({ userId: new Types.ObjectId(userId) })
          .sort({ startedAt: -1 })
          .limit(RECENT_SESSION_LOOKUP_LIMIT)
          .select('_id')
          .lean();
        const latest = await forensicAnalysisRepository.findLatestForRuns(ownSessions.map((s) => s._id));
        if (!latest) {
          response.json({ analysis: null, message: 'No analysis available yet. Run a test first.' });
          return;
        }
        response.json({
          analysis: {
            rootCause: latest.rootCause,
            riskScore: latest.riskScore,
            riskLevel: latest.riskLevel,
            recommendations: latest.recommendations,
            errorCount: latest.errorCount,
            apiFailureCount: latest.apiFailureCount,
            criticalErrorCount: latest.criticalErrorCount,
            jsExceptionCount: latest.jsExceptionCount,
            createdAt: latest.createdAt?.toISOString(),
          },
        });
        return;
      }

      // Explicit session id (ObjectId or RUN- code) → confirm the caller owns that
      // session, then key children by its resolved _id.
      const selector = resolveSessionSelector(sessionId);
      if (!selector) {
        response.status(400).json({ error: 'Invalid session ID format.' });
        return;
      }
      const ownedDoc = await SessionModel.findOne({
        ...selector,
        userId: new Types.ObjectId(userId),
      }).select('_id').lean();
      if (!ownedDoc) {
        response.status(404).json({ analysis: null, error: 'Session not found or access denied.' });
        return;
      }

      const analysis = await forensicAnalysisRepository.findByRunId(String(ownedDoc._id));
      if (!analysis) {
        response.json({ analysis: null, message: 'No analysis found for this session. Run a test first.' });
        return;
      }

      response.json({
        analysis: {
          rootCause: analysis.rootCause,
          riskScore: analysis.riskScore,
          riskLevel: analysis.riskLevel,
          recommendations: analysis.recommendations,
          errorCount: analysis.errorCount,
          apiFailureCount: analysis.apiFailureCount,
          criticalErrorCount: analysis.criticalErrorCount,
          jsExceptionCount: analysis.jsExceptionCount,
          createdAt: analysis.createdAt?.toISOString(),
        },
      });
    } catch (error) {
      console.error('[API] Error in /api/forensic/analysis:', error);
      response.status(500).json({ error: 'Failed to fetch the analysis.', analysis: null });
    }
  });

  //  Phase 5: Trigger forensic analysis generation
  // requireAuth + ownership: analyzeRun() is compute-heavy and reads a run's session/errors,
  // so only the session owner may trigger it (prevents anonymous DoS + foreign-session reads).
  app.post('/api/forensic/analyze', analyzeLimiter, requireAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    console.log('[API] POST /api/forensic/analyze called');

    try {
      const userId = request.userId;
      if (!userId) {
        response.status(401).json({ error: 'Authentication required.' });
        return;
      }
      const sessionId = typeof request.body?.sessionId === 'string' ? request.body.sessionId : undefined;

      if (!sessionId) {
        response.status(400).json({ error: 'sessionId is required in request body.' });
        return;
      }
      // Accept either an ObjectId or a public RUN- code, then resolve to the _id.
      const selector = resolveSessionSelector(sessionId);
      if (!selector) {
        response.status(400).json({ error: 'Invalid session ID format.' });
        return;
      }
      const ownedDoc = await SessionModel.findOne({
        ...selector,
        userId: new Types.ObjectId(userId),
      }).select('_id').lean();
      if (!ownedDoc) {
        response.status(404).json({ error: 'Session not found or access denied.' });
        return;
      }
      const resolvedSessionId = String(ownedDoc._id);

      console.log('[API] Generating forensic analysis for session:', resolvedSessionId);
      const result = await forensicAnalysisService.analyzeRun(resolvedSessionId);

      if (!result.analysis) {
        response.status(500).json({ error: 'Failed to generate analysis', analysis: null });
        return;
      }

      console.log('[API] Analysis generated successfully, risk score:', result.analysis.riskScore);
      response.json({
        analysis: {
          rootCause: result.analysis.rootCause,
          riskScore: result.analysis.riskScore,
          riskLevel: result.analysis.riskLevel,
          recommendations: result.analysis.recommendations,
          errorCount: result.analysis.errorCount,
          apiFailureCount: result.analysis.apiFailureCount,
          criticalErrorCount: result.analysis.criticalErrorCount,
          jsExceptionCount: result.analysis.jsExceptionCount,
          createdAt: new Date().toISOString(),
        },
        message: result.exists ? 'Analysis already exists (returned cached)' : 'Analysis generated successfully',
      });
    } catch (error) {
      console.error('[API] Error in /api/forensic/analyze:', error);
      response.status(500).json({ error: 'Failed to generate the analysis.', analysis: null });
    }
  });

  // On-demand AI remediation for a single saved finding. Returns an LLM fix, or the
  // caller-supplied deterministic advice as fallback — never fails the UI.
  app.post('/api/findings/suggest-fix', analyzeLimiter, requireAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    const body = (request.body ?? {}) as SuggestFixRequest;
    const fallback = typeof body.fallbackAdvice === 'string' ? body.fallbackAdvice : '';

    const ai = await generateRemediation(body);
    const result: SuggestFixResponse = ai
      ? { advice: ai, source: 'ai' }
      : { advice: fallback, source: 'fallback' };
    response.json(result);
  });



  //  Complete Forensic Report API - Get comprehensive report for a session
  app.get('/api/forensic/report/:sessionId', readLimiter, requireAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    console.log('[API] GET /api/forensic/report/:sessionId called');

    try {
      const userId = request.userId;
      if (!userId) {
        response.status(401).json({ error: 'Authentication required.' });
        return;
      }
      // Accept either an ObjectId or a public RUN- code.
      const selector = resolveSessionSelector(extractStringParam(request.params.sessionId) ?? '');
      if (!selector) {
        response.status(400).json({ error: 'Invalid sessionId format.', code: 'INVALID_ID' });
        return;
      }

console.log('[API] Fetching complete forensic report for session:', selector, 'user:', userId);

      // Fetch session data from sessions collection (unified history)
      const sessionDoc = await SessionModel.findOne({
        ...selector,
        userId: new Types.ObjectId(userId),
      }).lean();

      if (!sessionDoc) {
        response.status(404).json({ error: 'Session not found or access denied.' });
        return;
      }

      // Lazy Phase-3 backfill so even a legacy doc surfaces a public code.
      const runCode = await ensureRunId(sessionDoc);
      // Forensic CHILDREN are keyed by the session's _id (forensicRunId), never the
      // RUN- code — resolve the doc first, then hand its _id string to the repos.
      const sessionId = String(sessionDoc._id);

      // Convert to SessionReportData format
      const session: SessionReportData = {
        _id: sessionDoc._id,
        targetUrl: sessionDoc.targetUrl,
        executionDate: sessionDoc.startedAt,
        timeElapsed: sessionDoc.stats?.runtimeMs || 0,
        status: sessionDoc.status,
        outcome: sessionDoc.outcome,
        endedReason: sessionDoc.endedReason,
        coveragePercentage: sessionDoc.stats?.coveragePercentage,
        metrics: {
          totalActions: sessionDoc.stats?.actionsExecuted || 0,
          totalBugsFound: sessionDoc.findingCount || 0,
          bugsByCategory: sessionDoc.metrics?.bugsByCategory || {},
        },
        forensicTrace: sessionDoc.forensicTrace || {
          finalBreadcrumbSteps: [],
          caughtBugs: [],
        },
        actionSteps: sessionDoc.actionSteps ?? [],
      };

      // BK8: opt-in pagination for the three heavy log arrays. Absent params keep
      // the original full-report response byte-for-byte; when a limit is supplied
      // the arrays are page-bounded at the DB layer (per-run indexes) and accurate
      // run-wide counts come from dedicated count queries so the summary and the
      // dashboard's error totals stay correct regardless of the page fetched.
      const parseIntParam = (raw: unknown, min: number): number | undefined => {
        const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
        return Number.isFinite(n) && n >= min ? n : undefined;
      };
      const logsLimit = parseIntParam(request.query.logsLimit, 1);
      const logsOffset = parseIntParam(request.query.logsOffset, 0) ?? 0;
      const paginate = logsLimit !== undefined;

      // Independent per-run reads — issued together, not serially. The count
      // queries only run in paginated mode; otherwise they resolve to no-ops.
      const [errors, networkLog, consoleLog, telemetry, analysis, errorCounts, errorTotal, networkTotal, consoleTotal] = await Promise.all([
        paginate
          ? forensicErrorRepository.findPageByRunId(sessionId, logsLimit, logsOffset).catch(() => [])
          : forensicErrorRepository.findByRunId(sessionId).catch(() => []),
        paginate
          ? networkLogRepository.findPageByRunId(sessionId, logsLimit, logsOffset).catch(() => [])
          : networkLogRepository.findByRunId(sessionId).catch(() => []),
        paginate
          ? consoleLogRepository.findPageByRunId(sessionId, logsLimit, logsOffset).catch(() => [])
          : consoleLogRepository.findByRunId(sessionId).catch(() => []),
        forensicTelemetryRepository.findLatestByForensicRunId(sessionId).catch(() => null),
        forensicAnalysisRepository.findByRunId(sessionId).catch(() => null),
        paginate ? forensicErrorRepository.getCountByType(sessionId).catch(() => ({} as Record<string, number>)) : Promise.resolve({} as Record<string, number>),
        paginate ? forensicErrorRepository.countByRunId(sessionId).catch(() => 0) : Promise.resolve(0),
        paginate ? networkLogRepository.countByRunId(sessionId).catch(() => 0) : Promise.resolve(0),
        paginate ? consoleLogRepository.countByRunId(sessionId).catch(() => 0) : Promise.resolve(0),
      ]);

      // Error summary counts must reflect the WHOLE run, not the returned page —
      // page-local in default mode (from the full array), count-query-backed when paginated.
      const errorTypeCount = (type: string): number =>
        paginate ? (errorCounts[type] ?? 0) : errors.filter((e) => e.type === type).length;
      const totalErrorRows = paginate ? errorTotal : errors.length;

      // Authoritative findings source. forensic_errors is a live-stream mirror
      // that is empty for manually-saved runs, so the risk score/level are
      // derived from the persisted caughtBugs — the same findings the report
      // lists — and fall back to the forensic_errors analysis only when absent.
      const caughtBugs = sessionDoc.forensicTrace?.caughtBugs ?? [];
      const findingsRiskScore = forensicAnalysisService.scoreFindings(caughtBugs);
      const effectiveRiskScore = caughtBugs.length > 0 ? findingsRiskScore : (analysis?.riskScore ?? 0);
      const effectiveRiskLevel = determineRiskLevel(effectiveRiskScore);

      // Timestamp columns arrive as Date (Mongo) or string (client-transferred
      // logs). ?. only guards null, not a string, so coerce both forms to ISO.
      const toIso = (v: unknown): string | undefined =>
        v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : undefined;

      const formattedErrors = errors.map(e => ({
        id: e._id?.toString(),
        type: e.type,
        severity: e.severity,
        message: e.message,
        stackTrace: e.stackTrace,
        url: e.url,
        endpoint: e.endpoint,
        method: e.method,
        statusCode: e.statusCode,
        filename: e.filename,
        lineNumber: e.lineNumber,
        columnNumber: e.columnNumber,
        selector: e.selector,
        action: e.action,
        // Deterministic knowledge-base attribution.
        bugClass: e.bugClass,
        scenario: e.scenario,
        cwe: e.cwe,
        createdAt: toIso(e.createdAt),
      }));

      // Full per-run network + console logs — mirror the live dashboard tabs.
      // timestamp is a Date column; the wire contract stays an ISO string.
      const formattedNetworkLog = networkLog.map(n => ({
        timestamp: toIso(n.timestamp),
        method: n.method,
        url: n.url,
        statusCode: n.statusCode,
        durationMs: n.durationMs,
        resourceType: n.resourceType,
        ok: n.ok,
        message: n.message,
        repeatCount: n.repeatCount,
      }));
      const formattedConsoleLog = consoleLog.map(c => ({
        timestamp: toIso(c.timestamp),
        level: c.level,
        type: c.type,
        message: c.message,
        url: c.url,
        line: c.line,
        column: c.column,
        stackTrace: c.stackTrace,
      }));

      const formattedTelemetry = telemetry ? {
        browser: telemetry.browser,
        browserVersion: telemetry.browserVersion,
        browserEngine: telemetry.browserEngine,
        operatingSystem: telemetry.operatingSystem,
        platform: telemetry.platform,
        screenResolution: telemetry.screenResolution,
        viewportWidth: telemetry.viewportWidth,
        viewportHeight: telemetry.viewportHeight,
        memoryUsage: telemetry.memoryUsage,
        cpuUsage: telemetry.cpuUsage,
        executionDuration: telemetry.executionDuration,
        requestsCount: telemetry.requestsCount,
        pageCount: telemetry.pageCount,
        interactionCount: telemetry.interactionCount,
        failureCount: telemetry.failureCount,
        loadTimes: telemetry.loadTimes,
        timestamp: toIso(telemetry.timestamp),
      } : null;

      // Findings-derived root cause when forensic_errors is empty but caughtBugs exist.
      const rank = (s?: string | null): number =>
        ({ CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 })[(s ?? 'MEDIUM').toUpperCase()] ?? 3;
      const topBug = caughtBugs.length > 0
        ? [...caughtBugs].sort((a, b) => rank(b.severity) - rank(a.severity))[0]
        : null;
      const findingsRootCause = topBug
        ? `${caughtBugs.length} issue${caughtBugs.length === 1 ? '' : 's'} detected; most severe: ${topBug.type} (${(topBug.severity ?? 'MEDIUM').toUpperCase()}).`
        : null;

      const formattedAnalysis = (analysis || caughtBugs.length > 0) ? {
        rootCause: caughtBugs.length > 0 ? (findingsRootCause ?? analysis?.rootCause ?? '') : (analysis?.rootCause ?? ''),
        riskScore: effectiveRiskScore,
        riskLevel: effectiveRiskLevel,
        recommendations: analysis?.recommendations ?? [],
        errorCount: analysis?.errorCount ?? caughtBugs.length,
        apiFailureCount: analysis?.apiFailureCount ?? 0,
        criticalErrorCount: analysis?.criticalErrorCount ?? caughtBugs.filter(b => (b.severity ?? '').toUpperCase() === 'CRITICAL').length,
        jsExceptionCount: analysis?.jsExceptionCount ?? 0,
        createdAt: analysis?.createdAt ? toIso(analysis.createdAt) : undefined,
      } : null;

      // Build complete report
      const report = {
        // Executive Summary. `runId` is the PUBLIC RUN- code only — the internal
        // _id is never emitted to the client.
        runId: runCode ?? sessionDoc.runId ?? '',
        url: session.targetUrl,
        date: session.executionDate,
        status: session.status,
        outcome: session.outcome,
        endedReason: session.endedReason,
        coverage: session.coveragePercentage ?? 0,
        duration: session.timeElapsed,
        riskScore: effectiveRiskScore,

        // Findings
        findings: {
          vulnerabilities: session.forensicTrace?.caughtBugs?.filter(b => b.type === 'EXCEPTION').length || 0,
          securityIssues: session.forensicTrace?.caughtBugs?.filter(b => b.type === 'SECURITY').length || 0,
          functionalFailures: session.forensicTrace?.caughtBugs?.filter(b => b.type === 'RUNTIME_UI_FREEZE').length || 0,
          totalBugsFound: session.metrics?.totalBugsFound || 0,
          bugsByCategory: session.metrics?.bugsByCategory || {},
        },

        // Error Logs
        errorLogs: {
          consoleErrors: errorTypeCount('CONSOLE_ERROR'),
          apiFailures: errorTypeCount('API_FAILURE'),
          jsExceptions: errorTypeCount('JS_EXCEPTION'),
          totalErrors: totalErrorRows,
          errors: formattedErrors,
        },

        // Telemetry
        telemetry: formattedTelemetry,

        // Full network + console logs (all requests / all levels) — mirror live tabs.
        networkLog: formattedNetworkLog,
        consoleLog: formattedConsoleLog,

        // AI Analysis
        aiAnalysis: formattedAnalysis,

        // Metadata
        metrics: session.metrics,
        forensicTrace: session.forensicTrace,
        actionSteps: session.actionSteps ?? [],

        // Session-global execution context — rehydrates the live tabbed layout.
        visitedRoutes: sessionDoc.visitedRoutes ?? [],
        pagesVisited: sessionDoc.stats?.pagesVisited ?? 0,

        // Present only when the client opted into pagination — lets a lazy-loading
        // tab know the run-wide totals and how much of each array it just received.
        pagination: paginate ? {
          limit: logsLimit,
          offset: logsOffset,
          errors: { total: errorTotal, returned: formattedErrors.length },
          network: { total: networkTotal, returned: formattedNetworkLog.length },
          console: { total: consoleTotal, returned: formattedConsoleLog.length },
        } : undefined,
      };

      console.log('[API] Returning complete forensic report for session:', sessionId);
      response.json({ report });
    } catch (error) {
      console.error('[API] Error in /api/forensic/report:', error);
      response.status(500).json({ error: 'Failed to fetch the report.', report: null });
    }
  });
}
