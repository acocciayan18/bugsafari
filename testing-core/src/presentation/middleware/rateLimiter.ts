import type { Request, Response, NextFunction, RequestHandler } from 'express';

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

    if (bucket.hits.length >= max) {
      buckets.set(key, bucket);
      const retryAfterMs = bucket.hits[0] + windowMs - now;
      const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
      console.warn(`[RATE LIMIT] ${name} tripped for ${clientIp(request)} (${bucket.hits.length}/${max})`);
      response.setHeader('Retry-After', String(retryAfterSec));
      response.status(429).json({
        error: message ?? 'Too many requests. Please slow down and try again shortly.',
        retryAfterSeconds: retryAfterSec,
      });
      return;
    }

    bucket.hits.push(now);
    buckets.set(key, bucket);
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
