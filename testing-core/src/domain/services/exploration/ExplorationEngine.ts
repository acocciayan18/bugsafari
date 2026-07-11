import type { Page, Request, Response } from 'playwright';
import type { TelemetryGateway } from '../../../application/ports/TelemetryGateway.js';
import { defaultOptimizationSettings } from '../../../../../shared/types.js';
import type { OptimizationSettings, TestingTypeId } from '../../../../../shared/types.js';
import type { ActionBreadcrumb, ActionRecord, ActionType, TelemetryEvent } from '../../../../../shared/types.ts';
import { CircularBuffer } from '../../../lib/circularBuffer.js';
import { RecursiveDomParser } from '../../heuristics/domParser.js';
import { DomHasher, normalizeRoutePath } from '../../../ml/domHasher.js';
import { VisualRegressionDetector } from '../../heuristics/VisualRegressionDetector.js';
import { InteractionSimulator } from '../../scenarios/rapidClicker/index.js';
import { RiskScorer } from '../RiskScorer.js';
import { ChaosTransactionManager } from '../../chaos/ChaosTransactionManager.js';
import { setChaosManagerAccessor as setStructuralProbeAccessor } from '../../../bugs/finders/structuralProbe.js';
import { setChaosManagerAccessor as setConcurrentStressAccessor } from '../../../bugs/finders/concurrentStress.js';
import { setChaosManagerAccessor as setFuzzGuardAccessor } from '../../../bugs/finders/fuzzGuard.js';
import { BoundingBoxHighlighter } from '../../../infrastructure/playwright/BoundingBoxHighlighter.js';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import type { FindingRepository } from '../../repositories/FindingRepository.js';
import type { BrowserInfo } from '../../../infrastructure/playwright/PlaywrightBrowserEngine.js';
import { ReproductionPlaybookStore } from '../../../infrastructure/monitoring/reproductionPlaybookStore.js';
import { forensicErrorRepository } from '../../../infrastructure/database/repositories/ForensicErrorRepository.js';
import { forensicTelemetryRepository } from '../../../infrastructure/database/repositories/ForensicTelemetryRepository.js';
import { Types, isValidObjectId } from 'mongoose';

import { StateGraphNavigator } from '../StateGraphNavigator.js';
import { ScenarioGate } from '../scenarioGate.js';
import type { PathfinderMode } from '../DIrectedPathFinder.js';

import { TelemetryEmitter } from '../telemetry/TelemetryEmitter.js';
import { StabilityMonitor } from '../telemetry/StabilityMonitor.js';
import { ActionExecutor } from './ActionExecutor.js';
import { StateRestorer } from './StateRestorer.js';
import { StrictUrlLockGuard } from './StrictUrlLockGuard.js';
import { PageHealthGuard } from './PageHealthGuard.js';
import { ExplorationLoop } from './ExplorationLoop.js';
import { StateClusterRegistry } from './StateClusterRegistry.js';
import { EscalationTracker } from './EscalationTracker.js';
import { RouteExhaustionTracker } from './RouteExhaustionTracker.js';
import { shouldAttributeNetworkSignal } from './networkAttribution.js';
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

// Causal attribution bounds for async network-signal rewards: a click's own
// xhr/fetch fires within a beat and only a few times, so signals outside this
// window/cap are background SPA chatter (socket.io polling, lazy assets) that must
// not train the model on the acting element.
const NETWORK_ATTRIBUTION_WINDOW_MS = 2000;
const MAX_NETWORK_REWARDS_PER_ACTION = 3;

/**
 * Manages parent execution orchestration and run setups for an autonomous
 * exploratory testing session. Owns the engine collaborators, run-scoped shared
 * state, persistence, timing/timebox, and the confirmed-bug ledger, then
 * delegates the incremental step logic to {@link ExplorationLoop} and the
 * telemetry / stability / action / restore concerns to their respective modules.
 */
