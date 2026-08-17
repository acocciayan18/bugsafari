// ═══════════════════════════════════════════════════════════════
// telemetry/contractCorrelation.ts — JSON.parse fault → offending endpoint (pure state)
// ═══════════════════════════════════════════════════════════════
// A client fetch().json() that throws "Unexpected token '<', \"<!DOCTYPE\"..." parsed a
// non-JSON body. The response that carried that body settled just before the parse, so
// non-JSON 2xx API responses are parked here and the newest one inside the window is handed
// back as the fault's true route — naming the endpoint, not the page the parse threw on.
//
// No timers, no Playwright/telemetry knowledge: a run that never parses non-JSON parks
// nothing and costs nothing. Bounded so a response storm cannot grow memory.

const CONTRACT_CORRELATION_WINDOW_MS = 5000;
const MAX_CANDIDATES = 20;

// True when an API body is HTML/markup (not JSON) — the shape a fetch().json() throws on.
// JSON payloads open with `{`/`[`, so a leading `<` is decisive non-JSON markup.
export function looksNonJsonBody(body: string): boolean {
  return body.trimStart().slice(0, 1) === '<';
}

interface ContractCandidate {
  url: string;
  method: string;
  atMs: number;
}

// Parks non-JSON 2xx API responses and returns the one a later client JSON.parse fault
// most likely tried to parse. Newest-wins inside the window; older entries are ignored.
export class ContractResponseCorrelator {
  private readonly candidates: ContractCandidate[] = [];

  constructor(
    private readonly windowMs: number = CONTRACT_CORRELATION_WINDOW_MS,
    private readonly maxCandidates: number = MAX_CANDIDATES,
  ) {}

  // Park a non-JSON 2xx API response, newest last, bounded.
  public record(url: string, method: string, atMs: number): void {
    this.candidates.push({ url, method, atMs });
    if (this.candidates.length > this.maxCandidates) this.candidates.shift();
  }

  // Newest non-JSON response that settled within the window before the fault, else undefined.
  public correlate(faultAtMs: number): { url: string; method: string } | undefined {
    for (let i = this.candidates.length - 1; i >= 0; i -= 1) {
      const c = this.candidates[i];
      if (c.atMs <= faultAtMs && faultAtMs - c.atMs <= this.windowMs) return { url: c.url, method: c.method };
    }
    return undefined;
  }

  public get size(): number {
    return this.candidates.length;
  }

  public reset(): void {
    this.candidates.length = 0;
  }
}
