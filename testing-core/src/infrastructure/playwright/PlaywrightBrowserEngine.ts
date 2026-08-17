import { chromium, type Browser } from 'playwright';
import type { BrowserEngine } from '../../application/ports/BrowserEngine.js';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import type { OptimizationSettings, StopReason, TargetAuthConfig, TestingTypeId } from '../../../../shared/types.js';
import { STOP_REASON_DETAIL, STOP_REASON_OUTCOME, describeTermination } from '../../../../shared/types.js';
import { AutonomousExplorationEngine } from '../../domain/services/AutonomousExplorationEngine.js';
import type { FindingRepository } from '../../domain/repositories/FindingRepository.js';
import type { RunResult } from '../../domain/services/exploration/types.js';
import { installReflectionOracle } from '../../bugs/finders/reflectionOracle.js';
import { TargetAuthenticator } from './TargetAuthenticator.js';
import { installCredentialMask } from './credentialMask.js';
import type { SessionRestoreFn } from '../../domain/services/exploration/SessionPreservationGuard.js';
import { setScrubValues, clearScrubValues } from '../../domain/services/telemetry/credentialScrub.js';
import { TelemetryEmitter } from '../../domain/services/telemetry/TelemetryEmitter.js';
import { AuthNarrator } from '../../domain/services/auth/AuthNarrator.js';

import { createLogger } from '../observability/logger.js';

const obsLog = createLogger('[PlaywrightBrowserEngine]');

