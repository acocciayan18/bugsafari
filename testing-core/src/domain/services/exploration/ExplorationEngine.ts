import type { Page } from 'playwright';
import type { TelemetryGateway } from '../../../application/ports/TelemetryGateway.js';
import { STOP_REASON_DETAIL, STOP_REASON_OUTCOME, defaultOptimizationSettings } from '../../../../../shared/types.js';
import type { OptimizationSettings, TestingTypeId } from '../../../../../shared/types.js';
import type { ActionBreadcrumb, ActionRecord, ActionType, FindingAttribution, IncidentReport } from '../../../../../shared/types.js';
import { CircularBuffer } from '../../../lib/circularBuffer.js';
import { RecursiveDomParser } from '../../heuristics/domParser.js';
import { DomHasher, normalizeRoutePath } from '../../../ml/domHasher.js';
import { AccessibilityAuditor } from '../../heuristics/AccessibilityAuditor.js';
import { BrokenNavigationFinder } from '../../heuristics/BrokenNavigationFinder.js';
import type { InteractionContext } from '../../heuristics/DuplicateActionFinder.js';
import type { NavigationDefect } from '../../heuristics/BrokenNavigationFinder.js';
import { resolveScenarioAttribution } from '../../../bugs/knowledgeBase/scenarioCatalog.js';
import { normalizeFaultType, isSecurityBugClass } from '../../../bugs/knowledgeBase/FaultClassifier.js';
import { ReproductionProbe, type ReproductionOutcome } from '../verification/ReproductionProbe.js';
import { applyReproductionOutcome } from '../verification/confidenceScore.js';
import { InteractionSimulator } from '../../scenarios/rapidClicker/index.js';
import { RiskScorer } from '../RiskScorer.js';
import { ChaosTransactionManager } from '../../chaos/ChaosTransactionManager.js';
import {
  BUG_FINDERS,
  setStructuralProbeAccessor,
  setConcurrentStressAccessor,
  resetConstraintBypassFinder,
} from '../../../bugs/finders/index.js';
import { setChaosManagerAccessor as setFuzzGuardAccessor } from '../../../bugs/finders/fuzzGuard.js';
import { BoundingBoxHighlighter } from '../../../infrastructure/playwright/BoundingBoxHighlighter.js';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import type { FindingRepository } from '../../repositories/FindingRepository.js';
import type { BrowserInfo } from '../../../infrastructure/playwright/PlaywrightBrowserEngine.js';
import { ReproductionPlaybookStore } from '../../../infrastructure/monitoring/reproductionPlaybookStore.js';
import { captureStateFingerprint } from '../../../infrastructure/monitoring/stateFingerprint.js';
import { narrateActionRecords, resolveElementLabel } from '../forensics/narration.js';
import { forensicErrorRepository, type CreateForensicErrorParams } from '../../../infrastructure/database/repositories/ForensicErrorRepository.js';
import { MAX_FORENSIC_ROWS } from '../../../infrastructure/database/queryLimits.js';
import { forensicTelemetryRepository } from '../../../infrastructure/database/repositories/ForensicTelemetryRepository.js';
import { Types, isValidObjectId } from 'mongoose';

import { StateGraphNavigator } from '../StateGraphNavigator.js';
import { seedScenarioRandom } from '../../scenarios/seededRandom.js';
import { ScenarioGate } from '../scenarioGate.js';
import type { PathfinderMode } from '../DIrectedPathFinder.js';

import { TelemetryEmitter } from '../telemetry/TelemetryEmitter.js';
import { StabilityMonitor } from '../telemetry/StabilityMonitor.js';
import { scrubCredentials } from '../telemetry/credentialScrub.js';
import { ActionExecutor } from './ActionExecutor.js';
import { StateRestorer } from './StateRestorer.js';
import { StrictUrlLockGuard } from './StrictUrlLockGuard.js';
import { PageHealthGuard } from './PageHealthGuard.js';
import { ExplorationLoop } from './ExplorationLoop.js';
import { BugFinderRunner } from './BugFinderRunner.js';
import { StateClusterRegistry } from './StateClusterRegistry.js';
import { AsyncTaskTracker } from './AsyncTaskTracker.js';
import { EscalationTracker } from './EscalationTracker.js';
import { RouteExhaustionTracker } from './RouteExhaustionTracker.js';
import { EdgeRepeatTracker } from './EdgeRepeatTracker.js';
import { NetworkFailureCascadeTracker } from './NetworkFailureCascadeTracker.js';
import { FormFuzzRegistry } from './FormFuzzRegistry.js';
import { shouldAttributeNetworkSignal } from './networkAttribution.js';
import { TabWindowManager } from './TabWindowManager.js';
import type { CleanActionStep, ConfirmedBug, ExplorationLoopDeps, ForensicErrorParams, RunResult, RunTerminationOutcome, RuntimeMetrics, StopReason } from './types.js';

// ─────────────────────────────────────────────────────────────
// SECURITY PATCHES (Addressing Critical Vulnerabilities)
// ─────────────────────────────────────────────────────────────

/**
 * Maximum number of confirmed bugs to store in memory.
 * Prevents resource exhaustion during long-running SPA exploration sessions.
 * Task 3A: Patch Memory Leaks
 */
const MAX_CONFIRMED_BUGS = 500;

// Steps between sweeps of 'cadenced' finders — matches the network-sabotage cadence.
const BUG_FINDER_CADENCE = 10;
// Per-run ceiling on finder-produced findings, so a chatty finder can't dominate the ledger.
const BUG_FINDER_BUDGET = 25;

