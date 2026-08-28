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

// A declared server error (error:true) is never an "expected" outcome — its presence
// vetoes rejection-suppression so a genuine masked fault always promotes.
const HARD_FAULT_FLAG = /"(?:is|has)?error"\s*:\s*true/i;
// URL of an auth/session endpoint, where a rejection body is the routine answer.
const AUTH_ENDPOINT = /(log-?in|sign-?in|sign-?up|register|auth|session|token|password|oauth|logout|credential)/i;
// An outcome flag flipped false — the operation logically failed, by design.
const OUTCOME_FALSE = /"(?:success|ok|authenticated|authori[sz]ed|valid|logged-?in)"\s*:\s*false/i;
// A credential/authorization refusal — expected on any endpoint, obfuscated URLs included.
const AUTH_REJECTION = /(invalid|incorrect|wrong)\s+(credential|password|username|email|login|token|user)|invalid\s+credentials|unauthori[sz]ed|forbidden|access\s+denied|not\s+authori[sz]ed|authentication\s+failed|login\s+failed/i;
// A form-validation refusal — only suppresses when paired with a false outcome flag.
const VALIDATION_REJECTION = /(required|must\s+be|too\s+(long|short)|not\s+a\s+valid|already\s+(exists|taken)|does\s+not\s+match|invalid\s+(format|input|value|email))/i;

// An expected negative business outcome — a login denied or a form rejected — is the
// server refusing correctly, not a fault it hid behind a 200. Suppress those so they
// never promote as masked failures; a declared error flag or server-error signature
// (checked by the caller) still promotes, so a real masked 500 is never lost.
export function isExpectedRejectionEnvelope(url: string, body: string): boolean {
  if (!body) return false;
  if (HARD_FAULT_FLAG.test(body)) return false;
  if (AUTH_REJECTION.test(body)) return true;
  if (AUTH_ENDPOINT.test(url) && OUTCOME_FALSE.test(body)) return true;
  return OUTCOME_FALSE.test(body) && VALIDATION_REJECTION.test(body);
}

// A GraphQL endpoint — the spec convention is a single /graphql route (POST, or GET
// with ?query=). Subscriptions and versioned mounts (/api/graphql, /v1/graphql) included.
const GRAPHQL_ENDPOINT = /\/graphql\b|graphql\?/i;
// Canonical GraphQL error shape: an `errors` array whose entries are objects carrying a
// `message`. Bounded gap so a large body cannot force a pathological scan.
const GRAPHQL_ERRORS_SHAPE = /"errors"\s*:\s*\[\s*\{[\s\S]{0,2048}?"message"\s*:/i;
// A top-level `data` key — present (often null) on every spec GraphQL response.
const GRAPHQL_DATA_KEY = /"data"\s*:/i;

// True when a <400 body is a valid GraphQL error response, not a masked backend failure.
// Per the GraphQL spec a 200 carrying field/resolver errors in `errors` is normal. The
// dual gate (spec error shape AND [a data sibling OR a /graphql route]) keeps a REST
// string-array `{"errors":["x"]}` or a REST endpoint's own envelope still flagged.
export function isGraphQLErrorResponse(url: string, body: string): boolean {
  if (!body || !GRAPHQL_ERRORS_SHAPE.test(body)) return false;
  return GRAPHQL_DATA_KEY.test(body) || GRAPHQL_ENDPOINT.test(url);
}

export interface MaskedFailureVerdict {
  softFail: boolean;
  // The fault was dropped only because it is a normal GraphQL error response.
  graphqlInformational: boolean;
  matched?: string;
}

// Finalizes the masked-failure decision for a <400 API body: the raw envelope match (a
// declared error, or a server-error signature the caller detected), minus the two
// suppressions (an expected auth/validation rejection, a normal GraphQL error response).
// A server-error signature (leaked stack, raw SQL/Mongo error) overrides both suppressions
// so a resolver leaking a fault in a 200 body always promotes. Pure, so the promote vs
// suppress decision is unit-testable without a live response.
export function resolveMaskedFailure(input: {
  url: string;
  body: string;
  serverSignature: boolean;
}): MaskedFailureVerdict {
  const verdict = detectSoftFailBody(input.body);
  const raw = verdict.softFail || input.serverSignature;
  if (!raw) return { softFail: false, graphqlInformational: false };
  const expectedRejection = verdict.softFail && !input.serverSignature && isExpectedRejectionEnvelope(input.url, input.body);
  const graphqlNormal = verdict.softFail && !input.serverSignature && isGraphQLErrorResponse(input.url, input.body);
  const softFail = !expectedRejection && !graphqlNormal;
  return {
    softFail,
    graphqlInformational: !softFail && graphqlNormal,
    matched: softFail ? (verdict.matched ?? (input.serverSignature ? 'server-error signature in body' : undefined)) : undefined,
  };
}

// A reverse-proxy / tunnel EDGE emits 502/503/504 when it cannot complete with the
// origin; Cloudflare's 520–527 range is emitted EXCLUSIVELY by its edge (origin dropped,
// timed out, or unreachable) — an origin application never returns 520–527.
function isGatewayStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 527);
}

// Signatures of an EDGE-generated error page (Cloudflare / cloudflared quick tunnel /
// generic gateway), distinct from an origin app's own error body. Matched ONLY against a
// gateway-status response, so an app 500 carrying the app's JSON body is never suppressed.
const EDGE_GATEWAY_BODY =
  /\bcloudflare\b|\bcf-ray\b|\bray id\b|\bbad gateway\b|\bgateway time-?out\b|\berror\s+10\d\d\b|web server is (?:down|returning)|origin (?:is unreachable|web server)|argo tunnel|trycloudflare|cloudflared|this tunnel is/i;

// True when a 5xx was synthesized by the reverse proxy / tunnel EDGE in front of the
// target (Cloudflare / cloudflared quick tunnel), not returned by the target's own
// backend — infrastructure noise, never an application fault. A Cloudflare 520–527 is
// always edge-generated; a 502/503/504 qualifies only when its body is a recognizable
// edge error page, so a genuine origin 5xx (the app's own error body, a bare 500) still
// promotes. Explored-through-a-tunnel runs (SSRF guard) would otherwise report every
// origin connection-drop as a phantom "Server API Failure" on the app.
export function isProxyGatewayArtifact(status: number | undefined, body?: string): boolean {
  if (status === undefined || !isGatewayStatus(status)) return false;
  if (status >= 520 && status <= 527) return true;
  return EDGE_GATEWAY_BODY.test(body ?? '');
}
