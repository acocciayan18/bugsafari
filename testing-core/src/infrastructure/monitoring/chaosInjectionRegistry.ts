// Registry of deliberately-sabotaged requests (NetworkSaboteur and any future
// chaos scenario). A failure the harness INJECTED is not environment noise: the
// application was required to handle it, so the routing tree promotes it to a
// finding. Keyed by origin+path within a bounded window so a later, unrelated
// failure on the same endpoint is not misattributed to the injection.

const INJECTION_WINDOW_MS = 30_000;
const MAX_TRACKED = 32;

interface Injection {
  mode: string;
  atMs: number;
}

// origin+path — query strings vary per call and would defeat the lookup.
function endpointKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.toLowerCase();
  } catch {
    return (url.split('?')[0] ?? url).toLowerCase();
  }
}

export class ChaosInjectionRegistry {
  private static readonly injected = new Map<string, Injection>();

  /** Record that `url` was sabotaged in `mode` (delayed / aborted / mutated). */
  public static mark(url: string, mode: string, atMs: number = Date.now()): void {
    if (!url) return;
    if (ChaosInjectionRegistry.injected.size >= MAX_TRACKED) {
      const oldest = ChaosInjectionRegistry.injected.keys().next().value;
      if (oldest !== undefined) ChaosInjectionRegistry.injected.delete(oldest);
    }
    ChaosInjectionRegistry.injected.set(endpointKey(url), { mode, atMs });
  }

  /** True when `url` was sabotaged recently enough for this failure to be the injection's. */
  public static isInjected(url: string | undefined, atMs: number = Date.now()): boolean {
    return ChaosInjectionRegistry.lookup(url, atMs) !== undefined;
  }

  /** The injection mode behind a failure, for the finding's evidence line. */
  public static modeFor(url: string | undefined, atMs: number = Date.now()): string | undefined {
    return ChaosInjectionRegistry.lookup(url, atMs)?.mode;
  }

  /** True when ANY endpoint is inside its injection window at `atMs`. An app fetch-rejection
   *  log rarely names the sabotaged URL, so a downstream fault is correlated by time alone. */
  public static hasActiveInjection(atMs: number = Date.now()): boolean {
    for (const [key, entry] of ChaosInjectionRegistry.injected) {
      if (atMs - entry.atMs > INJECTION_WINDOW_MS) {
        ChaosInjectionRegistry.injected.delete(key);
        continue;
      }
      return true;
    }
    return false;
  }

  public static reset(): void {
    ChaosInjectionRegistry.injected.clear();
  }

  private static lookup(url: string | undefined, atMs: number): Injection | undefined {
    if (!url) return undefined;
    const entry = ChaosInjectionRegistry.injected.get(endpointKey(url));
    if (!entry) return undefined;
    if (atMs - entry.atMs > INJECTION_WINDOW_MS) {
      ChaosInjectionRegistry.injected.delete(endpointKey(url));
      return undefined;
    }
    return entry;
  }
}
