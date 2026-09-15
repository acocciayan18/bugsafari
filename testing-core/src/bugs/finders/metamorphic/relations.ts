// metamorphic/relations.ts — shared primitives for the metamorphic oracles.
// The diff target is DomHasher.hashCompound: its structure + interactive signatures
// already normalize volatile content (ads, dynamic classes, digit runs, repeated rows).
// A CompoundObservation also carries a field-level DOM path map so the volatility model
// can tell whether a residual hash difference is real or just dynamic content.

import type { Page } from 'playwright';
import type { InteractiveElement } from '../../../domain/entities/InteractiveElement.js';
import { DomHasher, type CompoundStateHash } from '../../../ml/domHasher.js';
import { settle } from '../../../domain/services/exploration/types.js';
import { captureDomPaths } from '../../../domain/services/baseline/domSnapshot.js';
import { VolatilityModel } from '../../../domain/services/baseline/volatilityModel.js';
import { changedPaths } from '../../../domain/services/baseline/jsonPaths.js';

// Shared hasher — default config (urlAware:false) is exactly right for a before/after
// diff on the same route: a URL change must never read as a state change (domHasher.ts:24).
const hasher = new DomHasher();

// A compound hash plus the field-level DOM paths captured at the same moment.
export interface CompoundObservation {
  hash: CompoundStateHash;
  paths: Map<string, string>;
}

// Injectable so the oracles can be unit-tested without a real browser.
export type CompoundCapture = (page: Page) => Promise<CompoundObservation>;

// Settle the page, then fingerprint. Settling first keeps a mid-flight snapshot from
// reading as drift.
export async function captureCompound(page: Page): Promise<CompoundObservation> {
  await settle(page);
  const [hash, paths] = await Promise.all([hasher.hashCompound(page), captureDomPaths(page)]);
  return { hash, paths };
}

// Two compound states are equivalent when both normalized signatures match. Structure
// catches leaked/dropped/duplicated nodes; interactive catches a control whose state
// (checked/expanded/disabled/label) did not revert.
export function equivalent(a: CompoundStateHash, b: CompoundStateHash): boolean {
  return a.structure === b.structure && a.interactive === b.interactive;
}

// True only when the two observations differ AT THE FIELD LEVEL and every one of those
// field changes is volatile (learned churn or a seeded dynamic format). Used to suppress a
// finding whose residual hash difference is fully explained by dynamic content. A hash
// difference with NO observable field change (or with any stable field change) never
// suppresses — we only veto what we can positively attribute to volatility.
export function volatileOnly(key: string, a: CompoundObservation, b: CompoundObservation): boolean {
  if (changedPaths(a.paths, b.paths).size === 0) return false;
  return VolatilityModel.stableDiff(key, a.paths, b.paths).size === 0;
}

// The "open" half of a round-trip: a visible control that opens a transient layer
// (modal/dropdown/sidebar) and is not itself a dismiss. The close half is the layer's
// own dismiss affordance or the Escape key, resolved after opening.
export function detectModalOpeners(targets: readonly InteractiveElement[]): InteractiveElement[] {
  return targets.filter(
    (t) => t.opensLayer === true && t.isDismiss !== true && t.isVisible === true && Boolean(t.selector),
  );
}
