// ═══════════════════════════════════════════════════════════════
// shared/types/verification.ts - FINDING VERIFICATION CONTRACT
// ═══════════════════════════════════════════════════════════════
import type { FaultSeverity } from './bug.js';

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
  | 'THIRD_PARTY_SDK' // Embedded vendor SDK noise (Facebook widget, chat/analytics) — the widget's error, not the app's.
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

/** Socket channel carrying in-run reproduction verdicts back to the operator. */
export const REPRODUCTION_VERDICT_EVENT = 'reproduction-verdict' as const;

/**
 * Result of the in-run reproduction pass for one finding, emitted once its replay
 * settles. Arrives AFTER the finding itself — the dashboard patches the matching
 * card by `bugId` rather than rendering a new one.
 */
export interface ReproductionVerdict {
  bugId: string;
  /** True ⇒ the original fault class recurred on at least one replay. */
  reproduced: boolean;
  stepsReplayed: number;
  /** Re-graded confidence after applying the reproduction delta. */
  confidenceScore: number;
  verificationStatus: VerificationStatus;
  /** Reproductions ÷ decidable replays (0–1). 1 = deterministic, <1 = intermittent flake. */
  reproductionRate?: number;
  /** Number of decidable replay attempts behind {@link reproductionRate}. */
  attempts?: number;
}

/** Socket channel carrying an in-run severity/verdict upgrade for an already-reported finding. */
export const FINDING_UPGRADE_EVENT = 'finding-upgrade' as const;

/**
 * A later, stronger judgement of a finding whose card already exists (e.g. a
 * duplicate-action defect that rose SUSPECTED → CONFIRMED once its control was
 * correlated). Emitted ONLY on a genuine upgrade, never on a plain recurrence, so the
 * live/History card's severity and message never lag the final verdict. The dashboard
 * patches the matching card by `bugId` in place rather than rendering a second one.
 */
export interface FindingUpgrade {
  bugId: string;
  severity: FaultSeverity;
  message: string;
  confidence?: FaultConfidence;
  confidenceScore?: number;
  verificationStatus?: VerificationStatus;
}

/** Socket channel carrying an authoritative occurrence-count update for an already-reported finding. */
export const FINDING_OCCURRENCE_EVENT = 'finding-occurrence' as const;

/**
 * Authoritative repeat count for a finding whose card already exists. Emitted ONLY when a
 * finder verifies the SAME signature genuinely recurred — never on duplicate telemetry (the
 * forensic→incident twin), a reconnect replay, or an engine retry. `occurrences` is the
 * running total (not a delta); the dashboard patches the matching card's ×N by `bugId` and
 * never accumulates from event arrival, so replaying the same patch is idempotent.
 */
export interface FindingOccurrencePatch {
  bugId: string;
  occurrences: number;
}

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
