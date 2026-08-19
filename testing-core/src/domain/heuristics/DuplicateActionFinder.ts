import { BUG_CATALOG } from '../../bugs/knowledgeBase/bugCatalog.js';
import { resolveControlName, describeRouteStep } from '../../../../shared/reproduction.js';
import type { ActionRecord } from '../../../../shared/types.js';

// State-changing verbs only; reads (GET/HEAD/OPTIONS) can repeat safely and are ignored.
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Primary oracle is in-flight overlap. A repeat issued AFTER the first settled is only a
// candidate inside this grace window; beyond it the operator intent is a fresh submission.
const SETTLED_GRACE_MS = 1500;

// A first request still pending past the hang threshold (StabilityMonitor's HANG_THRESHOLD_MS,
// 8s) is a HANG, not a live peer — its own INFINITE_LOADING finding covers it. A later identical
// request is then a fresh submission, not an unguarded double-submit, so the overlap oracle must
// stop treating the stale in-flight request as an overlap beyond this window.
const OVERLAP_WINDOW_MS = 8000;

// Statuses proving the backend rejected the repeat — the client guard is still missing,
// but no duplicate record was committed, so the finding is informational.
const GUARD_STATUSES = new Set([409, 425, 429]);

// Headers a well-behaved client sends to make a retry safe; a differing value means
// two genuinely distinct operations, an identical value means the server can dedupe.
const IDEMPOTENCY_HEADERS = ['idempotency-key', 'x-idempotency-key', 'x-request-id', 'x-correlation-id'];

const MAX_TRACKED = 400;
const MAX_REPORTED = 100;

// The interaction the correlator attributed this request to, if any.
export interface InteractionContext {
  selector: string;
  label: string;
  actedAtMs: number;
}

// One observed outbound request, fed by StabilityMonitor's request listener.
export interface RequestObservation {
  requestId: string;
  method: string;
  url: string;
  body?: string;
  headers?: Record<string, string>;
  raceScenarioActive: boolean;
  timestampMs: number;
  interaction?: InteractionContext;
  /** Document URL the control fired from — the page a developer opens, never url (an API endpoint). */
  pageUrl?: string;
}

// One settled request — status absent means a transport failure or abort.
export interface RequestSettlement {
  requestId: string;
  status?: number;
  failed?: boolean;
  timestampMs: number;
}

// How strongly the pair was judged to be an unguarded double-submit.
export type DuplicateVerdict = 'CONFIRMED_DUPLICATE' | 'SUSPECTED' | 'GUARDED';

// A duplicate state-changing request that survived retry/idempotency/rejection filtering.
export interface DuplicateActionDefect {
  bugId: string;
  bugClass: 'SPA_STATE_RACE_CONDITION';
  verdict: DuplicateVerdict;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  faultConfidence: 'CONFIRMED' | 'SIGNAL' | 'INFERRED';
  confidenceScore: number;
  cwe: string;
  message: string;
  endpoint: string;
  method: string;
  selector: string;
  elementLabel: string;
  /** Document URL the control fired from (never the API endpoint) — for the reproduction trace. */
  pageUrl?: string;
  evidence: string[];
  reproductionHint: string[];
  advice: string;
  occurrence: number;
  corroborated: boolean;
  overlapped: boolean;
  intervalMs: number;
  firstStatus?: number;
  secondStatus?: number;
  idempotencyKey?: string;
  // Backend correctly handled the duplicate (rejected 409/425/429, or deduped a shared
  // idempotency key) — real telemetry, but never promoted to a finding.
  protected: boolean;
}

interface TrackedRequest {
  id: string;
  signature: string;
  method: string;
  url: string;
  startedAtMs: number;
  settledAtMs?: number;
  status?: number;
  failed?: boolean;
  idempotencyKey?: string;
  interaction?: InteractionContext;
  raceScenarioActive: boolean;
  pageUrl?: string;
}

// Ranks a verdict so a later settlement can upgrade a pair but never downgrade it.
const VERDICT_RANK: Record<DuplicateVerdict, number> = { GUARDED: 1, SUSPECTED: 2, CONFIRMED_DUPLICATE: 3 };

/**
 * Two-phase double-submit detector. Pure and event-fed: holds no Playwright references,
 * never throws, all timestamps and correlation injected by the caller.
 *
 * Phase 1 (observeRequest) opens a candidate when an identical state-changing request
 * is issued while the first is still in flight, or within a short grace window after it
 * settled. Phase 2 (observeSettlement) judges the candidate against the observed
 * responses so retries, idempotent submissions, and backend-rejected repeats are
 * separated from genuine duplicate commits.
 */
