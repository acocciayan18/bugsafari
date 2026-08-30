import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { optionalAuth, type AuthRequest } from './authMiddleware.js';

// Self-executing script (no runner). Locks FIX-6: optionalAuth downgrades to guest
// ONLY when no token is present. A present-but-expired/invalid token must return 401
// TOKEN_EXPIRED (so the client refreshes and keeps its identity), never silent-guest.
// Signs with the dev fallback secret + pinned issuer/audience (no NODE_ENV=production).

const SECRET = 'bugsafari-local-development-secret';
const SIGN = { issuer: 'bugsafari', audience: 'bugsafari-api' } as const;

function exchange(authorization?: string): { req: AuthRequest; captured: { status: number | null; body: unknown; next: boolean } } {
  const captured = { status: null as number | null, body: null as unknown, next: false };
  const req = { headers: authorization ? { authorization } : {} } as unknown as AuthRequest;
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(payload: unknown) { captured.body = payload; return this; },
  } as unknown as Response;
  const next: NextFunction = () => { captured.next = true; };
  optionalAuth(req, res, next);
  return { req, captured };
}

let passed = 0;
function check(name: string, fn: () => void): void { fn(); passed += 1; console.log(`  ✓ ${name}`); }

console.log('optionalAuth — FIX-6 session isolation');

check('no Authorization header → guest, proceeds', () => {
  const { req, captured } = exchange();
  assert.equal(req.isGuest, true);
  assert.equal(captured.next, true);
  assert.equal(captured.status, null, 'guest is not rejected');
});

check('valid token → real user, proceeds, not guest', () => {
  const token = jwt.sign({ userId: 'u1', email: 'a@b.co' }, SECRET, { ...SIGN, expiresIn: '30m' });
  const { req, captured } = exchange(`Bearer ${token}`);
  assert.equal(req.isGuest, false);
  assert.equal(req.userId, 'u1');
  assert.equal(captured.next, true);
  assert.equal(captured.status, null);
});

check('expired token → 401 TOKEN_EXPIRED, NOT silent guest', () => {
  const token = jwt.sign({ userId: 'u1', email: 'a@b.co' }, SECRET, { ...SIGN, expiresIn: -10 });
  const { req, captured } = exchange(`Bearer ${token}`);
  assert.equal(captured.status, 401, 'must reject, not downgrade');
  assert.equal((captured.body as { code?: string }).code, 'TOKEN_EXPIRED');
  assert.notEqual(req.isGuest, true, 'must not be marked guest');
  assert.equal(captured.next, false, 'must not proceed');
});

check('garbage token → 401, not guest', () => {
  const { captured } = exchange('Bearer not-a-jwt');
  assert.equal(captured.status, 401);
  assert.equal(captured.next, false);
});

check('empty Bearer token → 401, not guest', () => {
  const { captured } = exchange('Bearer ');
  assert.equal(captured.status, 401);
  assert.equal(captured.next, false);
});

console.log(`\noptionalAuth: ${passed} checks passed.`);
