import type { Express, Request, Response } from 'express';
import { parseTargetUrl } from '../../serverUtils.js';
import { StartExplorationUseCase } from '../../application/useCases/StartExplorationUseCase.js';
import type { FindingRepository } from '../../domain/repositories/FindingRepository.js';
import { requireAuth, optionalAuth, type AuthRequest } from './authMiddleware.js';

export function registerRoutes(
  app: Express,
  useCase: StartExplorationUseCase,
  port: number,
  findingRepo?: FindingRepository,
): void {
  // Health check - public
  app.get('/api/health', (_request: Request, response: Response) => {
    response.json({
      ok: true,
      active: useCase.isActive(),
      port,
      timestamp: new Date().toISOString(),
    });
  });

  // Start test - allowed for guests (optional auth)
  app.post('/api/start-test', optionalAuth, async (request: Request, response: Response): Promise<void> => {
    const targetUrl = parseTargetUrl(request.body);
    if (!targetUrl) {
      response.status(400).json({ error: 'A valid url is required.' });
      return;
    }

    if (useCase.isActive()) {
      response.status(429).json({ error: 'A BugSafari run is already active.' });
      return;
    }

    response.json({ accepted: true, url: targetUrl });
    void useCase.execute(targetUrl);
  });

// Save session - requires authentication
  app.post('/api/history/save-session', requireAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    console.log('[API] POST /api/history/save-session called');
    console.log('[API] Request body:', JSON.stringify(request.body));
console.log('[API] Auth user:', request.userId ?? 'none');

    if (!findingRepo) {
      console.error('[API] findingRepo is undefined - database not connected');
      response.status(503).json({ error: 'Persistence is currently unavailable.' });
      return;
    }

    try {
      const targetUrl = typeof request.body?.targetUrl === 'string' ? request.body.targetUrl : undefined;
      console.log('[API] Target URL to save:', targetUrl);

      if (!targetUrl) {
        console.warn('[API] No targetUrl provided in request body');
        response.status(400).json({ error: 'targetUrl is required.' });
        return;
      }

      const sessionId = await findingRepo.markLatestSessionSaved(targetUrl);
      console.log('[API] markLatestSessionSaved result:', sessionId);

      if (!sessionId) {
        console.warn('[API] No session found to save for targetUrl:', targetUrl);
        response.status(404).json({ error: 'No session found to save.' });
        return;
      }

      console.log('[API] Session saved successfully! Session ID:', sessionId);
      response.json({ ok: true, sessionId });
    } catch (error) {
      console.error('[API] Error saving session:', error);
      const message = error instanceof Error ? error.message : String(error);
      response.status(500).json({ error: message });
    }
  });

  // Session history - optional auth (shows prompt for guests)
  app.get('/api/history/sessions', optionalAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    if (!findingRepo) {
      response.json({ sessions: [], requiresAuth: request.isGuest });
      return;
    }

    try {
      const rawLimit = Number(request.query.limit ?? 50);
      const limit = Number.isFinite(rawLimit) ? rawLimit : 50;
      const sessions = await findingRepo.listSessionHistory(limit);
      response.json({ sessions, requiresAuth: request.isGuest });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(500).json({ error: message });
    }
  });
}
