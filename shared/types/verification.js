// ═══════════════════════════════════════════════════════════════
// shared/types/verification.ts - FINDING VERIFICATION CONTRACT
// ═══════════════════════════════════════════════════════════════
// Shared vocabulary for the finding-verification pipeline. A raw fault caught by
// the engine is only a CANDIDATE; before it is reported it must pass provenance
// (does the root cause belong to the target app?) and evidence scoring. These
// unions are the wire-stable result of that pipeline, carried on FindingAttribution
// so the dashboard and saved history render the same verification verdict.
/** Socket channel carrying in-run reproduction verdicts back to the operator. */
export const REPRODUCTION_VERDICT_EVENT = 'reproduction-verdict';
