import { chromium } from 'playwright';
import type { BrowserEngine } from '../../application/ports/BrowserEngine.js';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import type { OptimizationSettings } from '../../../../developer-dashboard/src/types.js';
import { AutonomousExplorationEngine } from '../../domain/services/AutonomousExplorationEngine.js';
import type { FindingRepository } from '../../domain/repositories/FindingRepository.js';

export class PlaywrightBrowserEngine implements BrowserEngine {
  constructor(private readonly findingRepo?: FindingRepository) { }

  private activeEngine: AutonomousExplorationEngine | null = null;
  private optimizationSettings: OptimizationSettings | undefined = undefined;
  private activePage: import('playwright').Page | null = null;
  private activeContext: import('playwright').BrowserContext | null = null;
  private activeBrowser: import('playwright').Browser | null = null;
  private isStopping = false;
  private capturedConfirmedBugs: Array<{
    bugId: string;
    type: string;
    message: string;
    selector: string;
    payloadUsed: string;
    advice: string;
    timestamp: Date;
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

  public async run(targetUrl: string, telemetry: TelemetryGateway, optimizationSettings?: OptimizationSettings): Promise<{ completed: boolean; reason: string }> {
    this.optimizationSettings = optimizationSettings;
    console.log(`[PlaywrightBrowserEngine] Using optimization settings:`, optimizationSettings);
    this.activeEngine = new AutonomousExplorationEngine(this.findingRepo, optimizationSettings);
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
      this.capturedConfirmedBugs = this.activeEngine?.getConfirmedBugsFromMemory() ?? [];
      await this.cleanupResources();
      this.activeEngine = null;
    }
    return result;
  }

  public getConfirmedBugsFromMemory(): Array<{
    bugId: string;
    type: string;
    message: string;
    selector: string;
    payloadUsed: string;
    advice: string;
    timestamp: Date;
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
