// ═══════════════════════════════════════════════════════════════
// verification/index.ts — FINDING-VERIFICATION PIPELINE (barrel)
// ═══════════════════════════════════════════════════════════════
// Import verification primitives from here rather than reaching into modules.

export { classifyFaultOrigin, type OriginInput, type OriginVerdict } from './faultOrigin.js';
export { scoreFinding, type ScoreInput, type ScoreResult } from './confidenceScore.js';
export {
  VerificationPipeline,
  type VerificationCandidate,
  type VerificationOutcome,
} from './VerificationPipeline.js';
