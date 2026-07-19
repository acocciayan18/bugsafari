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
  /** Origin of the app under test. Enables first-party vs third-party transport attribution. */
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
// Anchored to net-error tokens / explicit request phrasing: a bare "cancelled" also
// appears in legitimate app errors ("Payment cancelled by gateway"), which must not
// be silently attributed to the harness.
const ABORT_PATTERNS = [
  /net::err_aborted/,
  /\berr_aborted\b/,
  /\brequest (?:was )?(?:cancell?ed|aborted)\b/,
  /\b(?:operation|action|navigation) (?:was )?(?:cancell?ed|aborted)\b/,
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
// Environmental regardless of which host they hit: no network, broken DNS,
// misconfigured TLS/proxy. Never the application's own code.
const ENVIRONMENT_TRANSPORT_MARKERS = [
  'err_name_not_resolved',
  'err_name_resolution_failed',
  'err_internet_disconnected',
  'err_network_changed',
  'err_address_unreachable',
  'err_cert_',
  'err_ssl_',
  'err_proxy_connection_failed',
];

// Transport failures whose meaning depends on WHO failed. Against a third-party host
// they are environment noise; against the app's own backend they ARE the defect — the
// server crashed, hung past its timeout, or dropped the connection. Suppressing these
// unconditionally hid the most severe class of API failure.
const HOST_DEPENDENT_TRANSPORT_MARKERS = [
  'err_connection_refused',
  'err_connection_reset',
  'err_connection_closed',
  'err_connection_aborted',
  'err_connection_failed',
  'err_connection_timed_out',
  'err_timed_out',
  'err_empty_response',
  'err_response_headers_truncated',
  'err_http2_protocol_error',
];

function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

function matchesAny(haystack: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(haystack));
}

// Registrable-ish host key (last two labels) so api.example.com === example.com.
function hostKey(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase().split('.').slice(-2).join('.');
  } catch {
    return '';
  }
}

// Relationship between the failing URL and the app under test.
function relationship(url: string | undefined, targetOrigin: string | undefined): 'FIRST_PARTY' | 'THIRD_PARTY' | 'UNKNOWN' {
  const a = hostKey(url);
  const b = hostKey(targetOrigin);
  if (!a || !b) return 'UNKNOWN';
  return a === b ? 'FIRST_PARTY' : 'THIRD_PARTY';
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

  // Driver prose ("waiting for locator", "navigation timeout") is produced by Playwright's
  // own API, never by a network event. Applying it to NETWORK faults suppressed genuine
  // backend timeouts whose reason string merely contains the word "timeout".
  if (input.faultType !== 'NETWORK' && includesAny(text, PLAYWRIGHT_MARKERS)) {
    return { origin: 'PLAYWRIGHT', isTargetApp: false, reason: 'Automation-driver artifact (closed/timed-out/aborted).' };
  }
  if (matchesAny(text, ABORT_PATTERNS)) {
    return { origin: 'PLAYWRIGHT', isTargetApp: false, reason: 'Request aborted/cancelled by the harness, not the app.' };
  }

  if (includesAny(text, ENVIRONMENT_TRANSPORT_MARKERS)) {
    return { origin: 'NETWORK_ENV', isTargetApp: false, reason: 'Transport/environment failure (DNS/TLS/proxy).' };
  }

  const party = relationship(input.url, input.targetOrigin);

  // Host-dependent transport failure: first-party ⇒ the backend itself is down or hung,
  // which is the defect. Third-party/unattributable ⇒ environment.
  if (includesAny(text, HOST_DEPENDENT_TRANSPORT_MARKERS)) {
    return party === 'FIRST_PARTY'
      ? { origin: 'TARGET_APP', isTargetApp: true, reason: "The application's own backend refused, reset, or timed out the request." }
      : { origin: 'NETWORK_ENV', isTargetApp: false, reason: 'Transport failure against a third-party host.' };
  }

  // A third-party endpoint returning an error is that vendor's fault, not the app's.
  if (input.faultType === 'NETWORK' && party === 'THIRD_PARTY') {
    return { origin: 'NETWORK_ENV', isTargetApp: false, reason: 'Failure originated from a third-party host, not the application under test.' };
  }

  return { origin: 'TARGET_APP', isTargetApp: true, reason: 'Attributed to the application under test.' };
}
