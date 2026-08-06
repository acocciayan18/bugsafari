// Boot-time environment validation for the critical infrastructure secrets. JWT is
// validated separately in authConfig; this covers the datastore URIs, which
// otherwise fall back to localhost silently — a production misconfig that points a
// live deployment at a non-existent local DB/Redis instead of failing fast.

import { createLogger } from '../infrastructure/observability/logger.js';

const log = createLogger('[env]');

const LOCAL_MONGO = 'mongodb://localhost:27017/';
const LOCAL_REDIS = 'redis://127.0.0.1:6379';

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

// Mongo connection string. In production a missing URI is fatal (fail-closed); in
// dev it falls back to localhost for convenience.
export function resolveMongoUri(): string {
  const uri = process.env.MONGODB_URI ?? process.env.MONGO_URI;
  if (uri && uri.trim().length > 0) return uri;
  if (isProduction()) throw new Error('MONGODB_URI (or MONGO_URI) must be set in production; refusing to fall back to localhost.');
  return LOCAL_MONGO;
}

// Redis connection string, same fail-closed policy — the queue is mandatory in prod.
export function resolveRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (url && url.trim().length > 0) return url;
  if (isProduction()) throw new Error('REDIS_URL must be set in production; refusing to fall back to localhost.');
  return LOCAL_REDIS;
}

// Aggregate boot guard: validate every critical infra var at once and report all
// failures together, so a misconfigured deploy aborts before opening a port.
export function assertBootEnv(role: 'api' | 'worker'): void {
  const errors: string[] = [];
  try { resolveMongoUri(); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  try { resolveRedisUrl(); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }

  if (errors.length > 0) {
    for (const message of errors) log.error(message);
    throw new Error(`[env] ${role} boot aborted: ${errors.length} required variable(s) missing or invalid.`);
  }
}
