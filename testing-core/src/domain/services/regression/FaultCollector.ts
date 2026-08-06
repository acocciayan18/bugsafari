import type { Page, ConsoleMessage, Response, Request } from 'playwright';
import { classifyFault, type FaultType, type FaultInput } from '../../../bugs/knowledgeBase/FaultClassifier.js';
import { SIGNAL_PATTERNS, matchesCategory, type SignalCategory } from '../../../bugs/knowledgeBase/signalPatterns.js';
import { MAX_SOFT_FAIL_BODY_BYTES, isBodyReadableResourceType } from '../verification/softFailBody.js';
import type { RegressionSignal } from '../../../../../shared/types.js';
import type { CollectedFault } from './types.js';

// Resource types whose failures represent real backend/app faults (not asset noise).
const FAULT_RESOURCE_TYPES = new Set(['document', 'xhr', 'fetch']);
// Cap page-content scanned by the classifier so a huge DOM can't stall the regex pass.
const MAX_CONTENT_SCAN = 200_000;
// Different-class faults surfaced to the operator are deduped and capped to stay readable.
const MAX_OTHER_SIGNALS = 10;
// Normalized-message prefix length used by the similarity containment check.
const SIMILARITY_PREFIX = 80;

/** What `evaluate` needs to compare replay faults against the original finding. */
export interface EvaluateInput {
  originalBugClass: string;
  originalFaultType: FaultType;
  /** Original finding's message — corroborates same-class matches via similarity. */
  originalMessage: string;
  /** Scenario active when the bug was first caught, threaded into classifyFault. */
  scenario?: string;
  pageContent: string;
}

/**
 * Tri-bucket verdict evidence:
 *   strong — same class, corroborated (signal-backed, probe-detected, or message-similar) → reproduction proof.
 *   weak   — same class but INFERRED-only and message-dissimilar → not proof, blocks RESOLVED.
 *   other  — different class → new findings, surfaced but never reproduction evidence.
 */
export interface SignalBuckets {
  strong: RegressionSignal[];
  weak: RegressionSignal[];
  other: RegressionSignal[];
}

/**
 * Attaches Playwright page listeners for the duration of a replay and accumulates
 * every runtime fault (JS exception, console error, failed response/request). At
 * the end, `evaluate` re-runs the SAME deterministic knowledge-base classifier
 * used by live detection and buckets each fault by how strongly it evidences the
 * ORIGINAL finding — so a RESOLVED/STILL_ACTIVE verdict is grounded in identical
 * rules to how the bug was first reported, corroborated by message identity.
 */
export class FaultCollector {
  private readonly faults: CollectedFault[] = [];
  private readonly endpoints = new Set<string>();
  private readonly bodyScans: Array<Promise<void>> = [];
  private bound = false;

  /** @param scanBodies read response bodies for classes whose evidence is body-borne. */
  constructor(private readonly page: Page, private readonly scanBodies = false) {}

  /** URL pathnames the replay actually issued requests to — proves the fault trigger ran. */
  public exercisedEndpoints(): string[] {
    return [...this.endpoints];
  }

  /** Await pending response-body reads before evaluate — they append content-bearing faults. */
  public async drainBodies(): Promise<void> {
    await Promise.all(this.bodyScans).catch(() => undefined);
  }

  /** Begin capturing faults. Idempotent. */
  public attach(): void {
    if (this.bound) return;
    this.bound = true;
    this.page.on('pageerror', this.onPageError);
    this.page.on('console', this.onConsole);
    this.page.on('response', this.onResponse);
    this.page.on('requestfailed', this.onRequestFailed);
  }

  /** Stop capturing faults. Safe to call once after the replay completes. */
  public detach(): void {
    if (!this.bound) return;
    this.bound = false;
    this.page.off('pageerror', this.onPageError);
    this.page.off('console', this.onConsole);
    this.page.off('response', this.onResponse);
    this.page.off('requestfailed', this.onRequestFailed);
  }

  /** Feed a fault observed by a ported replay probe (hang/freeze/soft-fail/rejection). */
  public addExternal(fault: CollectedFault): void {
    this.faults.push(fault);
  }

  private readonly onPageError = (error: Error): void => {
    this.faults.push({ faultType: 'EXCEPTION', message: error.message, url: this.safeUrl() });
  };

  private readonly onConsole = (message: ConsoleMessage): void => {
    if (message.type() !== 'error') return;
    this.faults.push({ faultType: 'CONSOLE', message: message.text(), url: this.safeUrl() });
  };

