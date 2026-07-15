import type { NetworkLogEntry } from '../../../../shared/types.js';

// Per-run buffer of every observed network request (incl. successful).
// Flushed to Mongo only when the operator saves the run — mirrors the
// errors-only-persists philosophy of forensic_errors.
export class NetworkLogStore {
  private static entries: NetworkLogEntry[] = [];
  private static readonly capacity = 2000;

  public static reset(): void {
    NetworkLogStore.entries = [];
  }

  // Collapse identical consecutive rows (polling loops) into a repeatCount.
  public static push(entry: NetworkLogEntry): void {
    const last = NetworkLogStore.entries[NetworkLogStore.entries.length - 1];
    if (last && last.method === entry.method && last.url === entry.url && last.statusCode === entry.statusCode) {
      last.repeatCount = (last.repeatCount ?? 1) + 1;
      return;
    }
    NetworkLogStore.entries.push(entry);
    while (NetworkLogStore.entries.length > NetworkLogStore.capacity) {
      NetworkLogStore.entries.shift();
    }
  }

  public static snapshot(): NetworkLogEntry[] {
    return [...NetworkLogStore.entries];
  }
}
