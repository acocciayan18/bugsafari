import { chromium } from 'playwright';
import type { BrowserEngine } from '../../application/ports/BrowserEngine.js';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import { AutonomousExplorationEngine } from '../../domain/services/AutonomousExplorationEngine.js';
import type { FindingRepository } from '../../domain/repositories/FindingRepository.js';

export class PlaywrightBrowserEngine implements BrowserEngine {
  constructor(private readonly findingRepo?: FindingRepository) { }

  private activeEngine: AutonomousExplorationEngine | null = null;
  private activePage: import('playwright').Page | null = null;
  private activeContext: import('playwright').BrowserContext | null = null;
  private activeBrowser: import('playwright').Browser | null = null;
  private isStopping = false;
  private isRunning = false; // Track if engine is currently running
  private pendingStop = false; // Flag to process stop request after engine starts
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
    console.log('[PlaywrightBrowserEngine] pause() called, activeEngine:', !!this.activeEngine);
    if (this.activeEngine) {
      this.activeEngine.pause();
      console.log('[PlaywrightBrowserEngine] Paused active engine');
    } else {
      console.log('[PlaywrightBrowserEngine] No active engine to pause (not started yet or already finished)');
    }
  }

  public resume(): void {
    console.log('[PlaywrightBrowserEngine] resume() called, activeEngine:', !!this.activeEngine);
    if (this.activeEngine) {
      this.activeEngine.resume();
      console.log('[PlaywrightBrowserEngine] Resumed active engine');
    } else {
      console.log('[PlaywrightBrowserEngine] No active engine to resume (not started yet or already finished)');
    }
  }

  public async stop(): Promise<void> {
    if (this.isStopping) {
      return;
    }
    this.isStopping = true;

    try {
      console.log('[PlaywrightBrowserEngine] stop() called, activeEngine:', !!this.activeEngine);
      if (this.activeEngine) {
        this.activeEngine.stop();
        console.log('[PlaywrightBrowserEngine] Stopped active engine');
      } else {
        console.log('[PlaywrightBrowserEngine] No active engine to stop (not started yet or already finished)');
      }
      await this.cleanupResources();
    } finally {
      this.isStopping = false;
    }
  }

  public async run(targetUrl: string, telemetry: TelemetryGateway): Promise<{ completed: boolean; reason: string }> {
    // Reset state and track that we're starting
    this.isRunning = true;
    this.isStopping = false;
    this.activeEngine = new AutonomousExplorationEngine(this.findingRepo);
    this.activeBrowser = await chromium.launch({ headless: true });
    this.activeContext = await this.activeBrowser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    });
    this.activePage = await this.activeContext.newPage();

    console.log('[PlaywrightBrowserEngine] Engine started, checking for pending operations...');

    // Process any pending stop request that came in before engine started
    if (this.pendingStop) {
      console.log('[PlaywrightBrowserEngine] Processing pending stop request');
      this.pendingStop = false;
      this.activeEngine.stop();
      this.isRunning = false;
      await this.cleanupResources();
      return { completed: false, reason: 'Safari session stopped by user (pending request)' };
    }

    let result: { completed: boolean; reason: string };
    try {
      result = await this.activeEngine.run(this.activePage, targetUrl, telemetry, 60);
    } finally {
      this.capturedConfirmedBugs = this.activeEngine?.getConfirmedBugsFromMemory() ?? [];
      this.isRunning = false;
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
