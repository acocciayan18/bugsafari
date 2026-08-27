// Save-path occurrence accuracy: dedupeCaughtBugs must SUM each finding's authoritative
// manifestation count (the ledger ×N), never a raw +1 per row — so duplicate telemetry
// rows can't inflate the persisted count, and the saved ×N equals what the operator saw
// live. Run: `npx tsx src/application/useCases/StartExplorationUseCase.dedupe.test.ts`.

import assert from 'node:assert/strict';
import { StartExplorationUseCase } from './StartExplorationUseCase.js';

// dedupeCaughtBugs is pure (uses only the signature helper), so a bare instance with stub
// deps exercises it without a browser/DB. private is compile-time only under tsx.
const useCase = new StartExplorationUseCase({} as never, {} as never, {} as never);
type Bug = { type: string; message: string; selector: string; stackTrace?: string; occurrences?: number };
const dedupe = (bugs: Bug[]): Array<Bug & { occurrences: number }> =>
  (useCase as unknown as { dedupeCaughtBugs(b: Bug[]): Array<Bug & { occurrences: number }> }).dedupeCaughtBugs(bugs);

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const bug = (over: Partial<Bug> = {}): Bug => ({
  type: 'EXCEPTION',
  message: 'TypeError: x is undefined',
  selector: '#a',
  occurrences: 1,
  ...over,
});

// Two ledger rows for the SAME signature carry authoritative counts — the saved finding
// is their SUM, not a count of rows.
check('same-signature rows sum their authoritative occurrences', () => {
  const out = dedupe([bug({ occurrences: 3 }), bug({ occurrences: 4 })]);
  assert.equal(out.length, 1, 'one representative finding');
  assert.equal(out[0].occurrences, 7, '3 + 4 authoritative manifestations');
});

// A single verified fault (one manifestation) stays ×1 — a duplicate telemetry row that
// somehow reached the ledger with occurrences:1 does not add a phantom occurrence beyond truth.
check('a lone finding is saved as ×1', () => {
  const out = dedupe([bug({ occurrences: 1 })]);
  assert.equal(out[0].occurrences, 1);
});

// A missing count defaults to exactly one manifestation (never zero, never doubled).
check('a row with no occurrences counts as 1', () => {
  const out = dedupe([bug({ occurrences: undefined }), bug({ occurrences: undefined })]);
  assert.equal(out[0].occurrences, 2, 'two distinct instances, each worth 1');
});

// Distinct signatures never merge — each keeps its own authoritative count.
check('distinct signatures stay separate with their own counts', () => {
  const out = dedupe([
    bug({ message: 'A', occurrences: 2 }),
    bug({ message: 'B', selector: '#b', occurrences: 5 }),
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((b) => b.occurrences).sort(), [2, 5]);
});

console.log(`\n${passed} dedupeCaughtBugs assertion group(s) passed.`);