  private readonly onResponse = (response: Response): void => {
    this.recordEndpoint(response.url());
    const status = response.status();
    if (status < 400) return;
    const resourceType = response.request().resourceType();
    if (!FAULT_RESOURCE_TYPES.has(resourceType)) return;
    const fault: CollectedFault = {
      faultType: 'NETWORK',
      message: `HTTP ${status} ${response.statusText()}`.trim(),
      statusCode: status,
      url: response.url(),
    };
    // Leaked Mongo/stack/soft-fail evidence lives in the body, never the status line —
    // read it so a body-borne leak reproduces instead of reading clean.
    if (this.scanBodies && isBodyReadableResourceType(resourceType)) {
      this.bodyScans.push(
        response
          .text()
          .then((body) => {
            if (body && body.length <= MAX_SOFT_FAIL_BODY_BYTES) fault.content = body;
            this.faults.push(fault);
          })
          .catch(() => {
            this.faults.push(fault);
          }),
      );
      return;
    }
    this.faults.push(fault);
  };

  private readonly onRequestFailed = (request: Request): void => {
    this.recordEndpoint(request.url());
    if (!FAULT_RESOURCE_TYPES.has(request.resourceType())) return;
    const reason = request.failure()?.errorText ?? 'request failed';
    this.faults.push({ faultType: 'NETWORK', message: `Request failed: ${reason}`, url: request.url() });
  };

  private recordEndpoint(url: string): void {
    const path = pathOf(url);
    if (path) this.endpoints.add(path);
  }

  private safeUrl(): string | undefined {
    try {
      return this.page.url();
    } catch {
      return undefined;
    }
  }

  /**
   * Deterministically bucket every observed fault against the original bug.
   * Same class alone is NOT proof: an unrelated console error INFERRED-defaults
   * into the exception class and would otherwise "reproduce" any exception-class
   * finding. Strong requires corroboration — probe override, a signal-backed
   * classification, message similarity, or a status code echoed by the original.
   */
  public evaluate(input: EvaluateInput): SignalBuckets {
    const { originalBugClass, originalFaultType, originalMessage, scenario } = input;
    const buckets: SignalBuckets = { strong: [], weak: [], other: [] };
    const seenOther = new Set<string>();

    for (const fault of this.faults) {
      const signal: RegressionSignal = {
        faultType: fault.faultType,
        message: fault.message,
        statusCode: fault.statusCode,
        url: fault.url,
      };

      if (fault.bugClassOverride) {
        if (fault.bugClassOverride === originalBugClass) buckets.strong.push(signal);
        else this.pushOther(buckets, seenOther, signal);
        continue;
      }

      const faultInput: FaultInput = {
        faultType: fault.faultType,
        message: fault.message,
        statusCode: fault.statusCode,
        url: fault.url,
        content: fault.content,
        scenario,
      };
      const cls = classifyFault(faultInput);
      if (cls.bugClass !== originalBugClass) {
        this.pushOther(buckets, seenOther, signal);
        continue;
      }

      const corroborated =
        cls.confidence !== 'INFERRED' ||
        messagesSimilar(fault.message, originalMessage) ||
        (fault.statusCode !== undefined && originalMessage.includes(String(fault.statusCode)));
      if (corroborated) buckets.strong.push(signal);
      // Uncorroborated console chatter is framework noise (React logs via console.error);
      // real uncaught exceptions / failed requests stay weak and block RESOLVED.
      else if (fault.faultType === 'CONSOLE') this.pushOther(buckets, seenOther, signal);
      else buckets.weak.push(signal);
    }

    const content = input.pageContent.slice(0, MAX_CONTENT_SCAN);
    if (this.contentHasSignal(content)) {
      const contentInput: FaultInput = {
        faultType: originalFaultType,
        message: '',
        content,
        url: this.safeUrl(),
        scenario,
      };
      // Signal-gated content classification is hard evidence, never INFERRED noise.
      if (classifyFault(contentInput).bugClass === originalBugClass) {
        buckets.strong.push({
          faultType: originalFaultType,
          message: `Original ${originalBugClass} signature present in replayed page content`,
          url: this.safeUrl(),
        });
      }
    }

    return buckets;
  }

  private pushOther(buckets: SignalBuckets, seen: Set<string>, signal: RegressionSignal): void {
    const key = normalizeMessage(signal.message);
    if (seen.has(key) || buckets.other.length >= MAX_OTHER_SIGNALS) return;
    seen.add(key);
    buckets.other.push(signal);
  }

  private contentHasSignal(content: string): boolean {
    if (!content) return false;
    return (Object.keys(SIGNAL_PATTERNS) as SignalCategory[]).some((category) => matchesCategory(category, content));
  }
}

/** URL → pathname (no query), or '' when unparseable. Used to compare fault triggers across runs. */
export function pathOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/** Collapse volatile spans (quoted values, numbers, URLs) so the same error matches across runs. */
export function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/(["'`]).*?\1/g, '""')
    .replace(/https?:\/\/\S+/g, 'u')
    .replace(/\d+/g, '#')
    .trim()
    .slice(0, 160);
}

/** Deterministic sameness test: equal after normalization, or one contains the other's prefix. */
export function messagesSimilar(a: string, b: string): boolean {
  const na = normalizeMessage(a);
  const nb = normalizeMessage(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.includes(nb.slice(0, SIMILARITY_PREFIX)) || nb.includes(na.slice(0, SIMILARITY_PREFIX));
}
