// ═══════════════════════════════════════════════════════════════
// scripts/accuracy-bench.ts — DETECTION / RANKING / DEDUP ACCURACY SCORER
// ═══════════════════════════════════════════════════════════════
// Runs each subsystem over its labeled corpus and prints precision/recall/F1
// (detection), precision@k + nDCG (ranking), and collapse-accuracy (dedup).
// Run: `npm run bench` (prints, exits 0). Add `--gate` to fail below thresholds.
//
// Executed through tsx (no external test framework), consistent with
// scripts/run-tests.mjs and the project's "no extra libraries" constraint.

import { classifyFault } from '../src/bugs/knowledgeBase/FaultClassifier.js';
import { RiskScorer } from '../src/domain/services/RiskScorer.js';
import { DETECTION_CORPUS, SECURITY_CLASSES } from '../src/__accuracy__/detectionCorpus.js';
import { RANKING_CORPUS } from '../src/__accuracy__/rankingCorpus.js';
import { DEDUP_CORPUS } from '../src/__accuracy__/dedupCorpus.js';

const GATE = process.argv.includes('--gate');

// ── Metric helpers ────────────────────────────────────────────────────────────
function prf(tp: number, fp: number, fn: number): { precision: number; recall: number; f1: number } {
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

// ── Detection: class accuracy + security precision/recall/F1 ───────────────────
function scoreDetection() {
  let classHits = 0;
  let classTotal = 0;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const c of DETECTION_CORPUS) {
    const predicted = classifyFault(c.input).bugClass;
    if (c.expected !== 'NONE') {
      classTotal += 1;
      if (predicted === c.expected) classHits += 1;
    }
    const predictedSecurity = SECURITY_CLASSES.has(predicted);
    if (c.expectSecurity && predictedSecurity) tp += 1;
    else if (!c.expectSecurity && predictedSecurity) fp += 1;
    else if (c.expectSecurity && !predictedSecurity) fn += 1;
  }
  return { classAccuracy: classTotal === 0 ? 1 : classHits / classTotal, ...prf(tp, fp, fn), fp };
}

// ── Ranking: precision@k + nDCG over RiskScorer output ─────────────────────────
function scoreRanking() {
  const scorer = new RiskScorer();
  const ranked = scorer.score(RANKING_CORPUS.map((r) => ({ ...r.element })));
  // Map selector → bug-bearing label for scoring the produced order.
  const label = new Map(RANKING_CORPUS.map((r) => [r.element.selector, r.isBugBearing]));
  const rels = ranked.map((e) => (label.get(e.selector) ? 1 : 0));
  const k = RANKING_CORPUS.filter((r) => r.isBugBearing).length;
  const precisionAtK = rels.slice(0, k).reduce((a, b) => a + b, 0) / k;
  const dcg = rels.reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
  const idcg = rels.slice().sort((a, b) => b - a).reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
  return { precisionAtK, ndcg: idcg === 0 ? 1 : dcg / idcg, k };
}

// ── Dedup: fraction of cases whose surviving-report count is correct ───────────
async function scoreDedup() {
  let dedupe: (i: unknown[], r: unknown[], w?: number) => unknown[];
  try {
    const mod = await import('../../developer-dashboard/src/utils/errorDeduplication.js');
    dedupe = mod.dedupeReportsAgainstIncidents as typeof dedupe;
  } catch (err) {
    console.warn('[bench] dedup module unavailable, skipping:', err instanceof Error ? err.message : err);
    return null;
  }
  let correct = 0;
  const failures: string[] = [];
  for (const c of DEDUP_CORPUS) {
    const remaining = dedupe(c.incidents, c.reports).length;
    if (remaining === c.expectedRemaining) correct += 1;
    else failures.push(`${c.name} (got ${remaining}, want ${c.expectedRemaining})`);
  }
  return { accuracy: correct / DEDUP_CORPUS.length, total: DEDUP_CORPUS.length, correct, failures };
}

async function main() {
  const det = scoreDetection();
  const rank = scoreRanking();
  const dedup = await scoreDedup();

  console.log('\n══════════════════ ACCURACY BENCHMARK ══════════════════');
  console.log('\n[Detection — FaultClassifier]');
  console.log(`  class accuracy       : ${pct(det.classAccuracy)}`);
  console.log(`  security precision   : ${pct(det.precision)}  (false positives: ${det.fp})`);
  console.log(`  security recall      : ${pct(det.recall)}`);
  console.log(`  security F1          : ${pct(det.f1)}`);

  console.log('\n[Ranking — RiskScorer / perceptron]');
  console.log(`  precision@${rank.k}         : ${pct(rank.precisionAtK)}`);
  console.log(`  nDCG                 : ${pct(rank.ndcg)}`);

  console.log('\n[Dedup — errorDeduplication]');
  if (dedup) {
    console.log(`  collapse accuracy    : ${pct(dedup.accuracy)}  (${dedup.correct}/${dedup.total})`);
    for (const f of dedup.failures) console.log(`    ✗ ${f}`);
  } else {
    console.log('  (skipped)');
  }
  console.log('\n═════════════════════════════════════════════════════════\n');

  if (GATE) {
    const fail =
      det.classAccuracy < 0.9 ||
      det.precision < 1 ||
      det.recall < 0.9 ||
      rank.precisionAtK < 0.85 ||
      rank.ndcg < 0.9 ||
      (dedup !== null && dedup.accuracy < 1);
    if (fail) {
      console.error('✗ accuracy gate failed — metrics below threshold');
      process.exit(1);
    }
    console.log('✓ accuracy gate passed');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
