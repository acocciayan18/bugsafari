// capRiskLevelByMaxSeverity — the session risk band never exceeds the worst finding.
// Run: `npx tsx src/infrastructure/database/models/ForensicAnalysisModel.riskCap.test.ts`.

import assert from 'node:assert/strict';
import { determineRiskLevel, capRiskLevelByMaxSeverity, ForensicAnalysisRiskLevel } from './ForensicAnalysisModel.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('capRiskLevelByMaxSeverity');

// The reported symptom: score 63 lands in the HIGH band while every finding is MEDIUM.
check('score 63 + max MEDIUM caps to MEDIUM', () => {
  assert.equal(determineRiskLevel(63), ForensicAnalysisRiskLevel.HIGH);
  assert.equal(capRiskLevelByMaxSeverity(determineRiskLevel(63), 'MEDIUM'), ForensicAnalysisRiskLevel.MEDIUM);
});

check('cap never RAISES the level (max HIGH, low score stays MEDIUM)', () => {
  assert.equal(capRiskLevelByMaxSeverity(ForensicAnalysisRiskLevel.MEDIUM, 'HIGH'), ForensicAnalysisRiskLevel.MEDIUM);
});

check('a real CRITICAL finding is not clamped down', () => {
  assert.equal(capRiskLevelByMaxSeverity(ForensicAnalysisRiskLevel.HIGH, 'CRITICAL'), ForensicAnalysisRiskLevel.HIGH);
});

check('INFO/LOW findings cap to LOW', () => {
  assert.equal(capRiskLevelByMaxSeverity(ForensicAnalysisRiskLevel.HIGH, 'INFO'), ForensicAnalysisRiskLevel.LOW);
  assert.equal(capRiskLevelByMaxSeverity(ForensicAnalysisRiskLevel.CRITICAL, 'LOW'), ForensicAnalysisRiskLevel.LOW);
});

check('absent / unknown severity applies no cap', () => {
  assert.equal(capRiskLevelByMaxSeverity(ForensicAnalysisRiskLevel.HIGH, undefined), ForensicAnalysisRiskLevel.HIGH);
  assert.equal(capRiskLevelByMaxSeverity(ForensicAnalysisRiskLevel.HIGH, 'WEIRD'), ForensicAnalysisRiskLevel.HIGH);
});

check('case-insensitive severity input', () => {
  assert.equal(capRiskLevelByMaxSeverity(determineRiskLevel(63), 'medium'), ForensicAnalysisRiskLevel.MEDIUM);
});

console.log(`\n${passed} passed`);
