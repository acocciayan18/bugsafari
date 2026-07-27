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
import { runAndScore } from '../testing/benchmark/harness.js';

async function main() {
  const app = await startSeededApp();
  const scenarios: TestingTypeId[] = ['exploratory', 'dataFuzzing', 'formBypass', 'navigation', 'concurrency'];
  await runAndScore(app, manifest, { title: 'e2e-bench', timeboxMs: 45000, seed: 42, scenarios });
  process.exit(0);
}

main().catch((err) => {
  console.error('[e2e-bench] fatal:', err);
  process.exit(1);
});
