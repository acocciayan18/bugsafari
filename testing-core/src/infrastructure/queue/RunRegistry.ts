import { Redis } from 'ioredis';
import type { ActiveSessionSnapshot } from '../../../../shared/types.js';

// Registry entries outlive the job's removeOnComplete window (1h) with margin.
const ENTRY_TTL_SECONDS = 2 * 60 * 60;
// Snapshot is refreshed every ~2s by the worker; expiry means the worker died.
const SNAPSHOT_TTL_SECONDS = 60;

/** Cross-process record of one enqueued/active run, keyed in Redis. */
export interface RunRegistryEntry {
  // Opaque bearer token: the Redis index key + run-room key (run:${runToken}).
  runToken: string;
  // Public RUN- code surfaced to the operator (display/id parity).
  runCode: string;
  jobId: string;
  userId: string | null;
  targetUrl: string;
  timeboxMs: number;
  createdAt: string;
}

/**
 * Redis-backed single source of truth for distributed-run recovery: maps a
 * runToken (and, for authenticated operators, a userId) to its BullMQ job, and
 * holds the worker's throttled live snapshot so the API process can rebuild a
 * refreshed client's dashboard for a run executing in another process.
 */
export class RunRegistry {
  private readonly redis: Redis;

  constructor(redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379') {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  }

  private runKey(runToken: string): string {
    return `safari:run:index:${runToken}`;
  }

  private ownerKey(userId: string): string {
    return `safari:run:owner:${userId}`;
  }

  private snapshotKey(runToken: string): string {
    return `safari:run:snapshot:${runToken}`;
  }

  /** Record a freshly-enqueued run (API side, at enqueue time). */
  public async register(entry: RunRegistryEntry): Promise<void> {
    const multi = this.redis.multi();
    multi.set(this.runKey(entry.runToken), JSON.stringify(entry), 'EX', ENTRY_TTL_SECONDS);
    if (entry.userId) {
      multi.set(this.ownerKey(entry.userId), entry.runToken, 'EX', ENTRY_TTL_SECONDS);
    }
    await multi.exec();
  }

  public async findByRunToken(runToken: string): Promise<RunRegistryEntry | null> {
    const raw = await this.redis.get(this.runKey(runToken));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RunRegistryEntry;
    } catch {
      return null;
    }
  }

  /** Resolve an authenticated operator's live run, if any. */
  public async findByOwner(userId: string): Promise<RunRegistryEntry | null> {
    const runToken = await this.redis.get(this.ownerKey(userId));
    return runToken ? this.findByRunToken(runToken) : null;
  }

  /** Drop every key for a finished/stale run (worker on completion, API on stale hit). */
  public async clear(runToken: string, userId: string | null): Promise<void> {
    const keys = [this.runKey(runToken), this.snapshotKey(runToken)];
    // Only clear the owner pointer if it still points at THIS run — a newer run
    // by the same user must not lose its index to a late-finishing old job.
    if (userId) {
      const current = await this.redis.get(this.ownerKey(userId));
      if (current === runToken) keys.push(this.ownerKey(userId));
    }
    await this.redis.del(...keys);
  }

  /**
   * Every live index entry. SCAN (not KEYS) so a large keyspace is walked in
   * bounded chunks instead of blocking Redis.
   */
  public async listEntries(): Promise<RunRegistryEntry[]> {
    const entries: RunRegistryEntry[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', this.runKey('*'), 'COUNT', 100);
      cursor = next;
      if (keys.length === 0) continue;
      const values = await this.redis.mget(...keys);
      for (const raw of values) {
        if (!raw) continue;
        try {
          entries.push(JSON.parse(raw) as RunRegistryEntry);
        } catch {
          // Unparseable entry — the sweep's caller drops it via clear().
        }
      }
    } while (cursor !== '0');
    return entries;
  }

  /** Worker-side write of the replay snapshot (throttled live, or final-state with a longer TTL). */
  public async writeSnapshot(runToken: string, snapshot: ActiveSessionSnapshot, ttlSeconds = SNAPSHOT_TTL_SECONDS): Promise<void> {
    await this.redis.set(this.snapshotKey(runToken), JSON.stringify(snapshot), 'EX', ttlSeconds);
  }

  public async readSnapshot(runToken: string): Promise<ActiveSessionSnapshot | null> {
    const raw = await this.redis.get(this.snapshotKey(runToken));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ActiveSessionSnapshot;
    } catch {
      return null;
    }
  }

  public async close(): Promise<void> {
    await this.redis.quit();
  }
}
