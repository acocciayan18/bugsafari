import type { Express, Request, Response } from 'express';
import type { ParsedQs } from 'qs';
import { parseTargetUrl, resolveEngineTargetUrl } from '../../serverUtils.js';
import { StartExplorationUseCase } from '../../application/useCases/StartExplorationUseCase.js';
import type { TaskQueue } from '../../infrastructure/queue/TaskQueue.js';
import type { FindingRepository } from '../../domain/repositories/FindingRepository.js';
import { requireAuth, optionalAuth, type AuthRequest } from '../authentication/authMiddleware.js';
import { sessionManager } from '../../application/services/SessionManager.js';
import { randomUUID } from 'node:crypto';
import { forensicAnalysisRepository } from '../../infrastructure/database/repositories/ForensicAnalysisRepository.js';
import { forensicAnalysisService } from '../../domain/services/ForensicAnalysisService.js';
import { forensicErrorRepository } from '../../infrastructure/database/repositories/ForensicErrorRepository.js';
import { forensicTelemetryRepository } from '../../infrastructure/database/repositories/ForensicTelemetryRepository.js';
import { networkLogRepository } from '../../infrastructure/database/repositories/NetworkLogRepository.js';
import { consoleLogRepository } from '../../infrastructure/database/repositories/ConsoleLogRepository.js';
import { SessionModel } from '../../infrastructure/database/models/SessionModel.js';
import { Types } from 'mongoose';
import {
  INFILTRATION_PROFILE_CATALOG,
  resolveInfiltrationProfile,
  type TestingTypeId,
  type InfiltrationProfileId,
  type ExplorationRunConfig,
  type FindingAttribution,
  type StateFingerprint,
  type ActionRecord,
} from '../../../../shared/types.js';

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

// ──────────────────────────────────────────────���──────────────────────────────
// Safe Parameter Extraction Utilities
// Addresses: string|string[] type issues from Express req.query/req.params
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely extract a single string from Express params/query.
 * Express can return string|ParsedQs|string[] when multiple values exist.
 */
function extractStringParam(value: string | ParsedQs | (string | ParsedQs)[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    // Handle array of strings or ParsedQs
    const first = value[0];
    return typeof first === 'string' ? first : undefined;
  }
  // Handle single value
  return typeof value === 'string' ? value : undefined;
}

/**
 * Safely extract and validate ObjectId from string parameter.
 * Returns null if invalid.
 */
