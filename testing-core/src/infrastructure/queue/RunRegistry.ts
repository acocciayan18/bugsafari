import { Redis } from 'ioredis';
import type { ActiveSessionSnapshot } from '../../../../shared/types.js';

import { createLogger } from '../observability/logger.js';

const obsLog = createLogger('[RunRegistry]');

// Registry entries outlive the job's removeOnComplete window (1h) with margin.
const ENTRY_TTL_SECONDS = 2 * 60 * 60;
// Snapshot is refreshed every ~2s by the worker; expiry means the worker died.
const SNAPSHOT_TTL_SECONDS = 60;
// Liveness key TTL. Deliberately NOT the snapshot's: the snapshot write is dirty-gated,
// so a healthy but momentarily quiet run lets that key lapse and would read as dead.
// The heartbeat is written unconditionally every tick, which is what makes its absence
// mean "the worker's event loop stopped turning" rather than "nothing changed".
const HEARTBEAT_TTL_SECONDS = 120;

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
  // ISO timestamp set the moment the operator asks to stop this run. A stop of an
  // active run is dispatched to the worker and returns before the run tears down, so
  // the job lingers in BullMQ's 'active'/'completed' set for a beat. Without this
  // flag a launch during that window matches the duplicate-submission guard and
  // RESUMES the run the operator just stopped instead of starting a fresh one.
  stopRequestedAt?: string;
  // Durable pause/resume intent. Stop has always had `stopRequestedAt` as its backstop,
  // but pause and resume rode Redis pub/sub alone — which has no persistence, so a
  // command published while the worker was mid-reconnect was simply lost and the
  // dashboard sat in PAUSING forever. The worker polls this on the same 3s tick it
  // already uses for the dropped-stop backstop; `seq` makes re-applying it idempotent.
  controlIntent?: RunControlIntent;
}

export interface RunControlIntent {
  command: 'pause' | 'resume';
  at: string;
  /** Monotonic per-run counter; the worker applies an intent only when it exceeds
   *  the last one it applied, so a repeat poll is a no-op and ordering is preserved. */
  seq: number;
}

/**
 * Should the worker act on this intent? Pure so the ordering rule is testable without
 * Redis. A missing or already-applied intent is a no-op; only a strictly newer `seq`
 * fires, which keeps a 3s poll idempotent while still honouring rapid pause→resume.
 */
export function shouldApplyControlIntent(intent: RunControlIntent | undefined, appliedSeq: number): boolean {
  if (!intent) return false;
  return Number.isFinite(intent.seq) && intent.seq > appliedSeq;
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
    // Prevent an unhandled ioredis 'error' event from crashing the process on a
    // transient Redis blip; the client auto-reconnects (maxRetriesPerRequest:null).
    this.redis.on('error', (err) => obsLog.error('[RunRegistry] redis connection error:', err instanceof Error ? err.message : err));
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

  private heartbeatKey(runToken: string): string {
    return `safari:run:hb:${runToken}`;
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

  /**
   * Flag a run as stop-requested so the duplicate-submission guard never resumes it.
   * Preserves the key's remaining TTL (KEEPTTL) and leaves the owner pointer + replay
   * snapshot intact, so a post-completion refresh still restores the stopped run — only
   * a NEW launch is prevented from adopting it. No-op if the entry already vanished.
   */
  public async markStopRequested(runToken: string): Promise<void> {
    const entry = await this.findByRunToken(runToken);
    if (!entry || entry.stopRequestedAt) return;
    entry.stopRequestedAt = new Date().toISOString();
    await this.redis.set(this.runKey(runToken), JSON.stringify(entry), 'KEEPTTL');
  }

  /**
   * Record a pause/resume the operator asked for, so the worker applies it even when the
   * bridged pub/sub message is dropped. Preserves the key's remaining TTL (KEEPTTL) and
   * bumps `seq` so the worker can tell a fresh intent from one it already applied.
   * No-op if the entry has already vanished.
   */
  public async markControlRequested(runToken: string, command: 'pause' | 'resume'): Promise<void> {
    const entry = await this.findByRunToken(runToken);
    if (!entry) return;
    entry.controlIntent = {
      command,
      at: new Date().toISOString(),
      seq: (entry.controlIntent?.seq ?? 0) + 1,
    };
    await this.redis.set(this.runKey(runToken), JSON.stringify(entry), 'KEEPTTL');
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

  /**
   * Extend a still-live run's entry back to the full TTL. The reconciler calls this on
   * every pass (every 5 min, far inside the 2h window), which is what makes a MISSING
   * entry a sound orphan signal: without it a legitimately long-waiting job outlived its
   * own index and the ghost sweep would mistake it for garbage.
   */
  public async touch(runToken: string, userId: string | null): Promise<void> {
    const multi = this.redis.multi();
    multi.expire(this.runKey(runToken), ENTRY_TTL_SECONDS);
    if (userId) multi.expire(this.ownerKey(userId), ENTRY_TTL_SECONDS);
    await multi.exec();
  }

  /** Drop every key for a finished/stale run (worker on completion, API on stale hit). */
  public async clear(runToken: string, userId: string | null): Promise<void> {
    const keys = [this.runKey(runToken), this.snapshotKey(runToken), this.heartbeatKey(runToken)];
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

  /**
   * Worker-side liveness stamp, written unconditionally on every tick. This is the only
   * signal that distinguishes a wedged worker from a quiet one: BullMQ's 'stalled' is
   * deliberately ignored (a blocked event loop is usually a false alarm), jobs are never
   * re-delivered, and the dirty-gated snapshot key cannot serve the purpose.
   */
  public async writeHeartbeat(runToken: string, at = Date.now()): Promise<void> {
    await this.redis.set(this.heartbeatKey(runToken), String(at), 'EX', HEARTBEAT_TTL_SECONDS);
  }

  /**
   * Milliseconds since the run's last heartbeat, or null when none is recorded — which
   * a caller must NOT read as "stalled": a run that just started has not stamped one yet,
   * and the key expires long before a legitimately long-lived entry does.
   */
  public async readHeartbeatAgeMs(runToken: string, now = Date.now()): Promise<number | null> {
    const raw = await this.redis.get(this.heartbeatKey(runToken)).catch(() => null);
    if (!raw) return null;
    const at = Number(raw);
    if (!Number.isFinite(at)) return null;
    return Math.max(0, now - at);
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