export class DuplicateActionFinder {
  private readonly byId = new Map<string, TrackedRequest>();
  private readonly latestBySignature = new Map<string, string>();
  private readonly candidateBySecond = new Map<string, string>();
  private readonly candidateByFirst = new Map<string, string>();
  private readonly judged = new Map<string, DuplicateVerdict>();
  private readonly reported = new Map<string, number>();
  private observations = 0;

  // Phase 1. Track the request and open a duplicate candidate when it repeats one that
  // is still in flight (or only just settled). Never reports on its own — a candidate is
  // judged once the responses are known.
  public observeRequest(o: RequestObservation): void {
    const method = (o.method ?? '').toString().toUpperCase();
    if (!STATE_CHANGING.has(method)) return;
    this.observations += 1;

    const signature = this.signatureFor(method, o.url ?? '', o.body);
    const record: TrackedRequest = {
      id: o.requestId,
      signature,
      method,
      url: o.url ?? '',
      startedAtMs: o.timestampMs,
      idempotencyKey: this.idempotencyKeyOf(o.headers),
      interaction: o.interaction,
      raceScenarioActive: o.raceScenarioActive,
      pageUrl: o.pageUrl,
    };
    this.track(record);

    const priorId = this.latestBySignature.get(signature);
    if (!priorId && this.latestBySignature.size >= MAX_TRACKED) {
      const oldest = this.latestBySignature.keys().next().value as string | undefined;
      if (oldest) this.latestBySignature.delete(oldest);
    }
    this.latestBySignature.set(signature, record.id);
    if (!priorId) return;
    const prior = this.byId.get(priorId);
    if (!prior) return;

    // Overlap is the strong oracle; a settled predecessor only qualifies inside the grace window.
    // A still-pending predecessor qualifies only until the hang threshold — past that it is a hang,
    // not a live peer, so a much-later identical request is a fresh submission, not a double-submit.
    const overlapped = prior.settledAtMs === undefined;
    if (overlapped) {
      if (o.timestampMs - prior.startedAtMs > OVERLAP_WINDOW_MS) return;
    } else if (o.timestampMs - prior.settledAtMs! > SETTLED_GRACE_MS) {
      return;
    }

    // Distinct idempotency keys mean the client intended two separate operations.
    if (prior.idempotencyKey && record.idempotencyKey && prior.idempotencyKey !== record.idempotencyKey) return;

    this.candidateBySecond.set(record.id, prior.id);
    this.candidateByFirst.set(prior.id, record.id);
  }

  // Phase 2. Settle a request and judge any candidate it completes. Returns a defect the
  // first time a pair is judged reportable, and again only when a later settlement
  // upgrades the verdict (occurrence carries the running repeat count).
  public observeSettlement(s: RequestSettlement): { defect: DuplicateActionDefect; isNew: boolean } | null {
    const record = this.byId.get(s.requestId);
    if (!record) return null;
    record.settledAtMs = s.timestampMs;
    record.status = s.status;
    record.failed = s.failed === true || s.status === undefined;

    const asSecond = this.candidateBySecond.get(record.id);
    if (asSecond) {
      const first = this.byId.get(asSecond);
      if (first) return this.judge(first, record);
    }
    const asFirst = this.candidateByFirst.get(record.id);
    if (asFirst) {
      const second = this.byId.get(asFirst);
      if (second?.settledAtMs !== undefined) return this.judge(record, second);
    }
    return null;
  }

  // Distinct duplicate-action defects reported this run.
  public totalFound(): number {
    return this.reported.size;
  }

  // Every state-changing request observed this run.
  public totalObservations(): number {
    return this.observations;
  }

