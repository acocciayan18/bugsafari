import { chromium } from 'playwright';
import type { BrowserEngine } from '../../application/ports/BrowserEngine.js';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import { AutonomousExplorationEngine } from '../../domain/services/AutonomousExplorationEngine.js';

export class PlaywrightBrowserEngine implements BrowserEngine {
  private activeEngine: AutonomousExplorationEngine | null = null;
  private activePage: import('playwright').Page | null = null;
  private activeContext: import('playwright').BrowserContext | null = null;
  private activeBrowser: import('playwright').Browser | null = null;
  private isStopping = false;

  public pause(): void {
    this.activeEngine?.pause();
  }

  public resume(): void {
    this.activeEngine?.resume();
  }

  public async stop(): Promise<void> {
    if (this.isStopping) {
      return;
    }
    this.isStopping = true;

    try {
      this.activeEngine?.stop();
      await this.cleanupResources();
    } finally {
      this.isStopping = false;
    }
  }

  public async run(targetUrl: string, telemetry: TelemetryGateway): Promise<{ completed: boolean; reason: string }> {
    this.activeEngine = new AutonomousExplorationEngine();
    this.activeBrowser = await chromium.launch({ headless: true });
    this.activeContext = await this.activeBrowser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    });
    this.activePage = await this.activeContext.newPage();

    try {
      return await this.activeEngine.run(this.activePage, targetUrl, telemetry, 60);
    } finally {
      await this.cleanupResources();
      this.activeEngine = null;
    }
  }

  private async cleanupResources(): Promise<void> {
    const page = this.activePage;
    const context = this.activeContext;
    const browser = this.activeBrowser;

    this.activePage = null;
    this.activeContext = null;
    this.activeBrowser = null;

    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}
