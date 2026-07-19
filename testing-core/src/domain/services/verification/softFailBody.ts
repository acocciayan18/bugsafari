// ═══════════════════════════════════════════════════════════════
// verification/softFailBody.ts — MASKED-FAILURE BODY DETECTOR (pure)
// ═══════════════════════════════════════════════════════════════
// A 2xx whose body declares an error is a backend failure the status line hides.
// Detection is adjacency-based: the previous substring test (`includes('"error"')
// && includes('true')`) fired on any payload that merely contained both tokens
// (e.g. `{"error":null,"active":true}`), producing false-positive findings.

// JSON error envelopes, matched by key→value adjacency rather than co-occurrence.
const ENVELOPE_PATTERNS: readonly RegExp[] = [
  /"error"\s*:\s*true/i,
  /"iserror"\s*:\s*true/i,
  /"haserror"\s*:\s*true/i,
  /"success"\s*:\s*false/i,
  /"ok"\s*:\s*false/i,
  /"status"\s*:\s*"(?:fail(?:ed|ure)?|error)"/i,
  /"result"\s*:\s*"(?:fail(?:ed|ure)?|error)"/i,
  /"errors"\s*:\s*\[\s*[^\]\s]/i,
  /"error"\s*:\s*(?:"[^"]+"|\{)/i,
];

// Bodies above this size are non-API payloads (bundles, documents); scanning them
// costs more than the signal is worth and risks matching source text.
export const MAX_SOFT_FAIL_BODY_BYTES = 128 * 1024;

export interface SoftFailVerdict {
  softFail: boolean;
  /** Which pattern fired — carried into the finding as forensic evidence. */
  matched?: string;
}

/** True when an otherwise-successful response body declares a failure. */
export function detectSoftFailBody(body: string): SoftFailVerdict {
  if (!body || body.length > MAX_SOFT_FAIL_BODY_BYTES) return { softFail: false };
  for (const pattern of ENVELOPE_PATTERNS) {
    const hit = pattern.exec(body);
    if (hit) return { softFail: true, matched: hit[0] };
  }
  return { softFail: false };
}

/** True when the response is worth reading a body from at all (API traffic only). */
export function isBodyReadableResourceType(resourceType: string): boolean {
  return resourceType === 'xhr' || resourceType === 'fetch';
}
