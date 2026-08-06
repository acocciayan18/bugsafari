import assert from 'node:assert/strict';
import { resolveMongoUri, resolveRedisUrl, assertBootEnv } from './env.js';

const KEYS = ['NODE_ENV', 'MONGODB_URI', 'MONGO_URI', 'REDIS_URL'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])) as Record<string, string | undefined>;

function set(env: Partial<Record<(typeof KEYS)[number], string | undefined>>): void {
  for (const k of KEYS) {
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

try {
  // ── dev: missing URIs fall back to localhost, boot does not abort ────────────
  set({ NODE_ENV: 'development' });
  assert.ok(resolveMongoUri().includes('localhost'), 'dev mongo falls back to localhost');
  assert.ok(resolveRedisUrl().includes('127.0.0.1'), 'dev redis falls back to localhost');
  assert.doesNotThrow(() => assertBootEnv('api'), 'dev boot must not abort on missing URIs');

  // ── prod: missing URIs are fatal ─────────────────────────────────────────────
  set({ NODE_ENV: 'production' });
  assert.throws(() => resolveMongoUri(), /MONGODB_URI/, 'prod mongo missing is fatal');
  assert.throws(() => resolveRedisUrl(), /REDIS_URL/, 'prod redis missing is fatal');
  assert.throws(() => assertBootEnv('api'), /boot aborted/, 'prod boot aborts when infra vars missing');

  // ── prod: provided URIs are returned verbatim and boot passes ────────────────
  set({ NODE_ENV: 'production', MONGODB_URI: 'mongodb://atlas/db', REDIS_URL: 'redis://cache:6379' });
  assert.equal(resolveMongoUri(), 'mongodb://atlas/db');
  assert.equal(resolveRedisUrl(), 'redis://cache:6379');
  assert.doesNotThrow(() => assertBootEnv('api'), 'prod boot passes when infra vars are set');

  // ── MONGO_URI is accepted as the alias for MONGODB_URI ───────────────────────
  set({ NODE_ENV: 'production', MONGO_URI: 'mongodb://alias/db', REDIS_URL: 'redis://cache:6379' });
  assert.equal(resolveMongoUri(), 'mongodb://alias/db', 'MONGO_URI alias resolves');
} finally {
  set(saved);
}

console.log('✓ env — prod fail-closed guards, dev localhost fallback');
