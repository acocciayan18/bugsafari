// ═══════════════════════════════════════════════════════════════
// verification/apiContractBody.ts — API-CONTRACT BODY DETECTOR (pure)
// ═══════════════════════════════════════════════════════════════
// A schema-level check for API_CONTRACT_VIOLATION: catches a wrong-shape response
// from the response itself, so the violation reproduces even when a fix makes the
// client swallow the JSON.parse error the fault was first caught by. Deliberately
// two unambiguous rules only, so a correctly-shaped API response is never flagged.

import { MAX_SOFT_FAIL_BODY_BYTES } from './softFailBody.js';

// A full HTML document (SPA index / error page) served to an API call — NOT any
// `<tag>`, so legitimate HTML-fragment xhrs (htmx-style) do not trip the check.
const HTML_DOCUMENT = /^<(?:!doctype\s+html|html[\s>])/i;

export interface ApiContractVerdict {
  violation: boolean;
  /** Which rule fired — carried into the finding as forensic evidence. */
  matched?: string;
}

/** True when a supposedly-JSON API response returned a shape it never should. */
export function detectApiContractViolation(contentType: string, body: string): ApiContractVerdict {
  if (!body || body.length > MAX_SOFT_FAIL_BODY_BYTES) return { violation: false };
  const trimmed = body.trimStart(); // trimStart also drops a leading BOM (U+FEFF)
  if (!trimmed) return { violation: false };

  // Rule 1: server labelled it JSON but sent a body that does not parse as JSON.
  if (/\bjson\b/i.test(contentType) && !isParseableJson(body)) {
    return { violation: true, matched: 'Content-Type declared JSON but the body did not parse as JSON' };
  }
  // Rule 2: a whole HTML document returned to a JSON API call.
  if (HTML_DOCUMENT.test(trimmed)) {
    return { violation: true, matched: 'HTML document returned where a JSON API response was expected' };
  }
  return { violation: false };
}

function isParseableJson(body: string): boolean {
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}
