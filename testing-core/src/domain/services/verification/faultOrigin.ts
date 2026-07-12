// ═══════════════════════════════════════════════════════════════
// verification/faultOrigin.ts — PROVENANCE CLASSIFIER (pure)
// ═══════════════════════════════════════════════════════════════
// Single source of truth for "does this fault's root cause belong to the target
// application?". Consolidates the artifact filters that were previously scattered
// across StabilityMonitor (isBrowserClosedError, isNetworkAbortedError) and the
// route classifier, and extends them to the full set of non-application origins:
// BugSafari instrumentation, the Playwright driver, browser/extension noise, and
// transport/environment failures. Deterministic and side-effect-free.

import type { FaultOrigin } from '../../../../../shared/types.js';
import type { FaultType } from '../../../bugs/knowledgeBase/FaultClassifier.js';

export interface OriginInput {
  faultType: FaultType;
  message: string;
  url?: string;
  statusCode?: number;
  /** Origin of the page under test (protocol + host). When set, a failed request to
   *  a DIFFERENT origin is treated as third-party/environment noise, not an app defect. */
  targetOrigin?: string;
}

export interface OriginVerdict {
  origin: FaultOrigin;
  /** True only when origin === 'TARGET_APP'. */
  isTargetApp: boolean;
  reason: string;
}

// BugSafari's own injected scripts/markers — never the app under test.
const BUGSAFARI_MARKERS = ['[bugsafari', 'bugsafari-inject', '__bugsafari'];

// Playwright / automation-driver artifacts. These fire because the harness closed
// the page, timed out a wait, or aborted an in-flight action — not app faults.
const PLAYWRIGHT_MARKERS = [
  'target page, context or browser has been closed',
  'target closed',
  'browser has been closed',
  'execution context was destroyed',
  'page.goto',
  'page.evaluate',
  'waiting for selector',
  'waiting for locator',
  'locator.',
  'timeout exceeded',
  'timeout of',
  'navigation timeout',
];

// Cancellations — the request was aborted (operator stop, superseded navigation).
const ABORT_MARKERS = [
  'net::err_aborted',
  'err_aborted',
  'request cancelled',
  'request canceled',
  'aborted',
  'canceled',
  'cancelled',
];

// Browser / devtools / extension noise. Benign engine chatter, not app defects.
const BROWSER_NOISE_MARKERS = [
  'resizeobserver loop limit exceeded',
  'resizeobserver loop completed',
  'non-error promise rejection captured',
  'script error.', // cross-origin script error with no detail — unattributable
];
const EXTENSION_URL_PREFIXES = ['chrome-extension://', 'moz-extension://', 'safari-extension://', 'devtools://'];

// Transport / environment failures. The network or host is unreachable/misconfigured;
// the application's own code is not at fault.
const NETWORK_ENV_MARKERS = [
  'err_name_not_resolved',
  'err_internet_disconnected',
  'err_connection_refused',
  'err_connection_reset',
  'err_connection_timed_out',
  'err_connection_closed',
  'err_network_changed',
  'err_address_unreachable',
  'err_timed_out',
  'err_cert_',
  'err_ssl_',
  'err_proxy_connection_failed',
  'dns',
];

function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Attribute a caught fault to its root-cause origin. A fault is only reportable as
 * a genuine defect when this returns TARGET_APP. The check order is deliberate:
 * unambiguous harness/driver artifacts are ruled out first, then browser noise,
 * then transport/third-party failures, and only what survives is the app itself.
 */
export function classifyFaultOrigin(input: OriginInput): OriginVerdict {
  const text = (input.message ?? '').toLowerCase();
  const url = (input.url ?? '').toLowerCase();

  if (includesAny(text, BUGSAFARI_MARKERS) || includesAny(url, BUGSAFARI_MARKERS)) {
    return { origin: 'BUGSAFARI', isTargetApp: false, reason: 'BugSafari instrumentation artifact.' };
  }

  if (includesAny(url, EXTENSION_URL_PREFIXES)) {
    return { origin: 'BROWSER_EXTENSION', isTargetApp: false, reason: 'Browser extension / devtools URL.' };
  }
  if (includesAny(text, BROWSER_NOISE_MARKERS)) {
    return { origin: 'BROWSER_EXTENSION', isTargetApp: false, reason: 'Benign browser/devtools console noise.' };
  }

  if (includesAny(text, PLAYWRIGHT_MARKERS)) {
    return { origin: 'PLAYWRIGHT', isTargetApp: false, reason: 'Automation-driver artifact (closed/timed-out/aborted).' };
  }
  if (includesAny(text, ABORT_MARKERS)) {
    return { origin: 'PLAYWRIGHT', isTargetApp: false, reason: 'Request aborted/cancelled by the harness, not the app.' };
  }

  if (includesAny(text, NETWORK_ENV_MARKERS)) {
    return { origin: 'NETWORK_ENV', isTargetApp: false, reason: 'Transport/environment failure (DNS/TLS/connection).' };
  }

  // A network fault against a DIFFERENT origin than the page under test is third-party
  // (CDN, analytics, ad, payment iframe) — its failure is not a defect in the app.
  if (input.faultType === 'NETWORK' && input.targetOrigin) {
    const faultOrigin = originOf(input.url);
    if (faultOrigin && originOf(input.targetOrigin) && faultOrigin !== originOf(input.targetOrigin)) {
      return { origin: 'NETWORK_ENV', isTargetApp: false, reason: `Third-party host (${faultOrigin}), not the target app.` };
    }
  }

  return { origin: 'TARGET_APP', isTargetApp: true, reason: 'Attributed to the application under test.' };
}
