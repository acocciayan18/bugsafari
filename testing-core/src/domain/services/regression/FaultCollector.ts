import type { Page, ConsoleMessage, Response, Request } from 'playwright';
import { classifyFault, type FaultType, type FaultInput } from '../../../bugs/knowledgeBase/FaultClassifier.js';
import { SIGNAL_PATTERNS, matchesCategory, type SignalCategory } from '../../../bugs/knowledgeBase/signalPatterns.js';
import type { RegressionSignal } from '../../../../../shared/types.js';
import type { CollectedFault } from './types.js';

// Resource types whose failures represent real backend/app faults (not asset noise).
const FAULT_RESOURCE_TYPES = new Set(['document', 'xhr', 'fetch']);
// Cap page-content scanned by the classifier so a huge DOM can't stall the regex pass.
const MAX_CONTENT_SCAN = 200_000;

/**
 * Attaches Playwright page listeners for the duration of a replay and accumulates
 * every runtime fault (JS exception, console error, failed response/request). At
 * the end, `evaluate` re-runs the SAME deterministic knowledge-base classifier
 * used by live detection and returns only the faults whose resolved bug class
 * matches the ORIGINAL finding — so a RESOLVED/STILL_ACTIVE verdict is grounded
 * in identical rules to how the bug was first reported.
 */
export class FaultCollector {
  private readonly faults: CollectedFault[] = [];
  private bound = false;

  constructor(private readonly page: Page) {}

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

  private readonly onPageError = (error: Error): void => {
    this.faults.push({ faultType: 'EXCEPTION', message: error.message, url: this.safeUrl() });
  };

  private readonly onConsole = (message: ConsoleMessage): void => {
    if (message.type() !== 'error') return;
    this.faults.push({ faultType: 'CONSOLE', message: message.text(), url: this.safeUrl() });
  };

  private readonly onResponse = (response: Response): void => {
    const status = response.status();
    if (status < 400) return;
    if (!FAULT_RESOURCE_TYPES.has(response.request().resourceType())) return;
    this.faults.push({
      faultType: 'NETWORK',
      message: `HTTP ${status} ${response.statusText()}`.trim(),
      statusCode: status,
      url: response.url(),
    });
  };

  private readonly onRequestFailed = (request: Request): void => {
    if (!FAULT_RESOURCE_TYPES.has(request.resourceType())) return;
    const reason = request.failure()?.errorText ?? 'request failed';
    this.faults.push({ faultType: 'NETWORK', message: `Request failed: ${reason}`, url: request.url() });
  };

  private safeUrl(): string | undefined {
    try {
      return this.page.url();
    } catch {
      return undefined;
    }
  }

  /**
   * Deterministically decide which observed faults reproduce the original bug.
   * A collected runtime fault matches when it classifies to `originalBugClass`.
   * The page content is only considered when it actually matches a known signal
   * signature — that guards against the classifier's fault-type-default fallback
   * spuriously equalling the original class on a clean page.
   */
  public evaluate(originalBugClass: string, originalFaultType: FaultType, pageContent: string): RegressionSignal[] {
    const matched: RegressionSignal[] = [];

    for (const fault of this.faults) {
      const input: FaultInput = {
        faultType: fault.faultType,
        message: fault.message,
        statusCode: fault.statusCode,
        url: fault.url,
      };
      if (classifyFault(input).bugClass === originalBugClass) {
        matched.push({
          faultType: fault.faultType,
          message: fault.message,
          statusCode: fault.statusCode,
          url: fault.url,
        });
      }
    }

    const content = pageContent.slice(0, MAX_CONTENT_SCAN);
    if (this.contentHasSignal(content)) {
      const contentInput: FaultInput = {
        faultType: originalFaultType,
        message: '',
        content,
        url: this.safeUrl(),
      };
      if (classifyFault(contentInput).bugClass === originalBugClass) {
        matched.push({
          faultType: originalFaultType,
          message: `Original ${originalBugClass} signature present in replayed page content`,
          url: this.safeUrl(),
        });
      }
    }

    return matched;
  }

  private contentHasSignal(content: string): boolean {
    if (!content) return false;
    return (Object.keys(SIGNAL_PATTERNS) as SignalCategory[]).some((category) => matchesCategory(category, content));
  }
}
