// Live-feed screencast integration probe. Needs a real Chromium, so run it inside
// the engine container (browsers at /ms-playwright):
//   podman exec bugsafari-api sh -c "cd /app/testing-core && npx tsx src/domain/services/telemetry/TelemetryEmitter.screencast.test.ts"
// Proves the CDP screencast path streams frames smoothly and stops cleanly.

import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { TelemetryEmitter } from './TelemetryEmitter.js';
import type { TelemetryGateway } from '../../../application/ports/TelemetryGateway.js';

// A page that repaints continuously so the screencast emits a steady stream.
const animatedPage = (color: string): string =>
  'data:text/html,' +
  encodeURIComponent(
    `<style>@keyframes m{from{transform:translateX(0)}to{transform:translateX(600px)}}` +
      `.b{width:80px;height:80px;background:${color};animation:m 1s linear infinite}</style>` +
      '<div class="b"></div>',
  );
const ANIMATED_PAGE = animatedPage('#2563eb');

async function main(): Promise<void> {
  const frames: number[] = [];
  const gateway = {
    emitLiveFrame: (b64: string) => { if (b64) frames.push(Date.now()); },
    emitTelemetry: () => {},
    emitAccessibility: () => {},
  } as unknown as TelemetryGateway;

  const emitter = new TelemetryEmitter(gateway, {
    isPaused: () => false,
    isStopRequested: () => false,
  });

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  } catch {
    console.log('⚠ skipped: no Chromium available — run inside the engine container (browsers at /ms-playwright)');
    return;
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(ANIMATED_PAGE);

  const LEG_MS = 1000;
  emitter.startFrameCaptureLoop(page);
  await new Promise((r) => setTimeout(r, LEG_MS));
  const beforeNav = frames.length;

  // The failing case: navigate to a new URL mid-stream. Chrome stops the screencast
  // on navigation, so without the re-arm the feed would freeze here.
  await page.goto(animatedPage('#dc2626'));
  await new Promise((r) => setTimeout(r, LEG_MS));
  const afterNav = frames.length - beforeNav;

  const total = frames.length;
  const captureMs = LEG_MS * 2;
  const fps = (total / captureMs) * 1000;
  const gaps: number[] = [];
  for (let i = 1; i < frames.length; i++) gaps.push(frames[i] - frames[i - 1]);
  const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : Infinity;
  const maxGap = gaps.length ? Math.max(...gaps) : Infinity;

  emitter.stopFrameCaptureLoop();
  const afterStop = frames.length;
  await new Promise((r) => setTimeout(r, 700));
  const stragglers = frames.length - afterStop;

  await browser.close();

  console.log(
    `beforeNav=${beforeNav}  afterNav=${afterNav}  total=${total}  ~${fps.toFixed(1)} fps  avgGap=${avgGap.toFixed(1)}ms  maxGap=${maxGap}ms  postStopStragglers=${stragglers}`,
  );

  // Frames must keep flowing AFTER the navigation — this is the "stuck on the old URL" fix.
  assert.ok(beforeNav >= 15, `expected a stream before nav (>=15), got ${beforeNav}`);
  assert.ok(afterNav >= 15, `expected the stream to RESUME after nav (>=15), got ${afterNav}`);
  // Smooth AND capped: steady ~30 fps, not the uncapped compositor rate (~60).
  assert.ok(fps >= 20 && fps <= 35, `expected the 30 fps cap (20-35), got ${fps.toFixed(1)}`);
  assert.ok(avgGap >= 28, `expected ~33ms pacing (avgGap>=28ms), got ${avgGap.toFixed(1)}ms`);
  // The stall watchdog bounds any navigation gap to ~1 s even in the worst case.
  assert.ok(maxGap <= 1200, `expected no long freeze (maxGap<=1200ms), got ${maxGap}ms`);
  assert.ok(stragglers <= 1, `expected the stream to stop, got ${stragglers} frames after stop`);

  console.log('\n✓ screencast survives navigation, stays capped at ~30 fps, stops cleanly');
}

main().catch((e) => { console.error(e); process.exit(1); });
