import type { Express, Request, Response } from 'express';
import type { ParsedQs } from 'qs';
import { parseTargetUrl } from '../../serverUtils.js';
import { StartExplorationUseCase } from '../../application/useCases/StartExplorationUseCase.js';
import type { FindingRepository } from '../../domain/repositories/FindingRepository.js';
import { requireAuth, optionalAuth, type AuthRequest } from '../authentication/authMiddleware.js';
import { savedSafariRepository } from '../../infrastructure/database/repositories/SavedSafariRepository.js';
import { forensicAnalysisRepository } from '../../infrastructure/database/repositories/ForensicAnalysisRepository.js';
import { forensicAnalysisService } from '../../domain/services/ForensicAnalysisService.js';
import { forensicErrorRepository } from '../../infrastructure/database/repositories/ForensicErrorRepository.js';
import { forensicTelemetryRepository } from '../../infrastructure/database/repositories/ForensicTelemetryRepository.js';

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
  metrics?: {
    totalActions?: number;
    totalBugsFound?: number;
    bugsByCategory?: Record<string, number>;
  };
  forensicTrace?: {
    finalBreadcrumbSteps?: string[];
    caughtBugs?: Array<{ type?: string }>;
  };
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
): void {
// Health check - public
  app.get('/api/health', (_request: Request, response: Response) => {
    response.json({ status: "healthy" });
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

    if (useCase.isActive()) {
      console.warn(`[API] ❌ Safari already running - rejecting request`);
      response.status(429).json({ error: 'A BugSafari run is already active.' });
      return;
    }

    // Set the userId from auth middleware - this ensures saved documents use the real operator ID
    if (request.userId) {
      useCase.setUserId(request.userId);
      console.log(`[API] ✓ Set userId for exploration session: ${request.userId}`);
    } else {
      console.log(`[API] ℹ️ No authenticated userId - using default for guest session`);
    }

    // Extract optimization settings from request body
    const optimizationSettings = request.body?.optimization;
    console.log(`[API] Optimization settings:`, optimizationSettings);

    console.log(`[API] ✅ Accepting safari launch for: ${targetUrl}`);
    response.json({ accepted: true, url: targetUrl });
    console.log(`[API] 🚀 Starting safari in background...`);
    void useCase.execute(targetUrl, optimizationSettings);
  });

// Save session - allows anonymous/guest (optionalAuth for bypass)
  app.post('/api/history/save-session', optionalAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    console.log('[API] POST /api/history/save-session called');
    console.log('[API] Request body:', JSON.stringify(request.body));
    console.log('[API] Auth user:', request.userId ?? 'anonymous/guest');
    console.log('[API] Is guest:', request.isGuest);

    // Use authenticated userId or fallback to anonymous placeholder
    const userId = request.userId || 'anonymous-guest-user';
    const ownerType = request.userId ? 'authenticated' : (request.body?.ownerType || 'anonymous');

    try {
      // SECURITY: Sanitize targetUrl to prevent NoSQL injection
      const targetUrl = sanitizeTargetUrl(request.body?.targetUrl);
      console.log('[API] Target URL to save:', targetUrl);

      if (!targetUrl) {
        console.warn('[API] No targetUrl provided in request body or invalid format');
        response.status(400).json({ error: 'targetUrl is required and must be a valid URL.' });
        return;
      }

      // Call manualSaveToHistory to save to savedsafaris collection
      // Pass ownerType in options for tracking anonymous vs authenticated saves
      const result = await useCase.manualSaveToHistory(targetUrl, userId, { ownerType });

      if (!result.success) {
        console.warn('[API] Manual save failed:', result.message);
        response.status(500).json({ error: result.message });
        return;
      }

      console.log('[API] Saved to savedsafaris:', result.message, '| ownerType:', ownerType);
      // Explicitly return 201 Created status for resource creation
      response.status(201).json({ ok: true, message: result.message, ownerType });
    } catch (error) {
      console.error('[API] Error saving session:', error);
      const message = error instanceof Error ? error.message : String(error);
      response.status(500).json({ error: message });
    }
  });

  // Session history - optional auth (shows prompt for guests)
  app.get('/api/history/sessions', optionalAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    console.log('[API] GET /api/history/sessions called with query:', request.query);
    console.log('[API] Auth user:', request.userId ?? 'none');

    // Wrap entire endpoint in try/catch for comprehensive error handling
    try {
      if (!findingRepo) {
        console.warn('[API] findingRepo is undefined - database not connected');
        response.json({ sessions: [], requiresAuth: request.isGuest });
        return;
      }

      // FIXED: Safely extract limit parameter - Express can return string|string[]
      const rawLimit = extractStringParam(request.query.limit);
      const limitVal = rawLimit ? Number(rawLimit) : 50;
      const limit = Number.isFinite(limitVal) ? Math.max(1, Math.min(limitVal, 200)) : 50;
      console.log('[API] Querying session history with limit:', limit);

      const sessions = await findingRepo.listSessionHistory(limit);
      console.log('[API] Raw sessions from repository:', sessions?.length ?? 0);

      // Falsy/empty safe check - ensure sessions is an array before returning
      const safeSessions = Array.isArray(sessions) ? sessions : [];
      console.log('[API] Returning safe sessions count:', safeSessions.length);

      response.json({ sessions: safeSessions, requiresAuth: request.isGuest });
    } catch (error) {
      // Comprehensive error handling with explicit log message
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[API] Error in /api/history/sessions:', error);
      console.error('[API] Error stack:', error instanceof Error ? error.stack : 'no stack');
      response.status(500).json({ error: `Failed to fetch session history: ${errorMessage}` });
    }
  });

  // Safari run history - requires authentication
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

      console.log('[API] Fetching safari history for userId:', userId);
      const history = await savedSafariRepository.getSafariHistoryByUserId(userId);
      console.log('[API] Safari history raw retrieved count:', history?.length ?? 0);

      if (history && history.length > 0) {
        console.log('[API] First document sample:', JSON.stringify(history[0]).substring(0, 200));
      }

      // Return documents sorted by executionDate: -1 (newest first) - repository handles sorting
      response.json(history);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[API] Error in /api/history:', error);
      response.status(500).json({ error: `Failed to fetch safari history: ${errorMessage}` });
    }
  });

  // Delete a safari record by ID
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

      console.log('[API] Deleting safari record:', recordId, 'for user:', userId);
      const result = await savedSafariRepository.deleteRecord(recordId, userId);

      if (!result.success) {
        console.warn('[API] Delete failed:', result.message);
        response.status(404).json({ error: result.message });
        return;
      }

      console.log('[API] Record deleted successfully:', recordId);
      response.json({ ok: true, message: result.message });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[API] Error in DELETE /api/history/:id:', error);
      response.status(500).json({ error: `Failed to delete record: ${errorMessage}` });
    }
  });

  // Export a safari record as JSON
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

      console.log('[API] Fetching safari record for export:', recordId, 'for user:', userId);
      const history = await savedSafariRepository.getSafariHistoryByUserId(userId);
      const record = history.find(h => h._id?.toString() === recordId);

      if (!record) {
        console.warn('[API] Record not found:', recordId);
        response.status(404).json({ error: 'Record not found.' });
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
  app.get('/api/forensic/analysis', async (request: Request, response: Response): Promise<void> => {
    console.log('[API] GET /api/forensic/analysis called with query:', request.query);

    try {
      const sessionId = request.query.sessionId as string | undefined;

      if (!sessionId) {
        // Return latest analysis if no session ID provided
        const latestAnalyses = await forensicAnalysisRepository.findLatest(1);
        if (latestAnalyses.length === 0) {
          response.json({ analysis: null, message: 'No analysis available yet. Run a test first.' });
          return;
        }
        const latest = latestAnalyses[0];
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
  app.post('/api/forensic/analyze', async (request: Request, response: Response): Promise<void> => {
    console.log('[API] POST /api/forensic/analyze called');

    try {
      const sessionId = request.body?.sessionId as string | undefined;

      if (!sessionId) {
        response.status(400).json({ error: 'sessionId is required in request body.' });
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

      // Fetch session data from savedsafaris collection
      const savedSafari = await savedSafariRepository.getSafariHistoryByUserId(userId);
      const sessionData = savedSafari.find(s => s._id?.toString() === sessionId);

      // If not found in savedsafaris, try sessions collection
      // FIXED: Use proper type interface for session data
      let session: SessionReportData | undefined = sessionData as SessionReportData | undefined;
      if (!session && findingRepo) {
        const sessions = await findingRepo.listSessionHistory(200);
        const foundSession = sessions.find(s => (s as any)._id?.toString() === sessionId);
        if (foundSession) {
          session = {
            _id: (foundSession as any)._id,
            targetUrl: (foundSession as any).targetUrl,
            executionDate: (foundSession as any).startedAt,
            timeElapsed: (foundSession as any).stats?.runtimeMs || 0,
            status: (foundSession as any).status,
            metrics: {
              totalActions: (foundSession as any).stats?.actionsExecuted || 0,
              totalBugsFound: (foundSession as any).findingCount || 0,
              bugsByCategory: {},
            },
            forensicTrace: {
              finalBreadcrumbSteps: [],
              caughtBugs: [],
            },
          };
        }
      }

      if (!session) {
        response.status(404).json({ error: 'Session not found or access denied.' });
        return;
      }

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
        createdAt: e.createdAt?.toISOString(),
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
        coverage: session.metrics?.totalActions ? Math.min(100, Math.floor(60 + (session.metrics.totalActions / 50) * 40)) : 0,
        duration: session.timeElapsed,
        riskScore: formattedAnalysis?.riskScore || (session.metrics?.totalBugsFound || 0) * 25,

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

        // Screenshots
        screenshots: formattedScreenshots,

        // AI Analysis
        aiAnalysis: formattedAnalysis,

        // Metadata
        metrics: session.metrics,
        forensicTrace: session.forensicTrace,
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
