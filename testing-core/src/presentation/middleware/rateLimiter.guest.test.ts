// Self-executing checks for the guest launch limiters + the ifGuest gate. No test
// framework (per the "no external libraries" rule) — run by scripts/run-tests.mjs.

import assert from 'node:assert/strict';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { guestStartWindowLimiter, guestStartCooldownLimiter } from './rateLimiter.js';
import { ifGuest } from '../authentication/authMiddleware.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function makeReq(ip: string, isGuest: boolean): Request {
  return { ip, socket: { remoteAddress: ip }, headers: {}, isGuest } as unknown as Request;
}
function makeRes(): Response & { statusCode: number } {
  const res = {
    statusCode: 0,
    setHeader() { /* noop */ },
    status(code: number) { res.statusCode = code; return res; },
    json() { return res; },
  };
  return res as unknown as Response & { statusCode: number };
}
function run(mw: RequestHandler, req: Request): { statusCode: number; nextCalled: boolean } {
  const res = makeRes();
  let nextCalled = false;
  const next: NextFunction = () => { nextCalled = true; };
  mw(req, res, next);
  return { statusCode: res.statusCode, nextCalled };
}

check('guest cooldown limiter blocks a second launch inside the window', () => {
  const req = makeReq('10.0.0.1', true);
  assert.equal(run(guestStartCooldownLimiter, req).nextCalled, true);
  const second = run(guestStartCooldownLimiter, req);
  assert.equal(second.nextCalled, false);
  assert.equal(second.statusCode, 429);
  // A different source IP has its own bucket.
  assert.equal(run(guestStartCooldownLimiter, makeReq('10.0.0.2', true)).nextCalled, true);
});

check('guest window limiter allows 3 launches then trips on the 4th', () => {
  const req = makeReq('10.0.0.9', true);
  for (let i = 0; i < 3; i += 1) assert.equal(run(guestStartWindowLimiter, req).nextCalled, true);
  const fourth = run(guestStartWindowLimiter, req);
  assert.equal(fourth.nextCalled, false);
  assert.equal(fourth.statusCode, 429);
});

check('ifGuest runs the inner middleware only for guests', () => {
  let innerCalls = 0;
  const inner: RequestHandler = (_req, _res, next) => { innerCalls += 1; next(); };
  const wrapped = ifGuest(inner);
  const authed = run(wrapped, makeReq('1.1.1.1', false));
  assert.equal(innerCalls, 0);
  assert.equal(authed.nextCalled, true);
  const guest = run(wrapped, makeReq('1.1.1.1', true));
  assert.equal(innerCalls, 1);
  assert.equal(guest.nextCalled, true);
});

console.log(`rateLimiter.guest.test.ts: ${passed} checks passed`);
