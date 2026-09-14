// metamorphic/relations.ts — shared primitives for the metamorphic oracles.
// The diff target is DomHasher.hashCompound: its structure + interactive signatures
// already normalize volatile content (ads, dynamic classes, digit runs, repeated rows),
// so a purely volatile difference is equal and needs no separate volatility filter here.

import type { Page } from 'playwright';
import type { InteractiveElement } from '../../../domain/entities/InteractiveElement.js';
import { DomHasher, type CompoundStateHash } from '../../../ml/domHasher.js';
import { settle } from '../../../domain/services/exploration/types.js';

// Shared hasher — default config (urlAware:false) is exactly right for a before/after
// diff on the same route: a URL change must never read as a state change (domHasher.ts:24).
const hasher = new DomHasher();

// Injectable so the oracles can be unit-tested without a real browser.
export type CompoundCapture = (page: Page) => Promise<CompoundStateHash>;

// Settle the page, then fingerprint. Settling first keeps a mid-flight snapshot from
// reading as drift.
export async function captureCompound(page: Page): Promise<CompoundStateHash> {
  await settle(page);
  return hasher.hashCompound(page);
}

// Two compound states are equivalent when both normalized signatures match. Structure
// catches leaked/dropped/duplicated nodes; interactive catches a control whose state
// (checked/expanded/disabled/label) did not revert.
export function equivalent(a: CompoundStateHash, b: CompoundStateHash): boolean {
  return a.structure === b.structure && a.interactive === b.interactive;
}

// The "open" half of a round-trip: a visible control that opens a transient layer
// (modal/dropdown/sidebar) and is not itself a dismiss. The close half is the layer's
// own dismiss affordance or the Escape key, resolved after opening.
export function detectModalOpeners(targets: readonly InteractiveElement[]): InteractiveElement[] {
  return targets.filter(
    (t) => t.opensLayer === true && t.isDismiss !== true && t.isVisible === true && Boolean(t.selector),
  );
}
