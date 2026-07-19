// Self-check for the security middleware: rate-limit windowing, ObjectId param
// rejection, and error sanitization (no internal detail reaches the client).
// Run with `npx tsx src/presentation/middleware/security.test.ts`.

import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { createRateLimiter } from './rateLimiter.js';
import { validateObjectIdParams, isValidObjectId } from './validateObjectId.js';
import { errorHandler, HttpError } from './errorHandler.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

interface Captured {
  status: number | null;
  body: unknown;
  headers: Record<string, string>;
  nextCalled: boolean;
}

function fakeExchange(request: Partial<Request>): { request: Request; response: Response; captured: Captured } {
  const captured: Captured = { status: null, body: null, headers: {}, nextCalled: false };
  const response = {
    headersSent: false,
    status(code: number) { captured.status = code; return this; },
    json(payload: unknown) { captured.body = payload; return this; },
    setHeader(key: string, value: string) { captured.headers[key] = value; },
  } as unknown as Response;
  return { request: request as Request, response, captured };
}

console.log('security middleware — rate limiting, id validation, error sanitization');

check('rate limiter admits up to max, then rejects with 429 and Retry-After', () => {
  const limiter = createRateLimiter({ name: 'test', windowMs: 60_000, max: 2 });
  const results: Captured[] = [];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { request, response, captured } = fakeExchange({ ip: '10.0.0.1', socket: {} as never });
    limiter(request, response, () => { captured.nextCalled = true; });
    results.push(captured);
  }

  assert.equal(results[0].nextCalled, true);
  assert.equal(results[1].nextCalled, true);
  assert.equal(results[2].nextCalled, false);
  assert.equal(results[2].status, 429);
  assert.ok(results[2].headers['Retry-After']);
});

check('rate limiter budgets are per client address', () => {
  const limiter = createRateLimiter({ name: 'test-perip', windowMs: 60_000, max: 1 });

  const first = fakeExchange({ ip: '10.0.0.1', socket: {} as never });
  limiter(first.request, first.response, () => { first.captured.nextCalled = true; });

  const other = fakeExchange({ ip: '10.0.0.2', socket: {} as never });
  limiter(other.request, other.response, () => { other.captured.nextCalled = true; });

  assert.equal(first.captured.nextCalled, true);
  assert.equal(other.captured.nextCalled, true, 'a second address must get its own budget');
});

check('only 24-char hex strings are accepted as ObjectIds', () => {
  assert.equal(isValidObjectId('507f1f77bcf86cd799439011'), true);
  assert.equal(isValidObjectId('not-an-id'), false);
  assert.equal(isValidObjectId(''), false);
  assert.equal(isValidObjectId(undefined), false);
  // Mongoose would accept a 12-char string; the route contract must not.
  assert.equal(isValidObjectId('123456789012'), false);
});

check('invalid ObjectId param is rejected as 400 before the handler runs', () => {
  const guard = validateObjectIdParams('sessionId');
  const { request, response, captured } = fakeExchange({
    params: { sessionId: "'; return true; //" } as never,
    method: 'GET',
    originalUrl: '/api/forensic/report/x',
  });

  guard(request, response, () => { captured.nextCalled = true; });

  assert.equal(captured.nextCalled, false);
  assert.equal(captured.status, 400);
  assert.equal((captured.body as { code: string }).code, 'INVALID_ID');
});

check('valid ObjectId param passes through', () => {
  const guard = validateObjectIdParams('sessionId');
  const { request, response, captured } = fakeExchange({
    params: { sessionId: '507f1f77bcf86cd799439011' } as never,
    method: 'GET',
    originalUrl: '/api/forensic/report/507f1f77bcf86cd799439011',
  });

  guard(request, response, () => { captured.nextCalled = true; });
  assert.equal(captured.nextCalled, true);
  assert.equal(captured.status, null);
});

check('unexpected errors are reported as opaque 500s with no internal detail', () => {
  const { request, response, captured } = fakeExchange({ method: 'GET', originalUrl: '/api/history' });
  const leaky = new Error('MongoServerError: connection to atlas-primary:27017 failed, user=admin');

  errorHandler(leaky, request, response, () => undefined);

  const body = captured.body as { error: string; code: string; errorId: string };
  assert.equal(captured.status, 500);
  assert.equal(body.error, 'An internal error occurred.');
  assert.equal(body.code, 'INTERNAL_ERROR');
  assert.ok(body.errorId, 'an id must be returned so the log can be correlated');
  assert.ok(!JSON.stringify(body).includes('atlas-primary'), 'infrastructure detail must not leak');
  assert.ok(!JSON.stringify(body).includes('stack'));
});

check('deliberate HttpErrors keep their status and message', () => {
  const { request, response, captured } = fakeExchange({ method: 'POST', originalUrl: '/api/x' });

  errorHandler(new HttpError(403, 'You do not own this session.', 'FORBIDDEN'), request, response, () => undefined);

  const body = captured.body as { error: string; code: string };
  assert.equal(captured.status, 403);
  assert.equal(body.error, 'You do not own this session.');
  assert.equal(body.code, 'FORBIDDEN');
});

check('oversized and malformed bodies map to their own 4xx codes', () => {
  const big = fakeExchange({ method: 'POST', originalUrl: '/api/history/save-session' });
  errorHandler({ type: 'entity.too.large', status: 413 }, big.request, big.response, () => undefined);
  assert.equal(big.captured.status, 413);
  assert.equal((big.captured.body as { code: string }).code, 'PAYLOAD_TOO_LARGE');

  const bad = fakeExchange({ method: 'POST', originalUrl: '/api/auth/login' });
  errorHandler({ type: 'entity.parse.failed', status: 400 }, bad.request, bad.response, () => undefined);
  assert.equal(bad.captured.status, 400);
  assert.equal((bad.captured.body as { code: string }).code, 'INVALID_JSON');
});

console.log(`\nsecurity middleware: ${passed} checks passed.`);
