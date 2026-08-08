// ═══════════════════════════════════════════════════════════════
// regression/replayProbes.ts — PORTED REPLAY-TIME DETECTORS
// ═══════════════════════════════════════════════════════════════
// The thin FaultCollector only hears raw pageerror/console/HTTP faults, so bug
// classes first caught by StabilityMonitor's richer detectors could never
// reproduce and always read RESOLVED. This module ports the cheap deterministic
// subset (unhandled rejections, renderer crash, API-hang watchdog, soft-fail
// body scan, freeze heartbeat) and names which classes replay can verify at all.

import type { Page, Request, Response } from 'playwright';
import { pathOf, type FaultCollector } from './FaultCollector.js';
import type { FaultType } from '../../../bugs/knowledgeBase/FaultClassifier.js';
import {
  detectSoftFailBody,
  isBodyReadableResourceType,
  MAX_SOFT_FAIL_BODY_BYTES,
} from '../verification/softFailBody.js';
import { detectApiContractViolation } from '../verification/apiContractBody.js';

// A first-party request still pending this long after the timeline finished is a hang.
export const HANG_THRESHOLD_MS = 8_000;
// Main-thread heartbeat ceiling for the one-shot freeze probe.
const FREEZE_PROBE_TIMEOUT_MS = 5_000;
const HANG_RESOURCE_TYPES = new Set(['xhr', 'fetch', 'document']);

/**
 * Classes a deterministic replay can actually evidence. Everything else must be
 * INCONCLUSIVE/UNVERIFIABLE — replay observation can never prove or refute them.
 * Excluded on purpose because replay has no oracle: FUZZ_VULNERABILITY_LEAK and
 * INPUT_SANITIZATION_FAILURE hinge on a CONFIRMED reflected-XSS oracle the replay
 * never runs (a body-leaked datastore error reclassifies to NOSQL/SQL, not FUZZ),
 * and CLIENT_TRUST_BOUNDARY_VIOLATION needs the StorageTamper privileged-route
 * oracle. Verifying them from passive faults alone fabricates RESOLVED.
 */
export const REPLAY_VERIFIABLE_CLASSES: ReadonlySet<string> = new Set([
  'RUNTIME_STABILITY_EXCEPTION',
  'API_CONTRACT_VIOLATION',
  'BOUNDARY_STRESS_FAILURE',
  'NOSQL_INJECTION',
  'SQL_INJECTION',
  'SECURITY_VULNERABILITY_LEAK',
  'ROUTE_MUTATION_FAILURE',
  'STRUCTURAL_NAVIGATION_LOGIC',
  'INFINITE_LOADING',
  // The replay re-runs the recorded bypass (strip client validation → submit the invalid
  // value) and observes the fault endpoint: still 2xx ⇒ the server accepted it, constraint
  // still bypassable (STILL_ACTIVE); 4xx ⇒ the server now rejects it (RESOLVED).
  'CLIENT_SIDE_CONSTRAINT_BYPASS',
]);

export function isReplayVerifiable(bugClass: string): boolean {
  return REPLAY_VERIFIABLE_CLASSES.has(bugClass);
}

/**
 * Classes whose live evidence lives in the RESPONSE BODY (a leaked Mongo/BSON error,
 * a stack/path/connection-string, a soft 404/redirect), not the status line. Replay
 * must read bodies for these or a still-active leak reads clean → false RESOLVED.
 */
const BODY_SCAN_CLASSES: ReadonlySet<string> = new Set([
  'NOSQL_INJECTION',
  'SQL_INJECTION',
  'SECURITY_VULNERABILITY_LEAK',
  'ROUTE_MUTATION_FAILURE',
  'STRUCTURAL_NAVIGATION_LOGIC',
]);

/** True when the finding's class can only be reproduced by scanning response bodies. */
export function requiresBodyScan(bugClass: string): boolean {
  return BODY_SCAN_CLASSES.has(bugClass);
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
    // Pathname of the request that defined the fault — the constraint-bypass oracle
    // watches it for a still-accepting 2xx response.
    private readonly faultEndpoint?: string,
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
    if (this.bugClass === 'API_CONTRACT_VIOLATION') {
      this.page.on('response', this.onApiContractResponse);
    }
    if (this.bugClass === 'CLIENT_SIDE_CONSTRAINT_BYPASS' && this.faultEndpoint) {
      this.page.on('response', this.onConstraintResponse);
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
    this.page.off('response', this.onApiContractResponse);
    this.page.off('response', this.onConstraintResponse);
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

  // Schema check for API_CONTRACT_VIOLATION: a 2xx API response whose body is the
  // wrong shape (JSON-declared but unparseable, or a full HTML page) is a contract
  // break the app may now swallow silently — flag it from the response itself.
  private readonly onApiContractResponse = (response: Response): void => {
    const status = response.status();
    if (status < 200 || status >= 300) return;
    if (!isBodyReadableResourceType(response.request().resourceType())) return;
    const contentType = response.headers()['content-type'] ?? '';
    this.bodyScans.push(
      response
        .text()
        .then((body) => {
          if (body.length > MAX_SOFT_FAIL_BODY_BYTES) return;
          const verdict = detectApiContractViolation(contentType, body);
          if (!verdict.violation) return;
          this.collector.addExternal({
            faultType: 'NETWORK',
            statusCode: status,
            message: `API contract violation: ${verdict.matched}`,
            url: response.url(),
            bugClassOverride: 'API_CONTRACT_VIOLATION',
          });
        })
        .catch(() => undefined),
    );
  };

  // Constraint-bypass oracle: the recorded steps strip the client validation and submit
  // the invalid value. If the fault endpoint still returns a 2xx, the server accepted it
  // without re-checking — the bypass is still live. A 4xx means the server now rejects it
  // (handled by the absence of this signal ⇒ RESOLVED).
  private readonly onConstraintResponse = (response: Response): void => {
    if (!this.faultEndpoint || pathOf(response.url()) !== this.faultEndpoint) return;
    const status = response.status();
    if (status < 200 || status >= 300) return;
    this.collector.addExternal({
      faultType: 'NETWORK',
      statusCode: status,
      message: `Constraint bypass reproduced: ${this.faultEndpoint} accepted the invalid value (HTTP ${status}) with client validation stripped`,
      url: response.url(),
      bugClassOverride: 'CLIENT_SIDE_CONSTRAINT_BYPASS',
    });
  };

  private safeUrl(): string | undefined {
    try {
      return this.page.url();
    } catch {
      return undefined;
    }
  }
}
