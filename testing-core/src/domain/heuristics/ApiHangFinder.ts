import { BUG_CATALOG } from '../../bugs/knowledgeBase/bugCatalog.js';
import { STRONG_LOADING_SELECTORS } from '../../bugs/knowledgeBase/signalPatterns.js';
import type { FaultConfidence, VerificationStatus } from '../../../../shared/types/verification.js';

const STRONG_SET = new Set<string>(STRONG_LOADING_SELECTORS);

// A duplicate finding never re-registers; cap the ledger so a pathological run stays bounded.
const MAX_REPORTED = 100;

// Background telemetry / analytics / beacon endpoints. A hang or failure on one of these
// never blocks the user-facing UI — the app fired it fire-and-forget — so a PENDING_TIMEOUT
// (or failure) against one must NOT become an INFINITE_LOADING finding. Matched on host +
// path with word boundaries so "/analytics/event" hits but "/analytics-report" (a real page)
// does not, and "/login" is never mistaken for a "log" endpoint.
const BACKGROUND_TELEMETRY_RE =
  /(?:^|[/.])(?:telemetry|analytics|metrics|ping|beacon|bz|collect|track(?:ing)?|rum|sentry|datadog|segment|mixpanel|amplitude|hotjar|gtag|gtm|google-analytics|googletagmanager|doubleclick)(?:[/.?#]|$)/i;

/** True for a fire-and-forget telemetry/analytics/beacon URL whose timeout is not a UI bug. */
export function isBackgroundTelemetryUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return BACKGROUND_TELEMETRY_RE.test(`${u.hostname}${u.pathname}`);
  } catch {
    return BACKGROUND_TELEMETRY_RE.test(url);
  }
}

