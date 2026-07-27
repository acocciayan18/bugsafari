// Pure rule for the retention sweep, split out so it is testable without a
// database. A child document is orphaned exactly when its parent session id is
// absent from `sessions` — the session row is always written before any child,
// so absence is unambiguous rather than a write-ordering race.

/** Ids in `batch` with no surviving session. Order-preserving. */
export function selectOrphans<T extends { toString(): string }>(
  batch: readonly T[],
  survivingIds: readonly string[],
): T[] {
  const alive = new Set(survivingIds);
  return batch.filter((id) => !alive.has(id.toString()));
}
