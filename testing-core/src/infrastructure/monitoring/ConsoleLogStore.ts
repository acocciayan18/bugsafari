import type { ConsoleLogEntry } from '../../../../shared/types.js';

// Per-run buffer of every console line (all levels). Flushed to Mongo only
// on save. Upstream browserConsoleListener already dedups within a session.
export class ConsoleLogStore {
  private static entries: ConsoleLogEntry[] = [];
  private static readonly capacity = 1000;

  public static reset(): void {
    ConsoleLogStore.entries = [];
  }

  public static push(entry: ConsoleLogEntry): void {
    ConsoleLogStore.entries.push(entry);
    while (ConsoleLogStore.entries.length > ConsoleLogStore.capacity) {
      ConsoleLogStore.entries.shift();
    }
  }

  public static snapshot(): ConsoleLogEntry[] {
    return [...ConsoleLogStore.entries];
  }
}
