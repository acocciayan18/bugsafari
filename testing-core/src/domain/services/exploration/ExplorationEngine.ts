import type { Page, Request } from 'playwright';
import type { TelemetryGateway } from '../../../application/ports/TelemetryGateway.js';
import type { OptimizationSettings, TestingTypeId } from '../../../../../shared/types.js';
import type { ActionBreadcrumb, ActionRecord, ActionType, TelemetryEvent } from '../../../../../shared/types.ts';
import { CircularBuffer } from '../../../lib/circularBuffer.js';
import { RecursiveDomParser } from '../../heuristics/domParser.js';
import { DomHasher } from '../../../ml/domHasher.js';
import { VisualRegressionDetector } from '../../heuristics/VisualRegressionDetector.js';
import { SeededRandomGenerator } from '../SeededRandomGenerator.js';
import { InteractionSimulator } from '../../scenarios/rapidClickerStress.js';
import { RiskScorer } from '../RiskScorer.js';
import { ChaosTransactionManager } from '../../fuzzing/ChaosTransactionManager.js';
import { BoundingBoxHighlighter } from '../../../infrastructure/playwright/BoundingBoxHighlighter.js';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import type { FindingRepository } from '../../repositories/FindingRepository.js';
import type { BrowserInfo } from '../../../infrastructure/playwright/PlaywrightBrowserEngine.js';
import { ReproductionPlaybookStore } from '../../../infrastructure/monitoring/reproductionPlaybookStore.js';
import { forensicErrorRepository } from '../../../infrastructure/database/repositories/ForensicErrorRepository.js';
import { forensicTelemetryRepository } from '../../../infrastructure/database/repositories/ForensicTelemetryRepository.js';
import { Types } from 'mongoose';

import { StateGraphNavigator } from '../StateGraphNavigator.js';
import { ScenarioGate } from '../scenarioGate.js';
import type { PathfinderMode } from '../DIrectedPathFinder.js';

import { TelemetryEmitter } from '../telemetry/TelemetryEmitter.js';
import { StabilityMonitor } from '../telemetry/StabilityMonitor.js';
import { ActionExecutor } from './ActionExecutor.js';
import { StateRestorer } from './StateRestorer.js';
import { ExplorationLoop } from './ExplorationLoop.js';
import type { ConfirmedBug, ForensicErrorParams, RuntimeMetrics } from './types.js';

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
 * Manages parent execution orchestration and run setups for an autonomous
 * exploratory testing session. Owns the engine collaborators, run-scoped shared
 * state, persistence, timing/timebox, and the confirmed-bug ledger, then
 * delegates the incremental step logic to {@link ExplorationLoop} and the
 * telemetry / stability / action / restore concerns to their respective modules.
 */
export class ExplorationEngine {
  private readonly parser = new RecursiveDomParser();
  private readonly hashManager = new DomHasher();
  private readonly visualRegressionDetector = new VisualRegressionDetector();
  private readonly simulator = new InteractionSimulator();
  private readonly scorer = new RiskScorer();
  private readonly highlighter = new BoundingBoxHighlighter();
  private readonly actions = new CircularBuffer<ActionBreadcrumb>(20);
  private readonly visitedUrls = new Set<string>();
  private readonly visitedHashes = new Set<string>();
  private readonly recentActionTraceIds: string[] = [];
  // State Graph Navigator for directed path finding and loop prevention (Task 2)
  // Initialised in the constructor after mode is derived from selectedScenarios.
  private readonly pathNavigator: StateGraphNavigator;
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

  // Live page reference for action-trace URL resolution.
  private activePage: Page | null = null;

  private confirmedBugsMemory: ConfirmedBug[] = [];

