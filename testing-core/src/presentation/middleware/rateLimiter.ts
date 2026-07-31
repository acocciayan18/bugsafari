import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AuthErrorBody } from '../../../../shared/types.js';

// In-process sliding-window limiter. No external dep (project constraint) and no
// always-on Redis requirement — budgets are therefore per API process. Running
// multiple API replicas multiplies the effective limit by the replica count.

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  // Label used in logs so a tripped limit is attributable to a route group.
  name: string;
  // Optional extra key material (e.g. login email) to narrow the bucket.
  keyOn?: (request: Request) => string | undefined;
  message?: string;
}

interface Bucket {
  hits: number[];
}

const SWEEP_INTERVAL_MS = 60_000;
// Upper bound on distinct keys held per limiter (SEC-09/16): a spoofed-source flood
// must not grow the map without limit between sweeps. Oldest entries are evicted.
const MAX_BUCKETS = 20_000;

function clientIp(request: Request): string {
  // req.ip honors `trust proxy`; socket address is the direct-connection fallback.
  return request.ip ?? request.socket.remoteAddress ?? 'unknown';
}

export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const { windowMs, max, name, keyOn, message } = options;
  const buckets = new Map<string, Bucket>();

  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, bucket] of buckets) {
      bucket.hits = bucket.hits.filter((at) => at > cutoff);
      if (bucket.hits.length === 0) buckets.delete(key);
    }
  }, SWEEP_INTERVAL_MS);
  // Never hold the event loop open for a janitor timer.
  sweep.unref?.();

  return function rateLimit(request: Request, response: Response, next: NextFunction): void {
    const now = Date.now();
    const cutoff = now - windowMs;
    const extra = keyOn?.(request);
    const key = extra ? `${name}:${clientIp(request)}:${extra}` : `${name}:${clientIp(request)}`;

    const bucket = buckets.get(key) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((at) => at > cutoff);

    // Standard rate-limit headers so clients can self-throttle (SEC-16.6).
    const resetSec = bucket.hits.length
      ? Math.max(1, Math.ceil((bucket.hits[0] + windowMs - now) / 1000))
      : Math.ceil(windowMs / 1000);
    response.setHeader('RateLimit-Limit', String(max));
    response.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.hits.length)));
    response.setHeader('RateLimit-Reset', String(resetSec));

    if (bucket.hits.length >= max) {
      buckets.set(key, bucket);
      console.warn(`[RATE LIMIT] ${name} tripped for ${clientIp(request)} (${bucket.hits.length}/${max})`);
      response.setHeader('Retry-After', String(resetSec));
      const body: AuthErrorBody = {
        error: message ?? 'Too many requests. Please slow down and try again shortly.',
        code: 'RATE_LIMITED',
        retryAfterSeconds: resetSec,
      };
      response.status(429).json(body);
      return;
    }

    bucket.hits.push(now);
    buckets.set(key, bucket);
    // Bound the map: evict oldest-inserted keys once over the cap so the limiter's
    // own state cannot be grown into a memory-exhaustion vector.
    while (buckets.size > MAX_BUCKETS) {
      const oldest = buckets.keys().next().value as string | undefined;
      if (oldest === undefined || oldest === key) break;
      buckets.delete(oldest);
    }
    next();
  };
}

// Shared presets. Auth mutations are the highest-value abuse targets, so they get
// the tightest budgets; read-heavy authenticated routes get a generous ceiling
// that only a scripted client would ever reach.

export const loginLimiter = createRateLimiter({
  name: 'auth:login',
  windowMs: 15 * 60_000,
  max: 10,
  keyOn: (request) => (typeof request.body?.email === 'string' ? request.body.email.toLowerCase() : undefined),
  message: 'Too many login attempts. Try again in a few minutes.',
});

// IP-only companion to loginLimiter (SEC-16.2): the per-email bucket lets one IP
// spray one attempt each across thousands of accounts unbounded. This bounds total
// login failures per source network regardless of which account is targeted.
export const loginIpLimiter = createRateLimiter({
  name: 'auth:login-ip',
  windowMs: 15 * 60_000,
  max: 30,
  message: 'Too many login attempts from this network. Try again in a few minutes.',
});

export const signupLimiter = createRateLimiter({
  name: 'auth:signup',
  windowMs: 60 * 60_000,
  max: 5,
  message: 'Too many accounts created from this address. Try again later.',
});

export const forgotPasswordLimiter = createRateLimiter({
  name: 'auth:forgot-password',
  windowMs: 60 * 60_000,
  max: 5,
  message: 'Too many password reset requests. Try again later.',
});

export const resetPasswordLimiter = createRateLimiter({
  name: 'auth:reset-password',
  windowMs: 15 * 60_000,
  max: 10,
  message: 'Too many reset attempts. Try again in a few minutes.',
});

export const refreshLimiter = createRateLimiter({
  name: 'auth:refresh',
  windowMs: 15 * 60_000,
  max: 60,
  message: 'Too many token refresh attempts.',
});

export const startTestLimiter = createRateLimiter({
  name: 'run:start-test',
  windowMs: 10 * 60_000,
  max: 20,
  message: 'Too many safari launches. Wait before starting another run.',
});

export const analyzeLimiter = createRateLimiter({
  name: 'forensic:analyze',
  windowMs: 10 * 60_000,
  max: 30,
  message: 'Too many analysis requests. Wait before requesting another.',
});

export const writeLimiter = createRateLimiter({
  name: 'api:write',
  windowMs: 5 * 60_000,
  max: 120,
  message: 'Too many write requests. Please slow down.',
});

export const readLimiter = createRateLimiter({
  name: 'api:read',
  windowMs: 5 * 60_000,
  max: 300,
});
