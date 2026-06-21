import type { Dialog, Page, Request, Response } from 'playwright';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import type { OptimizationSettings } from '../../../../shared/types.js';
import type { ActionBreadcrumb, ActionRecord, ActionType, TelemetryEvent } from '../../../../shared/types.ts';
import { CircularBuffer } from '../../lib/circularBuffer.js';

// ─────────────────────────────────────────────────────────────
// SECURITY PATCHES (Addressing Critical Vulnerabilities)
// ─────────────────────────────────────────────────────────────

/**
 * Maximum number of confirmed bugs to store in memory.
 * Prevents resource exhaustion during long-running SPA exploration sessions.
 * Task 3A: Patch Memory Leaks
 */
const MAX_CONFIRMED_BUGS = 500;

/**
 * Sanitizes exception stack traces to prevent information disclosure.
 * Strips internal file paths, Node.js internals, and environment-specific variables
 * before broadcasting EXCEPTION telemetry to the frontend.
 * Task 1: Remediate Information Disclosure
 */
function sanitizeException(error: Error | string): { message: string; stackTrace: string } {
  const message = typeof error === 'string' ? error : error.message;
  let stackTrace = typeof error === 'string' ? error : (error.stack ?? message);

  // Normalize line separators
  stackTrace = stackTrace.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Remove file paths that expose server internals
  // Windows paths
  stackTrace = stackTrace.replace(/C:\\Users\\[^\\]+\\/g, '[REDACTED_PATH]/g');
  stackTrace = stackTrace.replace(/C:\/[^\/]+\//g, '[REDACTED_PATH]/g');
  // Unix/Linux paths
  stackTrace = stackTrace.replace(/\/home\/[^\/]+\//g, '[REDACTED_PATH]/g');
  stackTrace = stackTrace.replace(/\/Users\/[^\/]+\//g, '[REDACTED_PATH]/g');

  // Remove Node.js internal paths
  stackTrace = stackTrace.replace(/node:[/\\][^\n]*/g, '[NODE_INTERNAL]');
  stackTrace = stackTrace.replace(/\/node_modules\/[^\n]*/g, '[NODE_MODULE]');

  // Remove environment variables references
  stackTrace = stackTrace.replace(/process\.env\.[A-Za-z_0-9]+/g, '[ENV_VAR]');
  stackTrace = stackTrace.replace(/NODE_ENV=[^\s\n]*/g, '[ENV_VAR]');
  stackTrace = stackTrace.replace(/DATABASE_URL=[^\s\n]*/g, '[ENV_VAR]');
  stackTrace = stackTrace.replace(/API_KEY=[^\s\n]*/g, '[ENV_VAR]');
  stackTrace = stackTrace.replace(/SECRET_[A-Za-z_0-9]*/g, '[SECRET]');

  // Remove anonymous function details (anonymous at position ...)
  stackTrace = stackTrace.replace(/anonymous at .+/g, '[anonymous function]');

  // Remove line/column numbers that could hint at codebase structure
  stackTrace = stackTrace.replace(/:(\d+):(\d+)/g, ':[LINE]:[COL]');

  // Extract just the error type name if present (e.g., "TypeError:", "ReferenceError:")
  const errorTypeMatch = stackTrace.match(/^([A-Za-z]+Error):/);
  const errorType = errorTypeMatch ? errorTypeMatch[1] : 'Error';

  return {
    message: `${errorType}: ${message}`,
    stackTrace,
  };
}
import { RecursiveDomParser } from '../heuristics/domParser.js';
import { DomHasher } from '../../ml/domHasher.js';
import { VisualRegressionDetector, CATASTROPHIC_SHIFT_THRESHOLD } from '../heuristics/VisualRegressionDetector.js';
import { SeededRandomGenerator } from './SeededRandomGenerator.js';
import { InteractionSimulator } from '../scenarios/rapidClickerStress.js';
import { RiskScorer } from './RiskScorer.js';
import { ChaosTransactionManager } from '../fuzzing/ChaosTransactionManager.js';
import { BoundingBoxHighlighter } from '../../infrastructure/playwright/BoundingBoxHighlighter.js';
import type { InteractiveElement } from '../entities/InteractiveElement.js';
import type { StressScenario } from '../scenarios/types.js';
import { stressScenarioMap, stressScenarioRegistry, formBypasser, networkSaboteur } from '../scenarios/index.js';
import { classifyInputElement } from '../scenarios/fuzzing/elementClassifier.js';
import { getStrategyByCategory } from '../scenarios/fuzzing/strategies/index.js';
import { setupStabilityMonitoring } from '../../infrastructure/monitoring/stabilityMonitor.js';
import { setupBrowserConsoleListener } from '../../infrastructure/monitoring/browserConsoleListener.js';
import type { FindingRepository } from '../repositories/FindingRepository.js';
import type { BrowserInfo } from '../../infrastructure/playwright/PlaywrightBrowserEngine.js';
import { ReproductionPlaybookStore } from '../../infrastructure/monitoring/reproductionPlaybookStore.js';
import { forensicErrorRepository } from '../../infrastructure/database/repositories/ForensicErrorRepository.js';
import { forensicTelemetryRepository } from '../../infrastructure/database/repositories/ForensicTelemetryRepository.js';
import { forensicScreenshotRepository } from '../../infrastructure/database/repositories/ForensicScreenshotRepository.js';
import { ForensicErrorType, ForensicErrorSeverity } from '../../infrastructure/database/models/ForensicErrorModel.js';
import { ForensicScreenshotType } from '../../infrastructure/database/models/ForensicScreenshotModel.js';
import { Types } from 'mongoose';

// Import StateGraphNavigator and types from DIrectedPathFinder
import { StateGraphNavigator } from './StateGraphNavigator.js';
import type {
  PathfinderDecision,
  PathfinderElement,
  EdgeSelector,
} from './DIrectedPathFinder.js';

export class AutonomousExplorationEngine {
  private readonly parser = new RecursiveDomParser();
  private readonly hashManager = new DomHasher();
  private readonly visualRegressionDetector = new VisualRegressionDetector();
  private readonly baselineScreenshots = new Map<string, Buffer>();
  private readonly simulator = new InteractionSimulator();
  private readonly scorer = new RiskScorer();
  private readonly highlighter = new BoundingBoxHighlighter();
  private readonly actions = new CircularBuffer<ActionBreadcrumb>(20);
  private readonly visitedUrls = new Set<string>();
  private readonly visitedHashes = new Set<string>();
  private readonly recentActionTraceIds: string[] = [];
  // State Graph Navigator for directed path finding and loop prevention (Task 2)
  private readonly pathNavigator = new StateGraphNavigator();
  private sessionId: string | null = null;
  private freezeActionTraceRecording = false;
  private lastBrainSnapshotStep = 0;
  private targetOrigin = '';

private isPaused = false;
  private isStopRequested = false;
  private chaosThreshold = 0.25; // 25% chance to escalate to security scenarios for text inputs

// Accumulative active time tracking for timebox (only counts when NOT paused)
  private elapsedActiveTimeMs: number = 0;
  private timingInterval: ReturnType<typeof setInterval> | null = null;
  private lastTickTimestamp: number = 0;
  private timeboxMs: number = 180000; // Default 3 minutes
  private timeboxExceeded: boolean = false;
  
  // Timer snapshot tracking for pause/resume support
  private pauseSnapshotTimeMs: number = 0;  // Time accumulated when PAUSE was triggered
  private dynamicDeadline: number = 0;  // Absolute deadline for resume calculation

  // Stability monitoring cleanup function - disposed in finally block
  private cleanupStabilityMonitor: (() => void) | null = null;

  // Independent frame capture loop state
  private page: Page | null = null;
  private frameCaptureInterval: ReturnType<typeof setInterval> | null = null;
  private isFrameBroadcastInFlight = false;
  private currentTelemetry: TelemetryGateway | null = null;

  private confirmedBugsMemory: Array<{
    bugId: string;
    type: string;
    message: string;
    selector: string;
    payloadUsed: string;
    advice: string;
    timestamp: Date;
  }> = [];

// Runtime metrics for Phase 3 telemetry tracking
  private runtimeMetrics = {
    startTime: 0,
    requestsCount: 0,
    pageCount: 0,
    interactionCount: 0,
    failureCount: 0,
  };

// ChaosTransactionManager for wrapping input field fuzzing sequences
  private fuzzManager: ChaosTransactionManager;

  // SeededRandomGenerator for deterministic/reproducible fuzzing decisions
  private seededRandom: SeededRandomGenerator;

  // Data fuzzer decision threshold - use heuristic scoring for intelligent decision
  private dataFuzzerThreshold = 0.3; // Use data fuzzer when target risk score >= 0.3

constructor(
    private readonly findingRepo?: FindingRepository,
    private readonly optimizationSettings?: OptimizationSettings,
  ) {
    console.log(`[AutonomousExplorationEngine] Optimization settings:`, optimizationSettings);

// Initialize ChaosTransactionManager with telemetry and action buffer callbacks
    this.fuzzManager = new ChaosTransactionManager(
      // WebSocket emitter callback - uses the event helper for consistent telemetry format
      (type: string, payload: any) => {
        console.log(`[ChaosTransactionManager] Emitting ${type}:`, payload.message ?? payload.bugType);
      },
      // Recent steps callback - queries the circular action buffer for crash context
      () => this.actions.snapshot()
    );

// Initialize SeededRandomGenerator for deterministic fuzzing decisions
    // Use seed from optimizationSettings if provided, otherwise undefined (non-reproducible mode)
    // Note: randomSeed can be added to OptimizationSettings interface for reproducible testing
    const seed = (this.optimizationSettings as any)?.randomSeed as number | undefined;
    this.seededRandom = new SeededRandomGenerator(seed);
    
    // Log mode for thesis panel demonstration
    if (seed !== undefined) {
      console.log(`[AutonomousExplorationEngine] Running in SEEDED mode (seed: ${seed}) for reproducible testing`);
    } else {
      console.log(`[AutonomousExplorationEngine] Running in HEURISTIC mode for intelligent data fuzzer decisions`);
    }
  }

  /**
   * Determines whether to use data fuzzer based on hybrid approach:
   * - Heuristic mode (default): Use data fuzzer when target risk score >= threshold
   * - Seeded mode: Use seeded RNG for deterministic decision when seed provided
   */
  private shouldUseDataFuzzer(target: InteractiveElement): boolean {
    const isInputField = target.tagName === 'input' || target.tagName === 'textarea';
    
    if (!isInputField) {
      return false;
    }

    // If seeded random generator is configured, use deterministic mode
    if (this.seededRandom.isSeeded()) {
      const randomValue = this.seededRandom.next();
      return randomValue < 0.5; // 50% chance when seeded for backwards compatibility
    }

    // Heuristic mode: Use data fuzzer based on risk score threshold
    const riskScore = Number(target.riskScore);
    return riskScore >= this.dataFuzzerThreshold;
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
    return this.confirmedBugsMemory;
  }

  public registerConfirmedBug(bug: {
    bugId: string;
    type: string;
    message: string;
    selector: string;
    payloadUsed: string;
    advice: string;
    timestamp: Date;
  }): void {
    // Deduplication: check if bug already exists in memory
    const isDuplicate = this.confirmedBugsMemory.some(
      existing => existing.type === bug.type && existing.message === bug.message
    );

    if (!isDuplicate) {
      this.confirmedBugsMemory.push(bug);

      // Task 3A: Enforce memory cap to prevent resource exhaustion
      // Use circular buffer approach - remove oldest entry when cap is reached
      while (this.confirmedBugsMemory.length > MAX_CONFIRMED_BUGS) {
        this.confirmedBugsMemory.shift();
      }
    }
  }

public pause() {
    // Record the snapshot of elapsed time when pausing
    this.pauseSnapshotTimeMs = this.elapsedActiveTimeMs;
    this.isPaused = true;
    console.log(`[AutonomousExplorationEngine] Session PAUSED at ${this.pauseSnapshotTimeMs}ms elapsed`);
  }

  public resume() {
    // Calculate the new dynamic deadline based on accumulated time
    const remainingTimeMs = Math.max(0, this.timeboxMs - this.elapsedActiveTimeMs);
    this.dynamicDeadline = Date.now() + remainingTimeMs;
    this.isPaused = false;
    console.log(`[AutonomousExplorationEngine] Session RESUMED with ${remainingTimeMs}ms remaining (elapsed: ${this.elapsedActiveTimeMs}ms)`);
  }

  /**
   * Get the remaining time in ms (for external queries like the dashboard).
   */
  public getRemainingTimeMs(): number {
    return Math.max(0, this.timeboxMs - this.elapsedActiveTimeMs);
  }

public stop() {
    this.isStopRequested = true;
    this.isPaused = false;
  }

  /**
   * Get the accumulated active execution time (in ms).
   * Only counts time when the engine is NOT paused.
   */
  public getElapsedActiveTimeMs(): number {
    return this.elapsedActiveTimeMs;
  }

  /**
   * Set the accumulated active execution time (for resumable scenarios).
   */
  public setElapsedActiveTimeMs(ms: number): void {
    this.elapsedActiveTimeMs = ms;
  }

/**
   * Check if the timebox has been exceeded.
   * Timebox exceeded only triggers when NOT paused.
   */
  public isTimeboxExceeded(timeboxMs: number = 180000): boolean {
    return this.elapsedActiveTimeMs >= timeboxMs && !this.isPaused;
  }

  /**
   * Check if timebox has been exceeded and terminate gracefully if so.
   * Should be called at the start of each loop iteration.
   * 
   * @param telemetry - Telemetry gateway for emitting timeout event
   * @returns true if timebox exceeded (caller should exit loop), false otherwise
   */
  private checkTimeboxAndTerminateIfExceeded(telemetry: TelemetryGateway): boolean {
    if (this.isTimeboxExceeded(this.timeboxMs) && !this.timeboxExceeded) {
      this.timeboxExceeded = true;
      this.stopTimingInterval();
      
      // Emit timeout telemetry
      telemetry.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'ACTION',
        meta: {
          actionExecuted: 'timebox-exceeded',
          message: `Execution timebox of ${this.timeboxMs}ms (${this.timeboxMs / 60000}min) exceeded - active time only`,
        },
      });
      
      return true;
    }
    return false;
  }

/**
   * Start the timing interval that accumulates active time.
   * Time only accumulates when NOT paused.
   * Emits TIME_REMAINING telemetry every 1 second to sync with frontend.
   */
  private startTimingInterval(telemetry: TelemetryGateway): void {
    this.elapsedActiveTimeMs = 0;
    this.lastTickTimestamp = Date.now();
    let tickCounter = 0;
    
    this.timingInterval = setInterval(() => {
      if (!this.isPaused && !this.isStopRequested) {
        const now = Date.now();
        const delta = now - this.lastTickTimestamp;
        this.elapsedActiveTimeMs += delta;
        this.lastTickTimestamp = now;
        
// Emit TIME_REMAINING every 10 ticks (1 second)
        tickCounter++;
        if (tickCounter >= 10) {
          tickCounter = 0;
          const remainingTimeMs = Math.max(0, this.timeboxMs - this.elapsedActiveTimeMs);
          // INFRASTRUCTURE TIME UPDATES REMOVED - Internal tracking continues for hard stop enforcement
          // The time tracking logic still runs internally to enforce 3-minute timeout
        }
      } else {
        // When paused or stopped, just update tick reference without accumulating
        this.lastTickTimestamp = Date.now();
      }
    }, 100);
  }

  /**
   * Stop the timing interval.
   */
  private stopTimingInterval(): void {
    if (this.timingInterval) {
      clearInterval(this.timingInterval);
      this.timingInterval = null;
    }
  }

  private breadcrumbsToActionRecords(breadcrumbs: ActionBreadcrumb[]): ActionRecord[] {
    return breadcrumbs.map((crumb) => ({
      timestamp: crumb.timestamp,
      type: (crumb.action.toUpperCase() as unknown as ActionType) || 'CLICK',
      selector: crumb.selector,
      url: this.targetOrigin || 'unknown',
      payload: crumb.payload,
    }));
  }

  private emitMilestone(telemetry: TelemetryGateway, message: string): void {
    telemetry.emitTelemetry(
      this.event('ACTION', {
        actionExecuted: 'engine-milestone',
        message,
      }),
    );
  }

  /**
   * Emit granular system status for dynamic UI (Task 3).
   * Sends specific status updates like "Navigating to URL...", "Hashing DOM state...", etc.
   */
  private emitSystemStatus(telemetry: TelemetryGateway, status: string): void {
    telemetry.emitTelemetry(
      this.event('ACTION', {
        actionExecuted: 'system-status',
        message: status,
      }),
    );
  }

  public async run(page: Page, targetUrl: string, telemetry: TelemetryGateway, maxSteps = 60, browserInfo?: BrowserInfo): Promise<{ completed: boolean; reason: string }> {
    // Initialize runtime metrics tracking
    this.runtimeMetrics = {
      startTime: Date.now(),
      requestsCount: 0,
      pageCount: 1, // Start with 1 for initial page load
      interactionCount: 0,
      failureCount: 0,
    };

    telemetry = this.createPersistentTelemetryGateway(telemetry);
    this.targetOrigin = new URL(targetUrl).origin;
this.freezeActionTraceRecording = false;
    this.lastBrainSnapshotStep = 0;
    this.sessionId = await this.createSession(targetUrl);

// 🕐 Start timing interval that accumulates active time (only when NOT paused)
    // This replaces the fixed timeout approach with accumulative time tracking
    // Also emits TIME_REMAINING telemetry to sync with frontend
    this.startTimingInterval(telemetry);

    // Persist initial telemetry with browser info (Phase 3)
    if (browserInfo && this.sessionId) {
      this.persistTelemetry({
        browser: browserInfo.browser,
        browserVersion: browserInfo.browserVersion,
        browserEngine: browserInfo.browserEngine,
        operatingSystem: browserInfo.operatingSystem,
        platform: browserInfo.platform,
        screenResolution: browserInfo.screenResolution,
        viewportWidth: browserInfo.viewportWidth,
        viewportHeight: browserInfo.viewportHeight,
        executionDuration: 0,
        requestsCount: 0,
        pageCount: 0,
        interactionCount: 0,
        failureCount: 0,
      });
    }

    // StateGraphNavigator handles its own state management - no clear() needed
    await this.persistBrainSnapshot('start');
    let lastTarget: InteractiveElement | null = null;
    let serverCrashReason: string | null = null;
    let runtimeCrashReason: string | null = null;
    let lastKnownUrl = '';

    let handleFramenavigated: (() => void) | null = null;

    // 🏁 Safari Initialized (milestone)
    this.emitMilestone(telemetry, '🏁 Safari Initialized');

    this.configureDialogAutoDismiss(page, telemetry);
    this.setupExceptionMonitoring(page, telemetry, lastKnownUrl);


    page.on('request', (request: Request) => {
      if (!lastTarget) {
        return;
      }
      const t: InteractiveElement = lastTarget;
      const resourceType = request.resourceType();
      if (resourceType === 'xhr' || resourceType === 'fetch') {
        this.scorer.rewardFromNetworkSignal(t);
        telemetry.emitTelemetry(this.event('ACTION', {
          actionExecuted: 'dynamic-weight-update',
          selector: t.selector,
          message: `Boosted feature weights after ${resourceType.toUpperCase()} network signal.`,
        }));
      }
    });

    // Task 1 Fix: Add response handler for NETWORK telemetry
    page.on('response', async (response: Response) => {
      const status = response.status();
      const url = response.url();
      const method = response.request().method();
      const resourceType = response.request().resourceType();

      // Skip frontend assets to prevent false positives
      if (url.includes('vite') ||
        url.includes('node_modules') ||
        url.endsWith('.js') ||
        url.endsWith('.css') ||
        resourceType === 'script' ||
        resourceType === 'stylesheet') {
        return;
      }

      // Emit NETWORK for failures (>=400 per TESTING_TYPES.md) or soft-fail body
      let shouldEmit = status >= 400;
      let bodyContent = '';

      if (!shouldEmit) {
        try {
          bodyContent = await response.text().catch(() => '');
          const bodyLower = bodyContent.toLowerCase();
          const hasErrorFlag = bodyLower.includes('"error"') && (bodyLower.includes('true') || bodyLower.includes(':true'));
          const hasStatusFail = bodyLower.includes('"status"') && (bodyLower.includes('"fail"') || bodyLower.includes(':"fail"'));
          shouldEmit = hasErrorFlag || hasStatusFail;
        } catch {
          // Ignore body parse errors
        }
      }

      if (shouldEmit) {
        // Phase 3: Track failed requests count
        this.runtimeMetrics.requestsCount++;

        telemetry.emitTelemetry(this.event('NETWORK', {
          statusCode: status,
          url,
          method,
          message: `Network ${status} ${method} ${url}`,
        }));

        // 📸 Phase 4: Capture CRITICAL_EVENT screenshot on API failure
        this.captureScreenshot(page, ForensicScreenshotType.API_FAILURE, `HTTP ${status} Error: ${method} ${url}`).catch((err) =>
          console.warn('[AutonomousExplorationEngine] API failure screenshot capture failed:', err)
        );

        // Persist API failure to forensic_errors database (Phase 2: Error Logging System)
        this.persistForensicError({
          type: ForensicErrorType.API_FAILURE,
          severity: status >= 500 ? ForensicErrorSeverity.HIGH : ForensicErrorSeverity.MEDIUM,
          message: `API Failure: HTTP ${status} ${method} ${url}`,
          stackTrace: `HTTP ${status} response from ${url}${bodyContent ? ` - Body: ${bodyContent.slice(0, 500)}` : ''}`,
          url: lastKnownUrl || page.url(),
          endpoint: url,
          method,
          statusCode: status,
          responseText: bodyContent.slice(0, 500),
        });

        // NEW: Register HTTP error bug to memory
        this.registerConfirmedBug({
          bugId: `http-${status}-${Date.now()}`,
          type: 'NETWORK',
          message: `HTTP ${status} Error: ${method} ${url}`,
          selector: '',
          payloadUsed: method,
          advice: `HTTP ${status} indicates server or network issue. Check backend.`,
          timestamp: new Date(),
        });
      }
    });

    // Catch network request failures (timeouts, connection errors, aborts)
    page.on('requestfailed', (request: Request) => {
      const timestamp = new Date().toISOString();
      const url = request.url();
      const method = request.method();
      const failure = request.failure();
      const reason = failure?.errorText ?? 'Unknown network failure';
      const breadcrumbs = this.actions.snapshot();

      telemetry.emitTelemetry(this.event('EXCEPTION', {
        url,
        method,
        message: `Network Request Failed: ${reason} for ${method} ${url}`,
      }));

      telemetry.emitIncidentReport({
        timestamp,
        reason: `Network Request Failed: ${reason}`,
        url: lastKnownUrl || page.url(),
        stackTrace: `${method} ${url} - ${reason}`,
        steps: this.breadcrumbsToActionRecords(breadcrumbs),
      });

      telemetry.emitForensicReport({
        timestamp,
        reason: `Network Request Failed: ${reason}`,
        url: lastKnownUrl || page.url(),
        stackTrace: `${method} ${url} - ${reason}`,
        breadcrumbs,
      });

      // Persist network failure to forensic_errors database (Phase 2: Error Logging System)
      this.persistForensicError({
        type: ForensicErrorType.API_FAILURE,
        severity: ForensicErrorSeverity.HIGH,
        message: `Network Request Failed: ${reason} for ${method} ${url}`,
        stackTrace: `${method} ${url} - ${reason}`,
        url: lastKnownUrl || page.url(),
        endpoint: url,
        method,
      });

      // NEW: Register network failure bug to memory
      this.registerConfirmedBug({
        bugId: `network-failed-${Date.now()}`,
        type: 'NETWORK',
        message: `Network Request Failed: ${reason}`,
        selector: '',
        payloadUsed: method,
        advice: 'Check network connectivity and server availability.',
        timestamp: new Date(),
      });
    });

    handleFramenavigated = (): void => {
      const url = page.url();
      if (!url) return;
      lastKnownUrl = url;
      // Phase 3: Track page count when navigating
      this.runtimeMetrics.pageCount++;
      telemetry.emitUrlChanged(url);
    };

    page.on('framenavigated', handleFramenavigated);

    try {
      // Task 3: Emit granular status for dynamic UI - "Navigating to URL..."
      this.emitSystemStatus(telemetry, `Navigating to ${targetUrl}...`);

      // EMIT EARLY TELEMETRY: Notify that browser has started navigating
      // This helps the frontend understand the engine is processing
      telemetry.emitTelemetry(this.event('ACTION', {
        actionExecuted: 'browser-launched',
        message: `🚀 Browser launched, navigating to ${targetUrl}...`,
      }));

      console.log('[AutonomousExplorationEngine] Starting page.goto for targetUrl:', targetUrl);
      // Use shorter timeout and better wait strategy to prevent hanging
      // Also emit immediate frame to prevent "No live frame" timeout
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      console.log('[AutonomousExplorationEngine] page.goto completed for targetUrl:', targetUrl);
      handleFramenavigated(); // initial capture so dashboard doesn't start blank
      
      // Emit immediate first frame to prevent frontend "No live frame received" timeout
      // This must happen BEFORE any other async operations
      console.log('[AutonomousExplorationEngine] Emitting first live frame after page navigation');
      await this.emitLiveFrame(page, telemetry);
      console.log('[AutonomousExplorationEngine] First live frame emitted successfully');
      
      await this.ensureDomReady(page, telemetry);

      // 📸 Phase 4: Capture initial screenshot (after page load)
      this.captureScreenshot(page, ForensicScreenshotType.INITIAL).catch((err) =>
        console.warn('[AutonomousExplorationEngine] Initial screenshot capture failed:', err)
      );

      // 🛡️ Initialize stability monitoring - runs silently in background
      // Monitors JS Exceptions, 500 Errors, and System Lock-up (5s heartbeat timeout)
      // NEW: Pass callback to register bugs to memory
      this.cleanupStabilityMonitor = setupStabilityMonitoring(page, telemetry, (bug) => this.registerConfirmedBug(bug));

      // 🖥️ Setup isolated browser console listener for dedicated Console Tab in dashboard
      // Captures actual browser console.log/warn/info/error without mixing with backend telemetry
      await setupBrowserConsoleListener(page, telemetry);

      // 🚀 Start independent frame capture loop for 30fps streaming
      this.startFrameCaptureLoop(page, telemetry);

      // --- 3-Strike Logic Loop State ---
      // Tracks consecutive steps where the DOM fingerprint did not change.
      let previousHash = '';
      let stagnationCounter = 0;
      // When > 0, the engine is in "escape mode": picks the lowest-scored target
      // instead of the highest, and all current-page elements carry a score penalty.
      let penaltyStepsRemaining = 0;

for (let step = 1; step <= maxSteps; step++) {
        if (this.isStopRequested) {
          this.emitMilestone(telemetry, `🛑 Safari session manually stopped by user.`);
          return { completed: false, reason: 'Safari session manually stopped by user.' };
        }

        // ─────────────────────────────────────────────────────────────
        // TIMEBOX CHECK - CRITICAL: Must check at each iteration
        // Only terminates when elapsedActiveTimeMs >= 180000 AND NOT paused
        // ─────────────────────────────────────────────────────────────
        if (this.checkTimeboxAndTerminateIfExceeded(telemetry)) {
          return { 
            completed: false, 
            reason: `Timebox of ${this.timeboxMs}ms (${this.timeboxMs / 60000}min) exceeded - active execution time only` 
          };
        }

        while (this.isPaused) {
          if (this.isStopRequested) {
            this.emitMilestone(telemetry, `🛑 Safari session manually stopped by user.`);
            return { completed: false, reason: 'Safari session manually stopped by user.' };
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        try {
          if (runtimeCrashReason) {
            return { completed: false, reason: runtimeCrashReason };
          }

          if (serverCrashReason) {
            return { completed: false, reason: serverCrashReason };
          }


          // 📡 Network Sabotage: 10% random chance to sabotage network requests
          // This tests if the UI breaks when network calls are delayed/aborted
          const sabotageDice = Math.random();
          if (sabotageDice < 0.1) {
            this.emitMilestone(telemetry, '📡 Chaos Mode: Sabotaging network requests for this step...');
            telemetry.emitTelemetry(this.event('ACTION', {
              actionExecuted: 'network-sabotage',
              message: '📡 Chaos Mode: Sabotaging network requests for this step...',
            }));
            // Execute the network sabotage - note: this remains active for subsequent interactions
            await networkSaboteur.execute(page);
          }

          // 🧠 Prioritization (milestone comes right after parse/scoring)
          this.emitMilestone(telemetry, '👁️ Vision Active');

          await this.ensureTargetDomain(page, telemetry);
          await this.ensureDomReady(page, telemetry);

          const elements = await this.parser.parse(page);

          telemetry.emitTelemetry(this.event('ACTION', {
            actionExecuted: 'dom-elements-parsed',
            message: `Parsed ${elements.length} interactive elements from DOM`,
          }));

          if (elements.length === 0) {
            telemetry.emitTelemetry(this.event('ACTION', {
              actionExecuted: 'empty-dom',
              message: 'No interactive elements after retry window. Stopping run.',
            }));
            return { completed: true, reason: 'DOM has no interactive elements.' };
          }

          const ranked = this.scorer.score(elements);
telemetry.emitTargets(
            ranked.slice(0, 12).map((element) => ({
              tagName: element.tagName,
              id: element.id,
              className: element.className,
              type: element.type,
              name: '',
              text: element.innerText,
              selector: element.selector,
              semanticRole: inferSemanticRole(element),
              score: Number(element.riskScore.toFixed(4)),
              isVisible: element.isVisible,
              // Use actual spatial coordinates captured after layout stabilization
              boundingBox: element.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 },
            })),
          );

          // Task 3: Emit granular status for dynamic UI - "Hashing DOM state..."
          this.emitSystemStatus(telemetry, 'Hashing DOM state...');

          // --- 3-Strike Logic Loop Detection ---
          // The hash represents the structural fingerprint of the page AFTER the
          // previous action. If it stays identical for 3 consecutive steps the
          // engine is stuck clicking elements that have no effect on app state.
          const currentHash = await this.hashManager.hash(page);

          // --- Visual Regression Detection (SSIM) ---
          // Only run SSIM comparison if the engine is returning to a previously known
          // domHash (visitation count > 1) to verify it hasn't visually degraded.
          const hasBaseline = this.baselineScreenshots.has(currentHash);
          const visitCount = this.visitedHashes.has(currentHash) ? 2 : 1;

          if (hasBaseline && visitCount > 1) {
            // Take current screenshot and compare against baseline
            const currentScreenshot = await page.screenshot({ type: 'png' });
            const baselineScreenshot = this.baselineScreenshots.get(currentHash)!;

            try {
              const comparisonResult = await this.visualRegressionDetector.compareFrames(
                baselineScreenshot,
                currentScreenshot,
              );

              if (!comparisonResult.isMatch) {
                // Catastrophic visual shift detected - UI has collapsed
                const bugMessage = `Silent Visual UI Collapse detected! SSIM score: ${comparisonResult.ssimScore.toFixed(3)} (threshold: ${CATASTROPHIC_SHIFT_THRESHOLD})`;

                telemetry.emitTelemetry(this.event('BUG', {
                  message: bugMessage,
                  selector: '',
                  url: lastKnownUrl || page.url(),
                }));

                // Register the visual regression bug
                this.registerConfirmedBug({
                  bugId: `visual-collapse-${currentHash.substring(0, 8)}-${Date.now()}`,
                  type: 'VISUAL_REGRESSION',
                  message: bugMessage,
                  selector: currentHash,
                  payloadUsed: `SSIM: ${comparisonResult.ssimScore.toFixed(3)}`,
                  advice: 'Visual UI structure has collapsed. Check CSS, Z-index, or rendering bugs.',
                  timestamp: new Date(),
                });

                // Capture screenshot for forensic analysis
                this.captureScreenshot(page, ForensicScreenshotType.CRITICAL_EVENT, bugMessage).catch(() => { });
              }
            } catch (error) {
              console.warn('[AutonomousExplorationEngine] Visual regression comparison failed:', error);
            }
          } else if (!hasBaseline) {
            // First time seeing this state - capture baseline screenshot
            const baselineScreenshot = await page.screenshot({ type: 'png' });
            this.baselineScreenshots.set(currentHash, baselineScreenshot);
          }

          telemetry.emitTelemetry(this.event('ACTION', {
            actionExecuted: 'dom-state-hash',
            stateHash: currentHash,
            message: `DOM fingerprint captured. stagnation=${stagnationCounter}/3`,
          }));

          // Track state changes.
          // Only increment the strike counter when no penalty is already active —
          // during escape mode the engine is deliberately trying new paths, so we
          // give it room to manoeuvre before counting fresh strikes.
          const currentUrl = page.url();
          const revisitedPage = this.visitedUrls.has(currentUrl) || this.visitedHashes.has(currentHash);
          this.visitedUrls.add(currentUrl);
          this.visitedHashes.add(currentHash);

          if (currentHash !== previousHash) {
            // Page state changed — bot successfully moved to a new state.
            stagnationCounter = 0;
            previousHash = currentHash;
          } else if (penaltyStepsRemaining === 0) {
            stagnationCounter++;
          }

          // Tick down the penalty window each step.
          if (penaltyStepsRemaining > 0) {
            penaltyStepsRemaining--;
          }

          // Trigger the full loop penalty on the 3rd consecutive identical hash.
          if (stagnationCounter >= 3) {
            this.emitMilestone(
              telemetry,
              '🚨 Logic Loop detected. Penalizing current UI branch to force deeper exploration.',
            );

            // Zero-out effective risk scores for every visible element on this
            // page for the next 5 steps by adding a penalty that exceeds each
            // element's current riskScore.
            for (const element of ranked) {
              this.scorer.penalize(element.selector, Math.abs(element.riskScore) + 1);
            }

            penaltyStepsRemaining = 5;
            stagnationCounter = 0; // reset strike counter; fresh window after escape
          }

          // Convert ranked elements to PathfinderElement format for StateGraphNavigator
          const pathfinderElements: PathfinderElement[] = ranked.map(el => ({
            selector: el.selector,
            score: el.riskScore,
          }));

          // Use StateGraphNavigator to make decision
          const decision = this.pathNavigator.registerStateAndDecide(
            currentHash,
            currentUrl,
            pathfinderElements,
            penaltyStepsRemaining > 0 || stagnationCounter >= 3,
          );

          // Initialize with default to satisfy TypeScript
          let target: InteractiveElement = ranked[0];

          if (decision.kind === 'exhausted') {
            this.emitMilestone(telemetry, '🔚 Graph exhausted. Exploration complete.');
            return { completed: true, reason: 'Full reachable graph exhausted.' };
          }

          telemetry.emitTelemetry(this.event('ACTION', {
            actionExecuted: 'element-selected',
            selector: target.selector,
            score: Number(target.riskScore.toFixed(4)),
            message: `Selected target: ${target.tagName}${target.id ? '#' + target.id : ''} with score ${target.riskScore.toFixed(4)}`,
          }));

          // StateGraphNavigator handles node/edge tracking automatically via registerStateAndDecide

          if (decision.kind === 'backtrack') {
            // Emit backtrack telemetry and navigate to target URL
            this.emitMilestone(telemetry, `↩️ Backtracking to ${decision.targetUrl}`);
            this.emitSystemStatus(telemetry, `Backtracking to ${decision.targetHash.substring(0, 8)}...`);
            await page.goto(decision.targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await wait(350);
            continue;
          }

          // decision.kind === 'explore-edge' - handle explicitly for TypeScript
          const exploreDecision = decision as { kind: 'explore-edge'; selector: string; score: number; pathTrace: string };
          const selectedSelector = exploreDecision.selector;
          const foundTarget = ranked.find(el => el.selector === selectedSelector);
          target = foundTarget ?? ranked[0];

          if (!target) {
            return { completed: true, reason: 'No ranked target found.' };
          }

          // Store score for telemetry
          const targetScore = exploreDecision.score;

          // Emit exploration milestone
          this.emitMilestone(telemetry, `🎯 Exploring edge: ${target.selector} (score: ${decision.score.toFixed(3)})`);
          this.emitSystemStatus(telemetry, `Clicking element ${target.selector}...`);

          // Execute the action
          this.logHighImpact(target, telemetry);
          const previousHashBeforeAction = currentHash;

          await this.executeWeightedAction(page, telemetry, target, ranked, revisitedPage);

          // Phase 3: Track interaction count
          this.runtimeMetrics.interactionCount++;

          telemetry.emitTelemetry(this.event('ACTION', {
            actionExecuted: 'action-executed',
            selector: target.selector,
            message: `Step ${step}: Action executed on ${target.selector}`,
          }));

          await this.persistBrainSnapshot('runtime', step);

          // Confirm edge traversal in the navigator
          this.pathNavigator.confirmEdgeTraversal(
            previousHashBeforeAction,
            target.selector,
            currentHash,
          );

          // Task 3: Observe novelty and fire Perceptron Delta Rule if state is highly novel
          // If the resulting state has low visitation count (novel), reward the weights
          const currentNode = this.pathNavigator.snapshot();
          const isNovelState = this.visitedHashes.has(currentHash) === false;

          if (isNovelState) {
            // Novel state discovered - fire Perceptron's Delta Rule to reward the element weights
            this.scorer.rewardFromNetworkSignal(target);

            telemetry.emitTelemetry(this.event('ACTION', {
              actionExecuted: 'novelty-reward-triggered',
              selector: target.selector,
              message: `Novel state discovered (visitCount: 1). Fired Perceptron Delta Rule to reward weights for ${target.selector}.`,
            }));
          } else {
            // Get the visit count for telemetry
            const visitCount = this.visitedHashes.size;
            telemetry.emitTelemetry(this.event('ACTION', {
              actionExecuted: 'state-revisited',
              selector: target.selector,
              message: `State revisitted (visitCount: ${visitCount}). No novelty reward applied.`,
            }));
          }

          // Emit curiosity-driven selection telemetry
          const boredomThreshold = this.pathNavigator.getBoredomThreshold();
          const topScore = decision.score;
          const curiosityDriven = topScore >= boredomThreshold;

          telemetry.emitTelemetry(this.event('ACTION', {
            actionExecuted: 'curiosity-decision',
            selector: target.selector,
            score: topScore,
            message: `Curiosity-driven: ${curiosityDriven ? 'EXPLORE' : 'BACKTRACK'} (topScore=${topScore.toFixed(2)}, boredomThreshold=${boredomThreshold})`,
          }));

          telemetry.emitTelemetry(this.event('HEURISTIC_SCORE', {
            selector: target.selector,
            score: Number(target.riskScore.toFixed(4)),
            message: `Target scored ${target.riskScore.toFixed(4)} and executed.`,
          }));

          await this.emitLiveFrame(page, telemetry);
          await wait(350);
        } catch (err: unknown) {
          // Phase 3: Track failure count on exception
          this.runtimeMetrics.failureCount++;

          // 📸 Phase 4: Capture FAILURE screenshot BEFORE recording error and test termination
          const failureMessage = err instanceof Error ? err.message : String(err);
          this.captureScreenshot(page, ForensicScreenshotType.FAILURE, `Test Failed: ${failureMessage}`).catch((err) =>
            console.warn('[AutonomousExplorationEngine] Failure screenshot capture failed:', err)
          );

          // Emergency Data Flush: capture current action buffer and emit EXCEPTION telemetry.
          const actionSnapshot = this.actions.snapshot();
          const reproductionSteps = actionSnapshot.map((item, index) => `Step ${index + 1}: ${item.action} on ${item.selector}`);
          const sanitized = sanitizeException(err instanceof Error ? err : String(err));

          telemetry.emitTelemetry(
            this.event('EXCEPTION', {
              message: `Engine exception: ${sanitized.message}`,
              exceptionDetails: {
                message: sanitized.message,
                stackTrace: sanitized.stackTrace,
              },
              reproductionSteps,
              url: lastKnownUrl || page.url(),
            }),
          );
          this.freezeActionTraceRecording = true;
          await this.persistBrainSnapshot('crash');


          // Do not remove existing crash reason logic; prefer already-known reasons.
          return {
            completed: false,
            reason: runtimeCrashReason ?? serverCrashReason ?? `Engine exception: ${sanitized.message}`,
          };
        }
      }

      this.emitMilestone(telemetry, `✅ Exploration Complete: 60 steps executed successfully`);
      return { completed: true, reason: 'Maximum exploration steps reached.' };
    } finally {
      // 🧹 Cleanup: dispose stability monitoring to prevent "ghost" heartbeat intervals
      if (this.cleanupStabilityMonitor) {
        this.cleanupStabilityMonitor();
        this.cleanupStabilityMonitor = null;
      }

// 🚀 Stop frame capture loop
      this.stopFrameCaptureLoop();

// 🕐 Stop timing interval
      this.stopTimingInterval();

      // CRITICAL: Emit explicit IDLE status to prevent zombie backend processes
      // This ensures deterministic state handshake with frontend
      telemetry.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'ACTION',
        meta: {
          actionExecuted: 'engine-status',
          message: 'IDLE',
        },
      });

      // 📸 Phase 4: Capture final screenshot (at test completion)
      const finalStatus = this.freezeActionTraceRecording ? 'Failed' : 'Completed';
      this.captureScreenshot(page, ForensicScreenshotType.FINAL, `Safari ${finalStatus}`).catch((err) =>
        console.warn('[AutonomousExplorationEngine] Final screenshot capture failed:', err)
      );

      // Phase 3: Persist final telemetry with execution duration (use instance metrics)
      const executionDuration = this.runtimeMetrics.startTime ? Date.now() - this.runtimeMetrics.startTime : 0;
      if (browserInfo && this.sessionId) {
        this.persistTelemetry({
          browser: browserInfo.browser,
          browserVersion: browserInfo.browserVersion,
          browserEngine: browserInfo.browserEngine,
          operatingSystem: browserInfo.operatingSystem,
          platform: browserInfo.platform,
          screenResolution: browserInfo.screenResolution,
          viewportWidth: browserInfo.viewportWidth,
          viewportHeight: browserInfo.viewportHeight,
          executionDuration,
          requestsCount: this.runtimeMetrics.requestsCount,
          pageCount: this.runtimeMetrics.pageCount,
          interactionCount: this.runtimeMetrics.interactionCount,
          failureCount: this.runtimeMetrics.failureCount,
        });
      }

      if (handleFramenavigated) {
        page.off('framenavigated', handleFramenavigated);
      }
      if (!this.freezeActionTraceRecording) {
        await this.persistBrainSnapshot('finish');
      }
      await this.completeSession();
      this.sessionId = null;
      this.recentActionTraceIds.length = 0;
    }
  }

  private createPersistentTelemetryGateway(telemetry: TelemetryGateway): TelemetryGateway {
    return {
      emitTelemetry: (event: TelemetryEvent) => {
        telemetry.emitTelemetry(event);
        void this.persistFinding(event);
      },
      emitUrlChanged: (url: string) => telemetry.emitUrlChanged(url),
      emitTargets: (targets) => telemetry.emitTargets(targets),
      emitLiveFrame: (base64Jpeg) => telemetry.emitLiveFrame(base64Jpeg),
      emitForensicReport: (report) => telemetry.emitForensicReport(report),
      emitIncidentReport: (report) => telemetry.emitIncidentReport(report),
      emitBrowserConsole: telemetry.emitBrowserConsole
        ? (message) => telemetry.emitBrowserConsole!(message)
        : undefined,
    };
  }

  private async createSession(targetUrl: string): Promise<string | null> {
    if (!this.findingRepo) {
      return null;
    }

    try {
      return await this.findingRepo.createSession({
        targetUrl,
        startedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[AutonomousExplorationEngine] Failed to create Safari session:', error);
      return null;
    }
  }

  private async completeSession(): Promise<void> {
    if (!this.findingRepo || !this.sessionId) {
      return;
    }

    try {
      if (this.freezeActionTraceRecording) {
        await this.findingRepo.markSessionCrashed(this.sessionId, new Date().toISOString(), 'Unhandled exception detected');
      } else {
        await this.findingRepo.markSessionCompleted(this.sessionId, new Date().toISOString());
      }
    } catch (error) {
      console.error('[AutonomousExplorationEngine] Failed to complete Safari session:', error);
    }
  }

  private async persistFinding(event: TelemetryEvent): Promise<void> {
    if (!this.findingRepo || !this.sessionId) {
      return;
    }

    try {
      const findingId = await this.findingRepo.save({
        sessionId: this.sessionId,
        event,
      });

      if (event.type === 'EXCEPTION' && this.recentActionTraceIds.length > 0) {
        this.freezeActionTraceRecording = true;
        await this.findingRepo.linkActionTracesToFinding(findingId, [...this.recentActionTraceIds]);
      }
    } catch (error) {
      console.error('[AutonomousExplorationEngine] Failed to persist finding:', error);
    }
  }

  private recordActionTrace(trace: ActionBreadcrumb): void {
    this.actions.push(trace);

    // FIX: Also push to ReproductionPlaybookStore so saving to history works
    // This ensures finalBreadcrumbSteps are available when user clicks "Save to History"
    const actionRecord: ActionRecord = {
      timestamp: trace.timestamp,
      type: (trace.action.toUpperCase() as unknown as ActionType) || 'CLICK',
      selector: trace.selector,
      url: this.targetOrigin || 'unknown',
      payload: trace.payload,
    };
    ReproductionPlaybookStore.push(actionRecord);

    if (!this.findingRepo || !this.sessionId || this.freezeActionTraceRecording) {
      return;
    }

    void this.findingRepo
      .saveActionTrace({ sessionId: this.sessionId, trace })
      .then((actionTraceId) => {
        this.recentActionTraceIds.push(actionTraceId);
        while (this.recentActionTraceIds.length > 20) {
          this.recentActionTraceIds.shift();
        }
      })
      .catch((error) => {
        console.error('[AutonomousExplorationEngine] Failed to persist action trace:', error);
      });
  }

  private async persistBrainSnapshot(source: 'start' | 'runtime' | 'finish' | 'crash', step?: number): Promise<void> {
    if (!this.findingRepo || !this.sessionId) {
      return;
    }

    if (source === 'runtime') {
      const currentStep = step ?? 0;
      if (currentStep - this.lastBrainSnapshotStep < 10) {
        return;
      }
      this.lastBrainSnapshotStep = currentStep;
    }

    const brainState = this.scorer.exportBrainState();
    try {
      await this.findingRepo.saveBrainConfig({
        sessionId: this.sessionId,
        source,
        bias: brainState.bias,
        weights: brainState.weights,
      });
    } catch (error) {
      console.error('[AutonomousExplorationEngine] Failed to persist brain snapshot:', error);
    }
  }


  private configureDialogAutoDismiss(page: Page, telemetry: TelemetryGateway): void {
    page.on('dialog', async (dialog: Dialog) => {
      telemetry.emitTelemetry(this.event('ACTION', {
        actionExecuted: 'dialog-auto-dismiss',
        message: `Auto-dismissed ${dialog.type()} dialog`,
      }));
      await dialog.dismiss().catch(() => undefined);
    });
  }

  /**
     * Persist error to forensic_errors database (Phase 2: Error Logging System)
     */
  private async persistForensicError(params: {
    type: ForensicErrorType;
    severity: ForensicErrorSeverity;
    message: string;
    stackTrace?: string;
    url?: string;
    endpoint?: string;
    method?: string;
    statusCode?: number;
    responseText?: string;
    filename?: string;
    lineNumber?: number;
    columnNumber?: number;
    selector?: string;
    action?: string;
  }): Promise<void> {
    if (!this.sessionId) return;

    try {
      await forensicErrorRepository.create({
        forensicRunId: new Types.ObjectId(this.sessionId),
        ...params,
      });
    } catch (error) {
      console.error('[AutonomousExplorationEngine] Failed to persist forensic error:', error);
    }
  }

  /**
     * Persist telemetry to forensic_telemetry database (Phase 3: Telemetry Collection)
     */
  private async persistTelemetry(params: {
    browser: string;
    browserVersion: string;
    browserEngine?: string;
    operatingSystem: string;
    platform?: string;
    screenResolution?: string;
    viewportWidth?: number;
    viewportHeight?: number;
    executionDuration?: number;
    requestsCount?: number;
    pageCount?: number;
    interactionCount?: number;
    failureCount?: number;
    memoryUsage?: number;
    cpuUsage?: number;
  }): Promise<void> {
    if (!this.sessionId) return;

    try {
      await forensicTelemetryRepository.create({
        forensicRunId: new Types.ObjectId(this.sessionId),
        ...params,
      });
    } catch (error) {
      console.error('[AutonomousExplorationEngine] Failed to persist forensic telemetry:', error);
    }
  }

/**
   * Capture and persist a screenshot (Phase 4: Screenshot Forensics)
   * Added check to verify page is still valid before attempting capture
   */
  private async captureScreenshot(
    page: Page,
    screenshotType: ForensicScreenshotType,
    errorMessage?: string,
    stepNumber?: number,
  ): Promise<void> {
    if (!this.sessionId) return;

    // Check if page is still valid and accessible before attempting screenshot
    // This prevents "Target page, context or browser has been closed" errors
    if (!page || (page as any).isClosed()) {
      console.warn('[AutonomousExplorationEngine] Cannot capture screenshot: page is closed or invalid');
      return;
    }

    try {
      const screenshot = await page.screenshot({ type: 'jpeg', quality: 80 });
      const imageData = screenshot.toString('base64');

      await forensicScreenshotRepository.create({
        forensicRunId: new Types.ObjectId(this.sessionId),
        screenshotType,
        imageData,
        url: page.url(),
        errorMessage,
        stepNumber,
      });
    } catch (error) {
      // Handle the specific "Target page, context or browser has been closed" error gracefully
      if (error instanceof Error && error.message.includes('Target page, context or browser has been closed')) {
        console.warn('[AutonomousExplorationEngine] Page closed before screenshot capture, skipping forensic screenshot');
        return;
      }
      console.error('[AutonomousExplorationEngine] Failed to capture screenshot:', error);
    }
  }

  private setupExceptionMonitoring(page: Page, telemetry: TelemetryGateway, lastKnownUrl: string): void {
    // Monitor uncaught JavaScript exceptions
    page.on('pageerror', (error: Error) => {
      const message = error?.message ?? 'Unknown page error';
      const stackTrace = error?.stack ?? message;
      const url = lastKnownUrl || page.url();
      const timestamp = new Date().toISOString();
      const breadcrumbs = this.actions.snapshot();

      telemetry.emitTelemetry(this.event('EXCEPTION', {
        message: `🔴 Unhandled JS Exception: ${message}`,
        exceptionDetails: { message, stackTrace },
      }));

      telemetry.emitIncidentReport({
        timestamp,
        reason: `Unhandled JS Exception: ${message}`,
        url,
        stackTrace,
        steps: this.breadcrumbsToActionRecords(breadcrumbs),
      });

      telemetry.emitForensicReport({
        timestamp,
        reason: `Unhandled JS Exception: ${message}`,
        url,
        stackTrace,
        breadcrumbs,
      });

      // Persist error to forensic_errors database (Phase 2: Error Logging System)
      this.persistForensicError({
        type: ForensicErrorType.JS_EXCEPTION,
        severity: ForensicErrorSeverity.HIGH,
        message: `🔴 Unhandled JS Exception: ${message}`,
        stackTrace,
        url,
      });

      // 📸 Phase 4: Capture CRITICAL_EVENT screenshot on JS exception
      this.captureScreenshot(page, ForensicScreenshotType.CRITICAL_EVENT, `JS Exception: ${message}`).catch((err) =>
        console.warn('[AutonomousExplorationEngine] JS exception screenshot capture failed:', err)
      );
    });

    // Monitor unhandled promise rejections via console errors
    page.on('console', (message) => {
      if (message.type() !== 'error') {
        return;
      }

      const text = message.text();

      // Skip network-related console errors (these are already handled by response monitoring)
      if (text.includes('net::ERR') || text.includes('ERR_')) {
        return;
      }

      const url = lastKnownUrl || page.url();
      const timestamp = new Date().toISOString();
      const breadcrumbs = this.actions.snapshot();

      telemetry.emitTelemetry(this.event('EXCEPTION', {
        message: `🔴 Console Error: ${text}`,
        exceptionDetails: { message: text, stackTrace: text },
      }));

      telemetry.emitIncidentReport({
        timestamp,
        reason: `Console Error: ${text}`,
        url,
        stackTrace: text,
        steps: this.breadcrumbsToActionRecords(breadcrumbs),
      });

      telemetry.emitForensicReport({
        timestamp,
        reason: `Console Error: ${text}`,
        url,
        stackTrace: text,
        breadcrumbs,
      });

      // Persist console error to forensic_errors database (Phase 2: Error Logging System)
      this.persistForensicError({
        type: ForensicErrorType.CONSOLE_ERROR,
        severity: ForensicErrorSeverity.MEDIUM,
        message: `🔴 Console Error: ${text}`,
        stackTrace: text,
        url,
      });
    });
  }

  private async ensureTargetDomain(page: Page, telemetry: TelemetryGateway): Promise<void> {
    const current = page.url();
    if (!current) {
      return;
    }
  }


  private async ensureDomReady(page: Page, telemetry: TelemetryGateway): Promise<void> {
    try {
      await page.waitForSelector('button, input, a, select, [style*="cursor: pointer"]', {
        timeout: 5000,
      });
    } catch {
      telemetry.emitTelemetry(this.event('ACTION', {
        actionExecuted: 'dom-wait-timeout',
        message: 'No interactive selector found during 5s wait window.',
      }));
    }
  }

  private async executeWeightedAction(
    page: Page,
    telemetry: TelemetryGateway,
    target: InteractiveElement,
    ranked: InteractiveElement[],
    revisitedPage: boolean,
  ): Promise<void> {
    const isStressAction = Math.random() < 0.3;

    if (!isStressAction) {
      await this.executeStandardInteraction(page, telemetry, target, ranked);
      return;
    }

    const scenario = this.pickStressScenario(target, revisitedPage);
    const escalationMessage = `🔥 Escalating to ${scenario.name} on ${target.selector}`;

    telemetry.emitTelemetry(this.event('ACTION', {
      actionExecuted: 'stress-scenario-escalation',
      selector: target.selector,
      message: escalationMessage,
    }));

    this.emitMilestone(telemetry, escalationMessage);

    this.recordActionTrace({
      timestamp: new Date().toISOString(),
      selector: target.selector,
      action: `scenario-${scenario.name}`,
      score: Number(target.riskScore.toFixed(4)),
    });

// For security scenarios on text inputs, strip constraints first
    if (scenario.name === 'FormBypasser') {
      try {
        await this.stripConstraints(page);
        telemetry.emitTelemetry(this.event('ACTION', {
          actionExecuted: 'security-constraints-stripped',
          selector: target.selector,
          message: `🔓 Stripped HTML5 constraints from ${target.selector} before security injection.`,
        }));
      } catch (error) {
        console.warn('[AutonomousExplorationEngine] Constraint stripping failed before security scenario:', error);
      }

      // Enhance security testing with data fuzzer payloads
      await this.executeSecurityFuzzerPayloads(page, telemetry, target);
    }

    await scenario.execute(page, target);
  }

  private pickStressScenario(target: InteractiveElement, revisitedPage: boolean): StressScenario {
    const tag = target.tagName.toLowerCase();
    const source = `${target.id} ${target.className} ${target.innerText} ${target.selector}`.toLowerCase();
    const buttonLike =
      tag === 'button' ||
      source.includes('role="button"') ||
      source.includes('[role="button"]') ||
      target.type.toLowerCase() === 'button' ||
      target.type.toLowerCase() === 'submit';

    // Check for text input fields (input[type="text"], textarea, input[type="password"])
    const isTextInput = tag === 'textarea' || target.type.toLowerCase() === 'text' || target.type.toLowerCase() === 'password';

    // If it's a text input field and chaos threshold allows, delegate to formBypasser (handles constraint stripping)
    if (isTextInput) {
      const chaosRoll = Math.random();
      if (chaosRoll < this.chaosThreshold) {
        console.log(`[AutonomousExplorationEngine] Chaos threshold triggered (${(chaosRoll * 100).toFixed(1)}% < ${(this.chaosThreshold * 100).toFixed(1)}%) - activating security audit on ${target.selector}`);
        return formBypasser;
      }
      // Use formBypasser for text inputs when not using security scout
      // This ensures constraints are stripped before payload injection
      return formBypasser;
    }

    if (revisitedPage) {
      return stressScenarioMap.RouteTrasher;
    }

    if (buttonLike) {
      // Use formBypasser for buttons to ensure they can be clicked
      // This helps bypass disabled/readonly button states
      return formBypasser;
    }

    return stressScenarioMap.CoordinateBombing;
  }

private async executeStandardInteraction(
    page: Page,
    telemetry: TelemetryGateway,
    target: InteractiveElement,
    ranked: InteractiveElement[],
  ): Promise<void> {
    // Highlight the target element being interacted with
    await this.highlighter.flashHighlight(page, target.selector);

if (target.tagName === 'input' || target.tagName === 'textarea' || target.tagName === 'select') {
      // Use heuristic-based decision (or seeded RNG if configured) instead of unseeded randomness
      const useDataFuzzer = this.shouldUseDataFuzzer(target);

      if (useDataFuzzer) {
        // Use Data Fuzzer: Delegate to strategy pattern
        const category = classifyInputElement(target);
        const strategyPayload = getStrategyByCategory(category);
        const payload = strategyPayload.value;

        this.recordActionTrace({
          timestamp: new Date().toISOString(),
          selector: target.selector,
          action: 'data-fuzzer-injection',
          payload: category,
          score: Number(target.riskScore.toFixed(4)),
        });

// Wrap fuzzing sequence with transaction lifecycle (backward-compatible method)
        this.fuzzManager.openFuzzTransaction(target.selector, payload);

        try {
          // Strip constraints first (maxlength, pattern) to allow large payloads
          await this.stripConstraints(page);

          // Inject the fuzz payload
          await this.injectPayload(page, target.selector, payload);

          // Wait for lagging SPA/network promises to resolve while transaction window remains open
          await this.page?.waitForTimeout(400);

          // Emit telemetry with the required format
          telemetry.emitTelemetry(this.event('ACTION', {
            actionExecuted: 'data-fuzzer-injection',
            selector: target.selector,
            message: `⚡ Data Fuzzer: Injecting ${category} strategy into ${target.selector} to test data validation limits.`,
          }));
        } finally {
          // Ensure transaction window never leaks between subsequent element exploration selections
          this.fuzzManager.closeTransaction();
        }

        return;
      }

      // Standard payload injection using strategy pattern
      const category = classifyInputElement(target);
      const strategyPayload = getStrategyByCategory(category);
      const payload = strategyPayload.value;

      this.recordActionTrace({
        timestamp: new Date().toISOString(),
        selector: target.selector,
        action: 'payload-injection',
        payload,
        score: Number(target.riskScore.toFixed(4)),
      });

// Wrap fuzzing sequence with transaction lifecycle (backward-compatible method)
      this.fuzzManager.openFuzzTransaction(target.selector, payload);

      try {
        await this.stripConstraints(page);
        await this.injectPayload(page, target.selector, payload);

        // Wait for lagging SPA/network promises to resolve while transaction window remains open
        await this.page?.waitForTimeout(400);
      } finally {
        // Ensure transaction window never leaks between subsequent element exploration selections
        this.fuzzManager.closeTransaction();
      }

      return;
    }

    this.recordActionTrace({
      timestamp: new Date().toISOString(),
      selector: target.selector,
      action: 'button-spammer',
      score: Number(target.riskScore.toFixed(4)),
    });

    await this.safeButtonSpammer(page, target, telemetry);
    await this.simulator.concurrentClicker(page, ranked.slice(1, 6).map((item) => item.selector));
  }

  private async safeButtonSpammer(page: Page, target: InteractiveElement, telemetry: TelemetryGateway): Promise<void> {
    try {
      await this.simulator.buttonSpammer(page, target.selector);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('Node is detached from document') ||
        message.includes('Element is not attached to the DOM') ||
        message.includes('is not clickable') ||
        message.includes('element is not visible') ||
        message.includes('obscured')
      ) {
        telemetry.emitTelemetry(this.event('ACTION', {
          actionExecuted: 'target-obscured-or-detached',
          selector: target.selector,
          message: `Target skipped due to interaction obstruction: ${message}`,
        }));
        return;
      }

      throw error;
    }
  }


  private async stripConstraints(page: Page): Promise<void> {
    // Use formBypasser for comprehensive constraint stripping
    // This leverages the full power of formBypasser for all input types
    try {
      await formBypasser.execute(page, undefined);
    } catch (error) {
      // Fallback to inline implementation if formBypasser fails
      console.warn('[AutonomousExplorationEngine] formBypasser failed, using fallback stripConstraints');
      await page.evaluate(() => {
        try {
          const fields = Array.from(document.querySelectorAll('input, textarea, select'));
          for (const field of fields) {
            field.removeAttribute('required');
            field.removeAttribute('disabled');
            field.removeAttribute('readonly');

            const input = field as HTMLInputElement;
            input.disabled = false;
            input.readOnly = false;
            input.required = false;

            const nextMaxLength = -1;
            if (nextMaxLength < 0) {
              input.removeAttribute('maxLength');
              continue;
            }

            input.maxLength = nextMaxLength;
          }
        } catch (err) {
          console.warn('[BugSafari] stripConstraints evaluate failed', err);
        }
      });
    }
  }


  private async injectPayload(page: Page, selector: string, payload: string): Promise<void> {
    await page
      .evaluate(
        ({ sel, value }: { sel: string; value: string }) => {
          const node = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
          if (!node) return;
          node.focus();
          node.value = value;
          node.dispatchEvent(new Event('input', { bubbles: true }));
          node.dispatchEvent(new Event('change', { bubbles: true }));
        },
        { sel: selector, value: payload },
      )
      .catch(() => undefined);
  }

  private async emitLiveFrame(page: Page, telemetry: TelemetryGateway): Promise<void> {
    /**
     * OPTIMIZED: Capture screenshot as raw Buffer for binary streaming.
     * Uses lower quality JPEG (35) for reduced bandwidth.
     * Frame-skipping guard prevents backpressure when previous broadcast is still in-flight.
     */
    if (this.isFrameBroadcastInFlight) {
      return;
    }
    this.isFrameBroadcastInFlight = true;

    try {
      const screenshot = await page.screenshot({ type: 'jpeg', quality: 35 });

      if (telemetry.emitLiveFrameBinary) {
        telemetry.emitLiveFrameBinary(screenshot);
      } else {
        telemetry.emitLiveFrame(screenshot.toString('base64'));
      }
    } finally {
      this.isFrameBroadcastInFlight = false;
    }
  }

  private startFrameCaptureLoop(page: Page, telemetry: TelemetryGateway): void {
    this.page = page;
    this.currentTelemetry = telemetry;

    this.frameCaptureInterval = setInterval(async () => {
      if (!this.page || !this.currentTelemetry || this.isStopRequested || this.isPaused) {
        return;
      }
      await this.captureAndEmitFrame();
    }, 33);
  }

  private async captureAndEmitFrame(): Promise<void> {
    if (!this.page || !this.currentTelemetry) {
      return;
    }
    if (this.isFrameBroadcastInFlight) {
      return;
    }
    this.isFrameBroadcastInFlight = true;

    try {
      const screenshot = await this.page.screenshot({ type: 'jpeg', quality: 35 });

      if (this.currentTelemetry.emitLiveFrameBinary) {
        this.currentTelemetry.emitLiveFrameBinary(screenshot);
      } else {
        this.currentTelemetry.emitLiveFrame(screenshot.toString('base64'));
      }
    } catch {
    } finally {
      this.isFrameBroadcastInFlight = false;
    }
  }

  private stopFrameCaptureLoop(): void {
    if (this.frameCaptureInterval) {
      clearInterval(this.frameCaptureInterval);
      this.frameCaptureInterval = null;
    }
    this.page = null;
    this.currentTelemetry = null;
  }

  private logHighImpact(target: InteractiveElement, telemetry: TelemetryGateway): void {
    const source = `${target.id} ${target.className} ${target.innerText}`.toLowerCase();
    if (source.includes('delete account') || source.includes('delete')) {
      telemetry.emitTelemetry(this.event('ACTION', {
        actionExecuted: 'high-impact-action-detected',
        selector: target.selector,
        message: `High impact action detected: ${target.innerText || target.selector}`,
      }));
    }
  }

  /**
     * Executes additional security fuzzing payloads alongside SecurityVulnerabilityScout.
     * Uses the strategy pattern to enhance security testing with categorized fuzzing strategies.
     */
  private async executeSecurityFuzzerPayloads(
    page: Page,
    telemetry: TelemetryGateway,
    target: InteractiveElement,
  ): Promise<void> {
    const selector = target.selector;

    // Use strategy pattern - classify the input element and get targeted fuzzing strategy
    const category = classifyInputElement(target);
    const strategyPayload = getStrategyByCategory(category);
    const payload = strategyPayload.value;

    try {
      await this.injectPayload(page, selector, payload);
      telemetry.emitTelemetry(this.event('ACTION', {
        actionExecuted: 'security-fuzzer-injection',
        selector,
        message: `🔐 Security Fuzzer: Injecting ${category} strategy payload (${payload.length} chars) into ${selector}`,
      }));
    } catch (error) {
      console.warn('[AutonomousExplorationEngine] Security fuzzer injection failed:', error);
    }

    // Trace all payloads injected for security audit
    console.log(
      `[SecurityFuzzerPayloads] Enhanced security testing complete on ${selector}: ` +
      `strategy=${category}, payloadLength=${payload.length}`,
    );
  }

  private event(type: TelemetryEvent['type'], meta: TelemetryEvent['meta']): TelemetryEvent {
    return {
      timestamp: new Date().toISOString(),
      type,
      meta,
    };
  }
}

function inferSemanticRole(element: InteractiveElement): 'LOGIN' | 'SEARCH' | 'SUBMIT' | 'CANCEL' | 'DESTRUCTIVE' | 'NAVIGATE' | 'INPUT' | 'UNKNOWN' {
  const text = `${element.id} ${element.className} ${element.innerText} ${element.type}`.toLowerCase();
  if (text.includes('login') || text.includes('password')) return 'LOGIN';
  if (text.includes('search')) return 'SEARCH';
  if (text.includes('submit') || text.includes('checkout') || text.includes('pay')) return 'SUBMIT';
  if (text.includes('cancel') || text.includes('close')) return 'CANCEL';
  if (text.includes('delete') || text.includes('remove')) return 'DESTRUCTIVE';
  if (element.tagName === 'a') return 'NAVIGATE';
  if (element.tagName === 'input' || element.tagName === 'select') return 'INPUT';
  return 'UNKNOWN';
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}