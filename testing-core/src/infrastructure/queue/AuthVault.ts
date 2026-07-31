import { Redis } from 'ioredis';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { TargetAuthConfig } from '../../../../shared/types.js';

// Long enough for a deep queue, short enough that an abandoned job's credentials
// are unrecoverable well before anyone could go looking for them.
const AUTH_TTL_SECONDS = 600;
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

interface SealedAuth {
  v: 1;
  iv: string;
  tag: string;
  ct: string;
}

// Accepts hex (64 chars) or base64; anything that isn't exactly 32 bytes is a
// misconfiguration we must not paper over by hashing it into range.
function readKey(raw: string | undefined): Buffer | null {
  if (!raw?.trim()) return null;
  const value = raw.trim();
  const buffer = /^[0-9a-fA-F]{64}$/.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64');
  return buffer.length === KEY_BYTES ? buffer : null;
}

/**
 * Ephemeral, encrypted, single-use store for target-app credentials crossing the
 * process boundary to a worker.
 *
 * The job payload never carries the secret — only the runToken, which is already
 * public to the run's owner. Ciphertext lives under its own key with a short TTL
 * and is consumed with GETDEL, so it exists for exactly one read. This is what
 * makes authenticated runs safe to queue: BullMQ retains failed job payloads in
 * Redis for 24h in plaintext, and credentials must never be part of that.
 */
export class AuthVault {
  private readonly redis: Redis;
  private readonly key: Buffer;

  private constructor(redis: Redis, key: Buffer) {
    this.redis = redis;
    this.key = key;
  }

  /** Null when no valid key is configured — callers must then refuse queued auth. */
  public static create(
    redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    rawKey = process.env.BUGSAFARI_AUTH_KEY,
  ): AuthVault | null {
    const key = readKey(rawKey);
    if (!key) {
      console.warn('[AuthVault] BUGSAFARI_AUTH_KEY missing or not 32 bytes — authenticated runs cannot be queued.');
      return null;
    }
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    // Attach an 'error' listener so a transient Redis blip never becomes an unhandled
    // EventEmitter 'error' that crashes the process. The client auto-reconnects.
    redis.on('error', (err) => console.error('[AuthVault] redis connection error:', err instanceof Error ? err.message : err));
    return new AuthVault(redis, key);
  }

  private vaultKey(runToken: string): string {
    return `safari:auth:${runToken}`;
  }

  public async put(runToken: string, auth: TargetAuthConfig): Promise<void> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(auth), 'utf8'), cipher.final()]);
    const sealed: SealedAuth = {
      v: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ct: ct.toString('base64'),
    };
    await this.redis.set(this.vaultKey(runToken), JSON.stringify(sealed), 'EX', AUTH_TTL_SECONDS);
  }

  /**
   * Read and destroy in one atomic step. Returns null if the entry expired or
   * was already consumed — the caller must fail the run rather than downgrade it
   * to an unauthenticated one, which would report a clean result for a surface
   * that was never tested.
   */
  public async take(runToken: string): Promise<TargetAuthConfig | null> {
    const raw = await this.redis.getdel(this.vaultKey(runToken));
    if (!raw) return null;
    try {
      const sealed = JSON.parse(raw) as SealedAuth;
      const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(sealed.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
      const plain = Buffer.concat([decipher.update(Buffer.from(sealed.ct, 'base64')), decipher.final()]);
      return JSON.parse(plain.toString('utf8')) as TargetAuthConfig;
    } catch (error) {
      // A tag mismatch means tampering or a rotated key — never guess, never log
      // the payload. The run fails closed.
      console.error('[AuthVault] Failed to open sealed credentials:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  /** Best-effort removal for a cancelled or dead job. */
  public async discard(runToken: string): Promise<void> {
    await this.redis.del(this.vaultKey(runToken)).catch(() => undefined);
  }

  public async close(): Promise<void> {
    await this.redis.quit();
  }
}
