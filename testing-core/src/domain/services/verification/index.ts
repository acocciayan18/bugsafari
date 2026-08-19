// ═══════════════════════════════════════════════════════════════
// verification/index.ts — FINDING-VERIFICATION PIPELINE (barrel)
// ═══════════════════════════════════════════════════════════════
// Import verification primitives from here rather than reaching into modules.

export { classifyFaultOrigin, type OriginInput, type OriginVerdict } from './faultOrigin.js';
export { scoreFinding, statusForScore, type ScoreInput, type ScoreResult } from './confidenceScore.js';
export { detectSoftFailBody, isBodyReadableResourceType, isExpectedRejectionEnvelope, isProxyGatewayArtifact, type SoftFailVerdict } from './softFailBody.js';
export {
  VerificationPipeline,
  type VerificationCandidate,
  type VerificationOutcome,
} from './VerificationPipeline.js';
export { NetworkFaultArbiter, type PendingNetworkFault } from './networkFaultArbiter.js';