// Long-lived-by-design request classes. These stay pending for seconds or forever WITHOUT
// blocking the UI: Next.js RSC prefetch (?_rsc=, RSC:/Next-Router-Prefetch: headers), SSE
// (Accept: text/event-stream), websocket upgrades, and streaming/poll/subscribe endpoints.
// A pending timeout on one of these is never an INFINITE_LOADING bug — it must not be watchdogged.
const LONG_LIVED_URL_RE =
  /(?:[?&]_rsc=|\/(?:stream|streaming|events|subscribe|subscription|sse|poll|longpoll|long-poll|hub|socket|ws|watch)(?:[/.?#]|$))/i;

/** True for a request that is long-lived by design — a pending timeout on it is not a UI hang. */
export function isLongLivedRequestUrl(url?: string, headers?: Record<string, string>): boolean {
  if (headers) {
    const accept = headers['accept'] ?? headers['Accept'] ?? '';
    if (/text\/event-stream/i.test(accept)) return true;
    const upgrade = headers['upgrade'] ?? headers['Upgrade'] ?? '';
    if (/websocket/i.test(upgrade)) return true;
    if ('rsc' in headers || 'RSC' in headers || 'next-router-prefetch' in headers || 'Next-Router-Prefetch' in headers) return true;
  }
  if (!url) return false;
  return LONG_LIVED_URL_RE.test(url);
}

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
  // True when the triggering request was STILL pending at confirm time. Undefined for
  // failed/5xx triggers (the request has already settled). A PENDING_TIMEOUT whose request
  // settled mid-probe is not a hang — the persisting spinner is unrelated.
  stillPending?: boolean;
  timestampMs: number;
}

// A confirmed API failure that left the UI stuck in a loading state with no recovery.
export interface ApiHangDefect {
  bugId: string;
  bugClass: 'INFINITE_LOADING';
  severity: 'HIGH' | 'MEDIUM';
  confidence: FaultConfidence;
  verificationStatus: VerificationStatus;
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
    // A background telemetry/analytics/beacon timeout is never a user-facing hang — ignore
    // it regardless of any coincidental spinner elsewhere on the page (req: no false positives).
    if (isBackgroundTelemetryUrl(o.url)) return null;
    // An indicator must PERSIST across both probes (recovered-gracefully gate).
    const persistent = this.persistentIndicators(o.initial, o.confirm);
    if (persistent.length === 0) return null;
    // Decorative overlay/backdrop/skeleton/modal chrome persists on healthy pages, so it alone
    // never proves a hang — require a genuine loading indicator (spinner/progressbar/aria-busy).
    if (!persistent.some((i) => STRONG_SET.has(i))) return null;
    // PENDING_TIMEOUT is the weakest trigger (the request has not even failed): demand a SECOND
    // corroborating signal beyond the spinner — the request still hanging at confirm time, inputs
    // blocked, or an active stress probe. Failed/5xx triggers carry that second signal already.
    if (o.trigger === 'PENDING_TIMEOUT' && !(o.stillPending === true || o.confirm.inputsBlocked || o.scenarioActive)) {
      return null;
    }

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

  // Indicators present in BOTH probes — the ones that actually persisted, not transient loaders.
  private persistentIndicators(initial: LoadingProbe, confirm: LoadingProbe): string[] {
    if (!initial?.present || !confirm?.present) return [];
    const before = new Set(initial.indicators ?? []);
    return (confirm.indicators ?? []).filter((i) => before.has(i));
  }

  // Grade a confirmed hang. Failed/5xx are firm HIGH/SIGNAL; a PENDING_TIMEOUT is only HIGH when a
  // strong second signal (blocked inputs or stress probe) corroborates it, else MEDIUM/NEEDS_VERIFICATION.
  private grade(o: HangObservation, corroborated: boolean): Pick<ApiHangDefect, 'severity' | 'confidence' | 'verificationStatus'> {
    if (o.trigger === 'PENDING_TIMEOUT' && !corroborated) {
      return { severity: 'MEDIUM', confidence: 'INFERRED', verificationStatus: 'NEEDS_VERIFICATION' };
    }
    return { severity: 'HIGH', confidence: 'SIGNAL', verificationStatus: corroborated ? 'CONFIRMED' : 'NEEDS_VERIFICATION' };
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
      `Failed or hanging request: ${method} ${endpoint} (${o.trigger}${detail})`,
      `The screen still showed loading after ${gapMs}ms: ${indicators || '(none named)'}`,
      'No error or timeout screen appeared when it failed',
    ];
    if (o.confirm.inputsBlocked) evidence.push('Inputs stayed disabled while the request never finished');
    if (o.stillPending) evidence.push('The request was still pending when the screen was re-checked');
    if (o.scenarioActive) evidence.push('Corroborated by an active NetworkSaboteur/AsyncStateRacer stress probe');
    // Corroboration = a second INDEPENDENT signal beyond the persistent spinner: blocked inputs or a stress probe.
    const corroborated = o.scenarioActive || o.confirm.inputsBlocked;
    const grade = this.grade(o, corroborated);
    return {
      bugId,
      bugClass: 'INFINITE_LOADING',
      severity: grade.severity,
      confidence: grade.confidence,
      verificationStatus: grade.verificationStatus,
      cwe: BUG_CATALOG.INFINITE_LOADING.cwe,
      message: `[Stuck loading] ${method} ${endpoint} (${o.trigger}) never finished, so the screen stayed stuck loading.`,
      endpoint,
      method,
      trigger: o.trigger,
      evidence,
      advice: this.buildAdvice(),
      occurrence,
      corroborated,
    };
  }

  // Human-readable tail for the trigger line (status / pending duration when present).
  private triggerDetail(o: HangObservation): string {
    if (o.trigger === 'SERVER_ERROR' && typeof o.status === 'number') return `: HTTP ${o.status}`;
    if (o.trigger === 'PENDING_TIMEOUT' && typeof o.pendingMs === 'number') return `: pending ${o.pendingMs}ms`;
    return o.failureDetail ? `: ${o.failureDetail}` : '';
  }

  private buildAdvice(): string {
    return `The request failed or never came back, and the screen never left its loading state.\n${BUG_CATALOG.INFINITE_LOADING.remediation}`;
  }

  // djb2 — stable, cheap, no crypto dependency.
  private hash(input: string): string {
    let h = 5381;
    for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
}
