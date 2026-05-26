import { chromium } from 'playwright';
import type { BrowserEngine } from '../../application/ports/BrowserEngine.js';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import { AutonomousExplorationEngine } from '../../domain/services/AutonomousExplorationEngine.js';

export class PlaywrightBrowserEngine implements BrowserEngine {
  public async run(targetUrl: string, telemetry: TelemetryGateway): Promise<{ completed: boolean; reason: string }> {
    const engine = new AutonomousExplorationEngine();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    try {
      return await engine.run(page, targetUrl, telemetry, 60);
    } finally {
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }
}
