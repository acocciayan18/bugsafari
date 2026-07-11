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

export type ReflectionVerdict =
  | 'CONFIRMED' // injected payload executed or reflected unescaped → real vulnerability
  | 'SANITIZED' // present only HTML-encoded → app defended correctly, no finding
  | 'ABSENT'; //   not reflected at all → no finding

/** Page-global bag of nonces whose injected payload actually executed. */
const ORACLE_FLAG = '__bgsf_xss_fired';

/**
 * Install the browser-side execution oracle. Any injected payload that carries a
 * `window.__bgsf_xss('<nonce>')` call (see {@link buildXssProbe}) records positive
 * proof of execution here. Must be added before the page navigates/loads.
 */
export async function installReflectionOracle(page: Page): Promise<void> {
  await page.addInitScript(`
    (function () {
      window.${ORACLE_FLAG} = window.${ORACLE_FLAG} || {};
      window.__bgsf_xss = function (nonce) {
        try { window.${ORACLE_FLAG}[String(nonce)] = true; } catch (e) { /* noop */ }
      };
    })();
  `);
}

/** Unique per-injection marker so reflection is correlated to THIS payload, not ambient markup. */
export function makeNonce(step: number): string {
  return `BGSF${step}_${Math.random().toString(36).slice(2, 8)}`;
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
  // Reflected raw/unescaped → the dangerous markup is live in the DOM.
  if (rawHtml.includes(payload)) return 'CONFIRMED';
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
  if (nonce) {
    try {
      executed = await page.evaluate(
        ([flag, n]) => {
          const bag = (window as unknown as Record<string, Record<string, boolean>>)[flag];
          return Boolean(bag && bag[n]);
        },
        [ORACLE_FLAG, nonce] as [string, string],
      );
    } catch {
      /* evaluate can fail on a closing page */
    }
  }

  return classifyReflection({ rawHtml, payload, executed });
}
