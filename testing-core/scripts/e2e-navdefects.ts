// Disposable e2e check for BrokenNavigationFinder — serves a local SPA-ish site
// seeded with a dead link, a 404 route, and an HTTP redirect loop, then drives
// the real engine against it and prints every nav-* confirmed bug.
import { createServer } from 'node:http';
import { PlaywrightBrowserEngine } from '../src/infrastructure/playwright/PlaywrightBrowserEngine.js';
import type { TelemetryGateway } from '../src/application/ports/TelemetryGateway.js';
import type { OptimizationSettings, TestingTypeId } from '../../shared/types.js';
import { defaultOptimizationSettings } from '../../shared/types.js';

const PORT = 4173;

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;

const HEALTHY = process.env.HEALTHY === '1';

const server = createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page('Nav Defect Fixture', HEALTHY
      ? '<a id="page2" href="/page2">Working page</a>'
      : `
      <a id="dead" href="/promised" onclick="event.preventDefault()">Promised page (dead)</a>
      <a id="missing" href="/missing">Missing page (404)</a>
      <a id="loop" href="/loop-a">Looping page</a>
      <a id="page2" href="/page2">Working page</a>
    `));
  } else if (url === '/page2') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page('Page 2', '<a id="home" href="/">Home</a><button id="noop">Do nothing</button>'));
  } else if (url === '/loop-a') {
    res.writeHead(302, { location: '/loop-b' });
    res.end();
  } else if (url === '/loop-b') {
    res.writeHead(302, { location: '/loop-a' });
    res.end();
  } else {
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end(page('404 Not Found', '<p>No such route.</p><a href="/">Home</a>'));
  }
});

const noopTelemetry: TelemetryGateway = {
  emitTelemetry(event) {
    const meta = event.meta as { selector?: string; message?: string };
    console.log(`[T] ${event.type} ${meta.selector ?? ''} ${meta.message ?? ''}`);
  },
  emitTargets() {},
  emitLiveFrame() {},
  emitForensicReport() {},
  emitIncidentReport() {},
  emitAccessibility() {},
  emitUrlChanged() {},
};

async function main() {
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  const target = `http://localhost:${PORT}/`;
  const engine = new PlaywrightBrowserEngine();
  const settings: OptimizationSettings = {
    ...defaultOptimizationSettings,
    'execution-timebox-ms': 60000,
    'exploration-seed': 42,
  };
  const scenarios: TestingTypeId[] = ['exploratory', 'navigation'];

  console.log(`[e2e-nav] running engine against ${target} (60s timebox)…`);
  const result = await engine.run(target, noopTelemetry, settings, scenarios);
  console.log(`[e2e-nav] engine stopped: completed=${result.completed} — ${result.reason}`);

  const raw = engine.getConfirmedBugsFromMemory() as Array<{
    bugId: string; type: string; message: string; selector: string;
    reproductionSteps?: string[];
    attribution?: { bugClass?: string; scenario?: string; corroborated?: boolean };
  }>;

  const nav = raw.filter((b) => b.bugId.startsWith('nav-'));
  console.log(`\nTotal findings: ${raw.length} — navigation defects: ${nav.length}\n`);
  nav.forEach((b, i) => {
    console.log(`${i + 1}. ${b.bugId}`);
    console.log(`   [${b.attribution?.bugClass ?? b.type}] ${b.message}`);
    console.log(`   selector: ${b.selector || '(none)'}  repro steps: ${b.reproductionSteps?.length ?? 0}`);
  });
  server.close();
  process.exit(0);
}

main().catch((err) => { console.error('[e2e-nav] fatal:', err); server.close(); process.exit(1); });