function extractObjectIdParam(value: string | ParsedQs | (string | ParsedQs)[] | undefined): string | null {
  const str = extractStringParam(value);
  if (!str) return null;

  // Basic validation - ObjectId is 24 hex characters
  if (!/^[0-9a-fA-F]{24}$/.test(str)) {
    return null;
  }
  return str;
}

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
): void {
// Health check - public
  app.get('/api/health', (_request: Request, response: Response) => {
    response.json({ status: "healthy" });
  });

  // Explicit Safari stop endpoint - for cleanup on timeout or emergency stop.
  // Uses the same optionalAuth as /api/start-test (guests may still stop a run),
  // but scopes the stop to the session's own owner: the requester must match
  // whichever userId (or guest/null) actually started the active run, so an
  // unrelated authenticated user can't kill someone else's in-progress session.
  app.post('/api/safari/stop', optionalAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    console.log('[API] 🔴 POST /api/safari/stop received - explicit cleanup request');

    try {
      const activeEngine = sessionManager.getActiveEngine();

      if (!activeEngine) {
        console.log('[API] No active engine to stop - already IDLE');
        response.json({ ok: true, message: 'No active session to stop' });
        return;
      }

      const activeUserId = sessionManager.getActiveUserId();
      const requesterId = request.userId ?? null;
      if (activeUserId !== requesterId) {
        console.warn('[API] ❌ Stop rejected: requester does not own the active session');
        response.status(403).json({ error: 'You do not have permission to stop this session.' });
        return;
      }

      console.log('[API] Stopping active engine...');
      await sessionManager.stopByOperator();

      console.log('[API] ✅ Engine stopped successfully via HTTP endpoint');
      response.json({ ok: true, message: 'Safari session stopped' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[API] Error stopping engine:', errorMessage);
      // Return success even on error - engine may already be stopped
      response.json({ ok: true, message: 'Stop attempted', error: errorMessage });
    }
  });

  // Start test - allowed for guests (optional auth)
  // IMPORTANT: Set the authenticated userId before executing so it persists to saved documents
  app.post('/api/start-test', optionalAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    console.log(`[API] 📥 POST /api/start-test received`);
    console.log(`[API] Request body:`, JSON.stringify(request.body));
    console.log(`[API] Auth user: ${request.userId ?? 'guest'}`);

    const targetUrl = parseTargetUrl(request.body);
    if (!targetUrl) {
      console.warn(`[API] ❌ Invalid URL in request`);
      response.status(400).json({ error: 'A valid url is required.' });
      return;
    }

    // Opt-in distributed path: hand the run to the Safari worker fleet instead of
    // running it in this process. Deliberately BEFORE tryActivate — the queue path
    // owns no in-process engine slot; admission is the worker's concern, so this
    // must not touch the synchronous use case's active flag. Target routing is left
    // to the worker (resolveEngineTargetUrl runs there against the browser's own
    // network view). Guest runs (no userId) enqueue too; the worker persists nothing.
    if (taskQueue) {
      try {
        const enqueued = await taskQueue.addSafariTask({
          targetUrl,
          requestedBy: request.userId ?? undefined,
        });
        console.log(`[API] 🧵 Enqueued safari job ${enqueued.id} runId=${enqueued.runId} for ${targetUrl} (queue=${enqueued.queueName})`);
        // runId lets the client join run:${runId} for bridged worker telemetry;
        // jobId lets it subscribe to queue:${jobId} position pushes.
        response.status(202).json({ accepted: true, url: targetUrl, jobId: enqueued.id, runId: enqueued.runId, queued: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[API] ❌ Failed to enqueue safari job:', message);
        response.status(502).json({ error: `Failed to enqueue run on the worker fleet: ${message}` });
      }
      return;
    }

    // Atomically claim the "active" slot right here, synchronously, so two
    // concurrent requests can't both pass this check before either marks the
    // use case active (see StartExplorationUseCase.tryActivate() for why).
    if (!useCase.tryActivate()) {
      console.warn(`[API] ❌ Safari already running - rejecting request`);
      response.status(429).json({ error: 'A BugSafari run is already active.' });
      return;
    }

    // Always (re)set the userId from auth middleware — this ensures saved documents
    // use the real operator ID and resets the singleton's context so a guest run
    // never inherits a previous authenticated user's id. Undefined => guest (no persist).
    useCase.setUserId(request.userId ?? null);
    console.log(request.userId
      ? `[API] ✓ Set userId for exploration session: ${request.userId}`
      : `[API] ℹ️ No authenticated userId - guest session (no persistence)`);

    // Extract optimization settings from request body
    const optimizationSettings = request.body?.optimization;
    console.log(`[API] Optimization settings:`, optimizationSettings);

    // Interpret the operator-selected Unified Infiltration Profile into the gated
    // scenario categories for this session. NetworkSaboteur is gated by the
    // 'navigation' testing type like every other scenario.
    const selectedScenarios = parseSelectedScenarios(request.body);
    console.log(`[API] Infiltration profile resolved to:`, selectedScenarios);

    // Route the target for the active RUN_ENVIRONMENT before launch: bridge
    // loopback in DOCKER_LOCAL, or reject an unreachable private address in
    // CLOUD_HOSTED with a clear operator message. Reject BEFORE accepting.
    const routing = resolveEngineTargetUrl(targetUrl);
    if (!routing.ok) {
      console.warn(`[API] ❌ Target rejected: ${routing.message}`);
      // Roll back the slot claimed above — we're bailing out without ever
      // calling execute(), so nothing else will reset it to false.
      useCase.releaseActivation();
      response.status(422).json({ error: routing.message });
      return;
    }
    const engineUrl = routing.url;
    if (routing.rewritten) {
      console.log(`[API] ↪ Routed target for engine: ${targetUrl} -> ${engineUrl} (${routing.note})`);
    }

    // Server-issued run token: returned to the client (stored client-side) so a
    // returning socket — including a guest after a full refresh — can prove
    // ownership and re-attach to this exact run.
    const runId = randomUUID();

    console.log(`[API] ✅ Accepting safari launch for: ${targetUrl} (runId=${runId})`);
    // Operator sees their original URL; the engine dials the routed one.
    response.json({ accepted: true, url: targetUrl, runId });
    console.log(`[API] 🚀 Starting safari in background...`);
    void useCase.execute(engineUrl, optimizationSettings, selectedScenarios, runId);
  });

  // Restore-on-load: a returning client asks whether it owns an active run and,
  // if so, gets the full replay snapshot to rebuild the live dashboard. Uses the
  // same optionalAuth as start-test — authed users are matched by identity, guests
  // by the runId they present. Returns { snapshot: null } when nothing is owned.
  app.get('/api/session/active', optionalAuth, (request: AuthRequest, response: Response): void => {
    const runId = extractStringParam(request.query.runId);
    const snapshot = sessionManager.getSnapshotFor(request.userId ?? null, runId);
    response.json({ snapshot });
  });

// Save session - REQUIRES authentication (no guest saves allowed)
  app.post('/api/history/save-session', requireAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    console.log('[API] POST /api/history/save-session called');
    console.log('[API] Request body:', JSON.stringify(request.body));
    console.log('[API] Auth user:', request.userId ?? 'none');
    console.log('[API] Is guest:', request.isGuest);

    // GUEST CHECK: requireAuth already validated JWT, but double-check for safety
    // If somehow we reached here without a valid userId, reject as guest
    if (!request.userId) {
      console.warn('[API] ❌ Guest save attempt rejected: No authenticated userId');
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
        response.status(500).json({ error: result.message });
        return;
      }

console.log('[API] ✅ Saved to sessions:', result.message, '| ownerType:', ownerType, '| userId:', userId);
      // Explicitly return 201 Created status for resource creation
      response.status(201).json({ ok: true, message: result.message, ownerType });
    } catch (error) {
      console.error('[API] Error saving session:', error);
      const message = error instanceof Error ? error.message : String(error);
      response.status(500).json({ error: message });
    }
  });

// Session history - REQUIRES authentication (returns only user's sessions)
  app.get('/api/history/sessions', requireAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    console.log('[API] GET /api/history/sessions called with query:', request.query);
    console.log('[API] Auth user:', request.userId ?? 'none');
    console.log('[API] Is guest:', request.isGuest);

    // GUEST CHECK: requireAuth already validated JWT, but double-check for safety
    if (!request.userId) {
      console.warn('[API] ❌ Guest history access rejected: No authenticated userId');
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

      // FIXED: Safely extract limit parameter - Express can return string|string[]
      const rawLimit = extractStringParam(request.query.limit);
      const limitVal = rawLimit ? Number(rawLimit) : 50;
      const limit = Number.isFinite(limitVal) ? Math.max(1, Math.min(limitVal, 200)) : 50;
      console.log('[API] Querying session history with limit:', limit, 'for userId:', request.userId);

      // CRITICAL: Pass userId to filter only this user's sessions
      const sessions = await findingRepo.listSessionHistory(limit, request.userId);
      console.log('[API] Raw sessions from repository:', sessions?.length ?? 0);

      // Falsy/empty safe check - ensure sessions is an array before returning
      const safeSessions = Array.isArray(sessions) ? sessions : [];
      console.log('[API] Returning safe sessions count:', safeSessions.length);

      // Return only authenticated user's sessions
      response.json({ sessions: safeSessions });
    } catch (error) {
      // Comprehensive error handling with explicit log message
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[API] Error in /api/history/sessions:', error);
      console.error('[API] Error stack:', error instanceof Error ? error.stack : 'no stack');
      response.status(500).json({ error: `Failed to fetch session history: ${errorMessage}`, sessions: [] });
    }
  });

