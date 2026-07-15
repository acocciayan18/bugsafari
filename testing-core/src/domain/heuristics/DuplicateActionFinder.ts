import { BUG_CATALOG } from '../../bugs/knowledgeBase/bugCatalog.js';

// State-changing verbs only; reads (GET/HEAD/OPTIONS) can repeat safely and are ignored.
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// A duplicate is two identical requests inside this burst window; wider gaps are intentional re-submits.
const WINDOW_MS = 1200;
const MAX_SIGNATURES = 500;
const MAX_REPORTED = 100;

// One observed outbound request, fed by StabilityMonitor's request listener.
export interface RequestObservation {
  method: string;
  url: string;
  body?: string;
  raceScenarioActive: boolean;
  timestampMs: number;
}

// A confirmed duplicate state-changing request (missing debounce / disable-on-submit guard).
export interface DuplicateActionDefect {
  bugId: string;
  bugClass: 'SPA_STATE_RACE_CONDITION';
  severity: 'HIGH';
  cwe: string;
  message: string;
  endpoint: string;
  method: string;
  evidence: string[];
  advice: string;
  occurrence: number;
  corroborated: boolean;
  withinMs: number;
}

// Passive double-submit detector. Pure and event-fed: holds no Playwright references,
// never throws, timestamps + scenario flag injected by the caller. Collapses an identical
// method+endpoint+payload burst into one finding with an occurrence count so a repeat
// storm never floods the ledger.
export class DuplicateActionFinder {
  private readonly windows = new Map<string, number[]>();
  private readonly reported = new Map<string, number>();
  private observations = 0;

  // Observe one request. Returns null for non-state-changing methods or when no burst
  // (2+ identical within the window) has formed. First burst crossing → isNew:true;
  // further identical hits in-window → isNew:false with occurrence incremented.
  public observeRequest(o: RequestObservation): { defect: DuplicateActionDefect; isNew: boolean } | null {
    const method = (o.method ?? '').toString().toUpperCase();
    if (!STATE_CHANGING.has(method)) return null;
    this.observations += 1;

    const signature = this.signatureFor(method, o.url ?? '', o.body);
    const stamps = this.recordStamp(signature, o.timestampMs);
    if (stamps.length < 2) return null;

    const bugId = this.bugIdFor(method, signature);
    const alreadyReported = this.reported.has(bugId);
    if (!alreadyReported && this.reported.size >= MAX_REPORTED) return null;

    const occurrence = stamps.length;
    this.reported.set(bugId, occurrence);
    const withinMs = stamps[stamps.length - 1] - stamps[0];
    const defect = this.build(bugId, method, o, signature, occurrence, withinMs);
    return { defect, isNew: !alreadyReported };
  }

  // Distinct duplicate-action defects seen this run.
  public totalFound(): number {
    return this.reported.size;
  }

  // Every state-changing request observed this run.
  public totalObservations(): number {
    return this.observations;
  }

  // Append a timestamp to the signature's window, dropping entries older than WINDOW_MS.
  private recordStamp(signature: string, timestampMs: number): number[] {
    const isNewKey = !this.windows.has(signature);
    if (isNewKey && this.windows.size >= MAX_SIGNATURES) {
      const oldest = this.windows.keys().next().value as string | undefined;
      if (oldest) this.windows.delete(oldest);
    }
    const cutoff = timestampMs - WINDOW_MS;
    const stamps = (this.windows.get(signature) ?? []).filter((t) => t >= cutoff);
    stamps.push(timestampMs);
    this.windows.set(signature, stamps);
    return stamps;
  }

  private signatureFor(method: string, url: string, body?: string): string {
    return `${method} ${this.normalizeUrl(url)}::${this.hash(body ?? '')}`;
  }

  // Strip the fragment and volatile noise (cache-buster query values, long digit runs)
  // so a timestamped duplicate still collapses, while keeping the path + meaningful query.
  private normalizeUrl(url: string): string {
    return (url || '')
      .split('#')[0]
      .replace(/([?&](?:_|t|ts|cb|rnd|rand|cache|cachebust)=)[^&]*/gi, '$1#')
      .replace(/\b\d{6,}\b/g, '#')
      .toLowerCase();
  }

  private bugIdFor(method: string, signature: string): string {
    return `dup-action-${method.toLowerCase()}-${this.hash(signature)}`;
  }

  private build(
    bugId: string,
    method: string,
    o: RequestObservation,
    signature: string,
    occurrence: number,
    withinMs: number,
  ): DuplicateActionDefect {
    const endpoint = o.url ?? '';
    const evidence = [
      `Duplicate ${method} ${endpoint}`,
      `${occurrence} identical requests within ${withinMs}ms`,
      `Payload signature: ${signature.split('::')[1] ?? '(none)'}`,
      'No client-side debounce/disable-on-submit guard fired before the repeat request',
    ];
    if (o.raceScenarioActive) evidence.push('Corroborated by an active concurrency/rapid-click stress probe');
    const def = BUG_CATALOG.SPA_STATE_RACE_CONDITION;
    return {
      bugId,
      bugClass: 'SPA_STATE_RACE_CONDITION',
      severity: 'HIGH',
      cwe: def.cwe,
      message: `[Duplicate action / double-submit] ${method} ${endpoint} — ${occurrence} identical requests within ${withinMs}ms`,
      endpoint,
      method,
      evidence,
      advice: this.buildAdvice(),
      occurrence,
      corroborated: o.raceScenarioActive,
      withinMs,
    };
  }

  private buildAdvice(): string {
    return `The control fired the same state-changing request twice with no debounce or disable-on-submit guard.\n${BUG_CATALOG.SPA_STATE_RACE_CONDITION.remediation}`;
  }

  // djb2 — stable, cheap, no crypto dependency.
  private hash(input: string): string {
    let h = 5381;
    for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
}
