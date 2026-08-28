// Save-path occurrence accuracy: dedupeCaughtBugsBySignature must SUM each finding's
// authoritative manifestation count (the ledger ×N), never a raw +1 per row — so duplicate
// telemetry rows can't inflate the persisted count, and the saved ×N equals what the operator
// saw live. The collapse keys on the SAME canonical fault signature the live view groups by
// (reason+url+stack+status), so a fault family fired from several controls is ONE saved finding.
// Run: `npx tsx src/application/useCases/StartExplorationUseCase.dedupe.test.ts`.

import assert from 'node:assert/strict';
import type { ICaughtBug } from '../../infrastructure/database/models/SessionModel.js';
import { dedupeCaughtBugsBySignature } from '../../domain/services/forensics/findingProjection.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const bug = (over: Partial<ICaughtBug> = {}): ICaughtBug => ({
  bugId: 'b',
  type: 'EXCEPTION',
  message: 'TypeError: x is undefined',
  selector: '#a',
  payloadUsed: '',
  advice: '',
  timestamp: new Date(0),
  occurrences: 1,
  ...over,
} as ICaughtBug);

// Two ledger rows for the SAME fault family carry authoritative counts — the saved finding
// is their SUM, not a count of rows.
check('same-signature rows sum their authoritative occurrences', () => {
  const out = dedupeCaughtBugsBySignature([bug({ occurrences: 3 }), bug({ occurrences: 4 })]);
  assert.equal(out.length, 1, 'one representative finding');
  assert.equal(out[0].occurrences, 7, '3 + 4 authoritative manifestations');
});

// The signature ignores selector, so the same fault fired from two different controls is ONE
// finding — the fix that makes the saved count equal the live card count.
check('a fault family split across controls collapses to one finding', () => {
  const out = dedupeCaughtBugsBySignature([bug({ selector: '#a', occurrences: 2 }), bug({ selector: '#b', occurrences: 5 })]);
  assert.equal(out.length, 1, 'selector does not partition the family');
  assert.equal(out[0].occurrences, 7);
});

// A single verified fault (one manifestation) stays ×1 — a duplicate telemetry row that
// somehow reached the ledger with occurrences:1 does not add a phantom occurrence beyond truth.
check('a lone finding is saved as ×1', () => {
  const out = dedupeCaughtBugsBySignature([bug({ occurrences: 1 })]);
  assert.equal(out[0].occurrences, 1);
});

// A missing count defaults to exactly one manifestation (never zero, never doubled).
check('a row with no occurrences counts as 1', () => {
  const out = dedupeCaughtBugsBySignature([bug({ occurrences: undefined }), bug({ occurrences: undefined })]);
  assert.equal(out[0].occurrences, 2, 'two distinct instances, each worth 1');
});

// Distinct fault families (different message) never merge — each keeps its own count.
check('distinct families stay separate with their own counts', () => {
  const out = dedupeCaughtBugsBySignature([
    bug({ message: 'A', occurrences: 2 }),
    bug({ message: 'B', occurrences: 5 }),
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((b) => b.occurrences).sort(), [2, 5]);
});

console.log(`\n${passed} dedupeCaughtBugsBySignature assertion group(s) passed.`);
