// ═══════════════════════════════════════════════════════════════
// bugs/finders/reflectionOracle.ts — PAYLOAD-CORRELATED XSS CONFIRMATION
// ═══════════════════════════════════════════════════════════════
// Eliminates the tag-presence false positive: a page that merely *contains* an
// <iframe> or inline <script> is NOT an XSS. A reflected-XSS finding is only
// warranted when the specific INJECTED payload is proven to reach an executable
// context — either it actually executed (execution oracle) or it was reflected
// raw/unescaped into the DOM. A payload echoed back HTML-encoded is proof the app
// sanitized correctly, so it must NOT be flagged.

import type { Page } from 'playwright';
import { scenarioRandom } from '../../domain/scenarios/seededRandom.js';

export type ReflectionVerdict =
  | 'CONFIRMED' // injected payload executed or reflected unescaped → real vulnerability
  | 'SANITIZED' // present only HTML-encoded → app defended correctly, no finding
  | 'ABSENT'; //   not reflected at all → no finding

/** Page-global bag of nonces whose injected payload actually executed. */
const ORACLE_FLAG = '__bgsf_xss_fired';
/** Page-global boolean: an injected XSS vector fired a script sink (alert/confirm/prompt). */
const EXEC_WITNESS = '__bgsf_xss_any';

/**
 * Install the browser-side execution oracle. Proves an injected payload actually
 * executed via two witnesses: (a) an explicit `window.__bgsf_xss('<nonce>')` call
 * ({@link buildXssProbe}), and (b) the common `alert/confirm/prompt` sinks that
 * off-the-shelf XSS vectors call — overridden to set a flag instead of blocking.
 * Must be added before the page navigates/loads. The flag is reset per injection
 * via {@link resetExecutionWitness} so a hit is always correlated to the last payload.
 */
export async function installReflectionOracle(page: Page): Promise<void> {
  await page.addInitScript(`
    (function () {
      window.${ORACLE_FLAG} = window.${ORACLE_FLAG} || {};
      window.${EXEC_WITNESS} = false;
      window.__bgsf_xss = function (nonce) {
        try { window.${ORACLE_FLAG}[String(nonce)] = true; window.${EXEC_WITNESS} = true; } catch (e) { /* noop */ }
      };
      // Off-the-shelf XSS vectors fire these; overriding to a flag both proves
      // execution and stops them blocking the headless run (dialogs are dismissed
      // anyway). Native behavior is otherwise irrelevant to an autonomous tester.
      function witness() { try { window.${EXEC_WITNESS} = true; } catch (e) { /* noop */ } }
      window.alert = witness; window.confirm = function(){ witness(); return true; };
      window.prompt = function(){ witness(); return ''; };
    })();
  `);
}

/** Reset the per-injection execution witness. Call immediately BEFORE injecting a payload. */
export async function resetExecutionWitness(page: Page): Promise<void> {
  try {
    await page.evaluate((flag) => {
      (window as unknown as Record<string, boolean>)[flag] = false;
    }, EXEC_WITNESS);
  } catch {
    /* page may be mid-navigation */
  }
}

/** Payload contains executable markup — required for a raw-reflection CONFIRMED verdict. */
function hasDangerousMarkup(payload: string): boolean {
  return /<\s*(script|img|svg|iframe|object|embed|body|input|details|a|video|source|audio|track)\b|on\w+\s*=|javascript:/i.test(payload);
}

// Normalize markup so a payload that survived unescaped is still matched after the
// browser's HTML round-trip (added attribute quotes, collapsed whitespace, void-tag
// closing, case). Entities are left intact, so escaped output (&lt;…&gt;) never
// matches here — preserving the SANITIZED verdict and the no-false-positive guard.
function normalizeMarkup(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*=\s*/g, '=')
    .replace(/["']/g, '')
    .replace(/\s*<\s*/g, '<')
    .replace(/\s*>\s*/g, '>');
}

/** Unique per-injection marker so reflection is correlated to THIS payload, not ambient markup.
 *  Draws from the scoped seeded PRNG so a seeded replay re-injects the SAME marker (raw
 *  Math.random broke reflection reproducibility); identical Math.random fallback when unseeded. */
export function makeNonce(step: number): string {
  return `BGSF${step}_${Math.floor(scenarioRandom() * 2 ** 31).toString(36)}`;
}

/**
 * Build an XSS probe that both (a) reflects raw and (b) fires the execution oracle
 * on an event handler, embedding the nonce so a positive result is unambiguous.
 */
export function buildXssProbe(nonce: string): string {
  return `<img src=x onerror="window.__bgsf_xss&&window.__bgsf_xss('${nonce}')">`;
}

/** Minimal HTML entity-encoding, matching what a correctly-escaping sink produces. */
function htmlEncode(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Pure decision core (unit-testable without a browser). Given the serialized page
 * HTML, the injected payload, and whether execution was observed, decide the verdict.
 */
export function classifyReflection(params: {
  rawHtml: string;
  payload: string;
  executed: boolean;
}): ReflectionVerdict {
  const { rawHtml, payload, executed } = params;
  if (executed) return 'CONFIRMED'; // strongest proof: the payload ran
  if (!payload) return 'ABSENT';
  // Reflected raw/unescaped AND actually dangerous → the markup is live in the DOM.
  // The markup guard prevents a harmless plain-text reflection reading as a leak.
  // Exact match first; then a normalization-tolerant match so a payload the browser
  // round-tripped (quotes added, whitespace/void-tags normalized) is still caught.
  if (hasDangerousMarkup(payload)) {
    if (rawHtml.includes(payload)) return 'CONFIRMED';
    if (normalizeMarkup(rawHtml).includes(normalizeMarkup(payload))) return 'CONFIRMED';
  }
  // Present only as HTML entities → the sink escaped it correctly.
  const encoded = htmlEncode(payload);
  if (encoded !== payload && rawHtml.includes(encoded)) return 'SANITIZED';
  return 'ABSENT';
}

/**
 * Live confirmation for a just-injected payload: combines the execution oracle
 * (when a nonce probe was used) with a raw-reflection check of the serialized DOM.
 * Never throws — a mid-navigation failure degrades to ABSENT (conservative).
 */
export async function confirmPayloadReflection(
  page: Page,
  payload: string,
  nonce?: string,
): Promise<ReflectionVerdict> {
  let rawHtml = '';
  try {
    rawHtml = await page.content();
  } catch {
    /* page may be mid-navigation */
  }

  let executed = false;
  try {
    executed = await page.evaluate(
      ([firedFlag, witnessFlag, n]) => {
        const win = window as unknown as Record<string, unknown>;
        const bag = win[firedFlag] as Record<string, boolean> | undefined;
        const nonceFired = Boolean(n && bag && bag[n]);
        return nonceFired || win[witnessFlag] === true;
      },
      [ORACLE_FLAG, EXEC_WITNESS, nonce ?? ''] as [string, string, string],
    );
  } catch {
    /* evaluate can fail on a closing page */
  }

  return classifyReflection({ rawHtml, payload, executed });
}
