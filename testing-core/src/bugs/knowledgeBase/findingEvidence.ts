// ═══════════════════════════════════════════════════════════════
// knowledgeBase/findingEvidence.ts — PROMOTION CONTRACT (pure)
// ═══════════════════════════════════════════════════════════════
// Every promoted finding owes a developer three things: the steps that reproduce
// it, the CWE class it belongs to, and how to fix it. Detectors that self-gate
// (duplicate-action, api-hang) build their own attribution and used to skip parts
// of this. This one funnel fills the gaps from the knowledge base so no promotion
// path can emit an incomplete finding.

import type { FindingAttribution } from '../../../../shared/types.js';
import { BUG_CATALOG } from './bugCatalog.js';
import { refineCwe } from './FaultClassifier.js';
import type { SignalCategory } from './signalPatterns.js';
import type { BugClass } from '../types.js';

/** Fallback class when a detector reports a promotion with no class at all. */
const FALLBACK_BUG_CLASS: BugClass = 'RUNTIME_STABILITY_EXCEPTION';

const MAX_SPECIFIC_PAYLOAD = 80;

/**
 * Prepend a "For this finding" block naming the concrete endpoint / field / payload /
 * location above the generic catalog checklist, so remediation references the actual
 * defect a developer is looking at. Returns the advice unchanged when no facts exist.
 */
function withSpecifics(advice: string, specifics?: FindingSpecifics): string {
  if (!specifics) return advice;
  const lines: string[] = [];
  if (specifics.method || specifics.endpoint) {
    const status = specifics.statusCode !== undefined ? ` (HTTP ${specifics.statusCode})` : '';
    lines.push(`• Address: ${[specifics.method, specifics.endpoint].filter(Boolean).join(' ')}${status}`);
  }
  if (specifics.field) lines.push(`• Field: ${specifics.field}`);
  if (specifics.payload) {
    const p = specifics.payload.length > MAX_SPECIFIC_PAYLOAD ? `${specifics.payload.slice(0, MAX_SPECIFIC_PAYLOAD)}…` : specifics.payload;
    lines.push(`• Value that triggered it: ${p}`);
  }
  if (lines.length === 0) return advice;
  return `For this finding\n${lines.join('\n')}\n\n${advice}`;
}

/**
 * Finding-specific facts used to make the generic catalog remediation concrete —
 * naming the exact endpoint, field, and payload instead of a bare checklist (audit M1).
 * Every field is optional; absent ones are simply omitted. Source locations are kept out:
 * student-facing advice describes the target site, not the target app's internal code.
 */
export interface FindingSpecifics {
  endpoint?: string;
  method?: string;
  statusCode?: number;
  field?: string;
  payload?: string;
}

export interface FindingEvidenceInput {
  attribution: FindingAttribution;
  advice?: string;
  /** Human reproduction steps captured at fault time. */
  reproductionPlaybook: string[];
  /** Fallback context when no steps were captured (endpoint, action, URL…). */
  context?: string;
  /** Concrete facts to fold into the remediation so it references THIS finding. */
  specifics?: FindingSpecifics;
  // Matched signal shapes a self-gating finder knows, so the CWE is refined not defaulted.
  signals?: SignalCategory[];
}

export interface FindingEvidenceResult {
  attribution: FindingAttribution;
  advice: string;
  reproductionPlaybook: string[];
  /** Names the fields this funnel had to fill in — surfaced in debug telemetry. */
  filled: string[];
}

/**
 * Complete a finding's evidence. Never throws and never weakens a detector that
 * already supplied everything — it only fills what is missing.
 */
export function ensureFindingEvidence(input: FindingEvidenceInput): FindingEvidenceResult {
  const filled: string[] = [];
  const bugClass = (input.attribution.bugClass || FALLBACK_BUG_CLASS) as BugClass;
  if (!input.attribution.bugClass) filled.push('bugClass');

  const definition = BUG_CATALOG[bugClass] ?? BUG_CATALOG[FALLBACK_BUG_CLASS];

  // Refine from the matched signal so multi-shape classes get the right CWE; a no-op for
  // single-shape classes and for already-refined classifier/network inputs.
  const cwe = refineCwe(bugClass, input.signals ?? [], input.attribution.cwe || definition.cwe);
  if (!input.attribution.cwe) filled.push('cwe');

  const baseAdvice = (input.advice ?? '').trim() || definition.remediation;
  if (!(input.advice ?? '').trim()) filled.push('advice');
  const advice = withSpecifics(baseAdvice, input.specifics);

  let reproductionPlaybook = input.reproductionPlaybook;
  if (reproductionPlaybook.length === 0) {
    // No interaction was captured — do not present a specific step as if it were verified.
    const where = input.context ? ` on ${input.context}` : ' on the affected page';
    reproductionPlaybook = [
      `Step 1. Unverified: no interaction was recorded before this fault. Reproduce by repeating your last action${where}.`,
    ];
    filled.push('reproductionPlaybook');
  }

  return {
    attribution: { ...input.attribution, bugClass, cwe },
    advice,
    reproductionPlaybook,
    filled,
  };
}
