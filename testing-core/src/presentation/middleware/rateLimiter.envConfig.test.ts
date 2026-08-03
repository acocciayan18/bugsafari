import assert from 'node:assert';
import type { Request, Response } from 'express';

// Env overrides are read when createRateLimiter() runs, so set them BEFORE the
// dynamic import below constructs anything.
process.env.BUGSAFARI_RL_TEST_OVERRIDE_MAX = '2';
process.env.BUGSAFARI_RL_TEST_OVERRIDE_WINDOW_MS = '60000';
process.env.BUGSAFARI_RL_TEST_BADVAL_MAX = 'not-a-number';
delete process.env.BUGSAFARI_RL_DISABLED;

const { createRateLimiter } = await import('./rateLimiter.js');

// Minimal Express req/res/next doubles — enough for the limiter's IP keying and
// header/response writes.
function fakeReq(ip = '203.0.113.7'): Request {
  return { ip, socket: { remoteAddress: ip }, body: {} } as unknown as Request;
}
function fakeRes(): Response & { statusCode: number; headers: Record<string, string>; body: unknown } {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(k: string, v: string) { this.headers[k] = String(v); },
    status(c: number) { this.statusCode = c; return this; },
    json(o: unknown) { this.body = o; return this; },
  };
  return res as unknown as Response & { statusCode: number; headers: Record<string, string>; body: unknown };
}

// Drive one request through the limiter; returns the mock response after it settles.
function hit(limiter: ReturnType<typeof createRateLimiter>, ip?: string) {
  const res = fakeRes();
  let nexted = false;
  limiter(fakeReq(ip), res as unknown as Response, () => { nexted = true; });
  return { res, nexted };
}

// 1) Env override tightens a generous default (max 100 -> 2).
const overridden = createRateLimiter({ name: 'test:override', windowMs: 1000, max: 100 });
assert.strictEqual(hit(overridden).nexted, true, 'override: 1st allowed');
assert.strictEqual(hit(overridden).nexted, true, 'override: 2nd allowed');
const third = hit(overridden);
assert.strictEqual(third.nexted, false, 'override: 3rd blocked by env max=2');
assert.strictEqual(third.res.statusCode, 429, 'override: 3rd returns 429');
assert.strictEqual(third.res.headers['RateLimit-Limit'], '2', 'override: header reflects env max');
assert.ok(third.res.headers['Retry-After'], 'override: 429 carries Retry-After');
assert.strictEqual((third.res.body as { code?: string }).code, 'RATE_LIMITED', 'override: typed RATE_LIMITED body');

// 2) Malformed override is ignored — the preset default (max 1) is kept.
const badval = createRateLimiter({ name: 'test:badval', windowMs: 60000, max: 1 });
assert.strictEqual(hit(badval).nexted, true, 'badval: 1st allowed');
assert.strictEqual(hit(badval).nexted, false, 'badval: 2nd blocked at default max=1 (bad env ignored)');

// 3) No override => default is used verbatim.
const noenv = createRateLimiter({ name: 'test:noenv', windowMs: 60000, max: 5 });
assert.strictEqual(hit(noenv).res.headers['RateLimit-Limit'], '5', 'noenv: default max exposed');

console.log('rateLimiter.envConfig.test.ts passed');