// Safari run history - requires authentication
  // UPDATED: Query sessions collection instead of savedsafaris for unified history
  app.get('/api/history', requireAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    console.log('[API] GET /api/history called');
    console.log('[API] Auth header:', request.headers.authorization?.substring(0, 30) + '...');
    console.log('[API] Authenticated user:', request.userId ?? 'none');
    console.log('[API] Auth email:', request.userEmail ?? 'none');

    try {
      const userId = request.userId;
      if (!userId) {
        console.warn('[API] No userId in authenticated request');
        response.status(401).json({ error: 'Authentication required.' });
        return;
      }

      console.log('[API] Fetching session history for userId:', userId);
      
      // Query sessions collection by userId (unified history). Only manually
      // saved sessions count as "history" — auto-tracked runs stay invisible
      // until the operator explicitly clicks Save.
      const { SessionModel } = await import('../../infrastructure/database/models/SessionModel.js');
      const { Types } = await import('mongoose');

      const sessions = await SessionModel.find({ userId: new Types.ObjectId(userId), savedManually: true })
        .sort({ startedAt: -1 })
        .lean();
      
      console.log('[API] Sessions raw retrieved count:', sessions?.length ?? 0);

      if (sessions && sessions.length > 0) {
        console.log('[API] First document sample:', JSON.stringify(sessions[0]).substring(0, 200));
      }

      // Return documents sorted by startedAt: -1 (newest first)
      response.json(sessions);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[API] Error in /api/history:', error);
      response.status(500).json({ error: `Failed to fetch safari history: ${errorMessage}` });
    }
  });

