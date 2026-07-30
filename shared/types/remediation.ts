// Contract for the on-demand AI remediation endpoint (POST /api/findings/suggest-fix).
// The saved Forensic Report sends a finding's fault context plus the deterministic
// knowledge-base advice; the server returns an LLM-generated fix, or that same
// advice as fallback when the model is unavailable.

export interface SuggestFixRequest {
  bugClass?: string;
  message?: string;
  severity?: string;
  cwe?: string;
  elementLabel?: string;
  stackTrace?: string;
  payloadUsed?: string;
  reproductionSteps?: string[];
  // Deterministic remediation already shown for this finding — the guaranteed fallback.
  fallbackAdvice?: string;
  // When both are present the AI result is persisted onto the saved finding (survives refresh).
  sessionId?: string;
  bugId?: string;
}

export type SuggestFixSource = 'ai' | 'fallback';

// Why the model was not used — set only when `source` is 'fallback', so the operator
// sees a cause instead of a generic failure. Never carries provider text or secrets.
export type RemediationFailureReason =
  | 'not_configured'
  | 'auth'
  | 'rate_limited'
  | 'model_unavailable'
  | 'bad_request'
  | 'provider_error'
  | 'timeout'
  | 'network'
  | 'invalid_response'
  | 'empty_response';

export interface SuggestFixResponse {
  advice: string;
  source: SuggestFixSource;
  reason?: RemediationFailureReason;
}

// Session-level AI Insights — on-demand LLM summary of a saved run, persisted so it
// survives refresh. Falls back to the deterministic templated analysis on failure.
export interface SuggestInsightsRequest {
  sessionId: string;
  riskLevel?: string;
  fallbackRootCause?: string;
  fallbackRecommendations?: string[];
  // Compact finding set the model reasons over.
  findings?: Array<{ bugClass?: string; severity?: string; message?: string; elementLabel?: string }>;
}

export interface SuggestInsightsResponse {
  rootCause: string;
  recommendations: string[];
  source: SuggestFixSource;
  reason?: RemediationFailureReason;
}
