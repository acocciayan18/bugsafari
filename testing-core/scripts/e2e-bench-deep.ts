// ═══════════════════════════════════════════════════════════════
// scripts/e2e-bench-deep.ts — END-TO-END ACCURACY ON THE DEEP FIXTURE
// ═══════════════════════════════════════════════════════════════
// Same real-engine harness as e2e-bench.ts, pointed at the deep-app fixture: an auth
// gate, a multi-step checkout wizard, async-rendered DOM, and a slow-settling 500. It
// measures exploration DEPTH (can the engine reach gated/multi-step/dynamic defects?)
// and, via the async-lag defect, culprit-attribution under settle delay (issue #1).
// A longer timebox than the flat bench because the defects are several clicks deep.
// Run: `npm run bench:e2e:deep` (real Chromium).

import type { TestingTypeId } from '../../shared/types.js';
import { startDeepApp } from '../testing/benchmark/deep-app/server.js';
import * as manifest from '../testing/benchmark/deep-app/manifest.js';
import { runAndScore } from '../testing/benchmark/harness.js';

async function main() {
  const app = await startDeepApp();
  const scenarios: TestingTypeId[] = ['exploratory', 'dataFuzzing', 'formBypass', 'navigation', 'concurrency'];
  await runAndScore(app, manifest, { title: 'e2e-bench-deep', timeboxMs: 90000, seed: 42, scenarios });
  process.exit(0);
}

main().catch((err) => {
  console.error('[e2e-bench-deep] fatal:', err);
  process.exit(1);
});
