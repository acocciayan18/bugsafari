import { BUG_CATALOG } from '../../bugs/knowledgeBase/bugCatalog.js';

// A duplicate finding never re-registers; cap the ledger so a pathological run stays bounded.
const MAX_REPORTED = 100;

// What provoked the hang check: an errored request, a 5xx, or a request still pending past the watchdog.
export type HangTrigger = 'REQUEST_FAILED' | 'SERVER_ERROR' | 'PENDING_TIMEOUT';

// One DOM probe result for loading indicators, captured by StabilityMonitor.probeLoadingState.
export interface LoadingProbe {
  present: boolean;
  indicators: string[];
  inputsBlocked: boolean;
  signature: string;
}

// One correlated observation: a failed/hung request plus the before/after loading probes.
export interface HangObservation {
  method: string;
  url: string;
  trigger: HangTrigger;
  failureDetail: string;
  status?: number;
  pendingMs?: number;
  confirmGapMs: number;
  initial: LoadingProbe;
  confirm: LoadingProbe;
  scenarioActive: boolean;
  timestampMs: number;
}

// A confirmed API failure that left the UI stuck in a loading state with no recovery.
export interface ApiHangDefect {
  bugId: string;
  bugClass: 'INFINITE_LOADING';
  severity: 'HIGH';
  cwe: string;
  message: string;
  endpoint: string;
  method: string;
  trigger: HangTrigger;
  evidence: string[];
  advice: string;
  occurrence: number;
  corroborated: boolean;
}

// Pure, event-fed infinite-loading detector. Holds no Playwright references and never
// throws — StabilityMonitor injects the request facts + two DOM snapshots. Fires only
// when a loading indicator persists across both probes (recovered-gracefully gate),
// then collapses repeats of the same endpoint+trigger into one occurrence-counted finding.
export class ApiHangFinder {
  private readonly reported = new Map<string, number>();
  private observations = 0;

  // Evaluate one correlated hang observation. Returns null unless a loading indicator was
  // present in both probes with an overlapping signature. First confirmation → isNew:true;
  // further confirmations of the same endpoint+trigger → isNew:false with occurrence bumped.
  public evaluate(o: HangObservation): { defect: ApiHangDefect; isNew: boolean } | null {
    this.observations += 1;
    if (!this.isStuck(o.initial, o.confirm)) return null;

    const method = (o.method ?? '').toString().toUpperCase() || 'GET';
    const bugId = this.bugIdFor(method, o.url ?? '', o.trigger);
    const alreadyReported = this.reported.has(bugId);
    if (!alreadyReported && this.reported.size >= MAX_REPORTED) return null;

    const occurrence = (this.reported.get(bugId) ?? 0) + 1;
    this.reported.set(bugId, occurrence);
    const defect = this.build(bugId, method, o, occurrence);
    return { defect, isNew: !alreadyReported };
  }

  // Distinct infinite-loading defects seen this run.
  public totalFound(): number {
    return this.reported.size;
  }

  // Every observation fed this run (confirmed or not).
  public totalObservations(): number {
    return this.observations;
  }

  // Stuck = a loading indicator present in both probes with at least one shared indicator.
  private isStuck(initial: LoadingProbe, confirm: LoadingProbe): boolean {
    if (!initial?.present || !confirm?.present) return false;
    const before = new Set(initial.indicators ?? []);
    return (confirm.indicators ?? []).some((i) => before.has(i));
  }

  private bugIdFor(method: string, url: string, trigger: HangTrigger): string {
    return `api-hang-${this.hash(`${this.normalizeUrl(url)}::${trigger}`)}`;
  }

  // Strip the fragment and volatile noise (cache-buster query values, long digit runs) so a
  // timestamped endpoint still collapses to one finding across repeated hangs.
  private normalizeUrl(url: string): string {
    return (url || '')
      .split('#')[0]
      .replace(/([?&](?:_|t|ts|cb|rnd|rand|cache|cachebust)=)[^&]*/gi, '$1#')
      .replace(/\b\d{6,}\b/g, '#')
      .toLowerCase();
  }

  private build(bugId: string, method: string, o: HangObservation, occurrence: number): ApiHangDefect {
    const endpoint = o.url ?? '';
    const gapMs = Math.max(0, o.confirmGapMs || 0);
    const detail = this.triggerDetail(o);
    const indicators = o.confirm.indicators.join(', ');
    const evidence = [
      `Failed/hanging request: ${method} ${endpoint} — ${o.trigger}${detail}`,
      `UI still showing loading indicators after ${gapMs}ms: ${indicators || '(none named)'}`,
      'No error/timeout fallback rendered on failure',
    ];
    if (o.confirm.inputsBlocked) evidence.push('Inputs remained disabled/blocked while the request never resolved');
    if (o.scenarioActive) evidence.push('Corroborated by an active NetworkSaboteur/AsyncStateRacer stress probe');
    return {
      bugId,
      bugClass: 'INFINITE_LOADING',
      severity: 'HIGH',
      cwe: BUG_CATALOG.INFINITE_LOADING.cwe,
      message: `[API hang / infinite loading] ${method} ${endpoint} — ${o.trigger}, UI stuck loading`,
      endpoint,
      method,
      trigger: o.trigger,
      evidence,
      advice: this.buildAdvice(),
      occurrence,
      corroborated: o.scenarioActive,
    };
  }

  // Human-readable tail for the trigger line (status / pending duration when present).
  private triggerDetail(o: HangObservation): string {
    if (o.trigger === 'SERVER_ERROR' && typeof o.status === 'number') return `: HTTP ${o.status}`;
    if (o.trigger === 'PENDING_TIMEOUT' && typeof o.pendingMs === 'number') return `: pending ${o.pendingMs}ms`;
    return o.failureDetail ? `: ${o.failureDetail}` : '';
  }

  private buildAdvice(): string {
    return `The request failed or never resolved and the UI never left its loading state.\n${BUG_CATALOG.INFINITE_LOADING.remediation}`;
  }

  // djb2 — stable, cheap, no crypto dependency.
  private hash(input: string): string {
    let h = 5381;
    for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
}
