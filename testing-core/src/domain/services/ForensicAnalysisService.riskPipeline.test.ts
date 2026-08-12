// Saved-run risk pipeline — exercises the REAL production functions the /api/forensic
// report path composes (scoreFindings → determineRiskLevel → capRiskLevelByMaxSeverity),
// proving an all-MEDIUM run no longer reads "HIGH risk".
// Run: `npx tsx src/domain/services/ForensicAnalysisService.riskPipeline.test.ts`.

import assert from 'node:assert/strict';
import { forensicAnalysisService } from './ForensicAnalysisService.js';
import { determineRiskLevel, capRiskLevelByMaxSeverity, ForensicAnalysisRiskLevel } from '../../infrastructure/database/models/ForensicAnalysisModel.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Mirrors the inline reduce in registerRoutes for the saved-run path.
const SEVERITY_RANK: Record<string, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
function maxSeverity(findings: Array<{ severity?: string | null }>): string | undefined {
  return findings.reduce<string | undefined>((top, f) => {
    const s = (f.severity ?? '').toUpperCase();
    if (!(s in SEVERITY_RANK)) return top;
    return top === undefined || SEVERITY_RANK[s] > SEVERITY_RANK[top] ? s : top;
  }, undefined);
}

// The reported run's shape: ten MEDIUM findings, nothing worse.
const tenMedium = Array.from({ length: 10 }, () => ({ severity: 'MEDIUM' }));

console.log('Saved-run risk pipeline (real production functions)');

check('all-MEDIUM x10 scores into the HIGH band but caps to MEDIUM', () => {
  const score = forensicAnalysisService.scoreFindings(tenMedium);
  assert.ok(score >= 51 && score < 76, `expected HIGH-band score, got ${score}`);
  const level = determineRiskLevel(score);
  assert.equal(level, ForensicAnalysisRiskLevel.HIGH); // pre-cap this is the bug
  const capped = capRiskLevelByMaxSeverity(level, maxSeverity(tenMedium));
  assert.equal(capped, ForensicAnalysisRiskLevel.MEDIUM); // cap fixes it
});

check('a genuine HIGH finding is never masked by the cap', () => {
  const mixed = [...tenMedium, { severity: 'HIGH' }];
  const level = determineRiskLevel(forensicAnalysisService.scoreFindings(mixed));
  const capped = capRiskLevelByMaxSeverity(level, maxSeverity(mixed));
  assert.ok(SEVERITY_RANK[capped] >= SEVERITY_RANK.HIGH, `HIGH finding must keep level >= HIGH, got ${capped}`);
});

check('a single MEDIUM finding stays LOW/MEDIUM, never inflated', () => {
  const one = [{ severity: 'MEDIUM' }];
  const capped = capRiskLevelByMaxSeverity(determineRiskLevel(forensicAnalysisService.scoreFindings(one)), maxSeverity(one));
  assert.ok(SEVERITY_RANK[capped] <= SEVERITY_RANK.MEDIUM);
});

console.log(`\n${passed} passed`);
