// The BullMQ concurrency-1 slot is the processor function itself: it frees only
// when execute() resolves. A wedged Playwright teardown never resolves it, so the
// slot pins and the next run sits in a false queue. Race execute() against the
// force-release signal (fired by SessionManager's stop-watchdog) so the processor
// returns — freeing the slot — while residual browser teardown detaches.

export type SlotOutcome = 'completed' | 'released';

// `execute` settling (fulfilled OR rejected) is terminal — the run is over either
// way. `released` wins only when execute() is wedged. The detached .catch keeps a
// late rejection on the losing branch from surfacing as an unhandled rejection.
export function raceSlotRelease(execute: Promise<void>, released: Promise<'released'>): Promise<SlotOutcome> {
  execute.catch(() => undefined);
  return Promise.race([execute.then<SlotOutcome, SlotOutcome>(() => 'completed', () => 'completed'), released]);
}
