// ═══════════════════════════════════════════════════════════════
// regression/replayProbes.ts — PORTED REPLAY-TIME DETECTORS
// ═══════════════════════════════════════════════════════════════
// The thin FaultCollector only hears raw pageerror/console/HTTP faults, so bug
// classes first caught by StabilityMonitor's richer detectors could never
// reproduce and always read RESOLVED. This module ports the cheap deterministic
// subset (unhandled rejections, renderer crash, API-hang watchdog, soft-fail
// body scan, freeze heartbeat) and names which classes replay can verify at all.

import type { Page, Request, Response } from 'playwright';
import type { FaultCollector } from './FaultCollector.js';
import type { FaultType } from '../../../bugs/knowledgeBase/FaultClassifier.js';
import {
  detectSoftFailBody,
  isBodyReadableResourceType,
  MAX_SOFT_FAIL_BODY_BYTES,
} from '../verification/softFailBody.js';

// A first-party request still pending this long after the timeline finished is a hang.
export const HANG_THRESHOLD_MS = 8_000;
// Main-thread heartbeat ceiling for the one-shot freeze probe.
const FREEZE_PROBE_TIMEOUT_MS = 5_000;
const HANG_RESOURCE_TYPES = new Set(['xhr', 'fetch', 'document']);

/**
 * Classes a deterministic replay can actually evidence. Everything else
 * (race timing, cascade attribution, constraint-bypass oracles) must be
 * INCONCLUSIVE/UNVERIFIABLE — replay observation can never prove or refute them.
 */
export const REPLAY_VERIFIABLE_CLASSES: ReadonlySet<string> = new Set([
  'RUNTIME_STABILITY_EXCEPTION',
  'BOUNDARY_STRESS_FAILURE',
  'NOSQL_INJECTION',
  'FUZZ_VULNERABILITY_LEAK',
  'SECURITY_VULNERABILITY_LEAK',
  'INPUT_SANITIZATION_FAILURE',
  'CLIENT_TRUST_BOUNDARY_VIOLATION',
  'ROUTE_MUTATION_FAILURE',
  'STRUCTURAL_NAVIGATION_LOGIC',
  'INFINITE_LOADING',
]);

export function isReplayVerifiable(bugClass: string): boolean {
  return REPLAY_VERIFIABLE_CLASSES.has(bugClass);
}

declare global {
  interface Window {
    __bsReplayRejections?: Array<{ message: string }>;
  }
}

/**
 * Arms the ported detectors on a replay page and drains their evidence into the
 * FaultCollector before evaluation. Class-gated probes only pay their cost when
 * the original finding needs them. Lifecycle: arm() before goto → replay →
 * drain() after the settle window → detach() in the caller's finally.
 */
export class ReplayProbes {
  private readonly pendingRequests = new Map<Request, number>();
  private readonly bodyScans: Array<Promise<void>> = [];
  private crashed = false;

  constructor(
    private readonly page: Page,
    private readonly collector: FaultCollector,
    private readonly bugClass: string,
    private readonly faultType: FaultType,
  ) {}

  public async arm(): Promise<void> {
    this.page.on('crash', this.onCrash);
    await this.page
      .addInitScript(() => {
        window.__bsReplayRejections = [];
        window.addEventListener('unhandledrejection', (event) => {
          const reason = (event as PromiseRejectionEvent).reason;
          const message = reason instanceof Error ? reason.message : String(reason);
          window.__bsReplayRejections?.push({ message: `Unhandled promise rejection: ${message}` });
        });
      })
      .catch(() => undefined);

    if (this.bugClass === 'INFINITE_LOADING') {
      this.page.on('request', this.onRequest);
      this.page.on('requestfinished', this.onRequestSettled);
      this.page.on('requestfailed', this.onRequestSettled);
    }
    if (this.bugClass === 'BOUNDARY_STRESS_FAILURE') {
      this.page.on('response', this.onResponse);
    }
  }

  /** Harvest probe evidence after the settle window, before collector.evaluate. */
  public async drain(): Promise<void> {
    if (this.crashed) {
      this.collector.addExternal({
        faultType: 'EXCEPTION',
        message: 'Renderer process crashed during replay (out-of-memory or GPU fault)',
      });
      return;
    }

    await Promise.all(this.bodyScans).catch(() => undefined);

    const rejections = await this.page
      .evaluate(() => window.__bsReplayRejections ?? [])
      .catch(() => [] as Array<{ message: string }>);
    for (const rejection of rejections) {
      this.collector.addExternal({ faultType: 'EXCEPTION', message: rejection.message, url: this.safeUrl() });
    }

    if (this.bugClass === 'INFINITE_LOADING') {
      const now = Date.now();
      for (const [request, startedAt] of this.pendingRequests) {
        if (now - startedAt < HANG_THRESHOLD_MS) continue;
        this.collector.addExternal({
          faultType: 'NETWORK',
          message: `API hang: ${request.method()} ${request.url()} pending > ${HANG_THRESHOLD_MS / 1000}s`,
          url: request.url(),
          bugClassOverride: 'INFINITE_LOADING',
        });
      }
    }

    if (this.faultType === 'FREEZE') {
      const alive = await Promise.race([
        this.page.evaluate(() => true).catch(() => false),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), FREEZE_PROBE_TIMEOUT_MS)),
      ]);
      if (!alive) {
        this.collector.addExternal({
          faultType: 'FREEZE',
          message: 'Main thread unresponsive (replay heartbeat probe timed out)',
          url: this.safeUrl(),
          bugClassOverride: 'RUNTIME_STABILITY_EXCEPTION',
        });
      }
    }
  }

  public detach(): void {
    this.page.off('crash', this.onCrash);
    this.page.off('request', this.onRequest);
    this.page.off('requestfinished', this.onRequestSettled);
    this.page.off('requestfailed', this.onRequestSettled);
    this.page.off('response', this.onResponse);
    this.pendingRequests.clear();
  }

  private readonly onCrash = (): void => {
    this.crashed = true;
  };

  private readonly onRequest = (request: Request): void => {
    if (HANG_RESOURCE_TYPES.has(request.resourceType())) this.pendingRequests.set(request, Date.now());
  };

  private readonly onRequestSettled = (request: Request): void => {
    this.pendingRequests.delete(request);
  };

  private readonly onResponse = (response: Response): void => {
    const status = response.status();
    if (status < 200 || status >= 300) return;
    if (!isBodyReadableResourceType(response.request().resourceType())) return;
    this.bodyScans.push(
      response
        .text()
        .then((body) => {
          if (body.length > MAX_SOFT_FAIL_BODY_BYTES) return;
          const verdict = detectSoftFailBody(body);
          if (!verdict.softFail) return;
          this.collector.addExternal({
            faultType: 'NETWORK',
            statusCode: status,
            message: `Masked failure in ${status} body (${verdict.matched})`,
            url: response.url(),
            bugClassOverride: 'BOUNDARY_STRESS_FAILURE',
          });
        })
        .catch(() => undefined),
    );
  };

  private safeUrl(): string | undefined {
    try {
      return this.page.url();
    } catch {
      return undefined;
    }
  }
}
