// Self-executing checks: the single score→status mapping, and that a duplicate-action
// GUARDED verdict's status agrees with its own confidence band (no verdict/score drift).
// Run directly: `npx tsx "src/domain/services/verification/statusForScore.test.ts"`.

import assert from 'node:assert/strict';
import { statusForScore } from './confidenceScore.js';
import { DuplicateActionFinder } from '../../heuristics/DuplicateActionFinder.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('statusForScore applies the CONFIRMED/NEEDS_VERIFICATION/INCONCLUSIVE bands', () => {
  assert.equal(statusForScore(0.9, 'TARGET_APP').status, 'CONFIRMED');
  assert.equal(statusForScore(0.6, 'TARGET_APP').status, 'NEEDS_VERIFICATION');
  assert.equal(statusForScore(0.3, 'TARGET_APP').status, 'INCONCLUSIVE');
});

check('a non-target-app origin can never read as CONFIRMED', () => {
  assert.equal(statusForScore(0.95, 'BUGSAFARI').status, 'NEEDS_VERIFICATION');
});

check('a GUARDED duplicate defect scores in the low band and maps to a non-CONFIRMED status', () => {
  const finder = new DuplicateActionFinder();
  const base = 1000;
  // Two identical overlapping POSTs; the second is rejected by the backend guard (429).
  finder.observeRequest({ requestId: 'r1', method: 'POST', url: 'https://x.ngrok.io/api/checkout', body: '{"a":1}', raceScenarioActive: false, timestampMs: base });
  finder.observeRequest({ requestId: 'r2', method: 'POST', url: 'https://x.ngrok.io/api/checkout', body: '{"a":1}', raceScenarioActive: false, timestampMs: base + 20 });
  finder.observeSettlement({ requestId: 'r1', status: 200, timestampMs: base + 100 });
  const out = finder.observeSettlement({ requestId: 'r2', status: 429, timestampMs: base + 120 });
  assert.ok(out, 'a guarded duplicate is reported');
  assert.equal(out!.defect.verdict, 'GUARDED');
  const mapped = statusForScore(out!.defect.confidenceScore, 'TARGET_APP').status;
  assert.notEqual(mapped, 'CONFIRMED', 'a guarded, backend-protected duplicate is not CONFIRMED');
  // Endpoint reads as a clean path, not the tunnel host.
  assert.equal(out!.defect.endpoint, '/api/checkout');
});

console.log(`\n${passed} assertions passed.`);
