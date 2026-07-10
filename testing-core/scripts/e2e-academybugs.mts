// One-off end-to-end smoke run of the real exploration engine against a live
// site, driving the exact production path (PlaywrightBrowserEngine.run) with a
// stub telemetry gateway that records events. Verifies the goal-critical fixes
// in practice: the engine must EXPLORE diverse controls rather than loop on one,
// and must not emit a stream of false "novel state" rewards on the same shell.
//
// Run: npx tsx scripts/e2e-academybugs.mts

import { PlaywrightBrowserEngine } from '../src/infrastructure/playwright/PlaywrightBrowserEngine.js';
import type { TelemetryGateway } from '../src/application/ports/TelemetryGateway.js';

const TARGET = 'https://academybugs.com/find-bugs/';
const TIMEBOX_MS = 150_000; // smoke window
// Isolate the pure exploration/navigation path — where the false-novelty loop
// lived — by skipping the heavy stress scenarios (coordinate bombing / bursts /
// fuzz) so more real navigation steps land inside the window.
const SCENARIOS = ['exploratory', 'navigation'] as any;

interface Rec { type: string; action?: string; selector?: string; score?: number; message?: string }
const events: Rec[] = [];

// Minimal gateway: capture telemetry, no-op the UI sinks.
const gateway: TelemetryGateway = {
  emitTelemetry(e: any) {
    const m = e?.meta ?? {};
    events.push({ type: e?.type, action: m.actionExecuted, selector: m.selector, score: m.score, message: m.message });
  },
  emitTargets() {},
  emitLiveFrame() {},
  emitForensicReport() {},
  emitIncidentReport() {},
  emitUrlChanged() {},
};

function summarize() {
  // Controls actually acted on (the true "am I exploring?" signal).
  const selected = events.filter((e) => e.action === 'element-selected' && e.selector);
  const executed = events.filter((e) => e.action === 'action-executed' && e.selector);
  const novelty = events.filter((e) => e.action === 'novelty-reward-triggered');
  const revisit = events.filter((e) => e.action === 'state-revisited');
  const cyclic = events.filter((e) => e.action === 'cyclic-loop-detected');

  const bySelector = new Map<string, number>();
  for (const e of executed) bySelector.set(e.selector!, (bySelector.get(e.selector!) ?? 0) + 1);
  const ranked = [...bySelector.entries()].sort((a, b) => b[1] - a[1]);

  console.log('\n════════ ACTION TIMELINE (selected → executed) ════════');
  let step = 0;
  for (const e of events) {
    if (e.action === 'element-selected') {
      step++;
      console.log(`  step ${String(step).padStart(2)}  select  ${e.selector}  (score ${e.score})`);
    } else if (e.action === 'novelty-reward-triggered') {
      console.log(`            ↳ NOVEL  ${e.selector}`);
    } else if (e.action === 'state-revisited') {
      console.log(`            ↳ revisit ${e.selector}`);
    } else if (e.action === 'cyclic-loop-detected') {
      console.log(`            ↳ cyclic-blocked ${e.selector ?? ''}`);
    }
  }

  console.log('\n════════ SUMMARY ════════');
  console.log(`total telemetry events : ${events.length}`);
  console.log(`elements selected      : ${selected.length}`);
  console.log(`actions executed       : ${executed.length}`);
  console.log(`distinct controls acted: ${bySelector.size}`);
  console.log(`novelty rewards        : ${novelty.length}`);
  console.log(`revisit penalties      : ${revisit.length}`);
  console.log(`cyclic-loops blocked   : ${cyclic.length}`);
  console.log('\ntop controls by execution count (loop check — no single one should dominate):');
  for (const [sel, n] of ranked.slice(0, 8)) console.log(`  ${String(n).padStart(3)}×  ${sel}`);

  const topShare = executed.length ? (ranked[0]?.[1] ?? 0) / executed.length : 0;
  console.log(`\ntop control share of all actions: ${(topShare * 100).toFixed(1)}%`);
  const verdict =
    bySelector.size >= 3 && topShare < 0.6
      ? '✅ EXPLORING — diverse controls, no single-control loop'
      : '⚠️ POSSIBLE LOOP — one control dominates; inspect timeline';
  console.log(`verdict: ${verdict}`);
}

async function main() {
  const engine = new PlaywrightBrowserEngine(); // no findingRepo → guest mode, no DB
  console.log(`[e2e] launching engine against ${TARGET} (timebox ${TIMEBOX_MS / 1000}s)…`);
  const start = Date.now();
  try {
    const result = await engine.run(TARGET, gateway, { 'execution-timebox-ms': TIMEBOX_MS } as any, SCENARIOS);
    console.log(`\n[e2e] run finished in ${((Date.now() - start) / 1000).toFixed(1)}s:`, result);
  } catch (err) {
    console.error('[e2e] run threw:', err instanceof Error ? err.stack : err);
  } finally {
    summarize();
    // Ensure the process exits even if a stray handle lingers.
    setTimeout(() => process.exit(0), 500);
  }
}

void main();
