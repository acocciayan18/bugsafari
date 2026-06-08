import { chromium } from 'playwright';
import type { BrowserEngine } from '../../application/ports/BrowserEngine.js';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import { AutonomousExplorationEngine } from '../../domain/services/AutonomousExplorationEngine.js';
import type { FindingRepository } from '../../domain/repositories/FindingRepository.js';

export class PlaywrightBrowserEngine implements BrowserEngine {
  constructor(private readonly findingRepo?: FindingRepository) {}

  private activeEngine: AutonomousExplorationEngine | null = null;
  private activePage: import('playwright').Page | null = null;
  private activeContext: import('playwright').BrowserContext | null = null;
  private activeBrowser: import('playwright').Browser | null = null;
  private isStopping = false;
  // Store confirmed bugs before cleanup so they're accessible after engine runs
  private capturedConfirmedBugs: Array<{
    timestamp: string;
    type: string;
    message: string;
    url: string;
    stackTrace?: string;
    severity?: string;
  }> = [];

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
    this.activeEngine = new AutonomousExplorationEngine(this.findingRepo);
    this.activeBrowser = await chromium.launch({ headless: true });
    this.activeContext = await this.activeBrowser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    });
    this.activePage = await this.activeContext.newPage();

    let result: { completed: boolean; reason: string };
    try {
      result = await this.activeEngine.run(this.activePage, targetUrl, telemetry, 60);
    } finally {
      // Capture confirmed bugs before cleanup so they're accessible after engine runs
      this.capturedConfirmedBugs = this.activeEngine?.getConfirmedBugs() ?? [];
      await this.cleanupResources();
      this.activeEngine = null;
    }
    return result;
  }

  public getConfirmedBugs(): Array<{
    timestamp: string;
    type: string;
    message: string;
    url: string;
    stackTrace?: string;
    severity?: string;
  }> {
    return this.capturedConfirmedBugs;
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
