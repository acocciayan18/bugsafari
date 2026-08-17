// ═══════════════════════════════════════════════════════════════════════════════
// AsyncSemaphore - minimal in-process FIFO counting semaphore (zero-dependency)
// ═══════════════════════════════════════════════════════════════════════════════
// Bounds how many holders may run a section concurrently. acquire() resolves once a
// permit is free (immediately, or FIFO once one is released), returning a single-use
// release fn. A permit is handed DIRECTLY to the next waiter on release, so the count
// invariant (never more than `capacity` holders) holds without a race window.
// maxWaiters caps the wait queue so a flood cannot grow it without bound; acquire()
// rejects once the queue is full rather than queuing unboundedly.

export class SemaphoreOverflowError extends Error {
  constructor(capacity: number, maxWaiters: number) {
    super(`Semaphore at capacity (${capacity}) with its wait queue full (${maxWaiters}).`);
    this.name = 'SemaphoreOverflowError';
  }
}

export class AsyncSemaphore {
  private permits: number;
  private readonly waiters: Array<() => void> = [];
  private readonly maxWaiters: number;

  constructor(capacity: number, maxWaiters = Number.POSITIVE_INFINITY) {
    // A non-positive/NaN capacity would deadlock every acquire; clamp to at least 1.
    this.permits = Number.isFinite(capacity) && capacity >= 1 ? Math.floor(capacity) : 1;
    this.maxWaiters = maxWaiters >= 0 ? maxWaiters : Number.POSITIVE_INFINITY;
  }

  /** Free permits available right now (0 while fully subscribed). */
  get available(): number {
    return this.permits;
  }

  /** Callers currently blocked waiting for a permit. */
  get waiting(): number {
    return this.waiters.length;
  }

  /**
   * Acquire a permit. Resolves with a release fn to call (exactly once) when done.
   * Rejects with SemaphoreOverflowError when no permit is free and the wait queue is
   * already at maxWaiters — the backpressure signal callers surface as "server busy".
   */
  acquire(): Promise<() => void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return Promise.resolve(this.makeRelease());
    }
    if (this.waiters.length >= this.maxWaiters) {
      return Promise.reject(new SemaphoreOverflowError(this.permits + this.waiters.length, this.maxWaiters));
    }
    return new Promise<() => void>((resolve) => {
      // The permit is transferred to this waiter at release time (no decrement here).
      this.waiters.push(() => resolve(this.makeRelease()));
    });
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return; // idempotent — a double release must not over-credit permits
      released = true;
      const next = this.waiters.shift();
      // Hand the just-freed permit straight to the next waiter; only bump the count
      // back up when nobody is waiting for it.
      if (next) next();
      else this.permits += 1;
    };
  }
}