// Delete a session by ID (using sessions collection)
  app.delete('/api/history/:id', requireAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    console.log('[API] DELETE /api/history/:id called');
    console.log('[API] Record ID:', request.params.id);
    console.log('[API] Authenticated user:', request.userId ?? 'none');

    try {
      const userId = request.userId;
      // FIXED: Safely extract recordId from params - can be string|string[]
      const recordId = extractObjectIdParam(request.params.id);

      if (!userId) {
        response.status(401).json({ error: 'Authentication required.' });
        return;
      }

      if (!recordId) {
        response.status(400).json({ error: 'Invalid record ID format.' });
        return;
      }

      console.log('[API] Deleting session record:', recordId, 'for user:', userId);
      
      // Use SessionModel.deleteOne with userId for ownership check
      const result = await SessionModel.deleteOne({
        _id: new Types.ObjectId(recordId),
        userId: new Types.ObjectId(userId),
      });

      if (result.deletedCount === 0) {
        console.warn('[API] Delete failed: Record not found or not owned by user');
        response.status(404).json({ error: 'Record not found or access denied.' });
        return;
      }

      console.log('[API] Record deleted successfully:', recordId);
      response.json({ ok: true, message: 'Record deleted successfully.' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[API] Error in DELETE /api/history/:id:', error);
      response.status(500).json({ error: `Failed to delete record: ${errorMessage}` });
    }
  });

// Export a session record as JSON (using sessions collection)
  app.get('/api/history/export/:id', requireAuth, async (request: AuthRequest, response: Response): Promise<void> => {
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

      // FIXED: Safely extract recordId from params - can be string|string[]
      const recordId = extractObjectIdParam(request.params.id);
      if (!recordId) {
        response.status(400).json({ error: 'Invalid record ID format.' });
        return;
      }

      console.log('[API] Fetching session record for export:', recordId, 'for user:', userId);
      
      // Use SessionModel.findOne with userId for ownership check
      const record = await SessionModel.findOne({
        _id: new Types.ObjectId(recordId),
        userId: new Types.ObjectId(userId),
      }).lean();

      if (!record) {
        console.warn('[API] Record not found or access denied:', recordId);
        response.status(404).json({ error: 'Record not found or access denied.' });
        return;
      }

      console.log('[API] Record found for export:', recordId);
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Content-Disposition', `attachment; filename="safari-${recordId}.json"`);
      response.json(record);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[API] Error in GET /api/history/export/:id:', error);
      response.status(500).json({ error: `Failed to export record: ${errorMessage}` });
    }
  });