// Causal attribution bounds for async network-signal rewards: a click's own
// xhr/fetch fires within a beat and only a few times, so signals outside this
// window/cap are background SPA chatter (socket.io polling, lazy assets) that must
// not train the model on the acting element.
const NETWORK_ATTRIBUTION_WINDOW_MS = 2000;
const MAX_NETWORK_REWARDS_PER_ACTION = 3;
// Buffered forensic errors flush once this many accumulate (mirrors the log-batch path).
const FORENSIC_FLUSH_THRESHOLD = 50;

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
  // Static WCAG auditor — scans each novel structural shell once, read-only.
  private readonly accessibilityAuditor = new AccessibilityAuditor();
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
  // Saturation thresholds resolved from optimizationSettings in the constructor.
  private readonly clusterRegistry: StateClusterRegistry;
  // Resolved graph/coverage settings, kept as fields so a secondary-tab sub-session
  // can build isolated collaborators configured identically to the primary's.
  private readonly saturationVisits: number;
  private readonly saturationInteractions: number;
  private readonly pathfinderMode: PathfinderMode;
  private readonly explorationSeed: number | undefined;
  // Per-(selector, category) payload-escalation level for adaptive fuzzing.
  private readonly escalationTracker = new EscalationTracker();
  // Consecutive defensive/error-route detector — drives URL-aware error-state
  // handling (penalize + redirect instead of oscillating on 404 templates).
  private readonly routeExhaustion = new RouteExhaustionTracker();
  // Session-wide structural-transition repeat counter — caps how many times one
  // control may re-navigate its shell back to a seen view before it is blocked as
  // an SPA navigation-loop source.
  private readonly edgeRepeat = new EdgeRepeatTracker();
  // Per-form fuzz-attempt budget — excludes a form after formFuzzCap submissions
  // to prevent input over-fuzzing on multi-field forms.
  private readonly formFuzz = new FormFuzzRegistry();
  // Rolling-window burst detector for failed network events — lets rapid-fire scenarios back off before a freeze.
  private readonly networkFailureCascade = new NetworkFailureCascadeTracker();
  // Element most recently acted on — lets async signals (network xhr/fetch,
  // confirmed faults) attribute compound learning rewards to the right element.
  private lastActedTarget: InteractiveElement | null = null;
  /** Set once the run authenticates into the target — guards against self-logout. */
  private authenticatedRun = false;
  // Timestamp + counter bounding causal network-signal attribution to the current action.
  private lastActedAtMs = 0;
  private networkRewardsThisAction = 0;
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
  // Session-wide transition-repeat budget (resolved in the constructor).
  private readonly transitionRepeatBudget: number;
  // Per-form fuzz cap (resolved in the constructor).
  private readonly formFuzzCap: number;

  private isPaused = false;
  private isStopRequested = false;
  // Why stop() was called. Null while running — a browser-closed error observed with
  // no reason recorded is a genuine fault, never an operator stop.
  private stopReason: StopReason | null = null;

  // Tracks fire-and-forget DB/telemetry writes so Pause/Stop can flush them before
  // the lifecycle settles (graceful settlement barrier).
  private readonly asyncTasks = new AsyncTaskTracker();

  // Per-run forensic-error buffer — batched via createMany instead of one insert
  // per event, and capped so a spewing target can't write unbounded rows.
  private forensicErrorBuffer: ForensicErrorParams[] = [];
  private forensicErrorsPersisted = 0;
  private forensicFlushChain: Promise<void> = Promise.resolve();

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

  // Live telemetry gateway for the active run — lets registerConfirmedBug stream
  // arsenal-discovered bugs to the Errors tab. Null between runs.
  private activeGateway: TelemetryGateway | null = null;

  private confirmedBugsMemory: ConfirmedBug[] = [];

  // In-run reproduction confirmation for newly registered findings. Null when the
  // page exposes no browser handle (no sidecar context can be opened).
  private reproductionProbe: ReproductionProbe | null = null;

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
    // Public RUN- code stamped on the auto-created session doc so live + history share one id.
    private readonly runCode?: string,
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

    // Resolve the session-wide transition-repeat budget (default 3; 0 disables).
    this.transitionRepeatBudget = optimizationSettings?.['transition-repeat-budget']
      ?? defaultOptimizationSettings['transition-repeat-budget']
      ?? 3;
    console.log(`[ExplorationEngine] Transition-repeat budget:`, this.transitionRepeatBudget);

    // Resolve the per-form fuzz cap (default 2; 0 disables).
    this.formFuzzCap = optimizationSettings?.['form-fuzz-cap']
      ?? defaultOptimizationSettings['form-fuzz-cap']
      ?? 2;
    console.log(`[ExplorationEngine] Form fuzz cap:`, this.formFuzzCap);

    // Resolve page-saturation caps (per structural shell; 0 disables each cap).
    const maxVisits = optimizationSettings?.['page-saturation-visits']
      ?? defaultOptimizationSettings['page-saturation-visits'] ?? 3;
    const maxInteractions = optimizationSettings?.['page-saturation-interactions']
      ?? defaultOptimizationSettings['page-saturation-interactions'] ?? 8;
    this.clusterRegistry = new StateClusterRegistry({ maxVisits, maxInteractions });
    this.saturationVisits = maxVisits;
    this.saturationInteractions = maxInteractions;
    console.log(`[ExplorationEngine] Page-saturation caps:`, { maxVisits, maxInteractions });

    // Build the testing-type gate (empty/undefined selection => all enabled).
    this.gate = new ScenarioGate(selectedScenarios);
    console.log(`[ExplorationEngine] Active testing types:`, this.gate.activeCategories());

    // Reproducibility seed (optional). One seed drives BOTH the edge-selection
    // softmax and fuzz payload/vector choice, so a seeded run replays identically.
    const explorationSeed = optimizationSettings?.['exploration-seed'];
    this.explorationSeed = explorationSeed;
    seedScenarioRandom(explorationSeed);
    console.log(`[ExplorationEngine] Exploration seed:`, explorationSeed ?? '(unseeded — non-deterministic)');

    // Derive and wire the scenario-aware pathfinder mode.
    const pathfinderMode = ExplorationEngine.derivePathfinderMode(selectedScenarios);
    this.pathfinderMode = pathfinderMode;
    this.pathNavigator = new StateGraphNavigator({ mode: pathfinderMode, explorationSeed });
    console.log(`[ExplorationEngine] PathfinderMode: ${pathfinderMode}`);

    // Initialize ChaosTransactionManager (transaction lifecycle only — bug
    // evaluation/telemetry now flows through the knowledge-base FaultClassifier
    // in StabilityMonitor, so no callbacks are needed here).
    this.fuzzManager = new ChaosTransactionManager();

    // Expose this run's transaction manager to the chaos-gated finders so they can
    // read live ROUTE_TRASH / STRESS_CLICK / FUZZ metadata. These are module-level
    // singletons, which is only safe because one process runs one exploration at a
    // time; converting them to constructor injection needs BugFinder to become a
    // factory, so it is deliberately left as follow-up work.
    setStructuralProbeAccessor(this.fuzzManager);
    setConcurrentStressAccessor(this.fuzzManager);
    setFuzzGuardAccessor(this.fuzzManager);
  }

  public getConfirmedBugsFromMemory(): ConfirmedBug[] {
    return this.confirmedBugsMemory;
  }

  /**
   * Note in the reproduction playbook that this run started authenticated, without
   * recording any credential. The step carries NO `value`, so there is nothing for
   * the regression replayer to type back and nothing to persist — which is exactly
   * why the login is a marker rather than a real recorded action.
   */
  public recordAuthenticationMarker(): void {
    this.authenticatedRun = true;
    this.recordActionTrace(
      {
        timestamp: new Date().toISOString(),
        selector: '(login form)',
        action: 'authenticate',
      },
      {
        actionType: 'INPUT',
        humanIdentifier: 'the target application login form (authenticated before exploration began)',
        redactValue: true,
      },
    );
  }

  // Distinct routes/URLs visited this run — the session-global page set for history metadata.
  public getVisitedRoutes(): string[] {
    return [...this.visitedUrls];
  }

  public registerConfirmedBug(incoming: ConfirmedBug): void {
    // Scrub before the ledger, so both the persisted finding and the Errors-tab
    // stream are covered by a single transform.
    const bug: ConfirmedBug = {
      ...incoming,
      message: scrubCredentials(incoming.message),
      payloadUsed: scrubCredentials(incoming.payloadUsed),
      advice: scrubCredentials(incoming.advice),
    };
    // IDENTITY-ONLY dedup. Content-based dedup (type+message+selector+payload)
    // catastrophically collapsed distinct error INSTANCES — e.g. 15 HTTP 500s to
    // the same endpoint share an identical signature and were merged into 1,
    // losing 14 findings before they ever reached the database. Every distinct
    // registration carries a unique bugId, so we only skip a literal re-push of
    // the exact same id. This retains all 15 instances for full telemetry parity.
    const existingIndex = this.confirmedBugsMemory.findIndex(
      existing => existing.bugId === bug.bugId
    );
    const isDuplicate = existingIndex >= 0;

    // A collapse-counting finder (duplicate-action) re-registers the SAME bugId as its
    // evidence sharpens. Refresh the stored record in place so the persisted finding
    // carries the final verdict/occurrence instead of the first, weakest observation.
    if (isDuplicate) {
      this.confirmedBugsMemory[existingIndex] = { ...this.confirmedBugsMemory[existingIndex], ...bug };
    }

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

      // Surface arsenal-discovered bugs (fuzzing/injection/stress/storage) on the
      // live Errors tab. JS/console exceptions are already streamed by
      // StabilityMonitor (streamed=true); plain network faults own the Network tab.
      // Exception: a masked vulnerability in a 2xx body (e.g. NOSQL_INJECTION) arrives
      // as a NETWORK bug but is a genuine security finding, so it is promoted here —
      // otherwise it stays invisible on the Network tab and never reaches Findings.
      // WCAG findings never reach this ledger — they are ephemeral, WS-only events.
      const isSecurityFinding = isSecurityBugClass(bug.attribution?.bugClass);
      if (!bug.streamed && (bug.type !== 'NETWORK' || isSecurityFinding)) {
        this.streamBugToErrorsTab(bug);
      }

      // Single choke point for in-run reproduction: every finding class reaches the
      // ledger here, already carrying its minimized timeline and bug class.
      this.enqueueReproduction(bug);
    }
  }

  /** Queue a newly registered finding for one deterministic replay. */
  private enqueueReproduction(bug: ConfirmedBug): void {
    const bugClass = bug.attribution?.bugClass;
    // No class ⇒ nothing for the collector to match a replayed fault against.
    if (!this.reproductionProbe || !bugClass) return;
    this.reproductionProbe.enqueue({
      bugId: bug.bugId,
      targetUrl: this.targetUrl,
      actions: bug.reproductionActions ?? [],
      bugClass,
      faultType: normalizeFaultType(bug.type),
      originalMessage: bug.message,
      scenario: bug.attribution?.scenario,
      stateFingerprint: bug.stateFingerprint,
    });
  }

  /**
   * Fold a settled reproduction verdict back into the finding: re-grade its
   * confidence with the same delta scoreFinding uses, refresh the ledger entry so
   * persistence saves the corrected verdict, and patch the live card.
   */
  private onReproductionSettled(outcome: ReproductionOutcome): void {
    const index = this.confirmedBugsMemory.findIndex((entry) => entry.bugId === outcome.bugId);
    const existing = index >= 0 ? this.confirmedBugsMemory[index] : undefined;
    if (!existing?.attribution) return;

    const { score, status } = applyReproductionOutcome(
      existing.attribution.confidenceScore ?? 0,
      existing.attribution.origin ?? 'UNKNOWN',
      outcome.reproduced,
    );
    const attribution = { ...existing.attribution, confidenceScore: score, verificationStatus: status };
    this.confirmedBugsMemory[index] = { ...existing, attribution };

    this.activeGateway?.emitReproductionVerdict?.({
      bugId: outcome.bugId,
      reproduced: outcome.reproduced,
      stepsReplayed: outcome.stepsReplayed,
      confidenceScore: score,
      verificationStatus: status,
    });

    this.activeGateway?.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'ACTION',
      meta: {
        actionExecuted: 'reproduction-verified',
        message: outcome.reproduced
          ? ` Reproduced after replaying ${outcome.stepsReplayed} step(s) — confidence ${score} (${status})`
          : ` Did not reproduce after replaying ${outcome.stepsReplayed} step(s) — confidence ${score} (${status})`,
      },
    });
  }

  /** Emit a confirmed arsenal bug as a live incident-report for the Errors tab. */
  private streamBugToErrorsTab(bug: ConfirmedBug): void {
    if (!this.activeGateway) return;
    const incident: IncidentReport = {
      bugId: bug.bugId,
      timestamp: bug.timestamp.toISOString(),
      reason: bug.message,
      url: this.activePage?.url() ?? this.targetUrl,
      stackTrace: bug.stackTrace,
      steps: bug.reproductionActions ?? [],
      reproductionActions: bug.reproductionActions ?? [],
      stateFingerprint: bug.stateFingerprint,
      reproductionPlaybook: bug.reproductionSteps,
      advice: bug.advice,
      attribution: bug.attribution,
      culpritSelector: bug.selector || undefined,
      bypass: bug.bypass,
    };
    this.activeGateway.emitIncidentReport(incident);
  }

  public pause() {
    if (this.isPaused) return; // already paused — idempotent no-op against duplicate calls
    // Record the snapshot of elapsed time when pausing
    this.pauseSnapshotTimeMs = this.elapsedActiveTimeMs;
    this.isPaused = true;
    // Sync the frozen baseline so the client stops interpolating at the exact elapsed.
    this.emitTimeSync();
    console.log(`[ExplorationEngine] Session PAUSED at ${this.pauseSnapshotTimeMs}ms elapsed`);
  }

  public resume() {
    if (!this.isPaused) return; // already running — idempotent no-op against duplicate calls
    // Calculate the new dynamic deadline based on accumulated time
    const remainingTimeMs = Math.max(0, this.timeboxMs - this.elapsedActiveTimeMs);
    this.dynamicDeadline = Date.now() + remainingTimeMs;
    this.isPaused = false;
    this.lastTickTimestamp = Date.now();
    // Resume the client's countdown from the exact authoritative baseline.
    this.emitTimeSync();
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

  // `reason` names the trigger so the loop can attribute the resulting teardown
  // accurately. First reason wins — a later internal shutdown must not overwrite
  // the target-crash or operator intent that caused it.
  public stop(reason: StopReason = 'operator') {
    this.stopReason ??= reason;
    this.isStopRequested = true;
    this.isPaused = false;
  }

  /** Trigger that requested the stop, or null when none was requested. */
  public getStopReason(): StopReason | null {
    return this.stopReason;
  }

  // Settlement barrier: await every in-flight fire-and-forget write so Pause/Stop
  // flush pending telemetry + DB persistence before the lifecycle transitions.
  public async settlePendingTasks(): Promise<void> {
    // Reproduction replays first: their verdicts re-register findings, which the
    // task settle below is responsible for flushing.
    await this.reproductionProbe?.settle();
    await this.asyncTasks.settle();
  }

  /**
   * Get the accumulated active execution time (in ms).
   * Only counts time when the engine is NOT paused.
   */
  public getElapsedActiveTimeMs(): number {
    return this.elapsedActiveTimeMs;
  }

  // Push the authoritative timebox clock to the dashboard. The frontend timer is a
  // display slaved to this — it never runs an independent countdown.
  private emitTimeSync(): void {
    this.activeGateway?.emitTimeSync?.({ elapsedActiveMs: this.elapsedActiveTimeMs, timeboxMs: this.timeboxMs });
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
          message: `️ Time limit reached: ${this.timeboxMs / 60000} min timebox completed - exploration ended normally`,
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
    let sinceSyncMs = 0;
    // Immediate baseline so the client's timer locks onto the authoritative clock
    // from the first frame instead of running its own countdown.
    this.emitTimeSync();

    this.timingInterval = setInterval(() => {
      if (!this.isPaused && !this.isStopRequested) {
        const now = Date.now();
        const delta = now - this.lastTickTimestamp;
        this.elapsedActiveTimeMs += delta;
        this.lastTickTimestamp = now;
        sinceSyncMs += delta;
        if (sinceSyncMs >= 1000) {
          sinceSyncMs = 0;
          this.emitTimeSync();
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

  /** `authOrigins` are ORIGINS only — the target's auth config never enters the engine. */
  public async run(page: Page, targetUrl: string, telemetry: TelemetryGateway, maxSteps = 60, browserInfo?: BrowserInfo, authOrigins: readonly string[] = []): Promise<RunResult> {
    // Initialize runtime metrics tracking
    this.runtimeMetrics = {
      startTime: Date.now(),
      requestsCount: 0,
      pageCount: 1, // Start with 1 for initial page load
      interactionCount: 0,
      failureCount: 0,
    };

    this.activeGateway = telemetry;
    this.targetOrigin = new URL(targetUrl).origin;
    this.targetUrl = targetUrl;
    this.freezeActionTraceRecording = false;
    ActiveScenarioTracker.reset();
    this.clusterRegistry.reset();
    this.escalationTracker.resetAll();
    this.routeExhaustion.reset();
    this.edgeRepeat.reset();
    this.formFuzz.reset();
    this.networkFailureCascade.reset();
    this.lastBrainSnapshotStep = 0;
    this.activePage = page;
    // Fresh run: a stop reason from a previous run must never leak forward.
    this.stopReason = null;
    this.isStopRequested = false;

    // Last navigated URL — shared via closure with the stability monitor and loop.
    let lastKnownUrl = '';

    // Latest MAIN-FRAME document response status, keyed by its normalized route
    // path. Lets the loop's error-route detector see a real HTTP ≥400 hard
    // navigation; null for pure client-side SPA renders (no top-level response).
    // Reassigned on page recreation via the shared `page` binding, exactly like
    // lastKnownUrl, so it survives the deepest recovery rung.
    let lastMainFrameStatus: { path: string; status: number } | null = null;

    // Run-scoped passive navigation-defect analyzer (dead links, broken routes,
    // redirect loops, back-nav state loss) — fed from the observation hooks below.
    const navigationFinder = new BrokenNavigationFinder();

    // Build the telemetry emitter around the persistent gateway.
    const emitter = new TelemetryEmitter(telemetry, {
      isPaused: () => this.isPaused,
      isStopRequested: () => this.isStopRequested,
    });

    // Turn verified navigation defects into forensic telemetry + confirmed bugs.
    // type:'NAVIGATION' auto-streams to the live Errors tab via registerConfirmedBug.
    const reportNavigationDefects = async (defects: NavigationDefect[]): Promise<void> => {
      for (const defect of defects) {
        const reproduction = ActiveScenarioTracker.flushSnapshot({
          faultUrl: defect.url || lastKnownUrl,
          faultAtMs: Date.now(),
        });
        // Anchor the trace to the navigation hops that formed the defect (the actual
        // route chain), not the generic rolling buffer of unrelated fuzz/stress steps.
        const hopActions: ActionRecord[] | null = defect.hops?.length
          ? defect.hops.map((h) => ({
              timestamp: new Date(h.timestampMs).toISOString(),
              type: 'NAVIGATION',
              selector: h.route || h.url || '',
              url: h.url || h.route || '',
              payload: h.status ? `HTTP ${h.status}` : undefined,
            }))
          : null;
        const reproductionActions = hopActions ?? reproduction.actions;
        const reproductionSteps = hopActions ? narrateActionRecords(hopActions) : reproduction.narrative;
        const stateFingerprint = this.activePage ? await captureStateFingerprint(this.activePage) : undefined;
        const attribution: FindingAttribution = {
          bugClass: defect.bugClass,
          cwe: defect.cwe,
          ...resolveScenarioAttribution(ActiveScenarioTracker.getActiveScenarioName()),
          stepIndex: reproductionActions.length,
          confidence: 'SIGNAL',
          corroborated: defect.corroborated,
        };
        emitter.emit('BUG', {
          message: defect.message,
          selector: defect.selector,
          url: defect.url,
          statusCode: defect.statusCode,
          severity: defect.severity === 'HIGH' ? 'CRITICAL' : 'WARNING',
          reproductionSteps,
          attribution,
        });
        emitter.emitMilestone(` Navigation defect: ${defect.message}`);
        this.registerConfirmedBug({
          bugId: defect.bugId,
          type: 'NAVIGATION',
          message: defect.message,
          selector: defect.selector,
          payloadUsed: '',
          advice: defect.advice,
          timestamp: new Date(),
          reproductionSteps,
          reproductionActions,
          stateFingerprint,
          attribution,
        });
      }
    };

    // In-run reproduction confirmation. Replays land in sidecar contexts of the SAME
    // browser — never on `page`, whose state the navigator owns. Absent only when the
    // page exposes no browser handle (a non-Chromium/detached driver).
    const browser = page.context().browser();
    this.reproductionProbe = browser
      ? new ReproductionProbe(browser, page.context(), (outcome) => this.onReproductionSettled(outcome))
      : null;

    // Assemble the extracted domain services with explicit dependency contracts.
    const stabilityMonitor = new StabilityMonitor({
      telemetry: emitter,
      getBreadcrumbs: () => this.actions.snapshot(),
      breadcrumbsToActionRecords: (b) => this.breadcrumbsToActionRecords(b),
      persistForensicError: (params) => this.bufferForensicError(params),
      registerConfirmedBug: (bug) => this.registerConfirmedBug(bug),
      setFreeze: () => this.freezeRecording(),
      getLastKnownUrl: () => lastKnownUrl,
      onApiFailure: () => { this.runtimeMetrics.requestsCount++; },
      recordNetworkFailure: () => this.networkFailureCascade.recordFailure(),
      getInteractionContext: (atMs) => this.interactionContextAt(atMs),
      getTargetOrigin: () => this.targetOrigin,
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
      formFuzz: this.formFuzz,
      formFuzzCap: this.formFuzzCap,
      registerConfirmedBug: (bug) => this.registerConfirmedBug(bug),
      isNetworkCascading: () => this.networkFailureCascade.isCascading(),
    });

    // Operator visibility: announce which testing strategies are active this run.
    emitter.emitMilestone(`️ Active testing types: ${this.gate.activeCategories().join(', ')}`);

    // Announce the Strict Page Boundary Lock so the operator sees the URL is pinned.
    if (this.strictUrlLock) {
      emitter.emitMilestone(` Strict Page Boundary Lock enabled — exploration confined to ${targetUrl}`);
    }

    // Warm-start the perceptron from the latest brain for this URL BEFORE creating the
    // session, so "most recent session for this URL" is a genuine prior run (not this one).
    await this.warmStartBrain(targetUrl, emitter);

    this.sessionId = await this.createSession(targetUrl);
    this.lastSessionId = this.sessionId;

    // Reset the per-run forensic-error batch for this fresh run.
    this.forensicErrorBuffer = [];
    this.forensicErrorsPersisted = 0;
    this.forensicFlushChain = Promise.resolve();

    //  Start timing interval that accumulates active time (only when NOT paused)
    // This replaces the fixed timeout approach with accumulative time tracking
    // Also emits TIME_REMAINING telemetry to sync with frontend
    this.startTimingInterval(telemetry);

    // Persist initial telemetry with browser info (Phase 3)
    if (browserInfo && this.sessionId) {
      this.asyncTasks.track(this.persistTelemetry({
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
      }));
    }

    // StateGraphNavigator handles its own state management - no clear() needed
    await this.persistBrainSnapshot('start');
    this.lastActedTarget = null;

    // Page-agnostic observation sinks. TabWindowManager owns which page's events reach
    // them, so the same run-scoped state is fed by whichever tab currently has focus.
    const onNavigated = (url: string): void => {
      if (!url) return;
      lastKnownUrl = url;
      // Phase 3: Track page count when navigating
      this.runtimeMetrics.pageCount++;
      emitter.gateway.emitUrlChanged(url);
      void reportNavigationDefects(navigationFinder.observeUrlChange({ url, timestampMs: Date.now() }));
    };

    const onNetworkRequest = (resourceType: string): void => {
      const t = this.lastActedTarget;
      if (!t) {
        return;
      }
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
    // response bodies. The document/main-frame filtering happens in TabWindowManager,
    // which owns the per-page listener and knows which page the response belongs to.
    const onDocumentResponse = (url: string, status: number): void => {
      lastMainFrameStatus = { path: normalizeRoutePath(url), status };
      void reportNavigationDefects(navigationFinder.observeRedirectHop({
        url,
        route: lastMainFrameStatus.path,
        status: lastMainFrameStatus.status,
        timestampMs: Date.now(),
      }));
    };

    //  Safari Initialized (milestone)
    emitter.emitMilestone(' Safari Initialized');

    // Forward-declared: the loop deps hold `tabs`, `tabs` holds `driveSecondary`, and
    // `driveSecondary` derives its deps from the loop's. The cycle is broken by reading
    // loopDeps lazily at call time, which is always after assignment.
    let loopDeps: ExplorationLoopDeps;

    // Bounded sub-session on an approved secondary tab: the same loop, but with an
    // isolated graph/coverage layer, a non-consuming timebox, popup-scoped health, and
    // a stop that also fires when the tab closes itself.
    const driveSecondary = async (tab: Page, budget: number, deadlineMs: number): Promise<void> => {
      const subLoop = new ExplorationLoop({
        ...loopDeps,
        pathNavigator: new StateGraphNavigator({ mode: this.pathfinderMode, explorationSeed: this.explorationSeed }),
        clusterRegistry: new StateClusterRegistry({
          maxVisits: this.saturationVisits,
          maxInteractions: this.saturationInteractions,
        }),
        routeExhaustion: new RouteExhaustionTracker(),
        // Never pageHealthGuard.ensureHealthy — its deepest rung recreates the PRIMARY.
        ensurePageHealth: async (p) => ({
          page: p,
          status: PageHealthGuard.isInvalidContext(p) ? 'unrecoverable' as const : 'healthy' as const,
        }),
        // A self-closing popup must read as a stop, not as a crash finding.
        isStopRequested: () => this.isStopRequested || tab.isClosed(),
        // isTimeboxExceeded (not checkTimeboxAndTerminateIfExceeded): the latter is a
        // one-shot latch, and consuming it here would stop the outer loop ever timing out.
        checkTimebox: () => this.isTimeboxExceeded() || Date.now() >= deadlineMs,
      });
      await subLoop.execute(tab, budget);
    };

    const tabs = new TabWindowManager({
      context: page.context(),
      telemetry: emitter,
      stabilityMonitor,
      getTargetUrl: () => this.targetUrl,
      getTargetOrigin: () => this.targetOrigin,
      authOrigins,
      strictUrlLock: this.strictUrlLock,
      setActivePage: (p) => { this.activePage = p; },
      onNavigated,
      onNetworkRequest,
      onDocumentResponse,
      noteEngineNavigation: () => navigationFinder.noteEngineNavigation(),
      ensureDomReady: (p) => this.ensureDomReady(p, emitter),
      attachAfterNavigation: async (p) => {
        this.cleanupStabilityMonitor = await stabilityMonitor.attachAfterNavigation(
          p,
          (bug) => this.registerConfirmedBug(bug),
        );
      },
      disposeAfterNavigation: () => {
        if (this.cleanupStabilityMonitor) {
          this.cleanupStabilityMonitor();
          this.cleanupStabilityMonitor = null;
        }
      },
      driveSecondary,
    });

    // Wires the launch page, focuses it, starts the 33 ms frame loop, and arms
    // context-level new-tab detection — all before the first navigation.
    await tabs.adoptPrimary(page);

    // Universal invalid-context recovery + strict-lock drift restore, applied
    // once per exploration iteration by the loop via ensurePageHealth().
    const pageHealthGuard = new PageHealthGuard({
      telemetry: emitter,
      getTargetUrl: () => this.targetUrl,
      getTargetOrigin: () => this.targetOrigin,
      strictUrlLock: this.strictUrlLock,
      recreatePage: () => tabs.recreateFocused(),
      recordRecovery: (url, strategy) => {
        navigationFinder.noteEngineNavigation();
        return this.recordActionTrace(
          { timestamp: new Date().toISOString(), selector: url, action: `recover-${strategy}` },
          { actionType: 'NAVIGATE', humanIdentifier: `recovery via ${strategy}`, url },
        );
      },
    });

    // Captured so the finally block can settle the session with the real outcome
    // instead of the old crashed/completed binary. Null means the loop threw.
    let runResult: RunResult | null = null;

    try {
      // Task 3: Emit granular status for dynamic UI - "Navigating to URL..."
      emitter.emitSystemStatus(`Navigating to ${targetUrl}...`);

      // EMIT EARLY TELEMETRY: Notify that browser has started navigating
      // This helps the frontend understand the engine is processing
      emitter.emit('ACTION', {
        actionExecuted: 'browser-launched',
        message: ` Browser launched, navigating to ${targetUrl}...`,
      });

      //  Proactive Strict Page Boundary Lock: arm the navigation guard BEFORE
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

      onNavigated(page.url()); // emit the real post-navigation URL

      await this.ensureDomReady(page, emitter);

      // ️ Initialize background stability/console monitoring (heartbeat + console tab).
      this.cleanupStabilityMonitor = await stabilityMonitor.attachAfterNavigation(
        page,
        (bug) => this.registerConfirmedBug(bug),
      );

      resetConstraintBypassFinder(); // clear the per-run one-probe-per-field guard
      const bugFinderRunner = new BugFinderRunner({
        finders: BUG_FINDERS,
        gate: this.gate,
        telemetry: emitter,
        registerConfirmedBug: (bug) => this.registerConfirmedBug(bug),
        cadence: BUG_FINDER_CADENCE,
        findingBudget: BUG_FINDER_BUDGET,
      });

      // Delegate the incremental step-by-step exploration to ExplorationLoop.
      loopDeps = {
        parser: this.parser,
        scorer: this.scorer,
        hashManager: this.hashManager,
        pathNavigator: this.pathNavigator,
        clusterRegistry: this.clusterRegistry,
        routeExhaustion: this.routeExhaustion,
        edgeRepeat: this.edgeRepeat,
        formFuzz: this.formFuzz,
        formFuzzCap: this.formFuzzCap,
        gate: this.gate,
        visitedUrls: this.visitedUrls,
        visitedHashes: this.visitedHashes,
        visitedStructures: this.visitedStructures,
        actionExecutor,
        stateRestorer,
        tabs,
        telemetry: emitter,
        runtimeMetrics: this.runtimeMetrics,
        isStopRequested: () => this.isStopRequested,
        getStopReason: () => this.stopReason,
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
        setFreeze: () => this.freezeRecording(),
        ensureDomReady: (p) => this.ensureDomReady(p, emitter),
        ensurePageHealth: (p) => pageHealthGuard.ensureHealthy(p),
        strictUrlLock: this.strictUrlLock,
        transitionRepeatBudget: this.transitionRepeatBudget,
        accessibilityAuditor: this.accessibilityAuditor,
        navigationFinder,
        reportNavigationDefects,
        hadNetworkActivitySinceAction: () => this.networkRewardsThisAction > 0,
        registerConfirmedBug: (bug) => this.registerConfirmedBug(bug),
        bugFinderRunner,
        sessionGuardActive: this.authenticatedRun,
      };

      runResult = await new ExplorationLoop(loopDeps).execute(page, maxSteps);
      return runResult;
    } finally {
      //  Cleanup: dispose stability monitoring to prevent "ghost" heartbeat intervals
      if (this.cleanupStabilityMonitor) {
        this.cleanupStabilityMonitor();
        this.cleanupStabilityMonitor = null;
      }

      // Drain the in-flight replay before the browser closes, then refuse new work —
      // a probe outlasting its browser would log a stream of disconnect noise.
      await this.reproductionProbe?.settle();
      this.reproductionProbe?.dispose();
      this.reproductionProbe = null;

      //  Stop frame capture loop
      emitter.stopFrameCaptureLoop();

      //  Stop timing interval
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
        this.asyncTasks.track(this.persistTelemetry({
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
        }));
      }

      // Detaches every page listener this run armed and reclaims any tab the target
      // opened; the primary page itself is closed by the browser engine's teardown.
      await tabs.dispose();
      if (!this.freezeActionTraceRecording) {
        await this.persistBrainSnapshot('finish');
      }
      // Drain any queued flush, then write the residual buffer before the run's
      // session id is cleared, so no forensic error is lost or mis-keyed.
      await this.forensicFlushChain.catch(() => undefined);
      await this.flushForensicErrors();
      await this.completeSession(runResult);
      this.sessionId = null;
      this.activePage = null;
      this.activeGateway = null;
    }
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
        runId: this.runCode,
      });
    } catch (error) {
      console.error('[ExplorationEngine] Failed to create Safari session:', error);
      return null;
    }
  }

  private async completeSession(result: RunResult | null): Promise<void> {
    // The owner is part of the update filter, so a session can only ever be
    // settled by the tenant that created it.
    if (!this.findingRepo || !this.sessionId || !this.userId) {
      return;
    }

    const { outcome, reason } = this.resolveTermination(result);
    try {
      await this.findingRepo.markSessionTerminated(this.sessionId, this.userId, new Date().toISOString(), outcome, reason);
    } catch (error) {
      console.error('[ExplorationEngine] Failed to complete Safari session:', error);
    }
  }

  // A loop that returned carries its own verdict. A null result means run() unwound
  // through a throw — attribute it to the recorded stop trigger when one exists,
  // otherwise it is a genuine unhandled failure.
  private resolveTermination(result: RunResult | null): { outcome: RunTerminationOutcome; reason: string } {
    if (result) return { outcome: result.outcome, reason: result.reason };
    if (this.stopReason) {
      return {
        outcome: STOP_REASON_OUTCOME[this.stopReason],
        reason: STOP_REASON_DETAIL[this.stopReason],
      };
    }
    return { outcome: 'exception', reason: 'Unhandled exception detected' };
  }

  // Freeze at crash time: stop the engine's own trace recording AND the global
  // playbook buffer, so post-fault scenario writes (which bypass recordActionTrace
  // by pushing to ReproductionPlaybookStore directly) can't overwrite the causal chain.
  private freezeRecording(): void {
    this.freezeActionTraceRecording = true;
    ReproductionPlaybookStore.freeze();
  }

  // Resolve which control the engine was actuating at `atMs`, so a request observed by
  // StabilityMonitor can be attributed to its triggering interaction. Bounded by the same
  // causal window used for network reward attribution — outside it, background SPA chatter
  // would be misattributed to an unrelated element.
  private interactionContextAt(atMs: number): InteractionContext | null {
    const target = this.lastActedTarget;
    if (!target || this.lastActedAtMs <= 0) return null;
    const sinceActionMs = atMs - this.lastActedAtMs;
    if (sinceActionMs < 0 || sinceActionMs > NETWORK_ATTRIBUTION_WINDOW_MS) return null;
    return {
      selector: target.selector,
      label: resolveElementLabel(target),
      actedAtMs: this.lastActedAtMs,
    };
  }

  // Records an executed action into the in-memory breadcrumb + reproduction buffers only.
  // High-frequency action traces are WebSocket/in-memory telemetry — never persisted to Mongo.
  private recordActionTrace(trace: ActionBreadcrumb, clean?: CleanActionStep): void {
    if (this.freezeActionTraceRecording) {
      return;
    }

    this.actions.push(trace);

    // Push a clean, human-descriptive record into the canonical playbook buffer
    // so crash-time narrative serialization reads accurate action types, visible
    // labels, live URLs, and real fuzz/text values instead of internal engine verbs.
    // Real execution time: elapsed since noteActedTarget stamped the action start.
    // Guarded to a sane window so replay/restore traces don't record a stale delta.
    const sinceActionMs = this.lastActedAtMs > 0 ? Date.now() - this.lastActedAtMs : -1;
    const durationMs = sinceActionMs >= 0 && sinceActionMs <= 60000 ? sinceActionMs : undefined;

    const actionRecord: ActionRecord = {
      timestamp: trace.timestamp,
      type: clean?.actionType ?? 'CLICK',
      selector: trace.selector,
      url: clean?.url ?? this.activePage?.url() ?? this.targetOrigin ?? 'unknown',
      payload: clean?.value ?? trace.payload,
      fallbackLabel: clean?.humanIdentifier,
      elementLabel: clean?.humanIdentifier,
      elementKind: clean?.elementKind,
      durationMs,
      strippedAttributes: clean?.strippedAttributes,
      affectedCount: clean?.affectedCount,
      outcome: clean?.outcome,
      redactValue: clean?.redactValue,
    };
    ReproductionPlaybookStore.push(actionRecord);
  }

  private async persistBrainSnapshot(source: 'start' | 'runtime' | 'finish' | 'crash', step?: number): Promise<void> {
    if (!this.findingRepo || !this.sessionId || !this.userId) {
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
        userId: this.userId,
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
    // No owner (guest run) means no private brain to restore — start cold rather
    // than inheriting whatever another tenant last learned about this URL.
    if (!this.findingRepo || !this.userId) return;
    try {
      const prior = await this.findingRepo.loadLatestBrainConfig(targetUrl, this.userId);
      if (prior && Object.keys(prior.weights).length > 0) {
        this.scorer.importBrainState(prior);
        console.log(`[ExplorationEngine] Warm-started brain for ${targetUrl} (bias=${prior.bias.toFixed(3)})`);
        emitter.emitMilestone(' Warm-started brain from a prior session for this URL.');
      }
    } catch (error) {
      console.error('[ExplorationEngine] Brain warm-start failed:', error);
    }
  }

  // Buffer a forensic error for batched persistence. Synchronous, drops silently
  // past the per-run cap (mirrors the read-side MAX_FORENSIC_ROWS truncation), and
  // schedules a serialized flush once the buffer reaches FORENSIC_FLUSH_THRESHOLD.
  private bufferForensicError(params: ForensicErrorParams): void {
    if (!this.sessionId) return;
    if (this.forensicErrorsPersisted + this.forensicErrorBuffer.length >= MAX_FORENSIC_ROWS) return;
    this.forensicErrorBuffer.push(params);
    if (this.forensicErrorBuffer.length >= FORENSIC_FLUSH_THRESHOLD) {
      this.scheduleForensicFlush();
    }
  }

  // Serialize flushes onto one chain so concurrent createMany calls can't interleave,
  // and track the chain so the settlement barrier awaits it.
  private scheduleForensicFlush(): void {
    this.forensicFlushChain = this.forensicFlushChain.then(() => this.flushForensicErrors());
    this.asyncTasks.track(this.forensicFlushChain);
  }

  // Drain the buffer to Mongo in one batch, honoring the per-run cap. Never throws.
  private async flushForensicErrors(): Promise<void> {
    if (!this.sessionId || this.forensicErrorBuffer.length === 0) return;
    const remaining = MAX_FORENSIC_ROWS - this.forensicErrorsPersisted;
    if (remaining <= 0) { this.forensicErrorBuffer = []; return; }
    const batch = this.forensicErrorBuffer.splice(0, remaining);
    const runId = new Types.ObjectId(this.sessionId);
    const rows: CreateForensicErrorParams[] = batch.map((params) => ({ forensicRunId: runId, ...params }));
    try {
      await forensicErrorRepository.createMany(rows);
      this.forensicErrorsPersisted += rows.length;
    } catch (error) {
      console.error('[ExplorationEngine] Failed to flush forensic errors:', error);
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
      await forensicTelemetryRepository.upsertForRun({
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
