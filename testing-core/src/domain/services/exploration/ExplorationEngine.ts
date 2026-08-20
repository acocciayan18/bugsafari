import type { Page } from 'playwright';
import type { TelemetryGateway } from '../../../application/ports/TelemetryGateway.js';
import { STOP_REASON_DETAIL, STOP_REASON_OUTCOME, defaultOptimizationSettings, resolveProfileFromTestingTypes } from '../../../../../shared/types.js';
import type { OptimizationSettings, TestingTypeId } from '../../../../../shared/types.js';
import type { ActionBreadcrumb, ActionRecord, ActionType, FindingAttribution, IncidentReport } from '../../../../../shared/types.js';
import { CircularBuffer } from '../../../lib/circularBuffer.js';
import { RecursiveDomParser } from '../../heuristics/domParser.js';
import { DomHasher, normalizeRoutePath } from '../../../ml/domHasher.js';
import { AccessibilityAuditor } from '../../heuristics/AccessibilityAuditor.js';
import { BrokenNavigationFinder } from '../../heuristics/BrokenNavigationFinder.js';
import type { InteractionContext } from '../../heuristics/DuplicateActionFinder.js';
import { isConcurrentBurstAt } from './culpritAmbiguity.js';
import type { DefectCulprit, NavHop, NavigationDefect } from '../../heuristics/BrokenNavigationFinder.js';
import { resolveScenarioAttribution } from '../../../bugs/knowledgeBase/scenarioCatalog.js';
import { normalizeFaultType, isSecurityBugClass } from '../../../bugs/knowledgeBase/FaultClassifier.js';
import { ReproductionProbe, type ReproductionOutcome } from '../verification/ReproductionProbe.js';
import { applyReproductionOutcome } from '../verification/confidenceScore.js';
import { classifyFaultOrigin } from '../verification/index.js';
import { InteractionSimulator } from '../../scenarios/rapidClicker/index.js';
import { RiskScorer } from '../RiskScorer.js';
import { ChaosTransactionManager } from '../../chaos/ChaosTransactionManager.js';
import {
  BUG_FINDERS,
  setStructuralProbeAccessor,
  setConcurrentStressAccessor,
  resetConstraintBypassFinder,
  resetInjectionDifferentialFinder,
  resetNoSqlInjectionFinder,
} from '../../../bugs/finders/index.js';
import { setChaosManagerAccessor as setFuzzGuardAccessor } from '../../../bugs/finders/fuzzGuard.js';
import { BoundingBoxHighlighter } from '../../../infrastructure/playwright/BoundingBoxHighlighter.js';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import type { FindingRepository } from '../../repositories/FindingRepository.js';
import type { BrowserInfo } from '../../../infrastructure/playwright/PlaywrightBrowserEngine.js';
import { ReproductionPlaybookStore } from '../../../infrastructure/monitoring/reproductionPlaybookStore.js';
import { captureStateFingerprint } from '../../../infrastructure/monitoring/stateFingerprint.js';
import { describeRedirectLoopObservation, narrateActionRecords, resolveElementLabel } from '../forensics/narration.js';
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
import type { AuthPlaybookStep } from '../auth/authNarration.js';
import { ActionExecutor } from './ActionExecutor.js';
import { StateRestorer } from './StateRestorer.js';
import { StrictUrlLockGuard, resolveUrlLockScope, type UrlLockScope } from './StrictUrlLockGuard.js';
import { PageHealthGuard } from './PageHealthGuard.js';
import { ExplorationLoop } from './ExplorationLoop.js';
import { shouldTriggerSessionLoss, classifySessionLoss, SessionRestoreCoordinator, type SessionRestoreFn } from './SessionPreservationGuard.js';
import { BUG_CATALOG } from '../../../bugs/knowledgeBase/bugCatalog.js';
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

import { createLogger } from '../../../infrastructure/observability/logger.js';

const obsLog = createLogger('[ExplorationEngine]');

// ─────────────────────────────────────────────────────────────
// SECURITY PATCHES (Addressing Critical Vulnerabilities)
// ─────────────────────────────────────────────────────────────

/**
 * Maximum number of confirmed bugs to store in memory.
 * Prevents resource exhaustion during long-running SPA exploration sessions.
 * Task 3A: Patch Memory Leaks
 */
const MAX_CONFIRMED_BUGS = 500;

// Upper bound on how long a Pause waits for the loop's current step to finish
// before settling to PAUSED anyway — so a wedged step can never hang the pause.
const PAUSE_SETTLE_TIMEOUT_MS = 10_000;

// Steps between sweeps of 'cadenced' finders — matches the network-sabotage cadence.
const BUG_FINDER_CADENCE = 10;
// Per-run ceiling on finder-produced findings, so a chatty finder can't dominate the ledger.
// Per-BUG-CLASS finding budget. Was a single global 25 shared by every finder, so
// whichever detector was chattiest consumed it and silently switched off all the
// others for the rest of the run (audit P3-11). Per-class, a noisy detector can
// only silence itself.
const BUG_FINDER_BUDGET = 10;

// Bound on the per-route document-status memory (query-volatile SPAs mint routes).
const MAX_ROUTE_STATUSES = 500;

// Causal attribution bounds for async network-signal rewards: a click's own
// xhr/fetch fires within a beat and only a few times, so signals outside this
// window/cap are background SPA chatter (socket.io polling, lazy assets) that must
// not train the model on the acting element.
const NETWORK_ATTRIBUTION_WINDOW_MS = 2000;
const MAX_NETWORK_REWARDS_PER_ACTION = 3;
// Depth of the acted-element history for time-keyed fault attribution. A fault's causal
// window is 2s, so a handful of recent actions is ample; bounded so it never grows.
const ACTED_HISTORY_CAP = 32;
// Buffered forensic errors flush once this many accumulate (mirrors the log-batch path).
const FORENSIC_FLUSH_THRESHOLD = 50;
// Per-attempt window and inter-attempt backoff for the initial target navigation.
const INITIAL_NAV_TIMEOUT_MS = 20000;
const NAV_RETRY_BACKOFF_MS = 1500;
// Bounded window to let a 'commit'-only navigation finish loading + paint interactive
// content before the first parse, so a slow SPA is not misread as a structural dead-end.
const HYDRATION_SETTLE_MS = 15000;
// ensureDomReady gates every route change (initial + in-app). Wait for 'load' so a slow
// route finishes fetching before the selector poll — instant on an already-loaded page —
// then poll for interactive content. Selector window stays short so a genuine empty page
// is still classified quickly (the loop retries this gate up to EMPTY_RETRY_LIMIT+1 times).
const DOM_READY_LOAD_TIMEOUT_MS = 10000;
const DOM_READY_SELECTOR_TIMEOUT_MS = 5000;

