// ═══════════════════════════════════════════════════════════════
// knowledgeBase/signalPatterns.ts — CONSOLIDATED RUNTIME-SIGNAL LIBRARY
// ═══════════════════════════════════════════════════════════════
// Single source of truth for the regex/selector signatures that indicate a
// runtime fault. Previously these arrays were duplicated across the (dormant)
// bug-finder modules — identical redirect/crash patterns lived in both
// structuralNavigation.ts and structuralProbe.ts, freeze selectors in
// networkSaboteur.ts, XSS/NoSQL signatures in fuzzGuard.ts. They now live here.
//
// All regexes are case-insensitive and NON-global on purpose: `.test()` on a
// global (`/g`) regex is stateful (advances `lastIndex`), which makes shared
// pattern objects give inconsistent results across calls. Presence testing does
// not need `/g`, so every pattern is `/…/i`.

/** Named categories of runtime signal, referenced by the scenario catalog + classifier. */
export type SignalCategory =
  | 'REDIRECT_LOOP'
  | 'DEAD_END'
  | 'CLIENT_CRASH'
  | 'COMPONENT_FAIL'
  | 'SERVER_ERROR'
  | 'NOSQL_ERROR'
  | 'XSS_REFLECTION'
  | 'QUERY_MUTATION';

/**
 * Regex signatures per category. Consumers decide which text source to test a
 * category against (URL vs. page content vs. error message) — see FaultClassifier.
 */
export const SIGNAL_PATTERNS: Record<SignalCategory, readonly RegExp[]> = {
  // Navigation loops (URL + content).
  REDIRECT_LOOP: [
    /redirected/i,
    /too many redirects/i,
    /redirect loop/i,
    /ERR_TOO_MANY_REDIRECTS/i,
  ],
  // Dead-ends / broken routes (URL + content).
  DEAD_END: [
    /not found/i,
    /404/i,
    /cannot get/i,
    /failed to load/i,
    /network error/i,
    /page not found/i,
  ],
  // Client-side JavaScript crashes (error message + content).
  CLIENT_CRASH: [
    /cannot read propert(y|ies)/i,
    /is not defined/i,
    /undefined is not (a|an)? ?(function|object)?/i,
    /null is not (a|an) (function|object)/i,
    /is not a function/i,
    /script error/i,
    /chunk.*not found/i,
    /maximum call stack/i,
  ],
  // SPA component/module resolution failures (content). NOTE: "is not a function"
  // is deliberately NOT here — it is a runtime crash signature (see CLIENT_CRASH),
  // not a module-resolution one, and its presence here mislabelled plain client
  // crashes as navigation/component failures.
  COMPONENT_FAIL: [
    /cannot read propert(y|ies) .* of undefined/i,
    /failed to resolve/i,
    /module not found/i,
    /chunk.*not found/i,
    /loading (chunk|failed)/i,
  ],
  // Server-side collapse (error message + response body + status text).
  SERVER_ERROR: [
    /500\s+internal server error/i,
    /internal server error/i,
    /service unavailable/i,
    /bad gateway/i,
    /gateway timeout/i,
    /database error/i,
    /sql execution failed/i,
    /fatal error/i,
    /segmentation fault/i,
    /uncaught exception/i,
  ],
  // NoSQL / MongoDB injection leakage (error message + response body).
  NOSQL_ERROR: [
    /MongoError/i,
    /BSON/i,
    /\$ne[^a-z]/i,
    /\$gt[^a-z]/i,
    /\$lt[^a-z]/i,
    /\$where/i,
    /\$regex/i,
    /no\s+cursor/i,
    /invalid\s+modifiers/i,
    /unrecognized/i,
    /dollar.*operator/i,
    /modifier.*must/i,
  ],
  // Reflected XSS signatures (page content).
  XSS_REFLECTION: [
    /<script[^>]*>.*?<\/script>/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /<img[^>]+onerror=/i,
    /<svg[^>]+onload=/i,
    /eval\s*\(/i,
    /<iframe[^>]*>/i,
    /<embed[^>]*>/i,
    /<object[^>]*>/i,
  ],
  // Malformed query-string mutation (URL only — these tokens appear legitimately in content).
  QUERY_MUTATION: [
    /%3D/i,
    /%26/i,
    /undefined/i,
    /null/i,
    /NaN/i,
  ],
};

/** Returns true when any pattern in the category matches the supplied text. */
export function matchesCategory(category: SignalCategory, text: string): boolean {
  if (!text) return false;
  return SIGNAL_PATTERNS[category].some((pattern) => pattern.test(text));
}

// ─────────────────────────────────────────────────────────────
// DOM selector catalogs (browser-side).
// These are STRINGS evaluated inside the target page. Pass them into
// page.evaluate() as arguments — Node module closures are NOT visible inside
// the browser context, so referencing them directly there silently no-ops.
// ─────────────────────────────────────────────────────────────

/** Selectors whose presence indicates a stuck/frozen loading state. */
export const FREEZE_SELECTORS: readonly string[] = [
  '[aria-busy="true"]',
  '.loading',
  '.spinner',
  '.infinite-spinner',
  '[data-loading="true"]',
  '.skeleton',
  '[class*="skeleton"]',
  '[data-skeleton="true"]',
  '.overlay',
  '.modal-overlay',
  '[class*="overlay"]',
  '[class*="backdrop"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  '[role="progressbar"]',
];

/** Input selectors whose disabled state indicates a UI blocked by a stuck request. */
export const INPUT_BLOCK_SELECTORS: readonly string[] = [
  'input[aria-disabled="true"]',
  'textarea[aria-disabled="true"]',
  'select[aria-disabled="true"]',
  'input[disabled]',
  'textarea[disabled]',
  'select[disabled]',
];
