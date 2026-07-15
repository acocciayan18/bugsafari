// Tracks fire-and-forget async ops so Pause/Stop can await their settlement
// before the lifecycle transitions to PAUSED/IDLE (settlement barrier).
export class AsyncTaskTracker {
  private readonly pending = new Set<Promise<unknown>>();

  // Register a fire-and-forget promise; auto-evicts on settle. Swallows rejection
  // (the tracked op self-handles errors) so a reject can't strand as unhandled.
  public track<T>(task: Promise<T>): void {
    const wrapped = Promise.resolve(task)
      .catch(() => undefined)
      .finally(() => { this.pending.delete(wrapped); });
    this.pending.add(wrapped);
  }

  // Await every in-flight task; re-checks because a settling task may enqueue more.
  public async settle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  public get pendingCount(): number {
    return this.pending.size;
  }
}
