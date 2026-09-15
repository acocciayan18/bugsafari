// volatilityModel — learns which observation fields churn WITHOUT any causing action, so
// diff-based oracles can compare modulo dynamic content. Run-scoped singleton (reset per
// run alongside the other forensic stores), worker-local; no cross-process persistence.
// A field is volatile if it differed across two action-free samples, or matches a seeded
// dynamic format. Everything else is stable and diff-significant.

import { changedPaths } from './jsonPaths.js';
import { isSeededVolatile } from './volatilitySeeds.js';

const MAX_KEYS = 512;
const MAX_PATHS_PER_KEY = 512;

export class VolatilityModel {
  private static learned = new Map<string, Set<string>>();

  public static reset(): void {
    VolatilityModel.learned = new Map();
  }

  // Record an ACTION-FREE pair: any path that differs is dynamic and marked volatile for
  // this key. Never call with a pair that had an action between the two observations.
  public static record(key: string, a: Map<string, string>, b: Map<string, string>): void {
    let set = VolatilityModel.learned.get(key);
    if (!set) {
      set = new Set<string>();
      VolatilityModel.learned.set(key, set);
      VolatilityModel.evictKeys();
    } else {
      // Refresh recency on re-observation.
      VolatilityModel.learned.delete(key);
      VolatilityModel.learned.set(key, set);
    }
    for (const path of changedPaths(a, b)) {
      set.delete(path);
      set.add(path);
    }
    while (set.size > MAX_PATHS_PER_KEY) {
      const oldest = set.values().next().value;
      if (oldest === undefined) break;
      set.delete(oldest);
    }
  }

  // A path is volatile if learned dynamic for this key, or either sampled value matches a
  // seeded dynamic format.
  public static isVolatile(key: string, path: string, a?: string, b?: string): boolean {
    if (VolatilityModel.learned.get(key)?.has(path)) return true;
    if (a !== undefined && isSeededVolatile(a)) return true;
    if (b !== undefined && isSeededVolatile(b)) return true;
    return false;
  }

  // Changed paths between two observations, minus every volatile one — the real signal.
  public static stableDiff(key: string, a: Map<string, string>, b: Map<string, string>): Set<string> {
    const stable = new Set<string>();
    for (const path of changedPaths(a, b)) {
      if (!VolatilityModel.isVolatile(key, path, a.get(path), b.get(path))) stable.add(path);
    }
    return stable;
  }

  private static evictKeys(): void {
    while (VolatilityModel.learned.size > MAX_KEYS) {
      const oldest = VolatilityModel.learned.keys().next().value;
      if (oldest === undefined) break;
      VolatilityModel.learned.delete(oldest);
    }
  }
}
