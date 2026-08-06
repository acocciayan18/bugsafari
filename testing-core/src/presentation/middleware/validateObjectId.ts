import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { Types } from 'mongoose';

import { createLogger } from '../../infrastructure/observability/logger.js';

const obsLog = createLogger('[VALIDATION]');

// A 24-char hex string is the only form we accept. Mongoose's isValid() also
// accepts 12-byte strings and numbers, which would let unintended input through
// to a query, so the regex is checked first.
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

export function isValidObjectId(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value) && Types.ObjectId.isValid(value);
}

// Read a param that validateObjectIdParams has already cleared. Express 5 types
// params as string|string[]; this narrows to the validated string form.
export function readObjectIdParam(request: Request, name: string): string {
  const raw = request.params[name];
  if (!isValidObjectId(raw)) {
    throw new Error(`readObjectIdParam("${name}") called without validateObjectIdParams("${name}")`);
  }
  return raw;
}

// Reject a request whose named route params aren't well-formed ObjectIds, so a
// malformed id fails as 400 at the edge instead of throwing inside a query.
export function validateObjectIdParams(...paramNames: string[]): RequestHandler {
  return function validate(request: Request, response: Response, next: NextFunction): void {
    for (const name of paramNames) {
      const raw = request.params[name];
      if (!isValidObjectId(raw)) {
        obsLog.warn(`[VALIDATION] Rejected ${request.method} ${request.originalUrl}: invalid ObjectId in :${name}`);
        response.status(400).json({ error: `Invalid ${name} format.`, code: 'INVALID_ID' });
        return;
      }
    }
    next();
  };
}
