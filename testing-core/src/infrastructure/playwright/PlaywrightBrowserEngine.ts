import { chromium } from 'playwright';
import type { BrowserEngine } from '../../application/ports/BrowserEngine.js';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import type { OptimizationSettings } from '../../../../shared/types.js';
import { AutonomousExplorationEngine } from '../../domain/services/AutonomousExplorationEngine.js';
import type { FindingRepository } from '../../domain/repositories/FindingRepository.js';

/**
 * Browser and system information captured at launch
 */
export interface BrowserInfo {
  browser: string;
  browserVersion: string;
  browserEngine: string;
  operatingSystem: string;
  platform: string;
  screenResolution: string;
  viewportWidth: number;
  viewportHeight: number;
}

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
  private currentBrowserInfo: BrowserInfo | null = null;

public pause(): void {
    this.activeEngine?.pause();
  }

  public resume(): void {
    this.activeEngine?.resume();
  }

  /**
   * Get the accumulated active execution time in milliseconds.
   * Only counts time when the engine is NOT paused.
   */
  public getElapsedActiveTimeMs(): number {
    return this.activeEngine?.getElapsedActiveTimeMs() ?? 0;
  }

  /**
   * Check if the timebox has been exceeded.
   * Returns true only when elapsed active time >= timeboxMs AND engine is NOT paused.
   */
  public isTimeboxExceeded(timeboxMs: number = 180000): boolean {
    return this.activeEngine?.isTimeboxExceeded(timeboxMs) ?? false;
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
// Launch browser with proper headless mode and timeout handling
    // Use headless: true for automated testing (no GUI)
    // Add explicit timeout to prevent hangs during browser startup
    const browserLaunchTimeoutMs = 30000;
    console.log('[PlaywrightBrowserEngine] Starting browser launch', {
      headless: true,
      launchTimeoutMs: browserLaunchTimeoutMs,
      env: {
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
        NODE_ENV: process.env.NODE_ENV,
      },
    });

    try {
      this.activeBrowser = await Promise.race([
        chromium.launch({
          headless: true,
          args: [
            '--start-maximized',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-sandbox',
          ],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Browser launch timeout: browser failed to start within ${browserLaunchTimeoutMs}ms`)),
            browserLaunchTimeoutMs,
          ),
        ),
      ]);
    } catch (launchError) {
      console.error('[PlaywrightBrowserEngine] Browser launch failed:', launchError);
      console.log('[PlaywrightBrowserEngine] Attempting fallback launch with minimal args...');

      try {
        this.activeBrowser = await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
      } catch (fallbackError) {
        console.error('[PlaywrightBrowserEngine] Fallback browser launch failed:', fallbackError);
        throw fallbackError;
      }
    }

    const VIEWPORT_WIDTH = 1440;
    const VIEWPORT_HEIGHT = 900;
    
    // Diagnostic: Log viewport configuration
    console.log(`[PlaywrightBrowserEngine] Viewport configured: ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}`);
    const browserVersion = await this.activeBrowser.version();
    console.log(`[PlaywrightBrowserEngine] Screen: ${browserVersion}`);
    
    this.activeContext = await this.activeBrowser.newContext({
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      ignoreHTTPSErrors: true,
      deviceScaleFactor: 1,
    });
    this.activePage = await this.activeContext.newPage();
    
    // Capture browser info and system details for telemetry
    const platformInfo = await this.activePage.evaluate(() => {
      return {
        platform: navigator.platform,
        userAgent: navigator.userAgent,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
      };
    });

    // Store browser info for telemetry
    this.currentBrowserInfo = {
      browser: 'Chromium',
      browserVersion: browserVersion,
      browserEngine: 'Blink',
      operatingSystem: platformInfo.platform,
      platform: platformInfo.platform,
      screenResolution: `${platformInfo.screenWidth}x${platformInfo.screenHeight}`,
      viewportWidth: VIEWPORT_WIDTH,
      viewportHeight: VIEWPORT_HEIGHT,
    };

    console.log(`[PlaywrightBrowserEngine] Browser info captured:`, this.currentBrowserInfo);

    // Diagnostic: Verify page viewport
    const initialViewport = await this.activePage.evaluate(() => {
      return {
        windowInnerWidth: window.innerWidth,
        windowInnerHeight: window.innerHeight,
        documentClientWidth: document.documentElement?.clientWidth ?? 0,
        documentClientHeight: document.documentElement?.clientHeight ?? 0,
        bodyClientWidth: document.body?.clientWidth ?? 0,
        bodyClientHeight: document.body?.clientHeight ?? 0,
        scrollWidth: document.documentElement?.scrollWidth ?? 0,
        scrollHeight: document.documentElement?.scrollHeight ?? 0,
      };
    });
    console.log(`[PlaywrightBrowserEngine] Initial viewport metrics:`, JSON.stringify(initialViewport));

    let result: { completed: boolean; reason: string };
    try {
      // Pass browserInfo to the engine for telemetry collection
      result = await this.activeEngine.run(this.activePage, targetUrl, telemetry, 60, this.currentBrowserInfo);
    } finally {
      this.capturedConfirmedBugs = this.activeEngine?.getConfirmedBugsFromMemory() ?? [];
      await this.cleanupResources();
      this.activeEngine = null;
    }
    return result;
  }

  /**
   * Get the captured browser info
   */
  public getBrowserInfo(): BrowserInfo | null {
    return this.currentBrowserInfo;
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
