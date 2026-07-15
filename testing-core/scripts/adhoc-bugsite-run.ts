// Disposable diagnostic run — drives the real engine against a live target URL.
import { PlaywrightBrowserEngine } from '../src/infrastructure/playwright/PlaywrightBrowserEngine.js';
import type { TelemetryGateway } from '../src/application/ports/TelemetryGateway.js';
import type { OptimizationSettings, TestingTypeId } from '../../shared/types.js';
import { defaultOptimizationSettings } from '../../shared/types.js';

const TARGET_URL = 'https://bugsite-one.vercel.app/';

const noopTelemetry: TelemetryGateway = {
  emitTelemetry() {},
  emitTargets() {},
  emitLiveFrame() {},
  emitForensicReport() {},
  emitIncidentReport() {},
  emitAccessibility() {},
  emitUrlChanged() {},
};

async function main() {
  const engine = new PlaywrightBrowserEngine();
  const settings: OptimizationSettings = {
    ...defaultOptimizationSettings,
    'execution-timebox-ms': 60000,
    'exploration-seed': 42,
  };
  const scenarios: TestingTypeId[] = ['exploratory', 'dataFuzzing', 'formBypass', 'navigation', 'concurrency'];

  console.log(`[adhoc] running engine against ${TARGET_URL} (60s timebox)…`);
  const result = await engine.run(TARGET_URL, noopTelemetry, settings, scenarios);
  console.log(`[adhoc] engine stopped: completed=${result.completed} — ${result.reason}`);

  const raw = engine.getConfirmedBugsFromMemory() as Array<{
    type: string; message: string; selector: string; url?: string;
    attribution?: { bugClass?: string; severity?: string; origin?: string };
  }>;

  console.log(`\nTotal findings: ${raw.length}\n`);
  raw.forEach((b, i) => {
    console.log(`${i + 1}. [${b.attribution?.severity ?? '?'}] ${b.attribution?.bugClass ?? b.type} — ${b.message.slice(0, 100)}`);
    console.log(`   url: ${b.url ?? 'N/A'}  origin: ${b.attribution?.origin ?? 'N/A'}`);
  });
  process.exit(0);
}

main().catch((err) => { console.error('[adhoc] fatal:', err); process.exit(1); });
