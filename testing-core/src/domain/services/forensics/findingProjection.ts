import { resolveSeverity } from '../../../../../shared/types.js';
import { buildFaultSignature } from '../../../../../shared/faultSignature.js';
import type { ConfirmedBug } from '../exploration/types.js';
import type { ICaughtBug } from '../../../infrastructure/database/models/SessionModel.js';
import { buildActionSteps } from './actionStepMapper.js';

// The engine ledger is capped at MAX_CONFIRMED_BUGS (500) and the save path caps the
// embedded array at MAX_EMBEDDED_CAUGHT_BUGS (1000); a merge can only ever union two
// bounded sets, so this ceiling is the union's own backstop, not a new policy.
export const MAX_MERGED_FINDINGS = 1000;

// Per-finding serialized ceiling. Mirrors the ingest-side MAX_FINGERPRINT_BYTES rule:
// stateFingerprint is arbitrary Mixed content lifted from a hostile target, so an
// oversized one is dropped rather than allowed to pressure the 16MB BSON limit.
const MAX_FINGERPRINT_BYTES = 32_000;

function capStateFingerprint(fingerprint: unknown): ICaughtBug['stateFingerprint'] {
  if (!fingerprint || typeof fingerprint !== 'object') return undefined;
  try {
    if (JSON.stringify(fingerprint).length > MAX_FINGERPRINT_BYTES) return undefined;
  } catch {
    return undefined;
  }
  return fingerprint as ICaughtBug['stateFingerprint'];
}

/**
 * Project one engine ledger entry onto the persisted finding shape. Single source of
 * truth for the mapping so an incremental checkpoint and a manual save can never write
 * two different shapes for the same run.
 */
export function toSavedCaughtBug(bug: ConfirmedBug): ICaughtBug {
  return {
    bugId: bug.bugId,
    type: bug.type,
    message: bug.message,
    selector: bug.selector,
    elementLabel: bug.elementLabel ?? '',
    url: bug.url ?? '',
    statusCode: bug.statusCode,
    payloadUsed: bug.payloadUsed,
    advice: bug.advice,
    stackTrace: bug.stackTrace ?? '',
    resolvedStackTrace: bug.resolvedStackTrace ?? '',
    // Authoritative per-finding manifestation count from the ledger, so the saved ×N
    // equals what the operator watched live.
    occurrences: bug.occurrences ?? 1,
    reproductionSteps: Array.isArray(bug.reproductionSteps) ? bug.reproductionSteps : [],
    // Per-finding minimized replay timeline; empty means the verifier falls back to
    // the session-global actionSteps.
    actionSteps: buildActionSteps(Array.isArray(bug.reproductionActions) ? bug.reproductionActions : []),
    timestamp: bug.timestamp,
    attribution: bug.attribution,
    stateFingerprint: capStateFingerprint(bug.stateFingerprint),
    bypass: bug.bypass,
    severity: resolveSeverity({
      severity: bug.severity,
      bugClass: bug.attribution?.bugClass,
      confidence: bug.attribution?.confidence,
      verificationStatus: bug.attribution?.verificationStatus,
    }),
  };
}

/** Findings carrying a usable identity; anything without a bugId cannot be merged. */
function keyOf(bug: ICaughtBug): string {
  return typeof bug.bugId === 'string' ? bug.bugId.trim() : '';
}

/**
 * Union two finding sets by bugId, server record winning per field.
 *
 * The server checkpoint is written by the engine that actually observed the fault, so
 * it is authoritative wherever both sides describe the same bugId. The client set is
 * still unioned in rather than discarded: the engine ledger evicts under its own cap
 * and a client can legitimately hold a finding the checkpoint no longer carries.
 * `occurrences` takes the max because both sides track a monotonic running total.
 *
 * Order is server-first, then client-only findings in arrival order, so the persisted
 * array stays stable across repeated saves of the same run.
 */
export function unionFindingsByBugId(server: ICaughtBug[], client: ICaughtBug[]): ICaughtBug[] {
  const merged = new Map<string, ICaughtBug>();
  const unkeyed: ICaughtBug[] = [];

  for (const bug of server) {
    const key = keyOf(bug);
    if (key) merged.set(key, bug);
    else unkeyed.push(bug);
  }

  for (const bug of client) {
    const key = keyOf(bug);
    if (!key) {
      unkeyed.push(bug);
      continue;
    }
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, bug);
      continue;
    }
    merged.set(key, {
      ...existing,
      occurrences: Math.max(existing.occurrences ?? 1, bug.occurrences ?? 1),
    });
  }

  return [...merged.values(), ...unkeyed].slice(0, MAX_MERGED_FINDINGS);
}

/**
 * Canonical fault identity — the SAME shared normalization + field set the live dashboard
 * groups by (errorDeduplication.liveFaultSignature). Keying the save-time collapse on this
 * makes the persisted findingCount equal the distinct-family count the operator watched live;
 * the older type+selector key split one family across its culprit controls (History > Live).
 */
export function canonicalFindingSignature(bug: Pick<ICaughtBug, 'message' | 'url' | 'stackTrace' | 'statusCode'>): string {
  return buildFaultSignature({
    reason: bug.message,
    url: bug.url,
    stackTrace: bug.stackTrace,
    statusCode: bug.statusCode,
  });
}

/**
 * Collapse duplicate findings into one representative per fault family, SUMMING each
 * instance's authoritative manifestation count (never a raw +1), so the saved ×N equals
 * the live one. The engine ledger still retains every instance for telemetry; only the
 * persisted, operator-facing set is collapsed. First entry wins as the representative.
 */
export function dedupeCaughtBugsBySignature(bugs: ICaughtBug[]): ICaughtBug[] {
  const groups = new Map<string, ICaughtBug>();
  for (const bug of bugs) {
    const key = canonicalFindingSignature(bug);
    const existing = groups.get(key);
    const count = bug.occurrences ?? 1;
    if (existing) existing.occurrences = (existing.occurrences ?? 1) + count;
    else groups.set(key, { ...bug, occurrences: count });
  }
  return [...groups.values()];
}