  // Runtime metrics for Phase 3 telemetry tracking
  private runtimeMetrics: RuntimeMetrics = {
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

  // Operator-gated scenario matrix — resolves which stress/fuzz/bypass modes run.
  private readonly gate: ScenarioGate;

  /**
   * Derive the `PathfinderMode` that best matches the operator's scenario selection.
   * - No selection / all enabled → 'exploration' (broadest coverage)
   * - Exclusively form-centric scenarios (formBypass / dataFuzzing) → 'coverage'
   *   (boredom nearly disabled so sparse input forms are fully swept)
   * - Navigation or exploratory scenarios present → 'exploration'
   * - Mixed/other selections → 'probe' (neutral, original behaviour)
   */
  private static derivePathfinderMode(selected?: TestingTypeId[]): PathfinderMode {
    if (!selected || selected.length === 0) return 'exploration';
    const formFocused = selected.every((s) => s === 'formBypass' || s === 'dataFuzzing');
    if (formFocused) return 'coverage';
    if (selected.includes('navigation') || selected.includes('exploratory')) return 'exploration';
    return 'probe';
  }

  constructor(
    private readonly findingRepo?: FindingRepository,
    private readonly optimizationSettings?: OptimizationSettings,
    selectedScenarios?: TestingTypeId[],
  ) {
    console.log(`[ExplorationEngine] Optimization settings:`, optimizationSettings);

    // Build the testing-type gate (empty/undefined selection => all enabled).
    this.gate = new ScenarioGate(selectedScenarios);
    console.log(`[ExplorationEngine] Active testing types:`, this.gate.activeCategories());

    // Derive and wire the scenario-aware pathfinder mode.
    const pathfinderMode = ExplorationEngine.derivePathfinderMode(selectedScenarios);
    this.pathNavigator = new StateGraphNavigator({ mode: pathfinderMode });
    console.log(`[ExplorationEngine] PathfinderMode: ${pathfinderMode}`);

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
      console.log(`[ExplorationEngine] Running in SEEDED mode (seed: ${seed}) for reproducible testing`);
    } else {
      console.log(`[ExplorationEngine] Running in HEURISTIC mode for intelligent data fuzzer decisions`);
    }
  }

  public getConfirmedBugsFromMemory(): ConfirmedBug[] {
    return this.confirmedBugsMemory;
  }

  public registerConfirmedBug(bug: ConfirmedBug): void {
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
    console.log(`[ExplorationEngine] Session PAUSED at ${this.pauseSnapshotTimeMs}ms elapsed`);
  }

