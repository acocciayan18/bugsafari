// ═══════════════════════════════════════════════════════════════
// verification/VerificationPipeline.ts — CANDIDATE → VERDICT GATE
// ═══════════════════════════════════════════════════════════════
// One instance per exploration run. Every raw fault caught by StabilityMonitor is
// a CANDIDATE that must pass this gate before it becomes a reported finding:
//   1. Provenance — is the root cause the target app? (artifacts are rejected)
//   2. Correlation — has the same signature recurred, or does a second channel
//      corroborate it within a short window? (consistency check)
//   3. Scoring — evidence strength → 0–1 score → CONFIRMED / NEEDS_VERIFICATION /
//      INCONCLUSIVE.
// A rejected candidate is surfaced as informational telemetry only, never as a
// bug — eliminating false positives from BugSafari, Playwright, the browser,
// timing, network, and the environment while preserving genuine coverage.

import type { FaultConfidence, VerificationVerdict } from '../../../../../shared/types.js';
import type { FaultType } from '../../../bugs/knowledgeBase/FaultClassifier.js';
import { classifyFaultOrigin } from './faultOrigin.js';
import { scoreFinding } from './confidenceScore.js';

export interface VerificationCandidate {
  faultType: FaultType;
  message: string;
  confidence: FaultConfidence;
  url?: string;
  statusCode?: number;
  content?: string;
  /** Present evidence artifacts — drives the evidence-completeness component of the score. */
  evidence?: {
    hasMessage?: boolean;
    hasStackTrace?: boolean;
    hasReproductionSteps?: boolean;
    hasSelector?: boolean;
    hasStatusCode?: boolean;
  };
  /** Result of an out-of-band reproduction pass, when one has already run. */
  reproduced?: boolean;
}

export interface VerificationOutcome extends VerificationVerdict {
  /** True ⇒ report the finding (persist + register). False ⇒ informational telemetry only. */
  report: boolean;
  /** How many times this fault signature has been observed this run (incl. this one). */
  seenCount: number;
}

// Window within which a second, different-channel fault corroborates this one.
const CORRELATION_WINDOW_MS = 3000;
// Cap the recent-fault ring buffer so a long run can't grow it unbounded.
const RECENT_FAULTS_CAP = 64;

interface RecentFault {
  faultType: FaultType;
  urlKey: string;
  at: number;
}

/** Collapse volatile tokens so the same logical fault shares one signature. */
function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/\d{4,}/g, '#') // ids, timestamps, ports
    .replace(/0x[0-9a-f]+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function urlKey(url: string | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split('?')[0] ?? url;
  }
}

function evidenceCompleteness(candidate: VerificationCandidate): number {
  const e = candidate.evidence;
  if (!e) return 0;
  const flags = [e.hasMessage, e.hasStackTrace, e.hasReproductionSteps, e.hasSelector, e.hasStatusCode];
  const present = flags.filter(Boolean).length;
  return present / flags.length;
}

export class VerificationPipeline {
  private readonly seen = new Map<string, number>();
  private readonly recent: RecentFault[] = [];

  constructor(private readonly nowMs: () => number = () => Date.now()) {}

  /** Evaluate one candidate fault and return its verification verdict + report decision. */
  public evaluate(candidate: VerificationCandidate): VerificationOutcome {
    const originVerdict = classifyFaultOrigin({
      faultType: candidate.faultType,
      message: candidate.message,
      url: candidate.url,
      statusCode: candidate.statusCode,
    });

    const signature = `${candidate.faultType}|${normalizeMessage(candidate.message)}|${candidate.statusCode ?? ''}`;
    const seenCount = (this.seen.get(signature) ?? 0) + 1;
    this.seen.set(signature, seenCount);

    const now = this.nowMs();
    const key = urlKey(candidate.url);
    const crossChannel = this.recent.some(
      (r) => r.faultType !== candidate.faultType && r.urlKey === key && key !== '' && now - r.at <= CORRELATION_WINDOW_MS,
    );
    this.recordRecent({ faultType: candidate.faultType, urlKey: key, at: now });

    // Corroboration: the same fault recurred, OR a different channel flagged the same URL.
    const corroborated = seenCount >= 2 || crossChannel;

    // An identified artifact origin is never a defect — reject before scoring.
    if (!originVerdict.isTargetApp && originVerdict.origin !== 'UNKNOWN') {
      return {
        report: false,
        status: 'INCONCLUSIVE',
        score: 0,
        origin: originVerdict.origin,
        confidence: candidate.confidence,
        corroborated,
        seenCount,
        reason: originVerdict.reason,
      };
    }

    const { score, status } = scoreFinding({
      confidence: candidate.confidence,
      origin: originVerdict.origin,
      evidenceCompleteness: evidenceCompleteness(candidate),
      corroborated,
      reproduced: candidate.reproduced,
    });

    return {
      report: true,
      status,
      score,
      origin: originVerdict.origin,
      confidence: candidate.confidence,
      corroborated,
      seenCount,
      reason:
        status === 'CONFIRMED'
          ? `${originVerdict.reason} Evidence sufficient (score ${score}).`
          : status === 'NEEDS_VERIFICATION'
            ? `${originVerdict.reason} Under-evidenced (score ${score}) — reproduction recommended.`
            : `${originVerdict.reason} Evidence weak (score ${score}).`,
    };
  }

  private recordRecent(fault: RecentFault): void {
    this.recent.push(fault);
    if (this.recent.length > RECENT_FAULTS_CAP) this.recent.shift();
  }
}
