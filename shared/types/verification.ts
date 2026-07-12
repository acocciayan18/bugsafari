// ═══════════════════════════════════════════════════════════════
// shared/types/verification.ts - FINDING VERIFICATION CONTRACT
// ═══════════════════════════════════════════════════════════════
// Shared vocabulary for the finding-verification pipeline. A raw fault caught by
// the engine is only a CANDIDATE; before it is reported it must pass provenance
// (does the root cause belong to the target app?) and evidence scoring. These
// unions are the wire-stable result of that pipeline, carried on FindingAttribution
// so the dashboard and saved history render the same verification verdict.

/** Where a caught fault actually originates — only TARGET_APP is a real defect. */
export type FaultOrigin =
  | 'TARGET_APP' // A genuine fault in the application under test.
  | 'BUGSAFARI' // Artifact of BugSafari's own instrumentation / injected scripts / operator stop.
  | 'PLAYWRIGHT' // Automation-driver artifact (closed context, navigation/wait timeout, aborted action).
  | 'BROWSER_EXTENSION' // Browser/devtools/extension noise (ResizeObserver loop, extension URL).
  | 'NETWORK_ENV' // Transport/environment failure (DNS, TLS, connection refused, third-party host).
  | 'TIMING' // Transient timing/race artifact that did not reproduce.
  | 'UNKNOWN'; // Could not be attributed — reportable only as NEEDS_VERIFICATION.

/** Evidence strength behind a classified bug class (mirrors the knowledge-base classifier). */
export type FaultConfidence = 'CONFIRMED' | 'SIGNAL' | 'INFERRED';

/** Terminal verification state assigned to every candidate finding. */
export type VerificationStatus =
  | 'CONFIRMED' // Target-app defect with sufficient, corroborated evidence.
  | 'NEEDS_VERIFICATION' // Plausibly real but under-evidenced; needs a reproduction pass.
  | 'INCONCLUSIVE'; // Evidence too weak / origin uncertain to report as a bug.

/** Verification verdict attached to a finding once the pipeline has evaluated it. */
export interface VerificationVerdict {
  status: VerificationStatus;
  /** Normalized 0–1 confidence score that produced {@link status}. */
  score: number;
  origin: FaultOrigin;
  confidence: FaultConfidence;
  /** True when a second signal/channel or a repeat occurrence corroborated the fault. */
  corroborated: boolean;
  /** Human-readable one-line justification (safe to surface in telemetry). */
  reason: string;
}