  // Classify a settled (or half-settled) pair and build the defect if it is reportable.
  private judge(first: TrackedRequest, second: TrackedRequest): { defect: DuplicateActionDefect; isNew: boolean } | null {
    // A repeat that followed an outright failure is a retry, not a double-submit.
    const firstFailed = first.failed === true || (first.status !== undefined && first.status >= 500);
    if (firstFailed && first.settledAtMs !== undefined && first.settledAtMs <= second.startedAtMs) return null;

    // A rejected repeat that was not the app's own dedupe guard committed nothing.
    if (second.status !== undefined && second.status >= 400 && !GUARD_STATUSES.has(second.status)) return null;

    const overlapped = first.settledAtMs === undefined || first.settledAtMs > second.startedAtMs;
    const bothCommitted = this.isSuccess(first.status) && this.isSuccess(second.status);
    const verdict: DuplicateVerdict = second.status !== undefined && GUARD_STATUSES.has(second.status)
      ? 'GUARDED'
      : bothCommitted
        ? 'CONFIRMED_DUPLICATE'
        : 'SUSPECTED';

    const previous = this.judged.get(second.id);
    if (previous && VERDICT_RANK[previous] >= VERDICT_RANK[verdict]) return null;
    this.judged.set(second.id, verdict);

    const bugId = this.bugIdFor(second.method, second.signature);
    const alreadyReported = this.reported.has(bugId);
    if (!alreadyReported && this.reported.size >= MAX_REPORTED) return null;

    // Occurrence counts duplicate REQUESTS, so a re-judgement that merely upgrades an
    // already-counted pair (the first response arriving late) must not inflate it.
    const occurrence = previous ? this.reported.get(bugId)! : (this.reported.get(bugId) ?? 1) + 1;
    this.reported.set(bugId, occurrence);
    return { defect: this.build(bugId, first, second, verdict, overlapped, occurrence), isNew: !alreadyReported };
  }

  private build(
    bugId: string,
    first: TrackedRequest,
    second: TrackedRequest,
    verdict: DuplicateVerdict,
    overlapped: boolean,
    occurrence: number,
  ): DuplicateActionDefect {
    const intervalMs = Math.max(0, second.startedAtMs - first.startedAtMs);
    const corroborated = first.raceScenarioActive || second.raceScenarioActive;
    const interaction = second.interaction ?? first.interaction;
    const confidenceScore = this.scoreOf({ verdict, overlapped, corroborated, interaction, idempotent: !!second.idempotencyKey });
    const severity = verdict === 'CONFIRMED_DUPLICATE' ? 'HIGH' : verdict === 'SUSPECTED' ? 'MEDIUM' : 'LOW';
    const faultConfidence = confidenceScore >= 0.75 ? 'CONFIRMED' : confidenceScore >= 0.5 ? 'SIGNAL' : 'INFERRED';
    // Host-stripped path so the message reads `POST /api/checkout`, never a tunnel/proxy URL.
    const endpoint = this.pathOf(second.url);
    const label = interaction?.label || 'the control';
    // The backend guarded the repeat (rejected it) or both requests shared an
    // idempotency key the server can dedupe — the app behaved correctly, so this is
    // telemetry, not a defect.
    const protectedDuplicate =
      verdict === 'GUARDED' ||
      Boolean(first.idempotencyKey && second.idempotencyKey && first.idempotencyKey === second.idempotencyKey);

    return {
      bugId,
      bugClass: 'SPA_STATE_RACE_CONDITION',
      verdict,
      severity,
      faultConfidence,
      confidenceScore,
      cwe: BUG_CATALOG.SPA_STATE_RACE_CONDITION.cwe,
      message: this.messageFor(verdict, second.method, endpoint, intervalMs, overlapped),
      endpoint,
      method: second.method,
      selector: interaction?.selector ?? '',
      elementLabel: label,
      // Document URL the control fired from — the page a developer opens to reproduce,
      // never `endpoint` (an API path). Drives the fallback reproduction trace.
      pageUrl: second.pageUrl ?? first.pageUrl,
      evidence: this.evidenceFor(first, second, verdict, overlapped, intervalMs, occurrence, confidenceScore, interaction),
      reproductionHint: this.reproductionFor(first, second, verdict, overlapped, label),
      advice: this.adviceFor(verdict),
      occurrence,
      corroborated,
      overlapped,
      intervalMs,
      firstStatus: first.status,
      secondStatus: second.status,
      idempotencyKey: second.idempotencyKey,
      protected: protectedDuplicate,
    };
  }

  // Weighted evidence score — each term is an independent signal that the repeat was unguarded.
  private scoreOf(f: {
    verdict: DuplicateVerdict;
    overlapped: boolean;
    corroborated: boolean;
    interaction?: InteractionContext;
    idempotent: boolean;
  }): number {
    let score = 0.2;
    if (f.overlapped) score += 0.35;
    if (f.verdict === 'CONFIRMED_DUPLICATE') score += 0.3;
    if (f.verdict === 'GUARDED') score -= 0.1;
    if (!f.idempotent) score += 0.15;
    if (f.corroborated) score += 0.1;
    if (f.interaction) score += 0.1;
    return Math.round(Math.min(1, Math.max(0, score)) * 100) / 100;
  }

