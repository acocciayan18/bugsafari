// Shared engine-run + scoring harness for the end-to-end benchmarks. Both the flat
// (seeded-app) and deep (deep-app) benches drive the REAL PlaywrightBrowserEngine and
// diff its confirmed findings against a manifest — the only difference is the fixture,
// so the run loop, metrics, and reporting live here once.

import { PlaywrightBrowserEngine } from '../../src/infrastructure/playwright/PlaywrightBrowserEngine.js';
import type { TelemetryGateway } from '../../src/application/ports/TelemetryGateway.js';
import type { OptimizationSettings, TestingTypeId } from '../../../shared/types.js';
import { defaultOptimizationSettings } from '../../../shared/types.js';

// Discard-everything telemetry — findings are read from engine memory, not the stream.
const noopTelemetry: TelemetryGateway = {
  emitTelemetry() {},
  emitTargets() {},
  emitLiveFrame() {},
  emitForensicReport() {},
  emitIncidentReport() {},
  emitAccessibility() {},
  emitUrlChanged() {},
};

export interface BenchDefect {
  id: string;
  label: string;
  expectedBugClass: string;
  /** Optional exploration capability tag (deep fixture) for reach-vs-detect diagnosis. */
  depth?: string;
}

export interface BenchManifest {
  SEEDED_DEFECTS: readonly BenchDefect[];
  BENIGN_SELECTORS: readonly string[];
  SEEDED_CLASSES: readonly string[];
}

export interface BenchApp {
  url: string;
  close: () => Promise<void>;
}

export interface BenchOptions {
  title: string;
  timeboxMs: number;
  seed: number;
  scenarios: TestingTypeId[];
  // When set, the run exits non-zero if any metric falls below its floor. Lets the e2e
  // bench act as a regression GATE (CI / pre-merge), not only a printout (audit M-1).
  gate?: BenchThresholds;
}

export interface BenchThresholds {
  minRecall?: number;
  minPrecision?: number;
  minF1?: number;
  minSelectorAccuracy?: number;
  maxFalsePositives?: number;
}

interface Finding {
  bugClass: string;
  selector: string;
  message: string;
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

/** Drive the engine against `app`, score its findings vs `manifest`, and print the report. */
export async function runAndScore(app: BenchApp, manifest: BenchManifest, opts: BenchOptions): Promise<void> {
  const { SEEDED_DEFECTS, BENIGN_SELECTORS, SEEDED_CLASSES } = manifest;
  console.log(`[${opts.title}] fixture up at ${app.url}`);
  const engine = new PlaywrightBrowserEngine();

  const settings: OptimizationSettings = {
    ...defaultOptimizationSettings,
    'execution-timebox-ms': opts.timeboxMs,
    'exploration-seed': opts.seed,
  };

  let findings: Finding[] = [];
  try {
    console.log(`[${opts.title}] running engine (seed ${opts.seed}, ${opts.timeboxMs}ms timebox)…`);
    const result = await engine.run(app.url, noopTelemetry, settings, opts.scenarios);
    console.log(`[${opts.title}] engine stopped: completed=${result.completed} — ${result.reason}`);
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

  // ── Class-level: recall / precision / F1 ──────────────────────────────────────
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

  // ── Attribution: right CLASS AND right CONTROL selector ───────────────────────
  const namesControl = (selector: string, id: string): boolean =>
    selector.includes(`#${id}`) || selector === id;
  const selectorHit = (d: BenchDefect): boolean =>
    findings.some((f) => f.bugClass === d.expectedBugClass && namesControl(f.selector, d.id));
  const selectorHits = SEEDED_DEFECTS.filter(selectorHit);
  const selectorAccuracy = SEEDED_DEFECTS.length === 0 ? 1 : selectorHits.length / SEEDED_DEFECTS.length;

  const perClass = new Map<string, number>();
  for (const f of findings) perClass.set(f.bugClass, (perClass.get(f.bugClass) ?? 0) + 1);

  console.log(`\n═════════════ ${opts.title} — E2E ACCURACY (real engine run) ═════════════`);
  console.log(`\nTotal findings: ${findings.length}`);
  console.log('\nPer-class finding counts:');
  for (const [cls, n] of [...perClass.entries()].sort()) console.log(`  ${cls.padEnd(30)} ${n}`);

  console.log('\nSeeded-class detection:');
  for (const defect of SEEDED_DEFECTS) {
    const hit = detected.has(defect.expectedBugClass);
    const tag = defect.depth ? `[${defect.depth}] ` : '';
    console.log(`  ${hit ? '✓' : '✗'} ${defect.expectedBugClass.padEnd(28)} ${tag}${defect.label}`);
  }

  console.log('\nCulprit-selector attribution (right class AND right control):');
  for (const defect of SEEDED_DEFECTS) {
    const hit = selectorHit(defect);
    const tag = defect.depth ? `[${defect.depth}] ` : '';
    console.log(`  ${hit ? '✓' : '✗'} ${`#${defect.id}`.padEnd(18)} ${tag}${defect.expectedBugClass}`);
  }

  // Every finding as reported, so an attribution miss above can be diagnosed
  // without re-running the engine to find out which selector it actually named.
  console.log('\nAll findings as reported (class → selector):');
  for (const f of findings) console.log(`  ${f.bugClass.padEnd(30)} ${f.selector || '(no selector)'}`);

  if (falsePos.length > 0) {
    console.log('\nFalse positives (unexpected class or benign control):');
    for (const f of falsePos) console.log(`  ✗ [${f.bugClass}] ${f.selector || '(no selector)'} — ${f.message.slice(0, 80)}`);
  }

  console.log('\nMetrics (class-level):');
  console.log(`  recall     : ${pct(recall)}  (${detectedSeeded.length}/${SEEDED_CLASSES.length} seeded classes; missed: ${missedSeeded.join(', ') || 'none'})`);
  console.log(`  precision  : ${pct(precision)}  (${truePos.length}/${findings.length} findings on-target)`);
  console.log(`  F1         : ${pct(f1)}`);
  console.log('\nMetrics (attribution-level):');
  console.log(`  selector accuracy : ${pct(selectorAccuracy)}  (${selectorHits.length}/${SEEDED_DEFECTS.length} defects named at the right control)`);
  console.log('\n═════════════════════════════════════════════════════════════════\n');

  // Regression gate: when thresholds are supplied, any shortfall fails the process so a
  // CI step catches an accuracy regression instead of it scrolling past in the log.
  if (opts.gate) {
    const g = opts.gate;
    const failures: string[] = [];
    if (g.minRecall !== undefined && recall < g.minRecall) failures.push(`recall ${pct(recall)} < ${pct(g.minRecall)}`);
    if (g.minPrecision !== undefined && precision < g.minPrecision) failures.push(`precision ${pct(precision)} < ${pct(g.minPrecision)}`);
    if (g.minF1 !== undefined && f1 < g.minF1) failures.push(`F1 ${pct(f1)} < ${pct(g.minF1)}`);
    if (g.minSelectorAccuracy !== undefined && selectorAccuracy < g.minSelectorAccuracy) failures.push(`selector accuracy ${pct(selectorAccuracy)} < ${pct(g.minSelectorAccuracy)}`);
    if (g.maxFalsePositives !== undefined && falsePos.length > g.maxFalsePositives) failures.push(`false positives ${falsePos.length} > ${g.maxFalsePositives}`);
    if (failures.length > 0) {
      console.error(`✗ [${opts.title}] accuracy gate failed: ${failures.join('; ')}`);
      process.exitCode = 1;
    } else {
      console.log(`✓ [${opts.title}] accuracy gate passed`);
    }
  }
}
