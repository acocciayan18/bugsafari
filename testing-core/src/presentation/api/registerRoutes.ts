import type { Express, Request, Response } from 'express';
import { parseTargetUrl } from '../../serverUtils.js';
import { StartExplorationUseCase } from '../../application/useCases/StartExplorationUseCase.js';

export function registerRoutes(app: Express, useCase: StartExplorationUseCase, port: number): void {
  app.get('/api/health', (_request: Request, response: Response) => {
    response.json({
      ok: true,
      active: useCase.isActive(),
      port,
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/start-test', async (request: Request, response: Response): Promise<void> => {
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
}
