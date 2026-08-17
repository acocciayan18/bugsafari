// ═══════════════════════════════════════════════════════════════════════════════
// replayAdmission.ts - global cross-operator cap on concurrent regression replays
// ═══════════════════════════════════════════════════════════════════════════════
// Each "Verify Fix" replay launches its OWN headless Chromium (RegressionPlaybookVerifier),
// outside the live-run admission pool. The socket handler already serializes replays
// PER OPERATOR, but nothing bounded them ACROSS operators — N tenants verifying at
// once meant N browsers stacked on the host with no cap, risking OOM on a memory-
// limited container. This process-global semaphore bounds that: replays beyond the
// cap wait FIFO for a slot; beyond a bounded wait queue they are rejected as busy.

import { AsyncSemaphore, SemaphoreOverflowError } from '../../../infrastructure/concurrency/AsyncSemaphore.js';
import { createLogger } from '../../../infrastructure/observability/logger.js';

const obsLog = createLogger('[ReplayAdmission]');

// Max replay browsers running at once across ALL operators. Kept low by default —
// each is a full Chromium; the live-run engine pool competes for the same host RAM.
const DEFAULT_MAX_CONCURRENT_REPLAYS = 2;
// Max operators allowed to WAIT for a slot before new requests get a fast busy signal.
// The per-operator gate caps waiters at one-per-user, so this only trips under genuine
// multi-tenant load, never a single-client flood.
const DEFAULT_MAX_REPLAY_WAITERS = 32;

// Read a positive-integer env override, falling back (with a warning) on absent or
// malformed input so a fat-fingered value can never silently unbound the cap.
function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    obsLog.warn(`[ReplayAdmission] Ignoring invalid ${key}="${raw}" (expected a positive integer); using default ${fallback}.`);
    return fallback;
  }
  return n;
}

const MAX_CONCURRENT_REPLAYS = envInt('BUGSAFARI_MAX_CONCURRENT_REPLAYS', DEFAULT_MAX_CONCURRENT_REPLAYS);
const MAX_REPLAY_WAITERS = envInt('BUGSAFARI_MAX_REPLAY_WAITERS', DEFAULT_MAX_REPLAY_WAITERS);

const replaySemaphore = new AsyncSemaphore(MAX_CONCURRENT_REPLAYS, MAX_REPLAY_WAITERS);

/** True when the error is the semaphore's backpressure signal (wait queue full). */
export function isReplayBusyError(error: unknown): boolean {
  return error instanceof SemaphoreOverflowError;
}

/**
 * Run `work` while holding one global replay slot. Waits FIFO for a free slot; the
 * returned release is tied to `work` settling, so a slot is never freed while its
 * browser is still open. Rejects with SemaphoreOverflowError (see isReplayBusyError)
 * when the cap AND the wait queue are both full.
 */
export async function withReplaySlot<T>(work: () => Promise<T>): Promise<T> {
  const release = await replaySemaphore.acquire();
  try {
    return await work();
  } finally {
    release();
  }
}

/** Snapshot for observability/telemetry (capacity + live pressure). */
export function replayAdmissionStatus(): { capacity: number; available: number; waiting: number; maxWaiters: number } {
  return {
    capacity: MAX_CONCURRENT_REPLAYS,
    available: replaySemaphore.available,
    waiting: replaySemaphore.waiting,
    maxWaiters: MAX_REPLAY_WAITERS,
  };
}