// Env-tunable positive-integer viewport dimension with a safe fallback.
function readViewportInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Gate for per-run diagnostic dumps that add stdout write pressure and log volume
// without operational value in production. Errors/warnings are never gated.
const VERBOSE = process.env.BUGSAFARI_VERBOSE === '1' || process.env.BUGSAFARI_VERBOSE === 'true';

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
  // Public RUN- code stamped on this run's DB session doc for live/history id parity. Set before run().
  private runCode: string | null = null;
  private activePage: import('playwright').Page | null = null;
  private activeContext: import('playwright').BrowserContext | null = null;
  private activeBrowser: import('playwright').Browser | null = null;
  private isStopping = false;
  // Set by stop() while a run() is in flight; tags the in-flight run so its
  // catch block can tell "expected teardown from stop()" apart from a real bug.
  private cancelledDuringRun = false;
  // Trigger recorded by stop(); resolves the outcome when a run unwinds via cancellation.
  private stopReason: StopReason | null = null;
  private capturedConfirmedBugs: Array<{
    bugId: string;
    type: string;
    message: string;
    selector: string;
    payloadUsed: string;
    advice: string;
    timestamp: Date;
  }> = [];
  // Snapshot of distinct visited routes, captured at teardown so it survives after run() returns.
  private capturedVisitedRoutes: string[] = [];
  private currentBrowserInfo: BrowserInfo | null = null;

  public setRunCode(runCode: string): void {
    this.runCode = runCode;
  }

  public pause(): void {
    this.activeEngine?.pause();
  }

  public resume(): void {
    this.activeEngine?.resume();
  }

  // Delegate the settlement barrier to the live engine (no-op once torn down).
  public async settlePendingTasks(): Promise<void> {
    await this.activeEngine?.settlePendingTasks();
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
  public isTimeboxExceeded(timeboxMs?: number): boolean {
    return this.activeEngine?.isTimeboxExceeded(timeboxMs) ?? false;
  }

  /** DB session id of the most recently started run. Null for guests/in-memory runs. */
  public getLastSessionId(): string | null {
    return this.activeEngine?.getLastSessionId() ?? null;
  }

  public async stop(reason: StopReason = 'operator'): Promise<void> {
    if (this.isStopping) {
      return;
    }
    this.isStopping = true;

    try {
      // Tag any in-flight run() BEFORE tearing anything down, so its catch
      // block can recognize a resulting error as an expected side-effect of
      // this stop() rather than inferring it from the error's message. The
      // trigger is recorded too, so the terminal result names the real cause.
      this.cancelledDuringRun = true;
      this.stopReason = reason;
      // Force engine stop first - critical for zombie prevention
      if (this.activeEngine) {
        this.activeEngine.stop(reason);
        obsLog.info('[PlaywrightBrowserEngine] Engine stop requested');
        // Graceful shutdown: flush pending telemetry/DB writes BEFORE closing the
        // browser, so a stop can't strand in-flight forensic persistence.
        await this.activeEngine.settlePendingTasks();
      }
      // Clear engine reference immediately to prevent stale state
      this.activeEngine = null;
      await this.cleanupResources();
    } catch (err) {
      obsLog.error('[PlaywrightBrowserEngine] Stop error:', err instanceof Error ? err.message : String(err));
      // Ensure cleanup runs even on error
      await this.cleanupResources();
    } finally {
      this.isStopping = false;
    }
  }

  public async run(targetUrl: string, telemetry: TelemetryGateway, optimizationSettings?: OptimizationSettings, selectedScenarios?: TestingTypeId[], userId?: string, targetAuth?: TargetAuthConfig): Promise<RunResult> {
    // Fresh run: any cancellation tag belongs to a previous run and must not
    // leak forward and swallow a genuine failure in this one.
    this.cancelledDuringRun = false;
    this.stopReason = null;
    // Drop the prior run's confirmed-bug snapshot so a save during THIS run can
    // never persist another run's (or another user's) findings.
    this.capturedConfirmedBugs = [];
    this.optimizationSettings = optimizationSettings;
    obsLog.info(`[PlaywrightBrowserEngine] Using optimization settings:`, optimizationSettings);
    obsLog.info(`[PlaywrightBrowserEngine] Selected scenarios:`, selectedScenarios ?? '(all)');
    this.activeEngine = new AutonomousExplorationEngine(this.findingRepo, optimizationSettings, selectedScenarios, userId, this.runCode ?? undefined);
    // Launch browser with proper headless mode and timeout handling
    // Use headless: true for automated testing (no GUI)
    // Add explicit timeout to prevent hangs during browser startup
    const browserLaunchTimeoutMs = 30000;
    obsLog.info('[PlaywrightBrowserEngine] Starting browser launch', {
      headless: true,
      launchTimeoutMs: browserLaunchTimeoutMs,
      env: {
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
        NODE_ENV: process.env.NODE_ENV,
      },
    });

    // Both attempts are bounded. An untimed fallback could hang forever, and a
    // hung launch produces NO terminal handshake — run() never returns, so
    // execute()'s catch never fires and the dashboard has nothing to reconcile
    // against. Bounding it guarantees every boot ends in a verdict the client can see.
    const launchBounded = async (args: string[], label: string): Promise<Browser> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          chromium.launch({ headless: true, args }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`Browser launch timeout: ${label} launch failed to start within ${browserLaunchTimeoutMs}ms`)),
              browserLaunchTimeoutMs,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    try {
      this.activeBrowser = await launchBounded(
        [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          // Suppress background work irrelevant to exploration. --start-maximized was
          // a no-op headless (overridden by the explicit viewport) and is dropped.
          '--disable-background-networking',
          // Anti-throttling: a throttled background timer in a headless page can make
          // the engine observe a frozen app and mis-report it — costs a little CPU,
          // correct here.
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-extensions',
          '--disable-default-apps',
          '--disable-sync',
          '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-first-run',
          '--no-default-browser-check',
        ],
        'primary',
      );
    } catch (launchError) {
      obsLog.error('[PlaywrightBrowserEngine] Browser launch failed:', launchError);
      obsLog.info('[PlaywrightBrowserEngine] Attempting fallback launch with minimal args...');

      try {
        this.activeBrowser = await launchBounded(['--no-sandbox', '--disable-setuid-sandbox'], 'fallback');
      } catch (fallbackError) {
        obsLog.error('[PlaywrightBrowserEngine] Fallback browser launch failed:', fallbackError);
        throw fallbackError;
      }
    }

    // Env-tunable but defaulted to the historical 1440x900: the viewport alters what
    // the engine SEES (responsive breakpoints, above-the-fold visibility), so it can
    // shift which elements are discovered and scored. Reducing it (e.g. 1280x800) is
    // benchmark-gated — re-baseline with bench:e2e before changing the default.
    const VIEWPORT_WIDTH = readViewportInt('BUGSAFARI_VIEWPORT_WIDTH', 1440);
    const VIEWPORT_HEIGHT = readViewportInt('BUGSAFARI_VIEWPORT_HEIGHT', 900);

    // Diagnostic: Log viewport configuration
    if (VERBOSE) obsLog.info(`[PlaywrightBrowserEngine] Viewport configured: ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}`);
    // attributionUserAgent is pure (no browser I/O), safe before the guard.
    // Optional attribution User-Agent (SEC-01.6): identify BugSafari with a contact so
    // a scanned party can trace/report a run. Opt-in via env — default keeps the stock
    // Chromium UA, since a non-standard UA can change what a target serves.
    const attributionUserAgent = process.env.BUGSAFARI_USER_AGENT?.trim();

    // The browser is live but the run-level try/finally below has not begun. Any throw
    // while creating the context/page, installing the oracle/mask, or running the boot
    // evaluate must still close the browser — else a failed/duplicate start leaks a
    // zombie Chromium process. This guard guarantees cleanup on that window.
    let bootEmitter: TelemetryEmitter | undefined;
    try {
      const browserVersion = await this.activeBrowser.version();
      if (VERBOSE) obsLog.info(`[PlaywrightBrowserEngine] Screen: ${browserVersion}`);

      this.activeContext = await this.activeBrowser.newContext({
        viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
        ignoreHTTPSErrors: true,
        deviceScaleFactor: 1,
        ...(attributionUserAgent ? { userAgent: attributionUserAgent } : {}),
      });
      this.activePage = await this.activeContext.newPage();

      // Install the reflection-oracle execution hook before any navigation so an
      // injected XSS payload that fires an event handler can positively prove
      // execution (the raw-reflection check works regardless of this).
      await installReflectionOracle(this.activePage);

      // Same constraint: an init script only reaches documents created after it is
      // registered, and the login flow navigates before the exploration engine does.
      await installCredentialMask(this.activePage);

      // Telemetry channel for the pre-exploration window. The engine builds its own
      // emitter later; until then this one carries the login narration and starts the
      // frame loop immediately, so the dashboard streams the target from about:blank
      // onward instead of showing "establishing telemetry stream" through the login.
      bootEmitter = new TelemetryEmitter(telemetry, {
        isPaused: () => false,
        isStopRequested: () => this.isStopping,
      });
      bootEmitter.startFrameCaptureLoop(this.activePage);

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

      if (VERBOSE) obsLog.info(`[PlaywrightBrowserEngine] Browser info captured:`, this.currentBrowserInfo);

      // Diagnostic: verify page viewport. Gated — this is a per-run CDP round-trip whose
      // only consumer is the log below, so it is pure cost outside debugging.
      if (VERBOSE) {
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
        obsLog.info(`[PlaywrightBrowserEngine] Initial viewport metrics:`, JSON.stringify(initialViewport));
      }
    } catch (setupError) {
      // Stop the boot frame loop if it started, then close the browser before rethrow.
      bootEmitter?.stopFrameCaptureLoop();
      await this.cleanupResources();
      this.activeEngine = null;
      throw setupError;
    }

    // Past the catch (which rethrows) the boot emitter is always set.
    const boot = bootEmitter;
    if (!boot) throw new Error('[PlaywrightBrowserEngine] boot telemetry emitter missing after setup');

    let result: RunResult;
    try {
      //  RACE CONDITION FIX: Check if engine was nullified during rapid cancellation
      if (!this.activeEngine) {
        // Gracefully abort - session was terminated by request before exploration began
        return this.cancellationResult(telemetry);
      }
      
      //  Authenticate into the target BEFORE exploration, so the engine's own
      // navigation lands on an authenticated session. Runs after the reflection
      // oracle and the credential mask are installed — both must precede every
      // navigation, login included. Frames stream throughout: the mask renders the
      // credential fields as bullets, so no frame can carry a readable value.
      // Exploration base URL. For an authenticated run it is REPLACED by wherever
      // login landed (below), so the engine explores the authenticated surface —
      // not the login URL, which would just bounce it back to the public form.
      let explorationUrl = targetUrl;
      // Injected into the engine on an authenticated run so the session guard can
      // re-authenticate in place after a session loss. The engine receives this
      // opaque callback only — never the credentials/state (least privilege).
      let restoreSession: SessionRestoreFn | undefined;
      let authOriginsVisited: string[] = [];
      if (targetAuth) {
        // Only a form login types literals into the page; a seeded session has no
        // value the target could echo back, so there is nothing to register.
        if (targetAuth.mode === 'credentials') {
          setScrubValues([targetAuth.username, targetAuth.password]);
        }
        // Narrates every phase to the Live Feed and records the replayable steps
        // into the playbook. The engine exists but has not started, so its trace
        // buffers are already scoped to this run and accept the login steps first.
        const narrator = new AuthNarrator(boot, (step) => this.activeEngine?.recordAuthStep(step));
        const auth = await new TargetAuthenticator().authenticate(this.activePage, targetAuth, targetUrl, narrator);
        authOriginsVisited = auth.originsVisited ?? [];
        if (auth.status !== 'authenticated') {
          // Deliberately NOT continuing unauthenticated: the engine would explore the
          // login page, find nothing, and report a clean run — a silently wrong result.
          return {
            completed: false,
            reason: `Target authentication failed: ${auth.reason}. No exploration performed.`,
            outcome: 'graceful-shutdown',
          };
        }
        this.activeEngine.recordAuthenticationMarker();
        // const capture preserves the narrowed (non-undefined) config type inside the closure.
        const authConfig = targetAuth;
        // Re-auth deterministically: pin restore to the form this login actually
        // resolved (its URL + selectors) so a mid-run session-restore navigates
        // straight back to the real login instead of re-guessing conventional auth
        // routes — the guessing that could strand the page on a non-existent route.
        const restoreConfig: TargetAuthConfig =
          auth.resolution && auth.loginUrl
            ? {
                ...authConfig,
                loginUrl: auth.loginUrl,
                usernameSelector: auth.resolution.username,
                passwordSelector: auth.resolution.password,
                submitSelector: auth.resolution.submit || authConfig.submitSelector,
              }
            : authConfig;
        restoreSession = async (restorePage): Promise<boolean> => {
          try {
            const result = await new TargetAuthenticator().authenticate(restorePage, restoreConfig, targetUrl, narrator);
            return result.status === 'authenticated';
          } catch {
            return false;
          }
        };
        // Explore from the post-login landing page, not the login URL. Re-navigating
        // to targetUrl (the login form) would abandon the authenticated session's
        // location and strand exploration on the public login/registration pages —
        // the exact "clean result for an untested surface" the fail path guards against.
        // Fall back to targetUrl if the landing URL is unusable (e.g. about:blank).
        const landedUrl = this.activePage.url();
        if (landedUrl && /^https?:/i.test(landedUrl)) {
          explorationUrl = landedUrl;
          // An SSO round-trip can land on a different host than the run started on
          // (www.app.com → idp → app.com); approve wherever the session actually is.
          authOriginsVisited = [...authOriginsVisited, new URL(landedUrl).origin];
        }
      }

      // Origins only — the auth config itself never crosses into the engine (least
      // privilege), but the login host must stay approved (SSO popup, or a login URL
      // on a different origin than the post-login landing page just adopted above).
      // authOriginsVisited covers wherever the login actually went — including an
      // identity provider a Sign In control redirected to, which no static config
      // could have named up front.
      const authOrigins = targetAuth
        ? [...new Set([
            new URL(targetUrl).origin,
            ...(targetAuth.mode === 'credentials' && targetAuth.loginUrl
              ? [new URL(targetAuth.loginUrl, targetUrl).origin]
              : []),
            ...authOriginsVisited,
          ])]
        : [];

      // Hand the frame stream over: TabWindowManager starts the engine's own 33ms
      // loop on a DIFFERENT emitter instance, so ours must be stopped or its
      // interval outlives the boot window and double-broadcasts for the whole run.
      boot.stopFrameCaptureLoop();

      // Pass browserInfo to the engine for telemetry collection
      result = await this.activeEngine.run(this.activePage, explorationUrl, telemetry, 150, this.currentBrowserInfo, authOrigins, restoreSession);
    } catch (err: unknown) {
      //  RACE CONDITION FIX: only treat this as an expected, graceful stop
      // when stop() actually tagged this run as cancelled. Previously this
      // matched on `err instanceof TypeError && message.includes('Cannot read
      // properties of null')`, which would just as happily swallow a genuine
      // null-deref bug unrelated to cancellation — misreporting a real crash
      // as a clean stop. Gating on the explicit tag removes that ambiguity.
      if (this.cancelledDuringRun) {
        return this.cancellationResult(telemetry);
      }
      // Re-throw unexpected errors
      throw err;
    } finally {
      // Idempotent — covers the early returns (cancellation, auth failure) that
      // never reach the hand-over above.
      boot.stopFrameCaptureLoop();
      this.capturedConfirmedBugs = this.activeEngine?.getConfirmedBugsFromMemory() ?? [];
      this.capturedVisitedRoutes = this.activeEngine?.getVisitedRoutes() ?? this.capturedVisitedRoutes;
      clearScrubValues();
      await this.cleanupResources();
      this.activeEngine = null;
    }
    return result;
  }

  // Terminal result for a run cancelled before or during startup, attributed to
  // whoever called stop(). An untagged cancellation is an internal shutdown.
  private cancellationResult(telemetry: TelemetryGateway): RunResult {
    const trigger = this.stopReason ?? 'internal-shutdown';
    const outcome = STOP_REASON_OUTCOME[trigger];
    const reason = STOP_REASON_DETAIL[trigger];
    telemetry.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'ACTION',
      meta: {
        actionExecuted: 'session-initialization-terminated',
        message: describeTermination(outcome, reason),
      },
    });
    return { completed: false, reason, outcome };
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
    // While a run is live, read straight from the active engine (this run's own
    // memory); only fall back to the captured snapshot after teardown.
    return this.activeEngine?.getConfirmedBugsFromMemory() ?? this.capturedConfirmedBugs;
  }

  public getVisitedRoutes(): string[] {
    // Live: read the active engine; post-teardown: the captured snapshot.
    return this.activeEngine?.getVisitedRoutes() ?? this.capturedVisitedRoutes;
  }

  private async cleanupResources(): Promise<void> {
    const page = this.activePage;
    const context = this.activeContext;
    const browser = this.activeBrowser;

    this.activePage = null;
    this.activeContext = null;
    this.activeBrowser = null;

    // Forcefully close page with error handling
    if (page) {
      try {
        await page.close();
      } catch (err) {
        obsLog.error('[PlaywrightBrowserEngine] Failed closing page:', err instanceof Error ? err.message : String(err));
      }
    }

    // Forcefully close context with error handling
    if (context) {
      try {
        await context.close();
      } catch (err) {
        obsLog.error('[PlaywrightBrowserEngine] Failed closing context:', err instanceof Error ? err.message : String(err));
      }
    }

    // Forcefully close browser to prevent zombie processes - critical for cleanup
    if (browser) {
      try {
        await browser.close();
        obsLog.info('[PlaywrightBrowserEngine] Browser closed successfully');
      } catch (err) {
        obsLog.error('[PlaywrightBrowserEngine] Failed killing zombie browser:', err instanceof Error ? err.message : String(err));
        // Try force kill as last resort
        try {
          if (!browser.isConnected()) {
            obsLog.info('[PlaywrightBrowserEngine] Browser already disconnected');
          } else {
            await browser.close();
          }
        } catch (forceErr) {
          obsLog.error('[PlaywrightBrowserEngine] Force kill failed:', forceErr instanceof Error ? forceErr.message : String(forceErr));
        }
      }
    }
  }
}
