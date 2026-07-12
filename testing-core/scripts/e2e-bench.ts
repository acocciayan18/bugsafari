// ═══════════════════════════════════════════════════════════════
// scripts/e2e-bench.ts — END-TO-END ACCURACY FROM A REAL ENGINE RUN
// ═══════════════════════════════════════════════════════════════
// Drives the actual PlaywrightBrowserEngine against the seeded-bug fixture, then
// diffs its confirmed findings against manifest.ts. Unlike accuracy-bench.ts (which
// scores subsystems over hand-authored corpora), this measures the SYSTEM as it
// runs: exploration + detection together. Run: `npm run bench:e2e` (real Chromium).
//
// Honesty: recall here = exploration coverage × detection. A miss can mean "the
// engine never clicked it", not "it can't detect it". Controls are named with
// high-risk keywords + a fixed seed to make coverage reliable; the run reports
// whatever it actually finds.

import { PlaywrightBrowserEngine } from '../src/infrastructure/playwright/PlaywrightBrowserEngine.js';
import type { TelemetryGateway } from '../src/application/ports/TelemetryGateway.js';
import type { OptimizationSettings, TestingTypeId } from '../../shared/types.js';
import { defaultOptimizationSettings } from '../../shared/types.js';
import { startSeededApp } from '../testing/benchmark/seeded-app/server.js';
import { SEEDED_DEFECTS, SEEDED_CLASSES, BENIGN_SELECTORS } from '../testing/benchmark/seeded-app/manifest.js';

// Discard-everything telemetry — findings are read from engine memory, not the stream.
const noopTelemetry: TelemetryGateway = {
  emitTelemetry() {},
  emitTargets() {},
  emitLiveFrame() {},
  emitForensicReport() {},
  emitIncidentReport() {},
  emitUrlChanged() {},
};

interface Finding {
  bugClass: string;
  selector: string;
  message: string;
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

async function main() {
  const app = await startSeededApp();
  console.log(`[e2e-bench] fixture up at ${app.url}`);
  const engine = new PlaywrightBrowserEngine();

  const settings: OptimizationSettings = {
    ...defaultOptimizationSettings,
    'execution-timebox-ms': 45000,
    'exploration-seed': 42,
  };
  const scenarios: TestingTypeId[] = ['exploratory', 'dataFuzzing', 'formBypass', 'navigation', 'concurrency'];

  let findings: Finding[] = [];
  try {
    console.log('[e2e-bench] running engine (fixed seed 42, 45s timebox)…');
    const result = await engine.run(app.url, noopTelemetry, settings, scenarios);
    console.log(`[e2e-bench] engine stopped: completed=${result.completed} — ${result.reason}`);
    const raw = engine.getConfirmedBugsFromMemory() as Array<{
      type: string;
      message: string;
      selector: string;
      attribution?: { bugClass?: string };
    }>;
    findings = raw.map((b) => ({
      bugClass: b.attribution?.bugClass ?? b.type,
      selector: b.selector ?? '',
      message: b.message ?? '',
    }));
  } finally {
    await app.close();
  }

  // ── Score ─────────────────────────────────────────────────────────────────
  const detected = new Set(findings.map((f) => f.bugClass));
  const detectedSeeded = SEEDED_CLASSES.filter((c) => detected.has(c));
  const missedSeeded = SEEDED_CLASSES.filter((c) => !detected.has(c));
  const recall = SEEDED_CLASSES.length === 0 ? 1 : detectedSeeded.length / SEEDED_CLASSES.length;

  const isBenign = (selector: string): boolean =>
    BENIGN_SELECTORS.some((b) => selector.toLowerCase().includes(b));
  const truePos = findings.filter((f) => SEEDED_CLASSES.includes(f.bugClass) && !isBenign(f.selector));
  const falsePos = findings.filter((f) => !SEEDED_CLASSES.includes(f.bugClass) || isBenign(f.selector));
  const precision = findings.length === 0 ? 1 : truePos.length / findings.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  // Per-class finding counts.
  const perClass = new Map<string, number>();
  for (const f of findings) perClass.set(f.bugClass, (perClass.get(f.bugClass) ?? 0) + 1);

  console.log('\n═════════════ END-TO-END ACCURACY (real engine run) ═════════════');
  console.log(`\nTotal findings: ${findings.length}`);
  console.log('\nPer-class finding counts:');
  for (const [cls, n] of [...perClass.entries()].sort()) console.log(`  ${cls.padEnd(30)} ${n}`);

  console.log('\nSeeded-class detection:');
  for (const defect of SEEDED_DEFECTS) {
    const hit = detected.has(defect.expectedBugClass);
    console.log(`  ${hit ? '✓' : '✗'} ${defect.expectedBugClass.padEnd(28)} ${defect.label}`);
  }

  if (falsePos.length > 0) {
    console.log('\nFalse positives (unexpected class or benign control):');
    for (const f of falsePos) console.log(`  ✗ [${f.bugClass}] ${f.selector || '(no selector)'} — ${f.message.slice(0, 80)}`);
  }

  console.log('\nMetrics (class-level):');
  console.log(`  recall     : ${pct(recall)}  (${detectedSeeded.length}/${SEEDED_CLASSES.length} seeded classes; missed: ${missedSeeded.join(', ') || 'none'})`);
  console.log(`  precision  : ${pct(precision)}  (${truePos.length}/${findings.length} findings on-target)`);
  console.log(`  F1         : ${pct(f1)}`);
  console.log('\n═════════════════════════════════════════════════════════════════\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('[e2e-bench] fatal:', err);
  process.exit(1);
});