// Forensic Screenshots API - Now returns empty array (screenshots disabled for storage optimization)
  app.get('/api/forensic/screenshots', async (_request: Request, response: Response): Promise<void> => {
    console.log('[API] GET /api/forensic/screenshots called - screenshots disabled');

    // Return empty screenshots array - screenshot capture has been removed
    response.json({ screenshots: [] });
  });

  // 🧠 Phase 5: Forensic Analysis API - Get analysis for a test run
  // requireAuth + tenant scoping: forensic analyses expose rootCause/riskScore/recommendations,
  // so a run's analysis is readable only by the user who owns that run's session.
  app.get('/api/forensic/analysis', requireAuth, async (request: AuthRequest, response: Response): Promise<void> => {
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
        const ownSessions = await SessionModel.find({ userId: new Types.ObjectId(userId) }).select('_id').lean();
        const latest = await forensicAnalysisRepository.findLatestForRuns(ownSessions.map((s) => s._id));
        if (!latest) {
          response.json({ analysis: null, message: 'No analysis available yet. Run a test first.' });
          return;
        }
        response.json({
          analysis: {
            id: latest._id?.toString(),
            forensicRunId: latest.forensicRunId?.toString(),
            rootCause: latest.rootCause,
            riskScore: latest.riskScore,
            riskLevel: latest.riskLevel,
            recommendations: latest.recommendations,
            errorCount: latest.errorCount,
            apiFailureCount: latest.apiFailureCount,
            criticalErrorCount: latest.criticalErrorCount,
            jsExceptionCount: latest.jsExceptionCount,
            screenshotCount: latest.screenshotCount,
            createdAt: latest.createdAt?.toISOString(),
          },
        });
        return;
      }

      // Explicit session id → confirm the caller owns that session before returning its analysis.
      if (!Types.ObjectId.isValid(sessionId)) {
        response.status(400).json({ error: 'Invalid session ID format.' });
        return;
      }
      const owned = await SessionModel.exists({
        _id: new Types.ObjectId(sessionId),
        userId: new Types.ObjectId(userId),
      });
      if (!owned) {
        response.status(404).json({ analysis: null, error: 'Session not found or access denied.' });
        return;
      }

      const analysis = await forensicAnalysisRepository.findByRunId(sessionId);
      if (!analysis) {
        response.json({ analysis: null, message: 'No analysis found for this session. Run a test first.' });
        return;
      }

      response.json({
        analysis: {
          id: analysis._id?.toString(),
          forensicRunId: analysis.forensicRunId?.toString(),
          rootCause: analysis.rootCause,
          riskScore: analysis.riskScore,
          riskLevel: analysis.riskLevel,
          recommendations: analysis.recommendations,
          errorCount: analysis.errorCount,
          apiFailureCount: analysis.apiFailureCount,
          criticalErrorCount: analysis.criticalErrorCount,
          jsExceptionCount: analysis.jsExceptionCount,
          screenshotCount: analysis.screenshotCount,
          createdAt: analysis.createdAt?.toISOString(),
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[API] Error in /api/forensic/analysis:', error);
      response.status(500).json({ error: `Failed to fetch analysis: ${errorMessage}`, analysis: null });
    }
  });

  // 🧠 Phase 5: Trigger forensic analysis generation
  // requireAuth + ownership: analyzeRun() is compute-heavy and reads a run's session/errors,
  // so only the session owner may trigger it (prevents anonymous DoS + foreign-session reads).
  app.post('/api/forensic/analyze', requireAuth, async (request: AuthRequest, response: Response): Promise<void> => {
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
      if (!Types.ObjectId.isValid(sessionId)) {
        response.status(400).json({ error: 'Invalid session ID format.' });
        return;
      }
      const owned = await SessionModel.exists({
        _id: new Types.ObjectId(sessionId),
        userId: new Types.ObjectId(userId),
      });
      if (!owned) {
        response.status(404).json({ error: 'Session not found or access denied.' });
        return;
      }

      console.log('[API] Generating forensic analysis for session:', sessionId);
      const result = await forensicAnalysisService.analyzeRun(sessionId);

      if (!result.analysis) {
        response.status(500).json({ error: 'Failed to generate analysis', analysis: null });
        return;
      }

      console.log('[API] Analysis generated successfully, risk score:', result.analysis.riskScore);
      response.json({
        analysis: {
          id: result.analysis.forensicRunId?.toString(),
          forensicRunId: result.analysis.forensicRunId?.toString(),
          rootCause: result.analysis.rootCause,
          riskScore: result.analysis.riskScore,
          riskLevel: result.analysis.riskLevel,
          recommendations: result.analysis.recommendations,
          errorCount: result.analysis.errorCount,
          apiFailureCount: result.analysis.apiFailureCount,
          criticalErrorCount: result.analysis.criticalErrorCount,
          jsExceptionCount: result.analysis.jsExceptionCount,
          screenshotCount: result.analysis.screenshotCount,
          createdAt: new Date().toISOString(),
        },
        message: result.exists ? 'Analysis already exists (returned cached)' : 'Analysis generated successfully',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[API] Error in /api/forensic/analyze:', error);
      response.status(500).json({ error: `Failed to generate analysis: ${errorMessage}`, analysis: null });
    }
  });



  // 📊 Complete Forensic Report API - Get comprehensive report for a session
  app.get('/api/forensic/report/:sessionId', requireAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    console.log('[API] GET /api/forensic/report/:sessionId called with params:', request.params);

    try {
      // FIXED: Safely extract sessionId from params - can be string|string[]
      const sessionId = extractStringParam(request.params.sessionId);
      if (!sessionId) {
        response.status(400).json({ error: 'Invalid session ID format.' });
        return;
      }

      const userId = request.userId;
      if (!userId) {
        response.status(401).json({ error: 'Authentication required.' });
        return;
      }

console.log('[API] Fetching complete forensic report for session:', sessionId, 'user:', userId);

      // Fetch session data from sessions collection (unified history)
      const sessionDoc = await SessionModel.findOne({
        _id: new Types.ObjectId(sessionId),
        userId: new Types.ObjectId(userId),
      }).lean();

      if (!sessionDoc) {
        response.status(404).json({ error: 'Session not found or access denied.' });
        return;
      }

      // Convert to SessionReportData format
      const session: SessionReportData = {
        _id: sessionDoc._id,
        targetUrl: sessionDoc.targetUrl,
        executionDate: sessionDoc.startedAt,
        timeElapsed: sessionDoc.stats?.runtimeMs || 0,
        status: sessionDoc.status,
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

      // Fetch errors
      const errors = await forensicErrorRepository.findByRunId(sessionId).catch(() => []);
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
        createdAt: e.createdAt?.toISOString(),
      }));

      // Full per-run network + console logs — mirror the live dashboard tabs.
      const networkLog = await networkLogRepository.findByRunId(sessionId).catch(() => []);
      const formattedNetworkLog = networkLog.map(n => ({
        timestamp: n.timestamp,
        method: n.method,
        url: n.url,
        statusCode: n.statusCode,
        durationMs: n.durationMs,
        resourceType: n.resourceType,
        ok: n.ok,
        message: n.message,
        repeatCount: n.repeatCount,
      }));
      const consoleLog = await consoleLogRepository.findByRunId(sessionId).catch(() => []);
      const formattedConsoleLog = consoleLog.map(c => ({
        timestamp: c.timestamp,
        level: c.level,
        type: c.type,
        message: c.message,
        url: c.url,
        line: c.line,
        column: c.column,
        stackTrace: c.stackTrace,
      }));

// Screenshots removed - return empty array
      const formattedScreenshots: never[] = [];

      // Fetch telemetry
      const telemetry = await forensicTelemetryRepository.findByForensicRunId(sessionId).catch(() => []);
      const formattedTelemetry = telemetry.length > 0 ? {
        browser: telemetry[0].browser,
        browserVersion: telemetry[0].browserVersion,
        browserEngine: telemetry[0].browserEngine,
        operatingSystem: telemetry[0].operatingSystem,
        platform: telemetry[0].platform,
        screenResolution: telemetry[0].screenResolution,
        viewportWidth: telemetry[0].viewportWidth,
        viewportHeight: telemetry[0].viewportHeight,
        memoryUsage: telemetry[0].memoryUsage,
        cpuUsage: telemetry[0].cpuUsage,
        executionDuration: telemetry[0].executionDuration,
        requestsCount: telemetry[0].requestsCount,
        pageCount: telemetry[0].pageCount,
        interactionCount: telemetry[0].interactionCount,
        failureCount: telemetry[0].failureCount,
        loadTimes: telemetry[0].loadTimes,
        timestamp: telemetry[0].timestamp?.toISOString(),
      } : null;

      // Fetch AI analysis
      const analysis = await forensicAnalysisRepository.findByRunId(sessionId).catch(() => null);
      const formattedAnalysis = analysis ? {
        id: analysis._id?.toString(),
        rootCause: analysis.rootCause,
        riskScore: analysis.riskScore,
        riskLevel: analysis.riskLevel,
        recommendations: analysis.recommendations,
        errorCount: analysis.errorCount,
        apiFailureCount: analysis.apiFailureCount,
        criticalErrorCount: analysis.criticalErrorCount,
        jsExceptionCount: analysis.jsExceptionCount,
        screenshotCount: analysis.screenshotCount,
        createdAt: analysis.createdAt?.toISOString(),
      } : null;

      // Build complete report
      const report = {
        // Executive Summary
        runId: session._id?.toString(),
        url: session.targetUrl,
        date: session.executionDate,
        status: session.status,
        coverage: session.coveragePercentage ?? 0,
        duration: session.timeElapsed,
        riskScore: Math.min(100, formattedAnalysis?.riskScore ?? ((session.metrics?.totalBugsFound || 0) * 25)),

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
          consoleErrors: errors.filter(e => e.type === 'CONSOLE_ERROR').length,
          apiFailures: errors.filter(e => e.type === 'API_FAILURE').length,
          jsExceptions: errors.filter(e => e.type === 'JS_EXCEPTION').length,
          totalErrors: errors.length,
          errors: formattedErrors,
        },

        // Telemetry
        telemetry: formattedTelemetry,

        // Full network + console logs (all requests / all levels) — mirror live tabs.
        networkLog: formattedNetworkLog,
        consoleLog: formattedConsoleLog,

        // Screenshots
        screenshots: formattedScreenshots,

        // AI Analysis
        aiAnalysis: formattedAnalysis,

        // Metadata
        metrics: session.metrics,
        forensicTrace: session.forensicTrace,
        actionSteps: session.actionSteps ?? [],

        // Session-global execution context — rehydrates the live tabbed layout.
        visitedRoutes: sessionDoc.visitedRoutes ?? [],
        pagesVisited: sessionDoc.stats?.pagesVisited ?? 0,
      };

      console.log('[API] Returning complete forensic report for session:', sessionId);
      response.json({ report });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[API] Error in /api/forensic/report:', error);
      response.status(500).json({ error: `Failed to fetch report: ${errorMessage}`, report: null });
    }
  });
}
