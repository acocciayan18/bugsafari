import type { NetworkLogEntry } from '../../../../shared/types.js';

// Per-run buffer of every observed network request (incl. successful).
// Flushed to Mongo only when the operator saves the run — mirrors the
// errors-only-persists philosophy of forensic_errors.
export class NetworkLogStore {
  // First-seen order preserved; keyed by method+url+status so a request polled amid
  // other traffic collapses to one row — the SAME global dedup the live Network tab
  // and buildSavedNetworkRows apply, so store, stream, and saved report never diverge.
  private static entries = new Map<string, NetworkLogEntry>();
  private static readonly capacity = 2000;

  public static reset(): void {
    NetworkLogStore.entries = new Map();
  }

  public static push(entry: NetworkLogEntry): void {
    const key = `${entry.method}|${entry.url}|${entry.statusCode ?? ''}`;
    const existing = NetworkLogStore.entries.get(key);
    if (existing) {
      existing.repeatCount = (existing.repeatCount ?? 1) + 1;
      if (typeof entry.durationMs === 'number') existing.durationMs = entry.durationMs;
      return;
    }
    NetworkLogStore.entries.set(key, entry);
    while (NetworkLogStore.entries.size > NetworkLogStore.capacity) {
      const oldest = NetworkLogStore.entries.keys().next().value;
      if (oldest === undefined) break;
      NetworkLogStore.entries.delete(oldest);
    }
  }

  public static snapshot(): NetworkLogEntry[] {
    return [...NetworkLogStore.entries.values()];
  }
}