export class ExplorationEngine {
  private readonly parser = new RecursiveDomParser();
  // URL-aware node identity: structurally identical pages at distinct routes
  // (e.g. a shared 404 template at /null vs /-1) resolve to DISTINCT graph nodes
  // so they never false-trip cyclic-loop detection. The same instance is shared
  // with StateRestorer so post-click verification stays identity-consistent.
  private readonly hashManager = new DomHasher({ urlAware: true });
  private readonly visualRegressionDetector = new VisualRegressionDetector();
  private readonly simulator = new InteractionSimulator();
  private readonly scorer = new RiskScorer();
  private readonly highlighter = new BoundingBoxHighlighter();
  private readonly actions = new CircularBuffer<ActionBreadcrumb>(20);
  private readonly visitedUrls = new Set<string>();
  private readonly visitedHashes = new Set<string>();
  // Structure sub-hashes seen this run — novelty reward is gated on a NEW shell,
  // not the volatile combined hash, so ad/crash churn can't fake novel states.
  private readonly visitedStructures = new Set<string>();
  // Clustered state-space coverage layer (keyed by normalized structure hash).
  private readonly clusterRegistry = new StateClusterRegistry();
  // Per-(selector, category) payload-escalation level for adaptive fuzzing.
  private readonly escalationTracker = new EscalationTracker();
  // Consecutive defensive/error-route detector — drives URL-aware error-state
  // handling (penalize + redirect instead of oscillating on 404 templates).
  private readonly routeExhaustion = new RouteExhaustionTracker();
  // Element most recently acted on — lets async signals (network xhr/fetch,
  // confirmed faults) attribute compound learning rewards to the right element.
  private lastActedTarget: InteractiveElement | null = null;
  // Timestamp + counter bounding causal network-signal attribution to the current action.
  private lastActedAtMs = 0;
  private networkRewardsThisAction = 0;
  private readonly recentActionTraceIds: string[] = [];
  // State Graph Navigator for directed path finding and loop prevention (Task 2)
  // Initialised in the constructor after mode is derived from selectedScenarios.
  private readonly pathNavigator: StateGraphNavigator;
  private sessionId: string | null = null;
  // Survives past the run's `finally` block (unlike sessionId, which is nulled
  // there) so StartExplorationUseCase can look it up after run() returns, to
  // update-in-place instead of creating a second document on manual save.
  private lastSessionId: string | null = null;
  private freezeActionTraceRecording = false;
  private lastBrainSnapshotStep = 0;
  private targetOrigin = '';
  private targetUrl = ''; // Full run URL — keyed for per-URL brain persistence/warm-start.
  // Strict Page Boundary Lock: when true the launch URL is the immutable
  // reference state and any drift is reverted (resolved in the constructor).
  private readonly strictUrlLock: boolean;
  // RouteTrasher URL-mutation budget per state (resolved in the constructor).
  private readonly routeMutationBudget: number;

  private isPaused = false;
  private isStopRequested = false;
  private chaosThreshold = 0.25; // 25% chance to escalate to security scenarios for text inputs

