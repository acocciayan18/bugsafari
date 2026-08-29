import { resolveSeverity, worstSeverity } from '../../../../../shared/types.js';
import { buildFaultSignature } from '../../../../../shared/faultSignature.js';
import { collapseFindings, type CollapseAdapter, type FindingOrigin } from '../../../../../shared/findingCollapse.js';
import { isReportableFinding } from '../../../../../shared/findingRouting.js';
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
      // Carry statusCode so a 5xx escalates to >=HIGH here exactly as it does live —
      // otherwise a saved network fault renders one tier below its live twin.
      statusCode: bug.statusCode,
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

// One wrapper carrying each finding's provenance so the shared collapse applies the
// occurrence contract "sum within origin, max across origins" — a fault's server ledger
// entries and its client twin describe the SAME events, so summing both is the ×2
// doubling; the max keeps distinct within-origin manifestations (15 identical 500s ⇒ ×15).
interface OriginBug {
  bug: ICaughtBug;
  origin: FindingOrigin;
}

const caughtBugCollapseAdapter: CollapseAdapter<OriginBug> = {
  signatureInput: (t) => ({ reason: t.bug.message, url: t.bug.url, stackTrace: t.bug.stackTrace, statusCode: t.bug.statusCode }),
  // Group by bugId OR signature (the SAME union the live tab uses): the server ledger record
  // and the client payload record of one fault share a bugId even when their signatures drift,
  // so they collapse into ONE saved finding instead of two — the History>Live duplicate. The
  // origin tag still prevents a shared-events server/client twin from double-counting.
  identityKeys: (t) => [(t.bug.bugId ?? '').trim(), canonicalFindingSignature(t.bug)],
  representative: (t) => ({ reproductionSteps: t.bug.reproductionSteps, timestamp: t.bug.timestamp }),
  origin: (t) => t.origin,
  occurrences: (t) => t.bug.occurrences ?? 1,
  withOccurrences: (t, occurrences) => ({ bug: { ...t.bug, occurrences }, origin: t.origin }),
  // Canonical fields across the family: worst resolved severity so a CONFIRMED-High twin
  // is never hidden behind an unverified-Medium one, and a single non-empty culprit pair
  // (label + its own selector) so the Element never drifts between members. The picker
  // chooses on reproduction richness alone, so without this the fields would ride along
  // from whichever twin happened to win — the drift the live view showed.
  reconcile: (rep, members) => {
    const severity = worstSeverity(members.map((m) => resolveSeverity({
      severity: m.bug.severity,
      bugClass: m.bug.attribution?.bugClass,
      confidence: m.bug.attribution?.confidence,
      verificationStatus: m.bug.attribution?.verificationStatus,
      statusCode: m.bug.statusCode,
    })));
    // Prefer a member carrying a human label; fall back to one with any selector. Both
    // fields come from that ONE record so the label and selector never describe different
    // nodes. Representative first, so a self-sufficient rep is never overridden.
    const culprit = [rep, ...members].find((m) => (m.bug.elementLabel ?? '').trim() !== '')
      ?? [rep, ...members].find((m) => (m.bug.selector ?? '').trim() !== '');
    return {
      origin: rep.origin,
      bug: {
        ...rep.bug,
        severity,
        // Label AND selector come from the SAME chosen member so they never describe different
        // nodes. If that member's selector is empty, leave it empty — borrowing rep's selector
        // (a different node) is exactly the label/selector cross-wire that mis-attributes findings.
        elementLabel: culprit ? culprit.bug.elementLabel : rep.bug.elementLabel,
        selector: culprit ? culprit.bug.selector : rep.bug.selector,
        statusCode: rep.bug.statusCode ?? members.find((m) => m.bug.statusCode !== undefined)?.bug.statusCode,
      },
    };
  },
};

// Reportability of a persisted finding, mapped onto the shared predicate the live tab
// uses — so infra/harness noise is filtered identically on both surfaces.
export function isBugReportable(bug: ICaughtBug): boolean {
  return isReportableFinding({ reason: bug.message, statusCode: bug.statusCode, url: bug.url, attribution: bug.attribution, stackTrace: bug.stackTrace });
}

// Reconcile server ledger + optional client findings into one representative per fault
// family by SIGNATURE (not bugId), so their disjoint id namespaces can never double-count
// one fault. Reportability is the caller's choice (kept out so the bare family collapse
// stays a pure grouping).
function collapseCaughtBugs(server: ICaughtBug[], client: ICaughtBug[] = []): ICaughtBug[] {
  const tagged: OriginBug[] = [
    ...server.map((bug) => ({ bug, origin: 'server' as const })),
    ...client.map((bug) => ({ bug, origin: 'client' as const })),
  ];
  return collapseFindings(tagged, caughtBugCollapseAdapter).map((t) => t.bug);
}

/**
 * Collapse duplicate findings into one representative per fault family, keyed on the
 * canonical signature, occurrences summed within origin. The engine ledger still retains
 * every instance for telemetry; only the persisted, operator-facing set is collapsed.
 */
export function dedupeCaughtBugsBySignature(bugs: ICaughtBug[]): ICaughtBug[] {
  return collapseCaughtBugs(bugs);
}

// Persisted-finding pipeline shared by the mid-run checkpoint and the manual save:
// project the ledger onto the saved shape, drop infra/harness noise, collapse to one
// representative per family. `findingCount` is then just this array's length, so the
// count History reads matches the live badge whether or not the run was manually saved.
export function projectFindingsForPersistence(bugs: ConfirmedBug[]): ICaughtBug[] {
  return collapseCaughtBugs(bugs.map(toSavedCaughtBug).filter(isBugReportable));
}

// Manual-save variant: server truth (already projected) reconciled with the client's
// transferred findings by signature. Both sides are reportability-filtered so History
// never exceeds the live count.
export function reconcileFindingsForPersistence(server: ICaughtBug[], client: ICaughtBug[]): ICaughtBug[] {
  return collapseCaughtBugs(server.filter(isBugReportable), client.filter(isBugReportable));
}
