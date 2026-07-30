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
import {
  ABORT_PATTERNS,
  BROWSER_NOISE_MARKERS,
  BUGSAFARI_MARKERS,
  ENVIRONMENT_TRANSPORT_MARKERS,
  EXTENSION_URL_PREFIXES,
  HOST_DEPENDENT_TRANSPORT_MARKERS,
  PLAYWRIGHT_MARKERS,
  THIRD_PARTY_SDK_MARKERS,
} from '../../../../../shared/types.js';
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

// The marker vocabulary lives in shared/types/telemetryRouting.ts so provenance
// (whose code is at fault) and routing (which surface it belongs on) can never
// disagree about what a DNS failure, an abort, or a driver artifact looks like.

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

  // Embedded vendor SDK (Facebook widget, chat, analytics) logging its own caught
  // error. No URL host to compare — matched by unmistakable message/stack signature
  // so a page's social/chat widget can't be reported as the app's own exception.
  if (includesAny(text, THIRD_PARTY_SDK_MARKERS) || includesAny(url, THIRD_PARTY_SDK_MARKERS)) {
    return { origin: 'THIRD_PARTY_SDK', isTargetApp: false, reason: 'Embedded third-party SDK (social/chat/analytics widget) error, not the application under test.' };
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
