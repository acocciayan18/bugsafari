// Contract for the on-demand AI remediation endpoint (POST /api/findings/suggest-fix).
// The saved Forensic Report sends a finding's fault context plus the deterministic
// knowledge-base advice; the server returns an LLM-generated fix, or that same
// advice as fallback when the model is unavailable.
export {};
