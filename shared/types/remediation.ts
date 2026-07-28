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
}

export type SuggestFixSource = 'ai' | 'fallback';

export interface SuggestFixResponse {
  advice: string;
  source: SuggestFixSource;
}