  private messageFor(verdict: DuplicateVerdict, method: string, endpoint: string, intervalMs: number, overlapped: boolean): string {
    const timing = overlapped
      ? `sent again ${intervalMs}ms later while the first was still running`
      : `sent again ${intervalMs}ms later, after the first had already completed`;
    if (verdict === 'GUARDED') {
      return `[Duplicate request, no browser guard] ${method} ${endpoint} was ${timing}. The server rejected the repeat, but nothing in the browser stopped it.`;
    }
    if (verdict === 'CONFIRMED_DUPLICATE') {
      return `[Double submit] ${method} ${endpoint} was ${timing}, and both requests succeeded, so the action ran twice.`;
    }
    return `[Possible double submit] ${method} ${endpoint} was ${timing}.`;
  }

  private evidenceFor(
    first: TrackedRequest,
    second: TrackedRequest,
    verdict: DuplicateVerdict,
    overlapped: boolean,
    intervalMs: number,
    occurrence: number,
    confidenceScore: number,
    interaction?: InteractionContext,
  ): string[] {
    const evidence = [
      `Request 1: ${first.method} ${this.pathOf(first.url)} at t+0ms, result: ${this.describeOutcome(first)}`,
      `Request 2: ${second.method} ${this.pathOf(second.url)} at t+${intervalMs}ms, result: ${this.describeOutcome(second)}`,
      `Same method, address, and value (${second.signature.split('::')[1] ?? 'none'})`,
      overlapped
        ? 'The repeat was sent while the first request was still running, so no disable-on-submit or in-flight guard stopped it'
        : `The repeat was sent ${intervalMs}ms after the first finished, inside the window a guarded control would normally block`,
    ];
    if (interaction) {
      evidence.push(`Control that triggered it: ${resolveControlName({ label: interaction.label, selector: interaction.selector })}`);
    }
    if (second.idempotencyKey) {
      evidence.push(`Both requests carried the same idempotency key (${second.idempotencyKey}), so the server can de-duplicate them but the browser still cannot`);
    } else {
      evidence.push('Neither request carried an idempotency key, so the server has no way to collapse the repeat');
    }
    if (verdict === 'GUARDED') {
      evidence.push(`The server rejected the repeat with HTTP ${second.status}, so no duplicate record was saved`);
    }
    if (verdict === 'CONFIRMED_DUPLICATE') {
      evidence.push('Both requests succeeded, so the action was saved twice');
    }
    if (first.raceScenarioActive || second.raceScenarioActive) {
      evidence.push('Corroborated by an active concurrency/rapid-click stress probe');
    }
    evidence.push(`Occurrence ${occurrence} this run; confidence ${confidenceScore.toFixed(2)}`);
    return evidence;
  }

  // Deterministic steps to reproduce, derived from the correlated causal pair. Timing is
  // kept qualitative ("before the first finishes") — the exact millisecond gap is the
  // engine's measurement, not an action a human repeats.
  private reproductionFor(
    first: TrackedRequest,
    second: TrackedRequest,
    verdict: DuplicateVerdict,
    overlapped: boolean,
    label: string,
  ): string[] {
    // The control lives on the PAGE the requests fired from — never the API endpoint
    // itself. second.url is a data endpoint the control ISSUES (step 2), not a route a
    // developer browses to; opening it sent them to a backend URL that renders no UI.
    const pageUrl = second.pageUrl || first.pageUrl;
    const openStep = pageUrl
      ? `${describeRouteStep(pageUrl)}, then bring ${label} into view`
      : `Bring ${label} into view on the page under test`;
    // Match the finding's own overlap determination: an overlapping repeat fired WHILE the
    // first was in flight; a non-overlapping one fired just AFTER it settled (the grace
    // window), so telling the developer to re-click "before the first finishes" would
    // contradict the message and evidence, which already read the first as settled.
    const repeatStep = overlapped
      ? `Use ${label} again before the first request finishes`
      : `Use ${label} again right after the first finishes, before the control re-enables`;
    const steps = [
      openStep,
      `Use ${label} once. The app sends ${first.method} ${this.pathOf(first.url)}`,
      repeatStep,
      `Watch a second ${second.method} ${this.pathOf(second.url)} go out with the same value`,
    ];
    steps.push(
      verdict === 'GUARDED'
        ? `Watch the server reject it with HTTP ${second.status}. The control was never disabled between clicks`
        : verdict === 'CONFIRMED_DUPLICATE'
          ? `Watch both requests succeed (${this.describeOutcome(first)}, ${this.describeOutcome(second)}), so the action is saved twice`
          : 'Watch the repeat reach the server with no browser guard in between',
    );
    return steps;
  }

