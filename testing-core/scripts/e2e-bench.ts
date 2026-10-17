// ═══════════════════════════════════════════════════════════════
// scripts/e2e-bench.ts — END-TO-END ACCURACY FROM A REAL ENGINE RUN (FLAT FIXTURE)
// ═══════════════════════════════════════════════════════════════
// Drives the actual PlaywrightBrowserEngine against the flat seeded-bug fixture, then
// diffs its confirmed findings against manifest.ts. Unlike accuracy-bench.ts (which
// scores subsystems over hand-authored corpora), this measures the SYSTEM as it runs:
// exploration + detection together. Run: `npm run bench:e2e` (real Chromium).
//
// Honesty: recall here = exploration coverage × detection. A miss can mean "the engine
// never clicked it", not "it can't detect it". The deep fixture (bench:e2e:deep) probes
// coverage depth; this one is the fast flat smoke test.

import type { TestingTypeId } from '../../shared/types.js';
import { startSeededApp } from '../testing/benchmark/seeded-app/server.js';
import * as manifest from '../testing/benchmark/seeded-app/manifest.js';
import { runAndScore, type BenchThresholds } from '../testing/benchmark/harness.js';

// Opt-in gate (audit M-1): `BUGSAFARI_BENCH_GATE=1 npm run bench:e2e` turns the smoke run
// into a regression gate. Off by default so an ad-hoc run still just prints.
const GATE: BenchThresholds | undefined = process.env.BUGSAFARI_BENCH_GATE
  ? { minRecall: 0.8, minPrecision: 0.8, minSelectorAccuracy: 0.6, maxFalsePositives: 1 }
  : undefined;

async function main() {
  const app = await startSeededApp();
  const scenarios: TestingTypeId[] = ['exploratory', 'dataFuzzing', 'formBypass', 'navigation', 'concurrency'];
  await runAndScore(app, manifest, { title: 'e2e-bench', timeboxMs: 45000, seed: 42, scenarios, gate: GATE });
  // Respect a gate failure (process.exitCode set by the harness) instead of masking it with 0.
  process.exit(process.exitCode ?? 0);
}

main().catch((err) => {
  console.error('[e2e-bench] fatal:', err);
  process.exit(1);
});
