import type { Request, Response, NextFunction } from 'express';

// Temporary development-only system lock. One shared secret, checked ahead of auth
// so neither a valid JWT nor guest mode can bypass it. Remove when dev-gating ends.
const ACCESS_PASSWORD = 'Bugsafari_2026';
const ACCESS_HEADER = 'x-bugsafari-access';

// Unauthenticated infra probes carry no header — never gate them or the container
// health check and metrics scrape start failing.
const EXEMPT_PATHS = new Set(['/api/health', '/metrics']);

export function requireAccessKey(request: Request, response: Response, next: NextFunction): void {
  // Tests exercise endpoints directly without the dev secret.
  if (process.env.NODE_ENV === 'test') { next(); return; }
  if (request.method === 'OPTIONS' || EXEMPT_PATHS.has(request.path)) { next(); return; }

  const provided = request.headers[ACCESS_HEADER];
  if (provided === ACCESS_PASSWORD) { next(); return; }

  response.status(403).json({
    error: 'System locked. Enter the BugSafari access password to continue.',
    code: 'ACCESS_LOCKED',
  });
}