  // Accumulative active time tracking for timebox (only counts when NOT paused)
  private elapsedActiveTimeMs: number = 0;
  private timingInterval: ReturnType<typeof setInterval> | null = null;
  private lastTickTimestamp: number = 0;
  private timeboxMs: number; // Resolved in the constructor from optimizationSettings (default 10 minutes)
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
    private readonly userId?: string,
  ) {
    console.log(`[ExplorationEngine] Optimization settings:`, optimizationSettings);

    // Resolve the enforced timebox from the caller-supplied settings, falling
    // back to the shared default. Previously this was hardcoded at field
    // declaration and optimizationSettings was ignored entirely.
    this.timeboxMs = optimizationSettings?.['execution-timebox-ms']
      ?? defaultOptimizationSettings['execution-timebox-ms']
      ?? 600000;

    // Resolve the Strict Page Boundary Lock flag (defaults off / backward-compatible).
    this.strictUrlLock = optimizationSettings?.strictUrlLock ?? false;
    console.log(`[ExplorationEngine] Strict URL Lock:`, this.strictUrlLock);

    // Resolve the RouteTrasher URL-mutation budget per state (default 1; 0 disables).
    this.routeMutationBudget = optimizationSettings?.['route-mutation-budget']
      ?? defaultOptimizationSettings['route-mutation-budget']
      ?? 1;
    console.log(`[ExplorationEngine] RouteTrasher budget:`, this.routeMutationBudget);

    // Build the testing-type gate (empty/undefined selection => all enabled).
    this.gate = new ScenarioGate(selectedScenarios);
    console.log(`[ExplorationEngine] Active testing types:`, this.gate.activeCategories());

    // Derive and wire the scenario-aware pathfinder mode.
    const pathfinderMode = ExplorationEngine.derivePathfinderMode(selectedScenarios);
    this.pathNavigator = new StateGraphNavigator({ mode: pathfinderMode });
    console.log(`[ExplorationEngine] PathfinderMode: ${pathfinderMode}`);

    // Initialize ChaosTransactionManager (transaction lifecycle only — bug
    // evaluation/telemetry now flows through the knowledge-base FaultClassifier
    // in StabilityMonitor, so no callbacks are needed here).
    this.fuzzManager = new ChaosTransactionManager();

    // Expose this run's transaction manager to the route-mutation finder so it can
    // read live ROUTE_TRASH metadata. NOTE: the bugs/ finder registry currently has
    // no runner, so structuralProbe stays dormant until one is added — live failure
    // capture during thrashing already flows through StabilityMonitor regardless.
    setStructuralProbeAccessor(this.fuzzManager);
    // Same wiring for the concurrent-stress guard so it can read live STRESS_CLICK
    // metadata. Same dormant-runner caveat applies; StabilityMonitor handles live
    // capture during the burst regardless.
    setConcurrentStressAccessor(this.fuzzManager);
    // Same wiring for the data-fuzz guard so it can read live FUZZ metadata. Same
    // dormant-runner caveat; StabilityMonitor handles live capture regardless.
    setFuzzGuardAccessor(this.fuzzManager);
  }

  public getConfirmedBugsFromMemory(): ConfirmedBug[] {
    return this.confirmedBugsMemory;
  }

  public registerConfirmedBug(bug: ConfirmedBug): void {
    // IDENTITY-ONLY dedup. Content-based dedup (type+message+selector+payload)
    // catastrophically collapsed distinct error INSTANCES — e.g. 15 HTTP 500s to
    // the same endpoint share an identical signature and were merged into 1,
    // losing 14 findings before they ever reached the database. Every distinct
    // registration carries a unique bugId, so we only skip a literal re-push of
    // the exact same id. This retains all 15 instances for full telemetry parity.
    const isDuplicate = this.confirmedBugsMemory.some(
      existing => existing.bugId === bug.bugId
    );

    if (!isDuplicate) {
      this.confirmedBugsMemory.push(bug);

      // Task 3A: Enforce memory cap to prevent resource exhaustion
      // Use circular buffer approach - remove oldest entry when cap is reached
      while (this.confirmedBugsMemory.length > MAX_CONFIRMED_BUGS) {
        this.confirmedBugsMemory.shift();
      }

      // Strongest compound reward: the element acted on just surfaced a real
      // fault/vulnerability, so its feature signature should gain weight.
      if (this.lastActedTarget) {
        this.scorer.applyCompoundReward(this.lastActedTarget, { faultDetected: true });
      }
    }
  }

  public pause() {
    if (this.isPaused) return; // already paused — idempotent no-op against duplicate calls
    // Record the snapshot of elapsed time when pausing
    this.pauseSnapshotTimeMs = this.elapsedActiveTimeMs;
    this.isPaused = true;
    console.log(`[ExplorationEngine] Session PAUSED at ${this.pauseSnapshotTimeMs}ms elapsed`);
  }

  public resume() {
    if (!this.isPaused) return; // already running — idempotent no-op against duplicate calls
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

  /**
   * Get the DB session id of the most recently started run, surviving past
   * run()'s finally block (unlike sessionId). Null for guests/in-memory runs.
   */
  public getLastSessionId(): string | null {
    return this.lastSessionId;
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
  public isTimeboxExceeded(timeboxMs: number = this.timeboxMs): boolean {
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
   * No telemetry is emitted here — the frontend runs its own local countdown.
   */
  private startTimingInterval(_telemetry: TelemetryGateway): void {
    this.elapsedActiveTimeMs = 0;
    this.lastTickTimestamp = Date.now();

    this.timingInterval = setInterval(() => {
      if (!this.isPaused && !this.isStopRequested) {
        const now = Date.now();
        const delta = now - this.lastTickTimestamp;
        this.elapsedActiveTimeMs += delta;
        this.lastTickTimestamp = now;
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
    this.targetUrl = targetUrl;
    this.freezeActionTraceRecording = false;
    ActiveScenarioTracker.reset();
    this.clusterRegistry.reset();
    this.escalationTracker.resetAll();
    this.routeExhaustion.reset();
    this.lastBrainSnapshotStep = 0;
    this.activePage = page;

    // Last navigated URL — shared via closure with the stability monitor and loop.
    let lastKnownUrl = '';

    // Latest MAIN-FRAME document response status, keyed by its normalized route
    // path. Lets the loop's error-route detector see a real HTTP ≥400 hard
    // navigation; null for pure client-side SPA renders (no top-level response).
    // Reassigned on page recreation via the shared `page` binding, exactly like
    // lastKnownUrl, so it survives the deepest recovery rung.
    let lastMainFrameStatus: { path: string; status: number } | null = null;

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
      simulator: this.simulator,
      highlighter: this.highlighter,
      telemetry: emitter,
      recordActionTrace: (trace, clean) => this.recordActionTrace(trace, clean),
      getTargetOrigin: () => this.targetOrigin,
      escalationTracker: this.escalationTracker,
    });

    // Operator visibility: announce which testing strategies are active this run.
    emitter.emitMilestone(`🎛️ Active testing types: ${this.gate.activeCategories().join(', ')}`);

    // Announce the Strict Page Boundary Lock so the operator sees the URL is pinned.
    if (this.strictUrlLock) {
      emitter.emitMilestone(`🔒 Strict Page Boundary Lock enabled — exploration confined to ${targetUrl}`);
    }

    // Warm-start the perceptron from the latest brain for this URL BEFORE creating the
    // session, so "most recent session for this URL" is a genuine prior run (not this one).
    await this.warmStartBrain(targetUrl, emitter);

    this.sessionId = await this.createSession(targetUrl);
    this.lastSessionId = this.sessionId;

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
    this.lastActedTarget = null;

    // Page-scoped wiring is applied through one routine so the deepest recovery
    // rung (page recreation) rebuilds a fresh page identically to launch — no
    // listener/telemetry drift between the initial page and a recreated one.
    const handleFramenavigated = (): void => {
      const url = page.url();
      if (!url) return;
      lastKnownUrl = url;
      // Phase 3: Track page count when navigating
      this.runtimeMetrics.pageCount++;
      emitter.gateway.emitUrlChanged(url);
    };

    const handleRequest = (request: Request): void => {
      const t = this.lastActedTarget;
      if (!t) {
        return;
      }
      const resourceType = request.resourceType();
      if (resourceType !== 'xhr' && resourceType !== 'fetch') return;
      // Only reward network activity plausibly caused by this action: within a short
      // causal window and under a per-action cap. Background SPA chatter (socket.io
      // polling, lazy assets) outside these bounds would otherwise flood the acting
      // element with reward noise (observed on OWASP Juice Shop).
      if (
        !shouldAttributeNetworkSignal({
          msSinceAction: Date.now() - this.lastActedAtMs,
          rewardsThisAction: this.networkRewardsThisAction,
          windowMs: NETWORK_ATTRIBUTION_WINDOW_MS,
          maxPerAction: MAX_NETWORK_REWARDS_PER_ACTION,
        })
      ) {
        return;
      }
      this.networkRewardsThisAction += 1;
      this.scorer.applyCompoundReward(t, { networkActivity: true });
      emitter.emit('ACTION', {
        actionExecuted: 'dynamic-weight-update',
        selector: t.selector,
        message: `Boosted feature weights after ${resourceType.toUpperCase()} network signal.`,
      });
    };

    // Capture the status of top-level document navigations only (not subresources
    // or in-page fetches) so the loop can flag an HTTP ≥400 route without reading
    // response bodies. Guarded — a teardown race must never break navigation.
    const handleResponse = (response: Response): void => {
      try {
        const request = response.request();
        if (request.resourceType() !== 'document' || !request.isNavigationRequest()) return;
        if (response.frame() !== page.mainFrame()) return;
        lastMainFrameStatus = { path: normalizeRoutePath(response.url()), status: response.status() };
      } catch {
        /* response already gone — ignore */
      }
    };

    const attachPageListeners = (p: Page): void => {
      stabilityMonitor.attachDialogAutoDismiss(p);
      stabilityMonitor.attachExceptionMonitoring(p);
      p.on('request', handleRequest);
      p.on('response', handleResponse);
      stabilityMonitor.attachNetworkMonitoring(p);
      p.on('framenavigated', handleFramenavigated);
    };

    // 🏁 Safari Initialized (milestone)
    emitter.emitMilestone('🏁 Safari Initialized');

    attachPageListeners(page);

    // 🚀 Start the independent 33 ms frame loop the instant the page object exists.
    emitter.startFrameCaptureLoop(page);

    // Deepest recovery rung: replace a dead/blank page with a fresh, fully re-wired
    // one navigated back to the target (strict guard reinstalled if enabled).
    const recreatePage = async (): Promise<Page | null> => {
      try {
        const context = page.context();
        emitter.stopFrameCaptureLoop();
        if (this.cleanupStabilityMonitor) {
          this.cleanupStabilityMonitor();
          this.cleanupStabilityMonitor = null;
        }
        if (!page.isClosed()) {
          try { await page.close(); } catch { /* already gone */ }
        }
        const fresh = await context.newPage();
        page = fresh;
        this.activePage = fresh;
        if (this.strictUrlLock) {
          await new StrictUrlLockGuard(targetUrl, emitter).install(fresh);
        }
        attachPageListeners(fresh);
        emitter.startFrameCaptureLoop(fresh);
        await fresh.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        handleFramenavigated();
        await this.ensureDomReady(fresh, emitter);
        this.cleanupStabilityMonitor = await stabilityMonitor.attachAfterNavigation(
          fresh,
          this.targetUrl,
          (bug) => this.registerConfirmedBug(bug),
        );
        return fresh;
      } catch (err) {
        console.error('[ExplorationEngine] Page recreation failed:', err instanceof Error ? err.message : String(err));
        return null;
      }
    };

    // Universal invalid-context recovery + strict-lock drift restore, applied
    // once per exploration iteration by the loop via ensurePageHealth().
    const pageHealthGuard = new PageHealthGuard({
      telemetry: emitter,
      getTargetUrl: () => this.targetUrl,
      getTargetOrigin: () => this.targetOrigin,
      strictUrlLock: this.strictUrlLock,
      recreatePage,
      recordRecovery: (url, strategy) =>
        this.recordActionTrace(
          { timestamp: new Date().toISOString(), selector: url, action: `recover-${strategy}` },
          { actionType: 'NAVIGATE', humanIdentifier: `recovery via ${strategy}`, url },
        ),
    });

    try {
      // Task 3: Emit granular status for dynamic UI - "Navigating to URL..."
      emitter.emitSystemStatus(`Navigating to ${targetUrl}...`);

      // EMIT EARLY TELEMETRY: Notify that browser has started navigating
      // This helps the frontend understand the engine is processing
      emitter.emit('ACTION', {
        actionExecuted: 'browser-launched',
        message: `🚀 Browser launched, navigating to ${targetUrl}...`,
      });

      // 🔒 Proactive Strict Page Boundary Lock: arm the navigation guard BEFORE
      // the first goto so the init script is present for the initial document and
      // the route interceptor is live for the very first navigation. Blocks any
      // main-frame navigation off the locked URL before it commits (no reactive
      // goto → no nav race / main-thread lockup).
      if (this.strictUrlLock) {
        const guard = new StrictUrlLockGuard(targetUrl, emitter);
        await guard.install(page);
      }

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
        this.targetUrl,
        (bug) => this.registerConfirmedBug(bug),
      );

      // Delegate the incremental step-by-step exploration to ExplorationLoop.
      const loop = new ExplorationLoop({
        parser: this.parser,
        scorer: this.scorer,
        hashManager: this.hashManager,
        pathNavigator: this.pathNavigator,
        clusterRegistry: this.clusterRegistry,
        routeExhaustion: this.routeExhaustion,
        gate: this.gate,
        visitedUrls: this.visitedUrls,
        visitedHashes: this.visitedHashes,
        visitedStructures: this.visitedStructures,
        actionExecutor,
        stateRestorer,
        telemetry: emitter,
        runtimeMetrics: this.runtimeMetrics,
        isStopRequested: () => this.isStopRequested,
        isPaused: () => this.isPaused,
        checkTimebox: () => this.checkTimeboxAndTerminateIfExceeded(telemetry),
        getTimeboxMs: () => this.timeboxMs,
        getLastKnownUrl: () => lastKnownUrl,
        // Only surface the status when it matches the current route, so a stale
        // 404 from a previous page can never be attributed to a fresh render.
        getMainFrameStatus: (routePath) =>
          lastMainFrameStatus && lastMainFrameStatus.path === routePath ? lastMainFrameStatus.status : null,
        noteActedTarget: (t) => { this.lastActedTarget = t; this.lastActedAtMs = Date.now(); this.networkRewardsThisAction = 0; },
        getTargetOrigin: () => this.targetOrigin,
        persistBrainSnapshot: (source, step) => this.persistBrainSnapshot(source, step),
        setFreeze: () => { this.freezeActionTraceRecording = true; },
        ensureDomReady: (p) => this.ensureDomReady(p, emitter),
        ensurePageHealth: (p) => pageHealthGuard.ensureHealthy(p),
        strictUrlLock: this.strictUrlLock,
        routeMutationBudget: this.routeMutationBudget,
        // Glass-box Decision Lens: build the exact per-feature rationale for the
        // chosen target vs its runner-up, stamped with this run's session id.
        explainDecision: (input) =>
          this.scorer.explainDecision({ ...input, sessionId: this.sessionId }),
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

      page.off('framenavigated', handleFramenavigated);
      page.off('response', handleResponse);
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
      emitDecisionRationale: telemetry.emitDecisionRationale
        ? (rationale) => telemetry.emitDecisionRationale!(rationale)
        : undefined,
    };
  }

  private async createSession(targetUrl: string): Promise<string | null> {
    // Skip DB persistence for guests / missing id — the run continues fully
    // in-memory (sessionId = null is a supported state). No dummy ObjectId is stamped.
    if (!this.findingRepo || !this.userId || !isValidObjectId(this.userId)) {
      return null;
    }

    try {
      return await this.findingRepo.createSession({
        targetUrl,
        startedAt: new Date().toISOString(),
        userId: this.userId,
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
        targetUrl: this.targetUrl,
        source,
        bias: brainState.bias,
        weights: brainState.weights,
      });
    } catch (error) {
      console.error('[ExplorationEngine] Failed to persist brain snapshot:', error);
    }
  }

  // Load the latest persisted brain for this URL (if any) and seed the scorer. Never throws.
  private async warmStartBrain(targetUrl: string, emitter: TelemetryEmitter): Promise<void> {
    if (!this.findingRepo) return;
    try {
      const prior = await this.findingRepo.loadLatestBrainConfig(targetUrl);
      if (prior && Object.keys(prior.weights).length > 0) {
        this.scorer.importBrainState(prior);
        console.log(`[ExplorationEngine] Warm-started brain for ${targetUrl} (bias=${prior.bias.toFixed(3)})`);
        emitter.emitMilestone('🧠 Warm-started brain from a prior session for this URL.');
      }
    } catch (error) {
      console.error('[ExplorationEngine] Brain warm-start failed:', error);
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

  // Strict-lock drift detection + recovery now lives in PageHealthGuard (which
  // shares StrictUrlLockGuard.confinementKey, so detection can never diverge from
  // enforcement), replacing the former detection-only ensureTargetDomain and its
  // duplicated confinement-key helper.

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