/**
 * Make the culprit interaction the terminal step of a navigation defect's
 * reproduction, replacing the buffer's own record of it when present. Guarantees
 * the playbook names the same control the finding does, even when the rolling
 * buffer was frozen, minimized away, or never captured the click.
 */
function anchorToCulprit(actions: ActionRecord[], culprit?: DefectCulprit): ActionRecord[] {
  if (!culprit) return actions;
  const record: ActionRecord = {
    timestamp: new Date(culprit.timestampMs).toISOString(),
    type: 'CLICK',
    selector: culprit.selector,
    url: culprit.url,
    elementLabel: culprit.label,
    elementKind: culprit.kind,
  };
  const last = actions[actions.length - 1];
  return last && last.selector === culprit.selector
    ? [...actions.slice(0, -1), { ...last, ...record }]
    : [...actions, record];
}

// The real, replayable trigger for a redirect loop: the culprit interaction when the
// loop was attributable, else the single navigation that lands on the looping route.
// The loop's own hops are automatic redirects — they belong in the observation, not
// the action timeline.
function redirectLoopTrigger(defect: NavigationDefect, buffered: ActionRecord[]): ActionRecord[] {
  if (defect.culprit) return anchorToCulprit(buffered, defect.culprit);
  const entry = defect.hops?.[0];
  const url = entry?.url || entry?.route || defect.url;
  if (!url) return [];
  return [{ timestamp: new Date(entry?.timestampMs ?? Date.now()).toISOString(), type: 'NAVIGATION', selector: '', url }];
}

