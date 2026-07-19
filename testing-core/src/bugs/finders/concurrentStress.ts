/**
 * ConcurrentStress - Domain Guard for Concurrent Rapid Click Stress Detection
 *
 * This bug finder detects stability issues resulting from rapid clicking stress scenarios:
 * - Main thread lockup/hanging during rapid UI interactions
 * - Frame reconciliation errors (React-like "nested update" errors)
 * - Event handler crashes
 * - Race conditions in concurrent click handling
 *
 * Findings are classified as 'RUNTIME_STABILITY_EXCEPTION'
 */

import type { BugFinder, BugContext, BugFinding } from '../types.js';
import type { ChaosContextType, StressClickMetadata } from '../../domain/chaos/index.js';

// Singleton reference to the active chaos transaction manager
// In a full implementation, this would be injected via dependency injection
let chaosManagerAccessor: {
  getChaosType(): ChaosContextType | null;
  getActiveMetadata(): StressClickMetadata | undefined;
} | null = null;

/**
 * Sets the chaos manager accessor for concurrentStress guard
 * @param accessor The chaos manager instance
 */
export function setChaosManagerAccessor(
  accessor: { getChaosType(): ChaosContextType | null; getActiveMetadata(): StressClickMetadata | undefined } | null
): void {
  chaosManagerAccessor = accessor;
}

/**
 * Stability data structure from stabilityMonitor.ts
 * Represents the current stability state of the application
 */
export interface StabilityData {
  hasUnhandledJsException: boolean;
  hasMainThreadLockup: boolean;
  hasServerCollapse: boolean;
  exceptionDetails?: {
    message: string;
    stackTrace: string;
  };
  lockupDetected?: boolean;
  serverStatusCode?: number;
}

/**
 * Frame reconciliation error patterns
 * These indicate React-like framework errors during rapid updates
 */
const FRAME_RECONCILIATION_PATTERNS = [
  /nested update/i,
  /too many re-renders/i,
  /render cycle/i,
  /maximum update depth/i,
  /cancel all subscriptions/i,
  /callback was already called/i,
  /called twice/i,
];

/**
 * Main thread hang indicators.
 * Deliberately narrow: generic words like "blocked"/"frozen" appear in ordinary
 * product copy and produced a CRITICAL false positive on any page containing them.
 */
const MAIN_THREAD_HANG_PATTERNS = [
  /main thread/i,
  /not responding/i,
  /event loop (?:blocked|stalled|lag)/i,
  /long task/i,
];

/**
 * Checks if the current context has an active STRESS_CLICK transaction
 */
function hasActiveStressClickTransaction(): boolean {
  if (!chaosManagerAccessor) {
    return false;
  }
  return chaosManagerAccessor.getChaosType() === 'STRESS_CLICK';
}

/**
 * Gets the active stress click metadata from the transaction
 */
function getActiveStressMetadata(): StressClickMetadata | undefined {
  if (!chaosManagerAccessor) {
    return undefined;
  }
  return chaosManagerAccessor.getActiveMetadata();
}

/**
 * Analyzes stability data for hang detection
 * @param stabilityData The stability data to analyze
 * @returns True if a hang was detected
 */
function detectMainThreadHang(stabilityData: StabilityData): boolean {
  // Check for explicit lockup flag
  if (stabilityData.hasMainThreadLockup || stabilityData.lockupDetected) {
    return true;
  }

  // Check exception details for hang patterns
  if (stabilityData.exceptionDetails?.message) {
    const message = stabilityData.exceptionDetails.message.toLowerCase();
    return MAIN_THREAD_HANG_PATTERNS.some((pattern) => pattern.test(message));
  }

  return false;
}

/**
 * Analyzes stability data for frame reconciliation errors
 * @param stabilityData The stability data to analyze
 * @returns True if frame reconciliation errors were detected
 */
function detectFrameReconciliationErrors(stabilityData: StabilityData): boolean {
  if (stabilityData.exceptionDetails?.message) {
    const message = stabilityData.exceptionDetails.message;
    return FRAME_RECONCILIATION_PATTERNS.some((pattern) => pattern.test(message));
  }
  return false;
}

// Dev-server / framework error overlays. Reconciliation and hang errors surface here;
// scanning whole-page HTML instead matched ordinary product copy and fired constantly.
const ERROR_OVERLAY_SELECTORS = [
  '[data-nextjs-dialog]',
  '#webpack-dev-server-client-overlay',
  '.react-error-overlay',
  'vite-error-overlay',
  '[role="alert"]',
];

const OVERLAY_TEXT_CAP = 2000;

/**
 * Gathers real stability signals from the live page.
 * Only framework error-overlay text is treated as an exception message — never the
 * full document, and never the crash flag echoed back as a second lockup signal.
 * @param ctx The bug context
 * @returns StabilityData representation
 */
