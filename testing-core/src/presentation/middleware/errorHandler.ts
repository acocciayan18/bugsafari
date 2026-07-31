import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

// Errors a route may deliberately surface to the client. Anything else reaching
// the handler is treated as internal and its detail is withheld.
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

interface ErrorLike {
  status?: number;
  statusCode?: number;
  type?: string;
  code?: string;
  message?: string;
  expose?: boolean;
}

// Body-parser and Express surface 4xx conditions as tagged errors; map the ones
// we can describe safely, leave everything else as an opaque 500.
function classify(error: ErrorLike): { status: number; message: string; code?: string } {
  if (error instanceof HttpError) {
    return { status: error.status, message: error.message, code: error.code };
  }

  const status = error.status ?? error.statusCode;

  if (error.type === 'entity.too.large' || status === 413) {
    return { status: 413, message: 'Request body is too large.', code: 'PAYLOAD_TOO_LARGE' };
  }
  if (error.type === 'entity.parse.failed' || (status === 400 && error instanceof SyntaxError)) {
    return { status: 400, message: 'Request body is not valid JSON.', code: 'INVALID_JSON' };
  }
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return { status, message: 'Request rejected.', code: 'BAD_REQUEST' };
  }

  return { status: 500, message: 'An internal error occurred.', code: 'INTERNAL_ERROR' };
}

// Terminal Express handler. Guarantees a JSON body and prevents the default
// handler from rendering an HTML stack trace to the client.
export function errorHandler(
  error: unknown,
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (response.headersSent) {
    next(error);
    return;
  }

  const errorId = randomUUID();
  const { status, message, code } = classify((error ?? {}) as ErrorLike);

  const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  // Log the path WITHOUT the query string (SEC-19): query strings can carry reset
  // tokens and other sensitive values that must not land in logs.
  console.error(`[ERROR ${errorId}] ${request.method} ${request.path} -> ${status}\n${detail}`);

  response.status(status).json({ error: message, code, errorId });
}

// JSON 404 for every unmatched path (SEC-23). The API host serves no HTML, so a
// non-/api path must not fall through to Express's default HTML 404, which
// fingerprints the framework. Socket.IO handles /socket.io/ before Express.
export function notFoundHandler(_request: Request, response: Response, _next: NextFunction): void {
  response.status(404).json({ error: 'Endpoint not found.', code: 'NOT_FOUND' });
}