// "/a (302) → /b (301) → /a" — statuses shown for HTTP redirects, absent on SPA hops.
function redirectChain(hops?: NavHop[]): string {
  return (hops ?? []).map((h) => (typeof h.status === 'number' ? `${h.route} (${h.status})` : h.route)).join(' → ');
}

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
  // Route-normalized (origin + pathname + hash, query dropped) and bounded by the
  // loop, so query-volatile SPAs neither defeat revisit detection nor grow memory.
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
  // Time-ordered history of recently acted elements. A network/runtime fault reports
  // asynchronously and carries its causal (request-START / fault) time; resolving that
  // against a single "latest" slot misattributes to whatever was clicked since. Look up
  // by fault time so a slow request settles onto the element that actually fired it.
  private readonly actedHistory: Array<{ target: InteractiveElement; actedAtMs: number }> = [];
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
  private targetUrl = ''; // User-entered run URL — kept for display, history, reports, forensics, brain key.
  // Canonical navigation target, resolved once from page.url() after the initial
  // redirect chain settles (e.g. fb.com → https://www.facebook.com/). Every
  // boundary/scope guard validates against this; it defaults to the user URL until
  // the first load resolves it, and is never replaced again mid-exploration.
  private canonicalUrl = '';
  private canonicalOrigin = '';
  // Active navigation-boundary scope (exact > subtree > site), resolved once from
  // the optimization flags and threaded into every guard/consumer. exact pins the
  // launch URL, subtree the launch route + descendants, site the whole target host.
  private readonly boundaryScope: UrlLockScope;
  // Read-only dialog mode: cancel native dialogs instead of confirming them, so a
  // run against a shared environment never executes a confirm-gated destructive branch.
  private readonly dialogReadOnly: boolean;
  // Session-wide transition-repeat budget (resolved in the constructor).
  private readonly transitionRepeatBudget: number;
  // Per-form fuzz cap (resolved in the constructor).
  private readonly formFuzzCap: number;

  private isPaused = false;
  // True while the ExplorationLoop is mid-step; lets a Pause wait for the current
  // iteration to finish (no straggler telemetry/findings after "Paused").
  private loopActive = false;
  private isStopRequested = false;
  // Why stop() was called. Null while running — a browser-closed error observed with
  // no reason recorded is a genuine fault, never an operator stop.
  private stopReason: StopReason | null = null;

  // The exception that unwound run(), captured so completeSession() can attribute the
  // failure to its origin (engine/Playwright/environment vs the target app). Reset per run.
  private lastUnhandledError: unknown = null;

  // Tracks fire-and-forget DB/telemetry writes so Pause/Stop can flush them before
  // the lifecycle settles (graceful settlement barrier).
  private readonly asyncTasks = new AsyncTaskTracker();

  // Per-run forensic-error buffer — batched via createMany instead of one insert
  // per event, and capped so a spewing target can't write unbounded rows.
  private forensicErrorBuffer: ForensicErrorParams[] = [];
  private forensicErrorsPersisted = 0;
  private forensicFlushChain: Promise<void> = Promise.resolve();

  // Serializes the one-row-per-run telemetry upsert. Both call sites are
  // fire-and-forget, and forensic_telemetry has no unique index on forensicRunId,
  // so two overlapping upserts would each miss the other's insert and leave the
  // duplicate rows the upsert exists to prevent. Chaining also fixes the write
  // order, so the final metrics can never be overwritten by the earlier probe.
  private telemetryUpsertChain: Promise<void> = Promise.resolve();

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
   * - Navigation scenarios present → 'exploration'
   * - Mixed/other selections → 'probe' (neutral, original behaviour)
   */
  private static derivePathfinderMode(selected?: TestingTypeId[]): PathfinderMode {
    if (!selected || selected.length === 0) return 'exploration';
    const formFocused = selected.every((s) => s === 'formBypass' || s === 'dataFuzzing');
    if (formFocused) return 'coverage';
    if (selected.includes('navigation')) return 'exploration';
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
    obsLog.info(`[ExplorationEngine] Optimization settings:`, optimizationSettings);

    // Resolve the enforced timebox from the caller-supplied settings, falling
    // back to the shared default. Previously this was hardcoded at field
    // declaration and optimizationSettings was ignored entirely.
    this.timeboxMs = optimizationSettings?.['execution-timebox-ms']
      ?? defaultOptimizationSettings['execution-timebox-ms']
      ?? 600000;

    // Resolve the navigation-boundary scope. exact > subtree > site; sub-tree is
    // the default when no explicit lock flag is supplied.
    this.boundaryScope = resolveUrlLockScope(optimizationSettings);
    obsLog.info(`[ExplorationEngine] Navigation boundary scope:`, this.boundaryScope);
    this.dialogReadOnly = optimizationSettings?.['dialog-read-only'] ?? false;

    // Resolve the session-wide transition-repeat budget (default 3; 0 disables).
    this.transitionRepeatBudget = optimizationSettings?.['transition-repeat-budget']
      ?? defaultOptimizationSettings['transition-repeat-budget']
      ?? 3;
    obsLog.info(`[ExplorationEngine] Transition-repeat budget:`, this.transitionRepeatBudget);

    // Resolve the per-form fuzz cap (default 2; 0 disables).
    this.formFuzzCap = optimizationSettings?.['form-fuzz-cap']
      ?? defaultOptimizationSettings['form-fuzz-cap']
      ?? 2;
    obsLog.info(`[ExplorationEngine] Form fuzz cap:`, this.formFuzzCap);

    // Resolve page-saturation caps (per structural shell; 0 disables each cap).
    const maxVisits = optimizationSettings?.['page-saturation-visits']
      ?? defaultOptimizationSettings['page-saturation-visits'] ?? 3;
    const maxInteractions = optimizationSettings?.['page-saturation-interactions']
      ?? defaultOptimizationSettings['page-saturation-interactions'] ?? 8;
    this.clusterRegistry = new StateClusterRegistry({ maxVisits, maxInteractions });
    this.saturationVisits = maxVisits;
    this.saturationInteractions = maxInteractions;
    obsLog.info(`[ExplorationEngine] Page-saturation caps:`, { maxVisits, maxInteractions });

    // Build the testing-type gate (empty/undefined selection => all enabled).
    this.gate = new ScenarioGate(selectedScenarios);
    obsLog.info(`[ExplorationEngine] Active testing types:`, this.gate.activeCategories());

    // Reproducibility seed (optional). One seed drives BOTH the edge-selection
    // softmax and fuzz payload/vector choice, so a seeded run replays identically.
    const explorationSeed = optimizationSettings?.['exploration-seed'];
    this.explorationSeed = explorationSeed;
    seedScenarioRandom(explorationSeed);
    obsLog.info(`[ExplorationEngine] Exploration seed:`, explorationSeed ?? '(unseeded — non-deterministic)');

    // Derive and wire the scenario-aware pathfinder mode.
    const pathfinderMode = ExplorationEngine.derivePathfinderMode(selectedScenarios);
    this.pathfinderMode = pathfinderMode;
    this.pathNavigator = new StateGraphNavigator({ mode: pathfinderMode, explorationSeed });
    obsLog.info(`[ExplorationEngine] PathfinderMode: ${pathfinderMode}`);

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
   * Record one narrated login step into the reproduction playbook. Steps carry NO
   * `value` and are always redacted, so the playbook shows how the engine signed in
   * without giving the regression replayer a credential to type back.
   */
  public recordAuthStep(step: AuthPlaybookStep): void {
    this.recordActionTrace(
      {
        timestamp: new Date().toISOString(),
        selector: '(login form)',
        action: step.action,
      },
      {
        actionType: step.actionType,
        humanIdentifier: step.humanIdentifier,
        elementKind: step.elementKind,
        url: step.url,
        redactValue: true,
      },
    );
  }

  /**
   * Mark the run as authenticated once the login succeeded. The individual steps
   * are recorded by {@link recordAuthStep} as they happen; this only flips the flag
   * the session-preservation guard reads.
   */
  public recordAuthenticationMarker(): void {
    this.authenticatedRun = true;
  }

  // Distinct routes visited this run (origin + normalized path, query dropped) —
  // the session-global page set for history metadata.
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

      // Memory cap. Was shift() — evicting the EARLIEST findings, i.e. the ones
      // discovered on the first, cleanest interactions and most likely to be root
      // causes, while retaining later noise (audit P3-21). Evict the lowest-value
      // duplicate class instead: the finding whose bugClass is already most
      // represented, and among those the least severe, so breadth is preserved.
      while (this.confirmedBugsMemory.length > MAX_CONFIRMED_BUGS) {
        this.evictLowestValueFinding();
      }

      // Strongest compound reward: the element acted on just surfaced a real
      // fault/vulnerability, so its feature signature should gain weight.
      //
      // Attributed through the SAME causal window network rewards already use
      // (audit P3-12). It used to credit `lastActedTarget` with no time bound at
      // all, so a fault surfacing from a background poll or a delayed API hang
      // trained the model on whatever happened to be clicked most recently.
      const culprit = this.interactionCulpritFor(bug.timestamp);
      if (culprit) {
        this.scorer.applyCompoundReward(culprit, { faultDetected: true });
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

  // Findings dropped by the ledger cap this run — surfaced so a truncated result
  // set is never mistaken for the complete one.
  private droppedFindings = 0;

  /** How many findings the ledger cap discarded this run (0 = nothing truncated). */
  public truncatedFindingCount(): number {
    return this.droppedFindings;
  }

  /**
   * Evict one finding when the ledger is over cap: the most-duplicated bug class
   * first, and within it the least severe. Keeps one representative of every class
   * so the report never loses a whole defect category to a chatty finder.
   */
  private evictLowestValueFinding(): void {
    const perClass = new Map<string, number>();
    for (const bug of this.confirmedBugsMemory) {
      const key = bug.attribution?.bugClass ?? bug.type;
      perClass.set(key, (perClass.get(key) ?? 0) + 1);
    }

    const rank: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
    let victim = -1;
    let victimScore = Infinity;
    for (let i = 0; i < this.confirmedBugsMemory.length; i++) {
      const bug = this.confirmedBugsMemory[i];
      const key = bug.attribution?.bugClass ?? bug.type;
      const count = perClass.get(key) ?? 1;
      if (count <= 1) continue; // never drop the last instance of a class
      // Lower is more evictable: least severe within the most crowded class.
      const score = (rank[String(bug.severity ?? 'MEDIUM')] ?? 2) * 1000 - count;
      if (score < victimScore) {
        victimScore = score;
        victim = i;
      }
    }

    // Every class is a singleton — fall back to dropping the oldest.
    this.confirmedBugsMemory.splice(victim >= 0 ? victim : 0, 1);
    this.droppedFindings += 1;
  }

  /**
   * Upgrade a registered finding's culprit selector when a later sighting names the
   * control the first (off-target collateral) sighting could not. First-wins dedup
   * otherwise locks in the empty selector forever — this lets a correctly-attributed
   * recurrence fill it, without disturbing a selector that is already set.
   */
  public upgradeFindingCulprit(bugId: string, selector: string): void {
    if (!selector) return;
    const index = this.confirmedBugsMemory.findIndex((b) => b.bugId === bugId);
    if (index >= 0 && !this.confirmedBugsMemory[index].selector) {
      this.confirmedBugsMemory[index] = { ...this.confirmedBugsMemory[index], selector };
    }
  }

  /** Queue a newly registered finding for one deterministic replay. */
  private enqueueReproduction(bug: ConfirmedBug): void {
    const bugClass = bug.attribution?.bugClass;
    // No class ⇒ nothing for the collector to match a replayed fault against.
    if (!this.reproductionProbe || !bugClass) return;
    // Oracle-only findings (reflected XSS) can't be re-armed by the replay — skip so a
    // forced "did not reproduce" never docks their oracle-confirmed verdict.
    if (bug.skipReproduction) return;
    this.reproductionProbe.enqueue({
      bugId: bug.bugId,
      targetUrl: this.targetUrl,
      actions: bug.reproductionActions ?? [],
      bugClass,
      faultType: normalizeFaultType(bug.type),
      severity: bug.severity ?? 'MEDIUM',
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
      outcome.reproductionRate,
    );
    const attribution = { ...existing.attribution, confidenceScore: score, verificationStatus: status };
    this.confirmedBugsMemory[index] = { ...existing, attribution };

    this.activeGateway?.emitReproductionVerdict?.({
      bugId: outcome.bugId,
      reproduced: outcome.reproduced,
      stepsReplayed: outcome.stepsReplayed,
      confidenceScore: score,
      verificationStatus: status,
      reproductionRate: outcome.reproductionRate,
      attempts: outcome.attempts,
    });

    // Reproduction rate makes an intermittent fault legible: "3/3" is deterministic,
    // "1/3" is a flake a developer should treat differently, "0/3" did not recur.
    const rateLabel = `${Math.round(outcome.reproductionRate * outcome.attempts)}/${outcome.attempts}`;
    const verdictWord =
      outcome.reproductionRate >= 1
        ? 'Reproduced deterministically'
        : outcome.reproduced
          ? 'Reproduced intermittently'
          : 'Did not reproduce';
    this.activeGateway?.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'ACTION',
      meta: {
        actionExecuted: 'reproduction-verified',
        message: ` ${verdictWord} (${rateLabel} replays, ${outcome.stepsReplayed} step(s)) — confidence ${score} (${status})`,
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
      title: bug.title,
      url: this.activePage?.url() ?? this.targetUrl,
      stackTrace: bug.stackTrace,
      steps: bug.reproductionActions ?? [],
      reproductionActions: bug.reproductionActions ?? [],
      stateFingerprint: bug.stateFingerprint,
      reproductionPlaybook: bug.reproductionSteps,
      advice: bug.advice,
      attribution: bug.attribution,
      culpritSelector: bug.selector || undefined,
      culpritLabel: bug.elementLabel || undefined,
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
    obsLog.info(`[ExplorationEngine] Session PAUSED at ${this.pauseSnapshotTimeMs}ms elapsed`);
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
    obsLog.info(`[ExplorationEngine] Session RESUMED with ${remainingTimeMs}ms remaining (elapsed: ${this.elapsedActiveTimeMs}ms)`);
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
    // Pause (no stop): wait — bounded — for the exploration loop to park at its
    // pause barrier so no in-flight step keeps clicking/emitting/registering after
    // the lifecycle settles to PAUSED. A stop tears the loop down instead (its own
    // finally settles), so the wait is skipped there. Bounded so a wedged step can
    // never hang the pause; a resume racing in (isPaused flips false) also exits it.
    if (!this.isStopRequested) {
      const deadline = Date.now() + PAUSE_SETTLE_TIMEOUT_MS;
      while (this.loopActive && this.isPaused && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    // Under a stop, cancel the verification backlog and unwind it — a stopped run
    // must not keep spawning replay sessions. A pure PAUSE must NOT block the PAUSED
    // transition on replay drain: the sidecar probes keep draining in the background
    // and re-register verdicts asynchronously, so the run stays resumable regardless.
    if (this.isStopRequested) {
      this.reproductionProbe?.dispose();
      await this.reproductionProbe?.settle();
    }
    await this.asyncTasks.settle();
  }

  /**
   * Get the accumulated active execution time (in ms).
   * Only counts time when the engine is NOT paused.
   */
  public getElapsedActiveTimeMs(): number {
    return this.elapsedActiveTimeMs;
  }

  /** Real interactions executed this run (uncapped) — the authoritative step count. */
  public getInteractionCount(): number {
    return this.runtimeMetrics.interactionCount;
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

      // Pin the authoritative clock at the limit and push a final sync so the frontend
      // timer (slaved to it) snaps to zero remaining instead of freezing mid-countdown.
      this.elapsedActiveTimeMs = Math.max(this.elapsedActiveTimeMs, this.timeboxMs);
      this.emitTimeSync();

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
   * Time only accumulates when NOT paused. Emits an authoritative time-sync every
   * ~1s (and an immediate baseline); the frontend timer is a pure display slaved
   * to it and never runs an independent countdown.
   */
  private startTimingInterval(telemetry: TelemetryGateway): void {
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
        // Timebox is enforced HERE, not only at the loop boundary: a step wedged in a
        // long Playwright await never returns to the loop's gate, so this clock-driven
        // check flips the stop the instant active time crosses the limit. stop('timebox')
        // sets isStopRequested + set-once stopReason, so the loop unwinds via stopResult()
        // with the same 'timebox' outcome and the background monitors read teardown.
        if (this.checkTimeboxAndTerminateIfExceeded(telemetry)) {
          this.stop('timebox');
        }
      } else {
        // When paused or stopped, just update tick reference without accumulating
        this.lastTickTimestamp = Date.now();
      }
    }, 100);
    // unref so a teardown-bypass path can't leave this interval pinning the event loop.
    this.timingInterval.unref();
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
  public async run(page: Page, targetUrl: string, telemetry: TelemetryGateway, maxSteps = 150, browserInfo?: BrowserInfo, authOrigins: readonly string[] = [], restoreSession?: SessionRestoreFn): Promise<RunResult> {
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
    // Boundary starts at the user URL; relocked to the canonical URL after first load.
    this.canonicalUrl = targetUrl;
    this.canonicalOrigin = this.targetOrigin;
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
    this.loopActive = false;
    // Clear the one-shot timebox latch so a reused engine instance can still
    // terminate via the timebox path — it is never reset elsewhere.
    this.timeboxExceeded = false;

    // Last navigated URL — shared via closure with the stability monitor and loop.
    let lastKnownUrl = '';

    // Latest MAIN-FRAME document response status, keyed by its normalized route
    // path. Lets the loop's error-route detector see a real HTTP ≥400 hard
    // navigation; null for pure client-side SPA renders (no top-level response).
    // Reassigned on page recreation via the shared `page` binding, exactly like
    // lastKnownUrl, so it survives the deepest recovery rung.
    let lastMainFrameStatus: { path: string; status: number } | null = null;
    // Observed document status per normalized route — stable across client
    // navigations, unlike the single last-write slot above.
    const routeStatuses = new Map<string, number>();

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
      // Off-target scenarios (coordinate bombing, sibling concurrent clicks, route
      // trashing) drive controls OTHER than the acted element, so any navigation
      // evidence gathered inside such a window is unattributable. Decline the
      // finding rather than pin it on whatever element was nominally selected.
      if (ActiveScenarioTracker.offTargetVetoes(Date.now(), this.lastActedAtMs)) return;
      for (const defect of defects) {
        const reproduction = ActiveScenarioTracker.flushSnapshot({
          faultUrl: defect.url || lastKnownUrl,
          faultAtMs: Date.now(),
        });
        // A navigation defect belongs to ONE control, so its playbook must end on
        // that control's own interaction — never on an unrelated stress-scenario
        // window, which is what the generic snapshot narrative would supply.
        //
        // A redirect loop is special: its hops are AUTOMATIC browser redirects, not
        // manual steps. The playbook opens with the real triggering action (the
        // culprit click, or the single navigation that lands on the looping route)
        // and closes with ONE observation of the loop — never a run of artificial
        // "Navigate to X" steps mirroring each automatic redirect.
        const isRedirectLoop = defect.kind === 'REDIRECT_LOOP';
        const reproductionActions = isRedirectLoop
          ? redirectLoopTrigger(defect, reproduction.actions)
          : anchorToCulprit(reproduction.actions, defect.culprit);
        const actionSteps = narrateActionRecords(reproductionActions);
        const reproductionSteps = isRedirectLoop
          ? [
              ...actionSteps,
              `Step ${actionSteps.length + 1}. ${describeRedirectLoopObservation(
                redirectChain(defect.hops),
                defect.hops?.some((h) => typeof h.status === 'number') ? 'http' : 'client',
              )}`,
            ]
          : actionSteps;
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
          elementLabel: defect.elementLabel,
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
      upgradeFindingCulprit: (bugId, selector) => this.upgradeFindingCulprit(bugId, selector),
      setFreeze: () => this.freezeRecording(),
      getLastKnownUrl: () => lastKnownUrl,
      onApiFailure: () => { this.runtimeMetrics.requestsCount++; },
      recordNetworkFailure: () => this.networkFailureCascade.recordFailure(),
      getInteractionContext: (atMs) => this.interactionContextAt(atMs),
      isConcurrentBurstAt: (atMs) => isConcurrentBurstAt(this.actedHistory.map((h) => ({ selector: h.target.selector, actedAtMs: h.actedAtMs })), atMs),
      getTargetOrigin: () => this.canonicalOrigin,
      dialogReadOnly: () => this.dialogReadOnly,
      isEngineStopping: () => this.isStopRequested || this.isPaused || this.timeboxExceeded,
      abortForHarnessFault: (kind) => this.stop(kind === 'memory' ? 'harness-resource' : 'harness-environment'),
    });

    const stateRestorer = new StateRestorer({
      hashManager: this.hashManager,
      telemetry: emitter,
      recordActionTrace: (trace, clean) => this.recordActionTrace(trace, clean),
      getTargetOrigin: () => this.canonicalOrigin,
      getReentryUrl: () => (this.authenticatedRun ? this.canonicalUrl : this.canonicalOrigin),
    });

    const actionExecutor = new ActionExecutor({
      gate: this.gate,
      fuzzManager: this.fuzzManager,
      simulator: this.simulator,
      highlighter: this.highlighter,
      telemetry: emitter,
      recordActionTrace: (trace, clean) => this.recordActionTrace(trace, clean),
      getTargetOrigin: () => this.canonicalOrigin,
      escalationTracker: this.escalationTracker,
      formFuzz: this.formFuzz,
      formFuzzCap: this.formFuzzCap,
      registerConfirmedBug: (bug) => this.registerConfirmedBug(bug),
      isNetworkCascading: () => this.networkFailureCascade.isCascading(),
    });

    // Operator visibility: announce which testing strategies are active this run.
    emitter.emitMilestone(`️ Active testing types: ${this.gate.activeCategories().join(', ')}`);

    // Announce the active boundary lock so the operator sees how navigation is pinned.
    if (this.boundaryScope === 'exact') {
      emitter.emitMilestone(` Strict Page Boundary Lock enabled — exploration confined to ${targetUrl}`);
    } else if (this.boundaryScope === 'subtree') {
      emitter.emitMilestone(` Sub-tree lock enabled. Exploration is limited to the launch route and its child pages. (${targetUrl})`);
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
    this.actedHistory.length = 0;

    // Session-preservation restore coordinator — inert unless the run authenticated
    // AND a restore callback was injected (guest/unauth runs pass none).
    const restoreCoordinator = new SessionRestoreCoordinator(restoreSession ?? null);

    // Classify an unexpected authenticated -> auth-page navigation as a Session
    // Synchronization Fault, emit the finding, and attempt an in-place restore so
    // exploration continues without restarting. Best-effort: a failed restore
    // leaves the run exploring the unauthenticated surface rather than aborting.
    const handleSessionLoss = async (from: string, to: string): Promise<void> => {
      const descriptor = classifySessionLoss(from, to);
      const definition = BUG_CATALOG.SESSION_SYNC_FAULT;
      const bugId = `session-sync-fault-${Date.now()}`;
      const timestamp = new Date().toISOString();
      const attribution: FindingAttribution = {
        bugClass: 'SESSION_SYNC_FAULT',
        cwe: definition.cwe,
        ...resolveScenarioAttribution(ActiveScenarioTracker.getActiveScenarioName()),
        origin: 'TARGET_APP',
        confidence: 'SIGNAL',
        verificationStatus: 'NEEDS_VERIFICATION',
      };
      emitter.emitMilestone(` Session synchronization fault — ${descriptor.reason}`);
      emitter.gateway.emitIncidentReport({
        bugId,
        timestamp,
        reason: descriptor.reason,
        url: to,
        steps: this.breadcrumbsToActionRecords(this.actions.snapshot()),
        advice: definition.remediation,
        attribution,
        severity: definition.defaultSeverity,
      });
      this.registerConfirmedBug({
        bugId,
        type: 'SESSION_SYNC_FAULT',
        message: descriptor.reason,
        selector: '',
        payloadUsed: '',
        advice: definition.remediation,
        attribution,
        severity: definition.defaultSeverity,
        timestamp: new Date(),
      });

      if (restoreCoordinator.canRestore() && this.activePage) {
        const ok = await restoreCoordinator.restore(this.activePage);
        emitter.emitSystemStatus(
          ok
            ? 'Authenticated session restored — continuing exploration.'
            : 'Session restore failed — continuing on the unauthenticated surface.',
        );
        emitter.emit('ACTION', {
          actionExecuted: ok ? 'session-restored' : 'session-restore-failed',
          url: this.activePage.url(),
          message: ok
            ? 'Re-authenticated after a session synchronization fault.'
            : 'Could not re-authenticate; exploration continues unauthenticated (no restart).',
        });
      } else {
        emitter.emitSystemStatus('Session lost and no restore available — continuing unauthenticated.');
      }
    };

    // Page-agnostic observation sinks. TabWindowManager owns which page's events reach
    // them, so the same run-scoped state is fed by whichever tab currently has focus.
    const onNavigated = (url: string): void => {
      if (!url) return;
      const from = lastKnownUrl;
      lastKnownUrl = url;
      // Phase 3: Track page count when navigating
      this.runtimeMetrics.pageCount++;
      emitter.gateway.emitUrlChanged(url);
      void reportNavigationDefects(navigationFinder.observeUrlChange({ url, timestampMs: Date.now() }));
      // Session guard: an authenticated run that lands on an auth page (and wasn't
      // already there) lost its session. Skipped while a restore is in flight so
      // the restore navigation can't re-trigger itself.
      if (shouldTriggerSessionLoss(this.authenticatedRun, restoreCoordinator.isRestoring, from, url)) {
        void handleSessionLoss(from, url);
      }
    };

    const onNetworkRequest = (resourceType: string): void => {
      const t = this.lastActedTarget;
      if (!t) {
        return;
      }
      if (resourceType !== 'xhr' && resourceType !== 'fetch') return;
      // An off-target scenario (bombing / sibling concurrent clicks) severs the
      // element↔request link: the xhr/fetch was not caused by the acted target,
      // so it must not reward it.
      if (ActiveScenarioTracker.isOffTargetScenarioActive()) return;
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
      const path = normalizeRoutePath(url);
      lastMainFrameStatus = { path, status };
      // Also remember it BY ROUTE (audit P3-17). A single last-write slot meant a
      // route that legitimately returned 4xx on a hard load lost that verdict as soon
      // as any other document loaded, so the same page was excluded once and admitted
      // later. Bounded, so a query-volatile SPA cannot grow it without limit.
      routeStatuses.set(path, status);
      if (routeStatuses.size > MAX_ROUTE_STATUSES) {
        const oldest = routeStatuses.keys().next().value;
        if (oldest !== undefined) routeStatuses.delete(oldest);
      }
      void reportNavigationDefects(navigationFinder.observeRedirectHop({
        url,
        route: path,
        status,
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
        // Both the terminating and non-consuming reads honor the sub-session deadline.
        checkTimebox: () => this.isTimeboxExceeded() || Date.now() >= deadlineMs,
        isTimeboxExceeded: () => this.isTimeboxExceeded() || Date.now() >= deadlineMs,
      });
      await subLoop.execute(tab, budget);
    };

    const tabs = new TabWindowManager({
      context: page.context(),
      telemetry: emitter,
      stabilityMonitor,
      getTargetUrl: () => this.canonicalUrl,
      getTargetOrigin: () => this.canonicalOrigin,
      authOrigins,
      boundaryScope: this.boundaryScope,
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
      getTargetUrl: () => this.canonicalUrl,
      getTargetOrigin: () => this.canonicalOrigin,
      getReentryUrl: () => (this.authenticatedRun ? this.canonicalUrl : this.canonicalOrigin),
      boundaryScope: this.boundaryScope,
      authOrigins,
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
    this.lastUnhandledError = null;

    try {
      // Task 3: Emit granular status for dynamic UI - "Navigating to URL..."
      emitter.emitSystemStatus(`Navigating to ${targetUrl}...`);

      // EMIT EARLY TELEMETRY: Notify that browser has started navigating
      // This helps the frontend understand the engine is processing
      emitter.emit('ACTION', {
        actionExecuted: 'browser-launched',
        message: ` Browser launched, navigating to ${targetUrl}...`,
      });

      //  Proactive Page Boundary Lock: arm the navigation guard BEFORE the first
      // goto so the init script is present for the initial document and the route
      // interceptor is live for the very first navigation. Blocks off-boundary
      // main-frame navigation before it commits (no reactive goto → no nav race).
      // Always-on: exact pins to the launch URL, subtree pins to the launch route
      // + descendants, site confines to the target host (+ subdomains + auth
      // origins). authOrigins is ignored by 'exact' and always kept as an escape
      // hatch for login under 'subtree'/'site'.
      const boundaryGuard = new StrictUrlLockGuard(targetUrl, emitter, {
        scope: this.boundaryScope,
        authOrigins,
        // Follow the launch redirect chain to the canonical URL, THEN pin the boundary
        // to it (relock below). Arming pre-goto would abort the very redirect that
        // resolves an alias like fb.com → www.facebook.com as a scope violation.
        deferInitialLock: true,
      });
      await boundaryGuard.install(page);

      // An authenticated run arrives here already positioned on the live, authenticated
      // landing page — PlaywrightBrowserEngine logged in and adopted page.url() as the
      // start. Re-navigating would hard-reload that page and can drop the session just
      // established (an in-memory token, an SSR cookie-gated route, or a redirect still
      // settling), bouncing the run onto a login page it then mistakes for its start.
      // Preserve the session: explore the current page in place, never re-goto.
      const startInPlace = this.authenticatedRun && /^https?:/i.test(page.url());
      if (startInPlace) {
        obsLog.info('[ExplorationEngine] Authenticated run — exploring live page in place:', page.url());
      } else {
        obsLog.info('[ExplorationEngine] Starting page.goto for targetUrl:', targetUrl);
        // A cold or slow link (tunnel cold-start, distant host, throttled network) often
        // misses a single 20s domcontentloaded window but is still reachable — so the
        // first navigation gets bounded retries, and the final attempt falls back to
        // 'commit' (resolves once the response lands) and lets ensureDomReady + the
        // re-parsing loop gate real readiness, rather than abandoning a live target.
        const NAV_ATTEMPTS = 3;
        let navError: unknown;
        let usedCommitFallback = false;
        for (let attempt = 1; attempt <= NAV_ATTEMPTS; attempt++) {
          const waitUntil = attempt < NAV_ATTEMPTS ? 'domcontentloaded' : 'commit';
          try {
            await page.goto(targetUrl, { waitUntil, timeout: INITIAL_NAV_TIMEOUT_MS });
            usedCommitFallback = waitUntil === 'commit';
            navError = undefined;
            break;
          } catch (error) {
            navError = error;
            if (attempt >= NAV_ATTEMPTS) break;
            emitter.emitSystemStatus(`Target slow to respond — retrying navigation (${attempt + 1}/${NAV_ATTEMPTS})…`);
            await page.waitForTimeout(NAV_RETRY_BACKOFF_MS * attempt);
          }
        }
        if (navError) throw navError;
        // A 'commit'-only navigation returned before the document parsed; over a slow link
        // the SPA shell has not rendered yet, so parsing now reads a false structural
        // dead-end. Give it a bounded window to reach 'load' and paint interactive content
        // before exploration begins — each wait resolves early once the page is ready.
        if (usedCommitFallback) {
          emitter.emitSystemStatus('Target committed slowly — waiting for the app to finish loading before exploring…');
          await page.waitForLoadState('load', { timeout: HYDRATION_SETTLE_MS }).catch(() => undefined);
          await page
            .waitForSelector('button, input, a, select, [style*="cursor: pointer"]', { timeout: HYDRATION_SETTLE_MS })
            .catch(() => undefined);
        }
        obsLog.info('[ExplorationEngine] page.goto completed for targetUrl:', targetUrl);
      }

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

      // Canonical target resolution (once): the browser's final URL after the launch
      // redirect chain is the site's real domain. Pin every boundary/scope guard to it
      // for the rest of the run so an alias entry (fb.com → www.facebook.com) never
      // reads as an off-boundary violation. The user-entered URL stays untouched for
      // display, history, reports, and forensics — only navigation validation moves.
      const settledUrl = page.url();
      const canonicalUrl = /^https?:/i.test(settledUrl) ? settledUrl : targetUrl;
      this.canonicalUrl = canonicalUrl;
      this.canonicalOrigin = new URL(canonicalUrl).origin;
      await boundaryGuard.relock(canonicalUrl);
      if (new URL(canonicalUrl).host !== new URL(targetUrl).host) {
        emitter.emitMilestone(` Canonical target resolved to ${this.canonicalOrigin} after redirect — navigation boundary now follows the site's real domain.`);
      }

      await this.ensureDomReady(page, emitter);

      // ️ Initialize background stability/console monitoring (heartbeat + console tab).
      this.cleanupStabilityMonitor = await stabilityMonitor.attachAfterNavigation(
        page,
        (bug) => this.registerConfirmedBug(bug),
      );

      resetConstraintBypassFinder(); // clear the per-run one-probe-per-field guard
      resetInjectionDifferentialFinder(); // clear the differential oracle's per-field guard
      resetNoSqlInjectionFinder(); // clear the nosql oracle's per-field guard
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
        escalationTracker: this.escalationTracker,
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
        setLoopActivity: (active) => { this.loopActive = active; },
        checkTimebox: () => this.checkTimeboxAndTerminateIfExceeded(telemetry),
        isTimeboxExceeded: () => this.isTimeboxExceeded(),
        getTimeboxMs: () => this.timeboxMs,
        getLastKnownUrl: () => lastKnownUrl,
        // Only surface the status when it matches the current route, so a stale
        // 404 from a previous page can never be attributed to a fresh render.
        // Route-keyed, so a route's own observed status survives later navigations
        // instead of being overwritten by whatever loaded last.
        getMainFrameStatus: (routePath) => routeStatuses.get(routePath) ?? null,
        noteActedTarget: (t) => {
          const now = Date.now();
          this.lastActedTarget = t;
          this.lastActedAtMs = now;
          this.networkRewardsThisAction = 0;
          this.actedHistory.push({ target: t, actedAtMs: now });
          if (this.actedHistory.length > ACTED_HISTORY_CAP) this.actedHistory.shift();
        },
        getTargetOrigin: () => this.canonicalOrigin,
        getTargetUrl: () => this.canonicalUrl,
        authOrigins,
        persistBrainSnapshot: (source, step) => this.persistBrainSnapshot(source, step),
        setFreeze: () => this.freezeRecording(),
        ensureDomReady: (p) => this.ensureDomReady(p, emitter),
        ensurePageHealth: (p) => pageHealthGuard.ensureHealthy(p),
        boundaryScope: this.boundaryScope,
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
    } catch (err) {
      // Retain the throw so the finally's completeSession() can attribute it; rethrow
      // to preserve the caller's existing fatal-error handling.
      this.lastUnhandledError = err;
      throw err;
    } finally {
      //  Cleanup: dispose stability monitoring to prevent "ghost" heartbeat intervals
      if (this.cleanupStabilityMonitor) {
        this.cleanupStabilityMonitor();
        this.cleanupStabilityMonitor = null;
      }

      // A forced termination (timebox reached or a stop) must not let replay/
      // verification keep running after the run is declared over: drop the backlog
      // and abort the in-flight replay now. Findings already collected are preserved
      // (only their unrun verdicts are skipped). A run that ended naturally drains so
      // pending verdicts finish. Settle either way so the in-flight replay unwinds
      // before the browser closes — a probe outlasting its browser logs disconnect noise.
      if (this.isStopRequested || this.timeboxExceeded || this.isTimeboxExceeded()) {
        this.reproductionProbe?.dispose();
      }
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
      // Profile is derived from the gate, not from the request, so the record
      // states what actually ran (an unknown profile that fell back to all-on
      // is stored as the full-spectrum profile, which is what executed).
      const activeTestingTypes = this.gate.activeCategories();
      return await this.findingRepo.createSession({
        targetUrl,
        startedAt: new Date().toISOString(),
        userId: this.userId,
        runId: this.runCode,
        infiltrationProfile: resolveProfileFromTestingTypes(activeTestingTypes),
        activeTestingTypes,
        executionTimeboxMs: this.timeboxMs,
      });
    } catch (error) {
      obsLog.error('[ExplorationEngine] Failed to create Safari session:', error);
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
    // Authoritative run metrics: interactionCount is the uncapped real step total, and
    // getElapsedActiveTimeMs is paused-aware. Falls back to wall-clock from the metrics
    // start when the active clock was never seeded (a run that ended before its first tick).
    const runtimeMs = this.getElapsedActiveTimeMs()
      || (this.runtimeMetrics.startTime ? Date.now() - this.runtimeMetrics.startTime : 0);
    const stats = {
      actionsExecuted: this.runtimeMetrics.interactionCount,
      runtimeMs,
      pageCount: this.runtimeMetrics.pageCount,
    };
    try {
      await this.findingRepo.markSessionTerminated(this.sessionId, this.userId, new Date().toISOString(), outcome, reason, stats);
    } catch (error) {
      obsLog.error('[ExplorationEngine] Failed to complete Safari session:', error);
    }
  }

  // A loop that returned carries its own verdict. A null result means run() unwound
  // through a throw — attribute it to the recorded stop trigger when one exists,
  // otherwise it is a genuine unhandled failure.
  private resolveTermination(result: RunResult | null): { outcome: RunTerminationOutcome; reason: string } {
    if (result) {
      // A graceful-shutdown the loop returned WHILE a stop was recorded is that
      // stop's teardown, not an independent bail-out — honor the recorded trigger.
      if (result.outcome === 'graceful-shutdown' && this.stopReason) {
        return { outcome: STOP_REASON_OUTCOME[this.stopReason], reason: STOP_REASON_DETAIL[this.stopReason] };
      }
      return { outcome: result.outcome, reason: result.reason };
    }
    if (this.stopReason) {
      return {
        outcome: STOP_REASON_OUTCOME[this.stopReason],
        reason: STOP_REASON_DETAIL[this.stopReason],
      };
    }
    // The loop threw with no operator stop. Attribute the failure: a Playwright /
    // browser / environment error (goto timeout, closed context) is an ENGINE fault
    // recorded as 'engine-error'; only a target-attributed throw is a 'exception' crash.
    const err = this.lastUnhandledError;
    const message = err instanceof Error ? err.message : String(err ?? 'Unhandled exception detected');
    const origin = classifyFaultOrigin({
      faultType: 'EXCEPTION',
      message,
      url: this.canonicalUrl || undefined,
      targetOrigin: this.canonicalOrigin || undefined,
    });
    return origin.isTargetApp
      ? { outcome: 'exception', reason: message }
      : { outcome: 'engine-error', reason: `${origin.reason} ${message}`.trim() };
  }

  // Freeze the LIVE operator breadcrumb timeline at crash time so a post-fault tail
  // doesn't flood it. The reproduction buffer (ReproductionPlaybookStore) deliberately
  // keeps recording — each finding snapshots it at its own fault instant, so freezing it
  // globally made every finding after the first inherit the first fault's timeline.
  private freezeRecording(): void {
    this.freezeActionTraceRecording = true;
  }

  // Resolve which control the engine was actuating at `atMs`, so a request observed by
  // StabilityMonitor can be attributed to its triggering interaction. Bounded by the same
  // causal window used for network reward attribution — outside it, background SPA chatter
  // would be misattributed to an unrelated element.
  /**
   * The element actually being actuated at `at`, for LEARNING attribution — the
   * same causal window that guards network rewards. Falls back to the latest acted
   * target only when the fault carries no usable timestamp.
   */
  private interactionCulpritFor(at: Date | undefined): InteractiveElement | null {
    const atMs = at instanceof Date ? at.getTime() : Number.NaN;
    if (!Number.isFinite(atMs)) return this.lastActedTarget;

    for (let i = this.actedHistory.length - 1; i >= 0; i--) {
      const entry = this.actedHistory[i];
      if (entry.actedAtMs > atMs) continue;
      if (atMs - entry.actedAtMs > NETWORK_ATTRIBUTION_WINDOW_MS) return null;
      return entry.target;
    }
    return null;
  }

  private interactionContextAt(atMs: number): InteractionContext | null {
    // Resolve the element actually being actuated AT the fault's instant: the newest
    // history entry acted at or before atMs and still inside the causal window. Scanning
    // the history (not just the latest slot) recovers a slow request's true culprit when
    // a later action has since replaced the "latest" pointer (async-lag attribution).
    for (let i = this.actedHistory.length - 1; i >= 0; i--) {
      const entry = this.actedHistory[i];
      if (entry.actedAtMs > atMs) continue;
      if (atMs - entry.actedAtMs > NETWORK_ATTRIBUTION_WINDOW_MS) return null;
      // Off-target scenarios (coordinate bombing / sibling concurrent clicks) drive
      // controls OTHER than this entry. Decline only when the fault is causally inside
      // such a span AND this entry did not supersede it (i.e. was acted during/before the
      // span, not as a fresh action after it) — so a genuine post-span click still attributes.
      if (ActiveScenarioTracker.offTargetVetoes(atMs, entry.actedAtMs)) return null;
      return {
        selector: entry.target.selector,
        label: resolveElementLabel(entry.target),
        actedAtMs: entry.actedAtMs,
      };
    }
    return null;
  }

  // Records an executed action into the in-memory breadcrumb + reproduction buffers only.
  // High-frequency action traces are WebSocket/in-memory telemetry — never persisted to Mongo.
  private recordActionTrace(trace: ActionBreadcrumb, clean?: CleanActionStep): void {
    // Build a clean, human-descriptive record for the canonical playbook buffer so
    // crash-time narrative serialization reads accurate action types, visible labels,
    // live URLs, and real fuzz/text values instead of internal engine verbs.
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
      containerLabel: clean?.containerLabel,
      containerKind: clean?.containerKind,
    };
    // ALWAYS feed the reproduction buffer — even after a fault — so each finding
    // snapshots its own causal chain. Post-fault noise is dropped per-fault by the
    // minimizer's fault-time cutoff, not by freezing the whole buffer.
    ReproductionPlaybookStore.push(actionRecord);

    // The live operator breadcrumb timeline still freezes at crash time so a post-fault
    // tail can't flood it — display-only; the reproduction buffer above is authoritative.
    if (this.freezeActionTraceRecording) return;
    this.actions.push(trace);
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
      obsLog.error('[ExplorationEngine] Failed to persist brain snapshot:', error);
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
        obsLog.info(`[ExplorationEngine] Warm-started brain for ${targetUrl} (bias=${prior.bias.toFixed(3)})`);
        emitter.emitMilestone(' Warm-started brain from a prior session for this URL.');
      }
    } catch (error) {
      obsLog.error('[ExplorationEngine] Brain warm-start failed:', error);
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
      obsLog.error('[ExplorationEngine] Failed to flush forensic errors:', error);
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
    const runId = new Types.ObjectId(this.sessionId);

    this.telemetryUpsertChain = this.telemetryUpsertChain.then(async () => {
      try {
        await forensicTelemetryRepository.upsertForRun({ forensicRunId: runId, ...params });
      } catch (error) {
        obsLog.error('[ExplorationEngine] Failed to persist forensic telemetry:', error);
      }
    });
    return this.telemetryUpsertChain;
  }

  // Strict-lock drift detection + recovery now lives in PageHealthGuard (which
  // shares StrictUrlLockGuard.confinementKey, so detection can never diverge from
  // enforcement), replacing the former detection-only ensureTargetDomain and its
  // duplicated confinement-key helper.

  private async ensureDomReady(page: Page, telemetry: TelemetryEmitter): Promise<void> {
    // Hydration-aware, applied to every route change: let the page reach 'load' first so
    // a slow route finishes fetching its bundle before we look for content — resolves
    // instantly on an already-loaded page, so fast apps pay nothing — then poll for
    // interactive content. Both bounded and resolve early once the page is ready.
    await page.waitForLoadState('load', { timeout: DOM_READY_LOAD_TIMEOUT_MS }).catch(() => undefined);
    try {
      await page.waitForSelector('button, input, a, select, [style*="cursor: pointer"]', {
        timeout: DOM_READY_SELECTOR_TIMEOUT_MS,
      });
    } catch {
      telemetry.emit('ACTION', {
        actionExecuted: 'dom-wait-timeout',
        message: `No interactive selector found during ${Math.round(DOM_READY_SELECTOR_TIMEOUT_MS / 1000)}s wait window.`,
      });
    }
  }
}