export async function gatherStabilityData(ctx: BugContext): Promise<StabilityData> {
  let overlayText = '';
  try {
    overlayText = await ctx.page.evaluate(
      ([selectors, cap]: [string[], number]) => {
        for (const selector of selectors) {
          const node = document.querySelector(selector);
          const text = node?.textContent?.trim();
          if (text) return text.slice(0, cap);
        }
        return '';
      },
      [ERROR_OVERLAY_SELECTORS, OVERLAY_TEXT_CAP] as [string[], number],
    );
  } catch {
    // Page may be closed/unresponsive mid-stress — fall back to crash flags only.
  }
  return {
    hasUnhandledJsException: ctx.crashHalted,
    // Derived from page evidence only. Mirroring crashHalted here made every crash
    // report twice: once as a hang, once from the crashHalted branch in run().
    hasMainThreadLockup: false,
    hasServerCollapse: false,
    exceptionDetails: overlayText ? { message: overlayText, stackTrace: '' } : undefined,
  };
}

/**
 * ConcurrentStressGuard bug finder implementation
 * Detects stability issues from rapid clicking stress tests
 */
export const concurrentStressGuard: BugFinder = {
  bugClass: 'RUNTIME_STABILITY_EXCEPTION',
  frequency: 'transactional',
  testingType: 'concurrency',

  /**
   * Determines if concurrentStressGuard should run based on context
   * Returns true if there's an active STRESS_CLICK transaction
   */
  async isApplicable(_ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> {
    // Check if we have access to chaos manager
    if (!chaosManagerAccessor) {
      return false;
    }

    // Check if there's an active STRESS_CLICK transaction
    return hasActiveStressClickTransaction();
  },

  /**
   * Executes stability detection for concurrent stress scenarios
   * Analyzes stability data for hang/error detection
   */
  async run(ctx: BugContext): Promise<BugFinding[]> {
    const findings: BugFinding[] = [];

    // Verify we have an active STRESS_CLICK transaction
    if (!hasActiveStressClickTransaction()) {
      console.log('[ConcurrentStressGuard] No active STRESS_CLICK transaction - skipping stability detection');
      return findings;
    }

    // Get the metadata from the transaction
    const metadata = getActiveStressMetadata();
    if (!metadata) {
      console.log('[ConcurrentStressGuard] No stress click metadata available');
      return findings;
    }

    console.log(
      `[ConcurrentStressGuard] Analyzing stability for concurrent stress: velocity=${metadata.velocity}ms, chain=${metadata.elementChain.join(', ')}`
    );

    // Gather real stability signals from the live page (crash flags + DOM error text).
    const stabilityData: StabilityData = await gatherStabilityData(ctx);

// Check for main thread hang
    if (detectMainThreadHang(stabilityData)) {
      findings.push({
        bugClass: 'RUNTIME_STABILITY_EXCEPTION',
        title: 'Main Thread Hang Detected - UI Unresponsive',
        severity: 'CRITICAL',
        evidence: {
          message: `Main thread hang detected during rapid clicking at velocity ${metadata.velocity}ms. UI is unresponsive.`,
          selector: metadata.elementChain[0] ?? '',
          actionExecuted: `stress-click-hang-vel${metadata.velocity}`,
        },
      });
    }

    // Check for frame reconciliation errors
    if (detectFrameReconciliationErrors(stabilityData)) {
      findings.push({
        bugClass: 'RUNTIME_STABILITY_EXCEPTION',
        title: 'Frame Reconciliation Error Detected - Rapid Updates Causing Errors',
        severity: 'HIGH',
        evidence: {
          message: `Frame reconciliation errors detected during rapid clicking. This may indicate a React-like framework issue with nested updates. Message: ${stabilityData.exceptionDetails?.message ?? 'unknown'}`,
          selector: metadata.elementChain[0] ?? '',
          actionExecuted: `stress-click-reconciliation-vel${metadata.velocity}`,
        },
      });
    }

    // Check for crash-halted state (generic stability issue)
    if (ctx.crashHalted) {
      findings.push({
        bugClass: 'RUNTIME_STABILITY_EXCEPTION',
        title: 'Process Halted During Concurrent Stress Test',
        severity: 'CRITICAL',
        evidence: {
          message: `The testing process was halted during concurrent stress testing. This indicates a catastrophic stability failure.`,
          selector: metadata.elementChain[0] ?? '',
          actionExecuted: `stress-click-crash-vel${metadata.velocity}`,
        },
      });
    }

    // If no specific issues found but we had a stress click, log the completion
    if (findings.length === 0) {
      console.log(`[ConcurrentStressGuard] No stability issues detected for stress clicks at ${metadata.velocity}ms velocity`);
    }

    return findings;
  },
};

export default concurrentStressGuard;
