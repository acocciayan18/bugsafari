import { Redis, type RedisOptions } from 'ioredis';

import { resolveRedisUrl } from '../../config/env.js';
import { createLogger } from '../observability/logger.js';

// Single factory for every queue-side ioredis client. Centralizes three things that
// were previously duplicated and drifting across the queue modules: URL resolution
// through resolveRedisUrl (empty/whitespace REDIS_URL falls back in dev, fails closed
// in prod), the mandatory 'error' listener, and a diagnostic that actually names the
// fault. ECONNREFUSED on Windows arrives with an EMPTY err.message, so logging only
// err.message prints '' and hides the cause; include err.code and the target host.

const DEFAULT_OPTIONS: RedisOptions = { maxRetriesPerRequest: null };

// Host:port only — never echo credentials from a redis://user:pass@host URL into logs.
function safeTarget(redisUrl: string): string {
  try {
    const u = new URL(redisUrl);
    return `${u.hostname || '127.0.0.1'}:${u.port || '6379'}`;
  } catch {
    return 'redis';
  }
}

// Render an ioredis/BullMQ error so the cause is never blank: ECONNREFUSED carries an
// empty message on Windows, so fall back to the error code when message is empty.
export function describeRedisError(err: unknown): string {
  const e = err as NodeJS.ErrnoException | undefined;
  const code = e?.code;
  const message = e instanceof Error && e.message.length > 0 ? e.message : undefined;
  return message ?? code ?? String(err);
}

export function createRedisConnection(component: string, redisUrl = resolveRedisUrl(), options: RedisOptions = {}): Redis {
  const target = safeTarget(redisUrl);
  const client = new Redis(redisUrl, { ...DEFAULT_OPTIONS, ...options });
  const log = createLogger(component);
  // MUST attach 'error': an ioredis client emits 'error' on every transient blip
  // (reconnect, ECONNRESET), and an EventEmitter 'error' with no listener throws →
  // uncaught exception → the process exits. ioredis auto-reconnects, so log-and-continue.
  let logged = 0;
  client.on('error', (err: NodeJS.ErrnoException) => {
    // Rate-limit: a down Redis emits one 'error' per reconnect attempt; don't flood.
    if (logged === 0 || logged % 50 === 0) {
      log.error(`redis connection error (${target}): ${describeRedisError(err)}`);
    }
    logged += 1;
  });
  return client;
}

// Resolve when the client reaches 'ready', reject after timeoutMs. Used at boot so an
// unreachable Redis fails fast with an actionable message instead of hanging a
// subscribe() on the offline queue forever (which blocked the API from ever listening).
export function waitForRedisReady(client: Redis, redisUrl: string, timeoutMs = 10_000): Promise<void> {
  if (client.status === 'ready') return Promise.resolve();
  const target = safeTarget(redisUrl);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Redis not reachable at ${target} within ${timeoutMs}ms. Start it (docker compose -f docker-compose.local.yml up -d redis) or unset BUGSAFARI_USE_QUEUE to run the synchronous in-process path.`));
    }, timeoutMs);
    timer.unref();
    const onReady = (): void => { cleanup(); resolve(); };
    const cleanup = (): void => { clearTimeout(timer); client.off('ready', onReady); };
    client.once('ready', onReady);
  });
}
