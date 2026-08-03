import assert from 'node:assert';
import type { Request, Response } from 'express';

// The kill switch is read once at module load, so set it BEFORE the dynamic import.
process.env.BUGSAFARI_RL_DISABLED = '1';

const { createRateLimiter } = await import('./rateLimiter.js');

function fakeReq(): Request {
  return { ip: '203.0.113.9', socket: { remoteAddress: '203.0.113.9' }, body: {} } as unknown as Request;
}
function fakeRes(): Response & { statusCode: number } {
  const res = { statusCode: 200, setHeader() {}, status(c: number) { this.statusCode = c; return this; }, json() { return this; } };
  return res as unknown as Response & { statusCode: number };
}

// With BUGSAFARI_RL_DISABLED set, a max=1 limiter must still let every request past.
const limiter = createRateLimiter({ name: 'test:disabled', windowMs: 60000, max: 1 });
for (let i = 0; i < 5; i++) {
  const res = fakeRes();
  let nexted = false;
  limiter(fakeReq(), res as unknown as Response, () => { nexted = true; });
  assert.strictEqual(nexted, true, `disabled: request ${i + 1} passes through`);
  assert.strictEqual(res.statusCode, 200, `disabled: request ${i + 1} never 429`);
}

console.log('rateLimiter.disabled.test.ts passed');
