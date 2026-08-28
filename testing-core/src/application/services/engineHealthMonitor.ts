import type { Server } from 'socket.io';
import { RUN_HEALTH_EVENT, type EngineHealthPhase } from '../../../../shared/types.js';
import type { RunRegistry } from '../../infrastructure/queue/RunRegistry.js';
import type { TaskQueue } from '../../infrastructure/queue/TaskQueue.js';
import { engineHealthPhase, shouldAnnounceHealth } from './runHealth.js';
import { sessionManager } from './SessionManager.js';
import { createLogger } from '../../infrastructure/observability/logger.js';

const obsLog = createLogger('[EngineHealthMonitor]');

// Sweep cadence. Well under ENGINE_STALE_MS so a stall is surfaced within a tick or two
// of crossing the threshold, and cheap: one Redis GET per active run.
const SWEEP_INTERVAL_MS = readPositiveInt(process.env.BUGSAFARI_ENGINE_HEALTH_SWEEP_MS, 15_000);

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Watches whether the engine behind each live run is still turning, and tells the run's
 * room when that changes.
 *
 * This closes the one gap that let a wedged worker read as RUNNING for its entire
 * timebox: BullMQ's 'stalled' is deliberately ignored (a briefly-blocked event loop is
 * usually a false alarm and tearing down a live run on it destroyed real state), jobs are
 * never re-delivered, and the run-snapshot key is dirty-gated so its expiry cannot be
 * read as death. The worker's unconditional heartbeat is the signal; this is its watcher.
 *
 * It never terminates anything. From out here a legitimately slow step is
 * indistinguishable from a hang, so the operator is informed and the timebox stays the
 * only automatic terminator.
 */
export class EngineHealthMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  // runToken -> last phase announced, so only transitions reach the wire.
  private readonly announced = new Map<string, EngineHealthPhase>();

  constructor(
    private readonly io: Server,
    private readonly registry?: RunRegistry,
    private readonly queue?: TaskQueue,
  ) {}

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  public stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  public async sweep(): Promise<void> {
    // In-process runs are watched by the manager itself, which owns their emit clock.
    sessionManager.sweepEngineHealth();
    if (!this.registry || !this.queue) return;

    let entries;
    try {
      entries = await this.registry.listEntries();
    } catch (error) {
      obsLog.error('[EngineHealthMonitor] registry scan failed:', error instanceof Error ? error.message : error);
      return;
    }

    for (const entry of entries) {
      // 'pending' is an enqueue still mid-flight in this process; a queued job has no
      // engine yet. Neither can be stalled.
      if (entry.jobId === 'pending') continue;
      const state = await this.queue.getJobState(entry.jobId).catch(() => 'unknown');
      if (state !== 'active') {
        this.announced.delete(entry.runToken);
        continue;
      }
      const ageMs = await this.registry.readHeartbeatAgeMs(entry.runToken).catch(() => null);
      const phase = engineHealthPhase(ageMs);
      // A run first seen healthy is the normal case and announces nothing; one first
      // seen stalled (this api process restarted while it was wedged) still does.
      const previous = this.announced.get(entry.runToken) ?? 'live';
      if (!shouldAnnounceHealth(previous, phase)) continue;
      this.announced.set(entry.runToken, phase);
      if (phase === 'stalled') {
        obsLog.warn(`[EngineHealthMonitor] Run ${entry.runCode} has not stamped a heartbeat for ${ageMs}ms — reporting STALLED.`);
      } else {
        obsLog.info(`[EngineHealthMonitor] Run ${entry.runCode} is stamping heartbeats again — clearing STALLED.`);
      }
      this.io.to(`run:${entry.runToken}`).emit(RUN_HEALTH_EVENT, {
        runToken: entry.runToken,
        phase,
        lastHeartbeatAgeMs: ageMs,
      });
    }
  }
}