  private adviceFor(verdict: DuplicateVerdict): string {
    const lead = verdict === 'GUARDED'
      ? 'The control fired the same state-changing request twice with no client guard; only the backend prevented a duplicate commit.'
      : 'The control fired the same state-changing request twice with no debounce or disable-on-submit guard.';
    return `${lead}\n${BUG_CATALOG.SPA_STATE_RACE_CONDITION.remediation}`;
  }

  private describeOutcome(r: TrackedRequest): string {
    if (r.settledAtMs === undefined) return 'still in flight';
    if (r.failed && r.status === undefined) return 'transport failure';
    return `HTTP ${r.status}`;
  }

  private isSuccess(status?: number): boolean {
    return status !== undefined && status >= 200 && status < 400;
  }

  private pathOf(url: string): string {
    const withoutOrigin = url.replace(/^[a-z]+:\/\/[^/]+/i, '');
    return withoutOrigin || url;
  }

  private idempotencyKeyOf(headers?: Record<string, string>): string | undefined {
    if (!headers) return undefined;
    for (const [name, value] of Object.entries(headers)) {
      if (IDEMPOTENCY_HEADERS.includes(name.toLowerCase()) && value) return value;
    }
    return undefined;
  }

  // Bound the tracked-request map so a long run can never grow without limit.
  private track(record: TrackedRequest): void {
    if (this.byId.size >= MAX_TRACKED) {
      const oldest = this.byId.keys().next().value as string | undefined;
      if (oldest) {
        this.byId.delete(oldest);
        this.candidateBySecond.delete(oldest);
        this.candidateByFirst.delete(oldest);
        this.judged.delete(oldest);
      }
    }
    this.byId.set(record.id, record);
  }

  private signatureFor(method: string, url: string, body?: string): string {
    return `${method} ${this.normalizeUrl(url)}::${this.hash(this.canonicalizeBody(body))}`;
  }

  // Strip the fragment and cache-buster query values so a timestamped repeat still
  // collapses. Resource identifiers in the path are preserved verbatim — masking them
  // would merge two distinct records into one false duplicate.
  private normalizeUrl(url: string): string {
    return (url || '')
      .split('#')[0]
      .replace(/([?&](?:_|t|ts|cb|rnd|rand|cache|cachebust)=)[^&]*/gi, '$1#');
  }

  // Order-insensitive JSON canonicalization so a re-serialized identical payload matches.
  private canonicalizeBody(body?: string): string {
    if (!body) return '';
    try {
      return JSON.stringify(this.sortKeys(JSON.parse(body)));
    } catch {
      return body;
    }
  }

  private sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((v) => this.sortKeys(v));
    if (value && typeof value === 'object') {
      const source = value as Record<string, unknown>;
      return Object.keys(source).sort().reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = this.sortKeys(source[key]);
        return acc;
      }, {});
    }
    return value;
  }

  private bugIdFor(method: string, signature: string): string {
    return `dup-action-${method.toLowerCase()}-${this.hash(signature)}`;
  }

  // djb2 — stable, cheap, no crypto dependency.
  private hash(input: string): string {
    let h = 5381;
    for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
}

// Deterministic replay trace for a judged duplicate — the exact pair a developer re-fires,
// framed to match the defect's own overlap finding. An overlapping repeat replays as ONE
// rapid burst (repeatCount 2, narrated "in quick succession"); a sequential one (the repeat
// fired only AFTER the first settled) replays as TWO distinct clicks, each showing the commit
// it caused, so the card never implies a simultaneity that did not happen.
export function buildDuplicateReplaySteps(
  defect: DuplicateActionDefect,
  pageUrl: string,
  timestamp: string,
): ActionRecord[] {
  const nav: ActionRecord = { timestamp, type: 'NAVIGATE', selector: pageUrl, url: pageUrl };
  const click = { timestamp, type: 'CLICK' as const, selector: defect.selector, url: pageUrl, elementLabel: defect.elementLabel };
  if (defect.overlapped) return [nav, { ...click, repeatCount: 2 }];
  const outcome = (status?: number): ActionRecord['outcome'] => (status === undefined ? undefined : { httpStatus: status });
  return [nav, { ...click, outcome: outcome(defect.firstStatus) }, { ...click, outcome: outcome(defect.secondStatus) }];
}