  public resume() {
    // Calculate the new dynamic deadline based on accumulated time
    const remainingTimeMs = Math.max(0, this.timeboxMs - this.elapsedActiveTimeMs);
    this.dynamicDeadline = Date.now() + remainingTimeMs;
    this.isPaused = false;
    console.log(`[ExplorationEngine] Session RESUMED with ${remainingTimeMs}ms remaining (elapsed: ${this.elapsedActiveTimeMs}ms)`);
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

      // Emit timebox completion as INFO (not exception)
      // This signals normal completion, not an error
      telemetry.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'ACTION',
        meta: {
          actionExecuted: 'timebox-completed',
          message: `⏱️ Time limit reached: ${this.timeboxMs / 60000} min timebox completed - exploration ended normally`,
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
      type: this.mapActionVerbToType(crumb.action),
      selector: crumb.selector,
      url: this.targetOrigin || 'unknown',
      payload: crumb.payload,
    }));
  }

  /** Map internal engine action verbs (e.g. 'payload-injection') to a clean ActionType. */
  private mapActionVerbToType(verb: string): ActionType {
    const v = (verb ?? '').toLowerCase();
    if (v.includes('navigat')) return 'NAVIGATE';
    if (v.includes('payload') || v.includes('fuzz') || v.includes('inject') || v.includes('type') || v.includes('input')) {
      return 'TYPE';
    }
    return 'CLICK';
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
    ActiveScenarioTracker.reset();
    this.lastBrainSnapshotStep = 0;
    this.activePage = page;

    // Last navigated URL — shared via closure with the stability monitor and loop.
    let lastKnownUrl = '';

    // Build the telemetry emitter around the persistent gateway.
    const emitter = new TelemetryEmitter(telemetry, {
      isPaused: () => this.isPaused,
      isStopRequested: () => this.isStopRequested,
    });

    // Assemble the extracted domain services with explicit dependency contracts.
    const stabilityMonitor = new StabilityMonitor({
      telemetry: emitter,
      getBreadcrumbs: () => this.actions.snapshot(),
      breadcrumbsToActionRecords: (b) => this.breadcrumbsToActionRecords(b),
      persistForensicError: (params) => { void this.persistForensicError(params); },
      registerConfirmedBug: (bug) => this.registerConfirmedBug(bug),
      setFreeze: () => { this.freezeActionTraceRecording = true; },
      getLastKnownUrl: () => lastKnownUrl,
      onApiFailure: () => { this.runtimeMetrics.requestsCount++; },
    });

    const stateRestorer = new StateRestorer({
      hashManager: this.hashManager,
      telemetry: emitter,
      recordActionTrace: (trace, clean) => this.recordActionTrace(trace, clean),
      getTargetOrigin: () => this.targetOrigin,
    });

    const actionExecutor = new ActionExecutor({
      gate: this.gate,
      fuzzManager: this.fuzzManager,
      seededRandom: this.seededRandom,
      simulator: this.simulator,
      highlighter: this.highlighter,
      dataFuzzerThreshold: this.dataFuzzerThreshold,
      telemetry: emitter,
      recordActionTrace: (trace, clean) => this.recordActionTrace(trace, clean),
      getTargetOrigin: () => this.targetOrigin,
    });

    // Operator visibility: announce which testing strategies are active this run.
    emitter.emitMilestone(`🎛️ Active testing types: ${this.gate.activeCategories().join(', ')}`);

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

    let handleFramenavigated: (() => void) | null = null;

    // 🏁 Safari Initialized (milestone)
    emitter.emitMilestone('🏁 Safari Initialized');

    stabilityMonitor.attachDialogAutoDismiss(page);
    stabilityMonitor.attachExceptionMonitoring(page);

    page.on('request', (request: Request) => {
      if (!lastTarget) {
        return;
      }
      const t: InteractiveElement = lastTarget;
      const resourceType = request.resourceType();
      if (resourceType === 'xhr' || resourceType === 'fetch') {
        this.scorer.rewardFromNetworkSignal(t);
        emitter.emit('ACTION', {
          actionExecuted: 'dynamic-weight-update',
          selector: t.selector,
          message: `Boosted feature weights after ${resourceType.toUpperCase()} network signal.`,
        });
      }
    });

    stabilityMonitor.attachNetworkMonitoring(page);

    handleFramenavigated = (): void => {
      const url = page.url();
      if (!url) return;
      lastKnownUrl = url;
      // Phase 3: Track page count when navigating
      this.runtimeMetrics.pageCount++;
      emitter.gateway.emitUrlChanged(url);
    };

    page.on('framenavigated', handleFramenavigated);

    // 🚀 Start the independent 33 ms frame loop the instant the page object exists.
    emitter.startFrameCaptureLoop(page);

    try {
      // Task 3: Emit granular status for dynamic UI - "Navigating to URL..."
      emitter.emitSystemStatus(`Navigating to ${targetUrl}...`);

      // EMIT EARLY TELEMETRY: Notify that browser has started navigating
      // This helps the frontend understand the engine is processing
      emitter.emit('ACTION', {
        actionExecuted: 'browser-launched',
        message: `🚀 Browser launched, navigating to ${targetUrl}...`,
      });

      console.log('[ExplorationEngine] Starting page.goto for targetUrl:', targetUrl);
      // Use shorter timeout and better wait strategy to prevent hanging
      // Also emit immediate frame to prevent "No live frame" timeout
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      console.log('[ExplorationEngine] page.goto completed for targetUrl:', targetUrl);

      // Open the reproduction playbook with the initial navigation step.
      this.recordActionTrace(
        {
          timestamp: new Date().toISOString(),
          selector: targetUrl,
          action: 'navigation',
        },
        { actionType: 'NAVIGATE', humanIdentifier: targetUrl, url: targetUrl },
      );

      handleFramenavigated(); // emit the real post-navigation URL

      await this.ensureDomReady(page, emitter);

      // 🛡️ Initialize background stability/console monitoring (heartbeat + console tab).
      this.cleanupStabilityMonitor = await stabilityMonitor.attachAfterNavigation(
        page,
        (bug) => this.registerConfirmedBug(bug),
      );

      // Delegate the incremental step-by-step exploration to ExplorationLoop.
      const loop = new ExplorationLoop({
        parser: this.parser,
        scorer: this.scorer,
        hashManager: this.hashManager,
        pathNavigator: this.pathNavigator,
        gate: this.gate,
        visitedUrls: this.visitedUrls,
        visitedHashes: this.visitedHashes,
        actionExecutor,
        stateRestorer,
        telemetry: emitter,
        runtimeMetrics: this.runtimeMetrics,
        isStopRequested: () => this.isStopRequested,
        isPaused: () => this.isPaused,
        checkTimebox: () => this.checkTimeboxAndTerminateIfExceeded(telemetry),
        getTimeboxMs: () => this.timeboxMs,
        getLastKnownUrl: () => lastKnownUrl,
        persistBrainSnapshot: (source, step) => this.persistBrainSnapshot(source, step),
        setFreeze: () => { this.freezeActionTraceRecording = true; },
        ensureDomReady: (p) => this.ensureDomReady(p, emitter),
        ensureTargetDomain: (p) => this.ensureTargetDomain(p),
      });

      return await loop.execute(page, maxSteps);
    } finally {
      // 🧹 Cleanup: dispose stability monitoring to prevent "ghost" heartbeat intervals
      if (this.cleanupStabilityMonitor) {
        this.cleanupStabilityMonitor();
        this.cleanupStabilityMonitor = null;
      }

      // 🚀 Stop frame capture loop
      emitter.stopFrameCaptureLoop();

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
      this.activePage = null;
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
      console.error('[ExplorationEngine] Failed to create Safari session:', error);
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
      console.error('[ExplorationEngine] Failed to complete Safari session:', error);
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
      console.error('[ExplorationEngine] Failed to persist finding:', error);
    }
  }

  private recordActionTrace(
    trace: ActionBreadcrumb,
    clean?: { actionType: ActionType; humanIdentifier?: string; value?: string; url?: string },
  ): void {
    if (this.freezeActionTraceRecording) {
      return;
    }

    this.actions.push(trace);

    // Push a clean, human-descriptive record into the canonical playbook buffer
    // so crash-time narrative serialization reads accurate action types, visible
    // labels, live URLs, and real fuzz/text values instead of internal engine verbs.
    const actionRecord: ActionRecord = {
      timestamp: trace.timestamp,
      type: clean?.actionType ?? 'CLICK',
      selector: trace.selector,
      url: clean?.url ?? this.activePage?.url() ?? this.targetOrigin ?? 'unknown',
      payload: clean?.value ?? trace.payload,
      fallbackLabel: clean?.humanIdentifier,
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
        console.error('[ExplorationEngine] Failed to persist action trace:', error);
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
      console.error('[ExplorationEngine] Failed to persist brain snapshot:', error);
    }
  }

  /**
   * Persist error to forensic_errors database (Phase 2: Error Logging System)
   */
  private async persistForensicError(params: ForensicErrorParams): Promise<void> {
    if (!this.sessionId) return;

    try {
      await forensicErrorRepository.create({
        forensicRunId: new Types.ObjectId(this.sessionId),
        ...params,
      });
    } catch (error) {
      console.error('[ExplorationEngine] Failed to persist forensic error:', error);
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
      console.error('[ExplorationEngine] Failed to persist forensic telemetry:', error);
    }
  }

  private async ensureTargetDomain(page: Page): Promise<void> {
    const current = page.url();
    if (!current) {
      return;
    }
  }

  private async ensureDomReady(page: Page, telemetry: TelemetryEmitter): Promise<void> {
    try {
      await page.waitForSelector('button, input, a, select, [style*="cursor: pointer"]', {
        timeout: 5000,
      });
    } catch {
      telemetry.emit('ACTION', {
        actionExecuted: 'dom-wait-timeout',
        message: 'No interactive selector found during 5s wait window.',
      });
    }
  }
}
