// Express middleware that binds a per-request log context and emits one access log
// per response. The request id is echoed via the X-Request-Id header so clients and
// proxies can correlate. Query strings are dropped from logs (SEC-19): they can
// carry reset tokens and other secrets.

import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

import { createLogger } from './logger.js';
import { runWithLogContext } from './logContext.js';
import { observeHttpStatus } from './metrics.js';

const log = createLogger('[HTTP]');

const REQUEST_ID_HEADER = 'x-request-id';
const MAX_INBOUND_ID_LEN = 128;

// Accept a caller-supplied id only if it is short and safe; otherwise mint one.
function resolveRequestId(request: Request): string {
  const inbound = request.headers[REQUEST_ID_HEADER];
  const value = Array.isArray(inbound) ? inbound[0] : inbound;
  if (typeof value === 'string' && value.length > 0 && value.length <= MAX_INBOUND_ID_LEN && /^[\w.:-]+$/.test(value)) {
    return value;
  }
  return randomUUID();
}

export function requestLogger(request: Request, response: Response, next: NextFunction): void {
  const reqId = resolveRequestId(request);
  response.setHeader('X-Request-Id', reqId);

  const startedAt = process.hrtime.bigint();

  runWithLogContext({ reqId }, () => {
    response.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      observeHttpStatus(response.statusCode);
      log.info(`${request.method} ${request.path} -> ${response.statusCode}`, {
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs: Math.round(durationMs),
      });
    });
    next();
  });
}
