// ═══════════════════════════════════════════════════════════════
// verification/reproductionGate.ts — REPLAY GATE POLICY (pure)
// ═══════════════════════════════════════════════════════════════
// Single owner of the rule "a finding may be CONFIRMED only if a replay re-observed
// it, or it is a self-evident class that needs no replay". Mirrors the
// securityEvidenceGate pattern: one place decides, both scoring chokepoints reuse it.

import type { ReproductionState } from '../../../../../shared/types.js';
import type { FaultType } from '../../../bugs/knowledgeBase/FaultClassifier.js';

// Re-export the wire type so verification callers import the policy and its vocabulary together.
export type { ReproductionState };

// Inputs that decide exemption when no replay verdict exists yet.
export interface ReproductionGateInput {
  faultType: FaultType;
  statusCode?: number;
  hasStackTrace?: boolean;
  // Oracle-confirmed, non-replayable findings (reflected XSS, behavioral-proof security).
  oracleProof?: boolean;
}

// True ⇒ HTTP status in the 5xx server-error band.
function is5xx(statusCode: number | undefined): boolean {
  return typeof statusCode === 'number' && statusCode >= 500 && statusCode <= 599;
}

// A self-evident fault needs no replay to be trusted: an uncaught exception with a
// stack, a server 5xx, or an oracle finding that carries its own proof and never replays.
export function isExempt(input: ReproductionGateInput): boolean {
  if (input.oracleProof) return true;
  if (input.faultType === 'EXCEPTION' && input.hasStackTrace) return true;
  if (input.faultType === 'NETWORK' && is5xx(input.statusCode)) return true;
  return false;
}

// Map a candidate + optional settled rate onto its reproduction state. A defined rate
// is authoritative (a settled negative demotes even an exempt class); an undefined rate
// means the replay has not settled, so an exempt class stays trusted and everything
// else is pending.
export function reproductionStateFor(input: ReproductionGateInput, rate?: number): ReproductionState {
  if (rate !== undefined) return rate > 0 ? 'REPRODUCED' : 'NOT_REPRODUCED';
  return isExempt(input) ? 'EXEMPT' : 'PENDING';
}

// The gate is on by default; set BUGSAFARI_REPLAY_GATE=false|0 to fall back to
// advisory-only scoring. Read at call sites so confidenceScore stays pure.
export function replayGateEnabled(): boolean {
  const flag = process.env.BUGSAFARI_REPLAY_GATE;
  return flag !== 'false' && flag !== '0';
}
