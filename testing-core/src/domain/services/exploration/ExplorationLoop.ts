import type { Page } from 'playwright';
import {
  ALL_TESTING_TYPE_IDS,
  ACCESSIBILITY_BANNER_THRESHOLD,
  STOP_REASON_DETAIL,
  STOP_REASON_OUTCOME,
} from '../../../../../shared/types.js';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import { normalizeRoutePath, routeKey } from '../../../ml/domHasher.js';
import type { CompoundStateHash } from '../../../ml/domHasher.js';
import type {
  PathfinderElement,
  PathfinderDecision,
  ExploreEdgeDecision,
  BacktrackDecision,
} from '../DIrectedPathFinder.js';
import { armNetworkSabotage, type ArmedSabotage } from '../../scenarios/index.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import { describeRecovery, elementNoun, humanizeElement, resolveElementLabel } from '../forensics/narration.js';
import { isBrowserClosedError, isEngineLifecycleError, sanitizeException } from '../telemetry/StabilityMonitor.js';
import { inferSemanticRole, raceDeadline, settle } from './types.js';
import { attackTargetBoost, ATTACK_TARGET_SCORE_BOOST } from './interactionScope.js';
import { isSessionDestroyingControl, shouldVetoExecution, SESSION_EXIT_DEMOTION } from './SessionPreservationGuard.js';
import type { ExplorationLoopDeps, RunResult } from './types.js';
import { computeStagnation, computePenaltyIntensity, computePenaltyWindow } from './stagnationScoring.js';
import { isNovelStructuralState } from './noveltyScoring.js';
import { PageHealthGuard } from './PageHealthGuard.js';
import { StrictUrlLockGuard } from './StrictUrlLockGuard.js';
import { isWithinTargetSite } from '../../../../../shared/url.js';
import { deriveStableBugId, safeRoutePath } from './bugIdentity.js';
import { detectClientErrorView } from './clientErrorOracle.js';
import { BUG_CATALOG } from '../../../bugs/knowledgeBase/bugCatalog.js';
import type { RouteExhaustionVerdict } from './RouteExhaustionTracker.js';

import { createLogger } from '../../../infrastructure/observability/logger.js';

const obsLog = createLogger('[ExplorationLoop]');

// Node-side ceiling for a single scroll page.evaluate — a wedged page main thread
// would otherwise hang the un-timeouted evaluate and park the whole iteration.
const SCROLL_EVAL_DEADLINE_MS = 3000;

// Upper bounds on the per-run visited sets so long runs can't grow memory without limit.
const MAX_VISITED_HASHES = 5000;
const MAX_VISITED_ROUTES = 2000;
const MAX_VISITED_STRUCTURES = 2000;

// Empty-DOM tolerance: allow this many retries (waiting for delayed SPA render)
// before declaring a page a Structural Dead-End on the next consecutive empty check.
const EMPTY_RETRY_LIMIT = 2;

// Coverage bias: fixed margin subtracted from any control already triggered on
// the CURRENT structural shell, so untested controls win best-first across page
// reloads. Scoped per shell (audit P3-07) because a selector is not a unique
// control identity — the same positional path or reused #id names a different
// control on a different screen. Large enough to sink below any untriggered
// element's natural score;
// applied as a demotion (not removal) so a tested control is still selectable as
// a last resort once the whole frontier is spent.
const TRIGGERED_SELECTOR_DEMOTION = 1000;

// Softer margin for a control whose selector was triggered on a DIFFERENT shell.
// Purely shell-scoped identity makes every namesake look brand new, so the engine
// re-explores each template instance from scratch and runs out of timebox before
// reaching deep multi-step flows. A control already exercised elsewhere is not
// unknown — it is just not proven for THIS instance, so it ranks below anything
// never touched but well above a control already triggered right here.
const CROSS_SHELL_TRIGGERED_DEMOTION = 250;

// UI-layer awareness margins. Interior controls of an open overlay are lifted a
// fixed margin above every background control so the layer is exhausted first;
// its close/dismiss control is sunk (but not removed) so it's picked only once the
// interior is spent; untriggered layer-opening controls get a modest nudge so
// hidden modals/menus/accordions get discovered instead of skipped for flat links.
const LAYER_INTERIOR_SCORE_BOOST = 30;
const LAYER_DISMISS_DEMOTION = 500;
const LAYER_TRIGGER_SCORE_BOOST = 15;

// Frontier-exhaustion reveal: max viewport scrolls when the visible frontier is
// spent, bounding an infinite-scroll feed. Each step reparses to detect new
// off-screen/lazy controls before the page is declared fully explored.
const MAX_FRONTIER_SCROLLS = 6;

// Route-transition demotion: an untriggered anchor that navigates off the current
// view is sunk below every untriggered in-page control so forms/buttons/dropdowns
// are exhausted before a route change. Demotion, not removal — still selectable
// once the in-page frontier is spent.
const NAV_EDGE_DEMOTION = 300;

// href schemes that are not real route transitions (in-page / non-navigational).
const NON_NAV_HREF_RE = /^\s*(#|javascript:|mailto:|tel:|sms:|$)/i;

type LoopResult = RunResult;
type StepGate = { kind: 'proceed' } | { kind: 'continue' } | { kind: 'return'; result: LoopResult };

/**
 * Route identity used by every per-run visited/revealed set: origin + normalized
 * route path, query string dropped — the same normalization the graph's node
 * identity uses. Storing raw `page.url()` let cache-busters and pagination params
 * fragment the set, so revisit detection silently degraded to hash-only and the
 * set grew without bound on query-volatile SPAs.
 */
function visitedRouteKey(url: string): string {
  return routeKey(url);
}

/** Bound an insertion-ordered Set by evicting its oldest entries. */
function boundSet(set: Set<string>, cap: number): void {
  while (set.size > cap) {
    const oldest = set.values().next().value;
    if (oldest === undefined) return;
    set.delete(oldest);
  }
}

/** Per-run tunables (fixed at loop start) plus the counters they evolve across iterations. */
interface RunContext {
  readonly structureWindow: number;
  readonly stagnationForceBacktrack: number;
  readonly maxRecoveryRounds: number;
  readonly sabotageCadence: number;
  readonly hardCap: number;
  readonly extensionSteps: number;
  readonly coverageStallWindow: number;
  previousCombined: string;
  recentStructures: string[];
  penaltyStepsRemaining: number;
  recoveryRounds: number;
  // Consecutive dead-end/recovery unwinds since the last genuine progress. Drives
  // the adaptive-escape escalation; reset to 0 on any novel state.
  barrenRecoveries: number;
  sabotageStepCounter: number;
  budget: number;
  budgetExtensions: number;
  // Empty-DOM retry state (per-page): the URL currently under empty-check and its
  // consecutive empty-snapshot count. Reset when a non-empty page or a new URL is seen.
  emptyCheckUrl: string;
  emptyCheckCount: number;
  // URLs already classified as Structural Dead-Ends this run — revisits skip the
  // retry wait and backtrack immediately (prevents re-stalling on a known empty page).
  // Route-normalized (visitedRouteKey), like every other per-run set. Keyed by the
  // raw URL it fragmented on cache-busters/pagination params, so a known dead end
  // reached with a different query paid the full empty-render retry wait again.
  deadEndUrls: Set<string>;
  // URL at the start of the previous iteration — lets the loop reveal lazy content
  // only when we genuinely RETURN to a seen URL, not while parked on one.
  lastStepUrl: string;
  // Structural shells already announced as Fully Explored — bounds the saturation
  // skip milestone to once per page instead of once per redundant landing.
  saturatedLogged: Set<string>;
  // URLs already scrolled for lazy/off-screen content on their FIRST landing, so
  // the first-visit reveal fires once per URL instead of every step parked on it.
  firstVisitRevealed: Set<string>;
  // Routes already reported as a client render freeze — one finding per route,
  // not one per step spent on a page that never settles.
  freezeReported: Set<string>;
}

/** Per-step DOM/graph fingerprint computed once per iteration for a VALID state. */
interface StepFingerprint {
  compound: CompoundStateHash;
  currentHash: string;
  currentUrl: string;
  revisitedPage: boolean;
  stagnationScore: number;
  /** Exact-state repeat AND a coverage stall — the backtrack can no longer be deferred. */
  hardStagnation: boolean;
}

/**
 * Outcome of per-step fingerprinting: either a traversable state to register, or
 * a non-traversable error state (HTTP 4xx/5xx or a detected error template) that
 * must be excluded from the graph and handled as a structural dead end.
 */
type FingerprintResult =
  | { kind: 'ok'; fingerprint: StepFingerprint }
  | {
      kind: 'error';
      compound: CompoundStateHash;
      mainFrameStatus: number | null;
      routeVerdict: RouteExhaustionVerdict;
    };

/**
 * Handles the incremental step-by-step exploration logic: per-step parse →
 * score → DOM-hash → loop detection → StateGraphNavigator decision → action
 * execution → traversal verification → novelty reward → telemetry. Returns the
 * run outcome to the parent ExplorationEngine.
 */
export class ExplorationLoop {
  constructor(private readonly deps: ExplorationLoopDeps) {}

  // Normalized route the static lookahead probe resolved for the current target
  // (null = no static destination) — feeds the dead-interaction oracle.
  private lastProbedRoute: string | null = null;

  // Absolute destination the same probe resolved — compared against the boundary
  // lock so a navigation BugSafari itself cancelled is never read as a dead link.
  private lastProbedHref: string | null = null;

  public async execute(page: Page, maxSteps: number): Promise<LoopResult> {
    const telemetry = this.deps.telemetry;

    // Crash-reason sentinels preserved from the original engine: declared but
    // never assigned here, they keep the historical short-circuit/return shape.
    let serverCrashReason: string | null = null;
    let runtimeCrashReason: string | null = null;

    const ctx: RunContext = {
      structureWindow: 8, // short-term memory span for shell familiarity
      stagnationForceBacktrack: 3, // score at/above which we force a backtrack
      maxRecoveryRounds: 2,
      sabotageCadence: 10,
      hardCap: Math.min(maxSteps * 5, 750), // absolute ceiling — never exceed 750 regardless of caller budget

      extensionSteps: Math.max(10, Math.ceil(maxSteps / 2)),
      coverageStallWindow: 12,
      previousCombined: '',
      recentStructures: [],
      penaltyStepsRemaining: 0,
      recoveryRounds: 0,
      barrenRecoveries: 0,
      sabotageStepCounter: 0,
      budget: maxSteps,
      budgetExtensions: 0,
      emptyCheckUrl: '',
      emptyCheckCount: 0,
      deadEndUrls: new Set<string>(),
      lastStepUrl: '',
      saturatedLogged: new Set<string>(),
      firstVisitRevealed: new Set<string>(),
      freezeReported: new Set<string>(),
    };

    for (let step = 1; ; step++) {
      // Mark idle at the top: while parked here (budget/stop/timebox/pause gates) no
      // step work runs, so a Pause can settle without a straggler emit. Set busy again
      // only once the pause gate lets this iteration proceed to real work below.
      this.deps.setLoopActivity?.(false);

      if (this.checkBudgetGate(step, ctx) === 'break') break;

      if (this.deps.isStopRequested()) {
        return this.stopResult();
      }

      // ─────────────────────────────────────────────────────────────
      // TIMEBOX CHECK - CRITICAL: Must check at each iteration
      // Only terminates when elapsedActiveTimeMs reaches the configured limit AND NOT paused
      // ─────────────────────────────────────────────────────────────
      if (this.deps.checkTimebox()) {
        const reason = `Time limit of ${this.deps.getTimeboxMs() / 60000} min reached.`;
        // The authoritative terminal line is emitted once by StartExplorationUseCase.
        return { completed: false, reason, outcome: 'timebox' };
      }

      const pauseGate = await this.waitWhilePaused();
      if (pauseGate.kind === 'return') return pauseGate.result;

      // Past every gate — this iteration is about to do (emitting) work.
      this.deps.setLoopActivity?.(true);

      try {
        // Universal page-health gate: recover from invalid contexts (about:blank,
        // closed page, failed navigation) and strict-lock drift BEFORE parsing, so
        // exploration can never get trapped on a dead page. May hand back a
        // recreated page; `unrecoverable` ends the run cleanly.
        const health = await this.deps.ensurePageHealth(page);
        if (health.status === 'unrecoverable') {
          telemetry.emitMilestone(' Unrecoverable invalid browser state — ending exploration.');
          return {
            completed: false,
            reason: 'Unrecoverable invalid browser state (about:blank / closed page).',
            outcome: 'graceful-shutdown',
          };
        }
        page = health.page;
        // Recovery navigations create A→B→A URL shapes — suppress the oscillation oracle.
        if (health.status === 'recovered') this.deps.navigationFinder.noteEngineNavigation();

        if (runtimeCrashReason) {
          return { completed: false, reason: runtimeCrashReason, outcome: 'exception' };
        }

        if (serverCrashReason) {
          return { completed: false, reason: serverCrashReason, outcome: 'exception' };
        }

        // Surface lazy-loaded / infinite-scroll / IntersectionObserver content
        // BEFORE parsing, so newly rendered controls are discovered instead of
        // leaving the page with a hidden frontier. Fires when the URL changed since
        // last step AND either we are RETURNING to a seen URL, or this is the FIRST
        // landing on it (revealed once per URL) — so below-fold controls on a fresh
        // long page are found before the engine can navigate away.
        const stepUrl = page.url();
        if (stepUrl !== ctx.lastStepUrl) {
          const routeKey = visitedRouteKey(stepUrl);
          const revisiting = this.deps.visitedUrls.has(routeKey);
          if (revisiting || !ctx.firstVisitRevealed.has(routeKey)) {
            ctx.firstVisitRevealed.add(routeKey);
            boundSet(ctx.firstVisitRevealed, MAX_VISITED_ROUTES);
            await this.revealLazyContent(page);
          }
        }
        ctx.lastStepUrl = stepUrl;

        // Page-saturation short-circuit: if this landing's structural shell is
        // already Fully Explored, skip all parse/score/interaction work, log once,
        // and unwind to the nearest unexplored branch. Suppressed only under the
        // exact lock — there is nowhere to advance to, and skipping interactions
        // would starve the only path (DOM mutation) to any new locked-page state.
        // Sub-tree still has descendant routes to advance to, so it keeps saturation.
        if (this.deps.boundaryScope !== 'exact') {
          // Pre-parse gate: a shell already Fully Explored is skipped before any
          // parse/score/interaction work, so it needs its own (cheap) hash here.
          const preParse = await this.deps.hashManager.hashCompound(page);
          const saturationGate = await this.checkPageSaturation(page, ctx, step, preParse);
          if (saturationGate.kind === 'return') return saturationGate.result;
          if (saturationGate.kind === 'continue') continue;
        }

        const parseResult = await this.parseDomAndScore(page, ctx);
        if (parseResult.kind === 'continue') continue;
        if (parseResult.kind === 'deadend') {
          // No interactive elements after the retry budget — Structural Dead-End.
          // Mark the page skipped and backtrack to the nearest unexplored branch.
          const deadEndGate = await this.handleStructuralDeadEnd(page, ctx, step);
          if (deadEndGate.kind === 'return') return deadEndGate.result;
          continue;
        }
        const { ranked, postParse } = parseResult;

        const fpResult = await this.computeFingerprintAndStagnation(page, step, ctx, ranked, postParse);
        if (fpResult.kind === 'error') {
          // HTTP 4xx/5xx or a detected error template — never a traversable state.
          // Exclude it from the graph/backtracking history and recover to the
          // nearest valid unexplored state.
          const errorGate = await this.handleErrorState(page, ctx, fpResult, step);
          if (errorGate.kind === 'return') return errorGate.result;
          continue;
        }
        const fingerprint = fpResult.fingerprint;

        //  Static WCAG audit of this state (runs once per novel structural shell;
        // fully isolated — an audit failure must never derail exploration).
        await this.auditAccessibility(page, fingerprint.compound.structure);

        const decision = this.decidePathfinderAction(ctx, ranked, fingerprint);

        // Initialize with default to satisfy TypeScript
        let target: InteractiveElement = ranked[0];

        if (decision.kind === 'exhausted') {
          this.noteBarrenUnwind(ctx);
          const exhaustedGate = await this.handleExhaustedDecision(page, ctx, fingerprint.currentUrl, step);
          if (exhaustedGate.kind === 'return') return exhaustedGate.result;
          continue;
        }

        telemetry.emit('ACTION', {
          actionExecuted: 'element-selected',
          selector: target.selector,
          score: Number(target.riskScore.toFixed(4)),
          message: `Selected target: ${target.tagName}${target.id ? '#' + target.id : ''} with score ${target.riskScore.toFixed(4)}`,
        });

        // StateGraphNavigator handles node/edge tracking automatically via registerStateAndDecide

        if (decision.kind === 'backtrack') {
          await this.handleBacktrackDecision(page, decision);
          continue;
        }

        // decision.kind === 'explore-edge'
        const targetResolution = this.resolveExploreEdgeTarget(decision, ranked);
        if (targetResolution.kind === 'return') return targetResolution.result;
        target = targetResolution.target;

        // Session-preservation hard veto: on an authenticated run, never click a
        // session-destroying control (logout, re-login, account delete/switch,
        // password reset, token revoke). Demotion alone lets it fire once the
        // frontier is spent; this blocks the click outright and accounts the edge
        // covered so the frontier still converges. Off for guest/unauth runs.
        if (this.deps.sessionGuardActive && shouldVetoExecution(target)) {
          this.deps.pathNavigator.markEdgeCyclic(fingerprint.currentHash, target.selector);
          this.deps.clusterRegistry.markTriggered(fingerprint.compound.structure, target.selector, step);
          this.deps.telemetry.emitMilestone(
            ` Session preserved: suppressed ${humanizeElement(target)} — a session-destroying control on an authenticated run.`,
          );
          this.deps.telemetry.emit('ACTION', {
            actionExecuted: 'session-control-suppressed',
            selector: target.selector,
            message: `Vetoed ${humanizeElement(target)}: would end/replace the authenticated session.`,
          });
          continue;
        }

        //  Forward lookahead (proactive): skip WITHOUT clicking any edge that
        // can't advance exploration — one resolving to a breadcrumb ancestor
        // (would loop) or one that opens a new tab / dead-end scheme (can't change
        // the app-under-test's main page). Marks it cyclic + accounts it as
        // triggered so it never re-queues or drives the re-seed loop.
        const skip = await this.checkForwardLookaheadCycle(
          page,
          fingerprint.currentHash,
          fingerprint.compound.structure,
          target,
          step,
        );
        if (skip) continue;

        // Execute the action, then VERIFY the traversal before confirming it.
        // The edge stays 'traversing' in the navigator until we observe a new
        // stable DOM state; an unverified/failed click is isolated as unstable
        // and the parent is restored locally (never collapses the graph).
        const { traversalOk, childHash, childStructure, landedInvalid, actionThrew, interacted } = await this.executeAndVerifyAction(
          page,
          ctx,
          step,
          target,
          ranked,
          fingerprint.revisitedPage,
          fingerprint.currentHash,
          decision.score,
        );

        //  Navigation-defect observation BEFORE any parent restore, so the
        // post-action URL still reflects what the interaction actually did.
        this.observeNavigation(page, fingerprint.compound, target, {
          traversalOk,
          landedInvalid,
          actionThrew,
          actuated: interacted,
        });

        //  Finder sweep on the DOM the interaction actually produced — before
        // applyTraversalOutcome, which may restore the parent and destroy it.
        // Skipped when the target was never actually driven: a sweep after a
        // failed/obscured/driver-timed-out actuation would attribute pre-existing
        // or engine-caused faults to a phantom interaction (0 successful
        // interactions = internal testing noise, not a target-app finding).
        if (interacted) {
          await this.runBugFinders(page, step, fingerprint.currentHash, target, ranked);
        } else {
          this.deps.telemetry.emit('ACTION', {
            actionExecuted: 'finder-sweep-skipped-no-interaction',
            selector: target.selector,
            message: `Skipped bug-finder sweep on ${humanizeElement(target)} — the control was not successfully actuated this step (no interaction to attribute a finding to).`,
          });
        }

        await this.applyTraversalOutcome(
          page,
          fingerprint.compound,
          target,
          fingerprint.currentHash,
          fingerprint.currentUrl,
          traversalOk,
          childHash,
          step,
          landedInvalid,
        );

        // Task 3: Observe novelty and fire Perceptron Delta Rule if state is highly novel
        this.applyNoveltyRewardAndTelemetry(
          target,
          traversalOk,
          childStructure,
          landedInvalid,
          decision.score,
          ctx,
          fingerprint.compound.structure,
        );

        await telemetry.emitLiveFrame(page);
        await settle(page);
      } catch (err: unknown) {
        return await this.handleIterationError(err, page, runtimeCrashReason, serverCrashReason);
      }
    }

    return this.buildTerminalSummary(ctx);
  }

  /** Budget boundary: extend while unexplored controls remain AND coverage is still
   *  being gained, else signal loop termination. The coverage-stall guard mirrors
   *  handleExhaustedDecision: controls that stay untriggered only because their sole
   *  shell is saturated/pruned (unreachable) keep hasUnexploredControls() true
   *  forever. Without it the budget extends into a frontier livelock (restore-ladder
   *  → saturated-skip → repeat) until the timebox instead of ending Graph Exhausted. */
  private checkBudgetGate(step: number, ctx: RunContext): 'proceed' | 'break' {
    if (step > ctx.budget) {
      if (
        this.deps.clusterRegistry.hasUnexploredControls() &&
        this.deps.clusterRegistry.stepsSinceCoverageGain(step) < ctx.coverageStallWindow &&
        !this.deps.isTimeboxExceeded() &&
        ctx.budget < ctx.hardCap
      ) {
        ctx.budget = Math.min(ctx.hardCap, ctx.budget + ctx.extensionSteps);
        ctx.budgetExtensions++;
        const remaining = this.deps.clusterRegistry.unexploredControlCount();
        this.deps.telemetry.emitMilestone(
          ` ${remaining} unexplored control(s) remain — extending budget to ${ctx.budget} steps (extension ${ctx.budgetExtensions}).`,
        );
        this.deps.telemetry.emit('ACTION', {
          actionExecuted: 'budget-extended',
          message: `Adaptive budget extended to ${ctx.budget} steps; ${remaining} unexplored controls remain.`,
        });
        return 'proceed';
      }
      return 'break';
    }
    return 'proceed';
  }

  private async waitWhilePaused(): Promise<StepGate> {
    while (this.deps.isPaused()) {
      if (this.deps.isStopRequested()) {
        return { kind: 'return', result: this.stopResult() };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { kind: 'proceed' };
  }

  /**
   * Network Sabotage (NetworkSaboteur): gated by the 'navigation' testing type,
   * so it runs only under profiles that select it (CHAOS + High-Frequency
   * Concurrency Strain) and never leaks into data/async/auth profiles. Fires on a
   * deterministic cadence (every Nth step) so execution stays reproducible.
   *
   * Returns an armed window the caller must disarm AROUND the step's interaction.
   * Arming without an action in flight cannot sabotage anything — the loop is a
   * single await chain, so nothing requests while we wait.
   *
   * The cadence counter now advances per ACTUATED step rather than per loop
   * iteration (it is read from the action path, not the top of the loop), so
   * iterations that parse and skip without interacting no longer consume budget.
   */
  private async armSabotageIfDue(page: Page, ctx: RunContext): Promise<ArmedSabotage | null> {
    if (!this.deps.gate.isEnabled('navigation')) return null;
    ctx.sabotageStepCounter += 1;
    if (ctx.sabotageStepCounter % ctx.sabotageCadence !== 0) return null;

    const armed = await armNetworkSabotage(page, this.deps.telemetry.gateway);
    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'network-sabotage',
      message: ` Network sabotage armed (${armed.mode}) — the next API call this step is intercepted.`,
    });
    return armed;
  }

  /**
   * Revisit-time content discovery: scroll the page to trigger lazy-loaded /
   * infinite-scroll / IntersectionObserver content so controls that render only
   * after scrolling are parsed before we leave a revisited view. Bounded by
   * MAX_REVEAL_SCROLLS so an infinite-scroll feed can't run forever, and stops
   * early once the page stops growing. Non-fatal — a detached/closed page is
   * caught by the per-iteration health gate on the next step.
   */
  private async revealLazyContent(page: Page): Promise<void> {
    const MAX_REVEAL_SCROLLS = 8;
    try {
      // Step one viewport at a time (not straight to the bottom) so virtualized /
      // windowed lists — whose scrollHeight is a fixed spacer and whose rows swap
      // in/out — still surface fresh controls. Stop when a step neither advances the
      // scroll position NOR changes the interactive-control count (progress signal
      // that survives a constant scrollHeight), or the document end is reached.
      let lastSig = -1;
      for (let i = 0; i < MAX_REVEAL_SCROLLS; i++) {
        // Bounded Node-side: a wedged page returns the fallback (stable, atBottom),
        // so the loop ends within two scrolls instead of hanging this iteration.
        const probe = await raceDeadline(
          page.evaluate(() => {
            const before = window.scrollY;
            window.scrollBy(0, window.innerHeight);
            const interactiveCount = document.querySelectorAll(
              'button, input:not([type="hidden"]), textarea, select, a[href], [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])',
            ).length;
            const atBottom =
              window.scrollY === before ||
              window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
            return { interactiveCount, scrollY: window.scrollY, atBottom };
          }),
          SCROLL_EVAL_DEADLINE_MS,
          { interactiveCount: -1, scrollY: -1, atBottom: true },
        );
        await settle(page);
        const sig = probe.interactiveCount * 100000 + probe.scrollY;
        if (probe.atBottom && sig === lastSig) break; // no advance and no new controls — done
        lastSig = sig;
      }
      // Restore the viewport so parsing/coordinate capture starts from the top.
      await raceDeadline(page.evaluate(() => window.scrollTo(0, 0)), SCROLL_EVAL_DEADLINE_MS, undefined as void);
      await settle(page);
      this.deps.telemetry.emitMilestone(' Scrolled to reveal lazy-loaded / off-screen content before re-parsing.');
    } catch {
      // Detached/closed/navigated page — handled by ensurePageHealth next step.
    }
  }

  /**
   * Adaptive content discovery for a spent frontier: scroll the page one viewport
   * at a time, reparsing after each step, until a control not triggered anywhere
   * this run appears (returns the enlarged parse) or the bottom is reached with
   * nothing new (returns null). Bounded by MAX_FRONTIER_SCROLLS so an
   * infinite-scroll feed can't run forever. Non-fatal — a detached/closed page is
   * caught by the per-iteration health gate on the next step.
   */
  private async scrollToRevealNewControls(
    page: Page,
    seen: InteractiveElement[],
    shell: string,
  ): Promise<InteractiveElement[] | null> {
    const seenSelectors = new Set(seen.map((el) => el.selector));
    const triggered = (selector: string): boolean =>
      this.deps.clusterRegistry.isSelectorTriggered(shell, selector);
    try {
      for (let i = 0; i < MAX_FRONTIER_SCROLLS; i++) {
        // Advance one viewport; atBottom when the position no longer moved or the
        // scroll reached the document end.
        const atBottom = await raceDeadline(
          page.evaluate(() => {
            const before = window.scrollY;
            window.scrollBy(0, window.innerHeight);
            return window.scrollY === before || window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
          }),
          SCROLL_EVAL_DEADLINE_MS,
          true, // wedged page → treat as bottom and stop scrolling
        );
        await settle(page);
        const reparsed = await this.deps.parser.parse(page);
        const hasNewUntriggered = reparsed.some(
          (el) => !seenSelectors.has(el.selector) && !triggered(el.selector),
        );
        if (hasNewUntriggered) return reparsed;
        for (const el of reparsed) seenSelectors.add(el.selector);
        if (atBottom) break;
      }
    } catch {
      // Detached/closed/navigated page — handled by ensurePageHealth next step.
    }
    return null;
  }

  /**
   * Session-wide page-saturation gate, evaluated BEFORE the expensive parse/score
   * pass. Keys off the normalized structural shell (compound.structure) — the same
   * identity the coverage registry uses — so a page recognized as Fully Explored is
   * skipped even when input-fuzz / interactive churn keeps minting a fresh combined
   * hash (which the navigator's combined-hash fast-path would miss and re-test).
   * On a saturated shell it logs once, marks the node skipped, and unwinds to the
   * nearest unexplored branch via the shared dead-end path. `proceed` falls through
   * to normal exploration (the cheap extra hash on live pages is negligible beside
   * the parse/reveal/score work it guards).
   */
  private async checkPageSaturation(
    page: Page,
    ctx: RunContext,
    step: number,
    preParse: CompoundStateHash,
  ): Promise<StepGate> {
    const { structure, combined } = preParse;
    const url = page.url();
    // Instance-aware (audit P3-18): a saturated shell still admits a few unseen route
    // instances, so a per-record defect on /products/42 is not skipped unparsed just
    // because /products/1 was fully explored.
    if (!this.deps.clusterRegistry.isSaturatedForRoute(structure, visitedRouteKey(url))) {
      return { kind: 'proceed' };
    }
    if (!ctx.saturatedLogged.has(structure)) {
      ctx.saturatedLogged.add(structure);
      this.deps.telemetry.emitMilestone(
        ` Page fully explored (${url}) — skipping re-parse/re-test; advancing to the nearest unexplored branch.`,
      );
    }
    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'page-saturated-skip',
      url,
      stateHash: combined,
      message: `Structural shell already saturated — page skipped and pruned from the frontier; unwinding to unexplored branch.`,
    });

    // Reuse the shared dead-end unwind: mark this node skipped in the graph and
    // backtrack toward the nearest unexplored frontier (or recover/end if exhausted).
    const decision = this.deps.pathNavigator.markStructuralDeadEnd(combined, url);
    return this.finishDeadEnd(page, ctx, decision, step);
  }

  /**
   * Register a bounded-scan failure as a CLIENT_RENDER_FREEZE finding. `unsettled`
   * means the DOM node count never stopped changing (render loop, endless toast
   * queue, live feed); `timeout` means the scan could not complete at all. Reported
   * once per route so a genuinely frozen page yields one finding, not one per step.
   */
  private async reportClientFreeze(page: Page, health: 'unsettled' | 'timeout', ctx: RunContext): Promise<void> {
    // Intentional teardown (operator stop/cancel, pause, timebox, crash shutdown) aborts the
    // bounded DOM scan mid-flight, so a 'timeout'/'unsettled' scan here is a shutdown artifact,
    // not a target render loop. Mark it an expected interruption and never register a finding.
    if (this.deps.isStopRequested() || this.deps.isPaused()) {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'render-freeze-suppressed-teardown',
        url: page.url(),
        message: `Scan ended ${health} during session termination — expected interruption, not a client render freeze.`,
      });
      return;
    }
    // Driver-timeout corroboration: a 'timeout' scan means page.evaluate stopped
    // answering entirely — which a wedged app main thread AND a broken/overloaded
    // Playwright driver both produce. Require supporting evidence that the app was
    // genuinely reachable this run (at least one successful interaction landed)
    // before blaming the app; otherwise it is an unattributable driver/env wait
    // timeout, reported as a suppressed diagnostic, not a CLIENT_RENDER_FREEZE. The
    // 'unsettled' path is unaffected — a DOM node count that never stops changing is
    // itself app-side evidence.
    if (health === 'timeout' && this.deps.runtimeMetrics.interactionCount === 0) {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'render-freeze-suppressed-uncorroborated',
        url: page.url(),
        message: `Script evaluation timed out at ${safeRoutePath(page)} with no successful interaction yet this run — treating as a driver/environment wait timeout, not a client render freeze.`,
      });
      return;
    }

    const url = page.url();
    const routeKey = visitedRouteKey(url);
    if (ctx.freezeReported.has(routeKey)) return;
    ctx.freezeReported.add(routeKey);
    boundSet(ctx.freezeReported, MAX_VISITED_ROUTES);

    const detail =
      health === 'timeout'
        ? 'the page stopped responding to script evaluation entirely'
        : 'the DOM node count never stopped changing';
    const message = `Client render freeze at ${safeRoutePath(page)} — ${detail}, so the view never reached a stable state.`;

    this.deps.telemetry.emitMilestone(` ${message}`);
    this.deps.registerConfirmedBug({
      bugId: deriveStableBugId('client-render-freeze', [routeKey, health]),
      type: 'EXCEPTION',
      message,
      selector: '',
      payloadUsed: health,
      advice: BUG_CATALOG.CLIENT_RENDER_FREEZE.remediation,
      timestamp: new Date(),
      attribution: {
        bugClass: 'CLIENT_RENDER_FREEZE',
        cwe: BUG_CATALOG.CLIENT_RENDER_FREEZE.cwe,
        scenario: 'Exploratory',
        testingType: 'exploratory',
      },
    });
  }

  private async parseDomAndScore(
    page: Page,
    ctx: RunContext,
  ): Promise<
    | { kind: 'continue' }
    | { kind: 'deadend' }
    | { kind: 'proceed'; ranked: InteractiveElement[]; postParse: CompoundStateHash }
  > {
    //  Per-step scan status — drives the live "thinking" indicator, not the log.
    this.deps.telemetry.emitSystemStatus('Vision Active');

    // Page-context validity + strict-lock confinement are enforced by the
    // per-iteration ensurePageHealth() gate in execute(); here we only wait for
    // interactive content to appear. A route already confirmed a dead end skips
    // the wait entirely — re-paying ensureDomReady's ~5s interactive-selector
    // timeout on a page proven empty is the core recovery-loop time sink.
    const knownDeadEnd = ctx.deadEndUrls.has(visitedRouteKey(page.url()));
    if (!knownDeadEnd) await this.deps.ensureDomReady(page);

    let elements = await this.deps.parser.parse(page);

    // Client-freeze oracle (audit P3-04). The in-page stability wait and the scan
    // itself are now bounded, so a page whose DOM never settles degrades to a
    // partial snapshot instead of parking the run inside page.evaluate. A render
    // loop or wedged view is one of the highest-value defects an exploratory
    // tester can report — surface it rather than absorbing it as engine latency.
    const scanHealth = this.deps.parser.scanHealth();
    if (scanHealth !== 'ok') await this.reportClientFreeze(page, scanHealth, ctx);

    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'dom-elements-parsed',
      message: `Parsed ${elements.length} interactive elements from DOM`,
    });

    if (elements.length === 0) {
      const url = page.url();
      // Known dead-end this session — skip the retry wait, backtrack immediately.
      if (ctx.deadEndUrls.has(visitedRouteKey(url))) return { kind: 'deadend' };
      // Reset the per-page counter when the empty page differs from the last one.
      if (ctx.emptyCheckUrl !== url) {
        ctx.emptyCheckUrl = url;
        ctx.emptyCheckCount = 0;
      }
      ctx.emptyCheckCount += 1;
      // Up to EMPTY_RETRY_LIMIT retries for delayed SPA rendering — wait and retry.
      if (ctx.emptyCheckCount <= EMPTY_RETRY_LIMIT) {
        this.deps.telemetry.emitMilestone(
          ` No interactive elements (check ${ctx.emptyCheckCount}/${EMPTY_RETRY_LIMIT + 1}) — waiting for delayed render...`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        return { kind: 'continue' };
      }
      // Still empty on the third consecutive check — classify as Structural Dead-End.
      this.deps.telemetry.emitMilestone(
        `️ Structural Dead-End: no interactive elements after ${ctx.emptyCheckCount} checks — skipping page and backtracking.`,
      );
      return { kind: 'deadend' };
    }
    // Interactive content present — clear any pending empty-check retry state.
    ctx.emptyCheckUrl = '';
    ctx.emptyCheckCount = 0;

    // Revival: a route previously classified a dead end now renders controls
    // (late/dynamic render, or unlocked by another state). Un-mark it so it is
    // explored again and re-admitted to the navigator's frontier.
    const revivedKey = visitedRouteKey(page.url());
    if (ctx.deadEndUrls.delete(revivedKey)) {
      this.deps.pathNavigator.clearRouteDeadEnd(revivedKey);
      this.deps.telemetry.emitMilestone(
        ` Dead-end route now renders content — re-admitting ${page.url()} to exploration.`,
      );
    }

    // Shell identity for every coverage/penalty lookup below. Measured HERE, after
    // the parse (which can itself mutate the page via hover-reveal), because this
    // is the exact hash that markTriggered/observe will write to further down the
    // step — reading a differently-timed hash silently queries an empty cluster,
    // so nothing ever reads as triggered and the coverage bias stops working.
    const postParse = await this.deps.hashManager.hashCompound(page);
    const shell = postParse.structure;
    const triggered = (selector: string): boolean =>
      this.deps.clusterRegistry.isSelectorTriggered(shell, selector);

    // Frontier-exhaustion reveal: when every on-screen control has already been
    // triggered on this shell, the visible frontier is spent. Before leaving
    // the page, adaptively scroll — reparsing after each step — to surface lazy /
    // off-screen controls. New untriggered controls replace the parse and get
    // scored/interacted this step; reaching the bottom with nothing new means the
    // page is fully explored and the normal flow backtracks to an unexplored branch.
    if (elements.every((el) => triggered(el.selector))) {
      const revealed = await this.scrollToRevealNewControls(page, elements, shell);
      if (revealed) {
        this.deps.telemetry.emitMilestone(' Frontier spent — adaptive scroll revealed new off-screen controls.');
        elements = revealed;
      } else {
        this.deps.telemetry.emitMilestone(
          ' Page fully explored (frontier spent, nothing new on scroll) — backtracking to nearest unexplored branch.',
        );
      }
    }

    // Bind penalties and payload-escalation levels to this shell so a control is
    // only deprioritized (and a field only escalated) where it actually behaved
    // that way — not everywhere its selector string happens to repeat.
    this.deps.scorer.setScope(shell);
    this.deps.escalationTracker.setScope(shell);

    // Fade accumulated penalties one step before ranking so transient stagnation/
    // no-op nudges recover over time instead of permanently suppressing controls.
    this.deps.scorer.decayPenalties();

    // Look-Ahead Edge Suppression: floor any control whose navigation destination
    // is already saturated (fully explored) so ranking never surfaces a wasted
    // revisit. The navigator gates selection too — this keeps the ranked/target
    // list honest for the dashboard and global-frontier scoring.
    const suppressed = new Set<string>();
    for (const el of elements) {
      if (this.deps.pathNavigator.isNavDestinationSaturated(el.selector)) suppressed.add(el.selector);
    }
    this.deps.scorer.setSuppressedSelectors(suppressed);

    let ranked = this.deps.scorer.score(elements);

    // Coverage bias: demote every control already triggered ON THIS SHELL by a
    // large fixed margin so untested controls win best-first across page reloads.
    // Non-decaying (recomputed from the registry each pass) — unlike
    // scorer penalties, which fade — so a tested element stays deprioritized instead
    // of recovering its rank and being re-selected. Demoted, not removed: still
    // selectable once the frontier is fully spent, and the pathfinder still explores
    // any unvisited edge from this node regardless of the demoted score.
    // Graded by WHERE it was triggered: hard demotion on this shell, soft demotion
    // for a namesake proven on another shell, none for a control never touched.
    ranked = ranked
      .map((element) => {
        const margin = triggered(element.selector)
          ? TRIGGERED_SELECTOR_DEMOTION
          : this.deps.clusterRegistry.isSelectorTriggeredAnywhere(element.selector)
            ? CROSS_SHELL_TRIGGERED_DEMOTION
            : 0;
        return margin > 0 ? { ...element, riskScore: element.riskScore - margin } : element;
      })
      .sort((left, right) => right.riskScore - left.riskScore);

    // Session preservation: on an authenticated run, sink logout/sign-out controls
    // beneath everything else so the engine explores the authenticated surface
    // instead of ending its own session within the first few steps.
    if (this.deps.sessionGuardActive) {
      ranked = ranked
        .map((element) =>
          isSessionDestroyingControl(element)
            ? { ...element, riskScore: element.riskScore - SESSION_EXIT_DEMOTION }
            : element,
        )
        .sort((left, right) => right.riskScore - left.riskScore);
    }

    // Premature-navigation guard: while any untriggered NON-navigational control
    // remains on this view, demote every untriggered route-changing anchor below
    // them so in-page interactions (inputs, buttons, dropdowns, toggles) are
    // exhausted before the engine follows a link off the page. Demotion, not
    // removal — a link still wins once the in-page frontier is spent.
    const isNavEdge = (el: InteractiveElement): boolean =>
      el.tagName.toLowerCase() === 'a' && !!el.href && !NON_NAV_HREF_RE.test(el.href);
    const hasUntriggeredInPageControl = ranked.some(
      (el) => !isNavEdge(el) && !triggered(el.selector),
    );
    if (hasUntriggeredInPageControl) {
      ranked = ranked
        .map((element) =>
          isNavEdge(element) && !triggered(element.selector)
            ? { ...element, riskScore: element.riskScore - NAV_EDGE_DEMOTION }
            : element,
        )
        .sort((left, right) => right.riskScore - left.riskScore);
    }

    // Deep Semantic Data Attack prioritization: when data-fuzzing is active,
    // fuzzable attack vectors must be selected BEFORE any navigation
    // control, otherwise high-keyword buttons (login=82, checkout, pay…) win the
    // best-first pick and the engine clicks submit on an empty form — inputs are
    // never fuzzed. A fixed additive boost can't beat an arbitrary keyword sum, so
    // we lift every UNTRIGGERED attack vector to a deterministic margin ABOVE the
    // highest other score this step. Coverage-first: once a field has been fuzzed
    // (triggered on its structural cluster) it loses the boost and falls back to
    // its natural score, so the next untriggered input → submit button →
    // register/recovery link wins instead of the engine re-fuzzing the same field
    // forever (each payload mutates the input value → a fresh graph node → the boost
    // would otherwise re-lift it). Gated — the scorer/perceptron stay
    // profile-agnostic; only data-attack runs shift.
    if (this.deps.gate.isEnabled('dataFuzzing')) {
      const isFreshAttackVector = (element: InteractiveElement): boolean =>
        attackTargetBoost(element) > 0 &&
        !triggered(element.selector) &&
        // A form at its session fuzz cap loses the boost so unexplored controls win.
        !this.deps.formFuzz.isExhausted(element.formKey ?? '', this.deps.formFuzzCap);
      const otherScores = ranked.filter((el) => !isFreshAttackVector(el)).map((el) => el.riskScore);
      const maxOther = otherScores.length > 0 ? Math.max(...otherScores) : 0;
      ranked = ranked
        .map((element) =>
          isFreshAttackVector(element)
            ? { ...element, riskScore: maxOther + ATTACK_TARGET_SCORE_BOOST }
            : element,
        )
        .sort((left, right) => right.riskScore - left.riskScore);
    }

    // UI-layer awareness: when an overlay/modal/dropdown is open, exhaust its
    // interior controls before the background page and postpone its close/dismiss
    // control; otherwise nudge untriggered layer-opening controls so hidden layers
    // get discovered. Coverage-driven: once interior controls are triggered they
    // lose the boost, so the dismiss/background naturally wins and the layer closes.
    const layerActive = ranked.some((el) => el.inActiveLayer);
    {
      const isFreshLayerControl = (el: InteractiveElement): boolean =>
        !!el.inActiveLayer &&
        !el.isDismiss &&
        !triggered(el.selector);
      const baseline = ranked.filter((el) => !isFreshLayerControl(el)).map((el) => el.riskScore);
      const maxOther = baseline.length > 0 ? Math.max(...baseline) : 0;
      ranked = ranked
        .map((el) => {
          if (layerActive) {
            if (isFreshLayerControl(el)) return { ...el, riskScore: maxOther + LAYER_INTERIOR_SCORE_BOOST };
            if (el.isDismiss) return { ...el, riskScore: el.riskScore - LAYER_DISMISS_DEMOTION };
            return el;
          }
          const untriggeredTrigger =
            !!el.opensLayer && !triggered(el.selector);
          return untriggeredTrigger ? { ...el, riskScore: el.riskScore + LAYER_TRIGGER_SCORE_BOOST } : el;
        })
        .sort((left, right) => right.riskScore - left.riskScore);
    }

    this.deps.telemetry.gateway.emitTargets(
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

    return { kind: 'proceed', ranked, postParse };
  }

  private async computeFingerprintAndStagnation(
    page: Page,
    step: number,
    ctx: RunContext,
    ranked: InteractiveElement[],
    postParse: CompoundStateHash,
  ): Promise<FingerprintResult> {
    // Task 3: Emit granular status for dynamic UI - "Hashing DOM state..."
    this.deps.telemetry.emitSystemStatus('Hashing DOM state...');

    // --- Compound structural fingerprint ---
    // structure = layout shell, interactive = control surface + state,
    // combined = canonical node identity. combined is strictly finer-grained
    // than the old structure-only key, so states that differ only by a toggled
    // control are no longer conflated.
    //
    // Taken by parseDomAndScore at the end of the parse and reused verbatim: the
    // shell that scoping READ from must be the shell that markTriggered/observe
    // WRITE to, or the coverage bias silently queries a cluster that was never
    // populated. Nothing mutates the page between there and here.
    const compound = postParse;
    const currentHash = compound.combined;
    const currentUrl = page.url();

    // --- Error-state detection (URL-aware), evaluated FIRST ---
    // structure is the DOM-only shell; routePath is the normalized route; httpStatus
    // is the observed main-frame document status (null for pure client renders). A
    // status ≥400 or an identical error template re-rendered at a new route means
    // this page is a non-traversable error state.
    const mainFrameStatus = this.deps.getMainFrameStatus(compound.routePath);
    const routeVerdict = this.deps.routeExhaustion.observe({
      structureHash: compound.structure,
      routePath: compound.routePath,
      httpStatus: mainFrameStatus,
    });

    // Error states must NEVER enter the exploration graph, coverage clusters, the
    // visited-state sets, or the backtracking history. Return before any of that
    // folding so the caller can treat the page as a structural dead end.
    if (routeVerdict.isErrorState) {
      return { kind: 'error', compound, mainFrameStatus, routeVerdict };
    }

    // Client-rendered error view (audit P3-17). A client route change issues no
    // document request, so mainFrameStatus is null for nearly every SPA state and
    // the HTTP signal above effectively never fires after the first load. Judge the
    // RENDERED view instead, so a "Not found" served under HTTP 200 is excluded from
    // the graph and reported, rather than explored and counted as coverage.
    if (mainFrameStatus === null) {
      const clientError = await detectClientErrorView(page);
      if (clientError.isErrorView) {
        this.deps.telemetry.emit('ACTION', {
          actionExecuted: 'client-error-view-detected',
          url: currentUrl,
          stateHash: currentHash,
          message: `Client-rendered error view at ${currentUrl} (${clientError.signal}) — excluded from the graph despite HTTP 200.`,
        });
        return { kind: 'error', compound, mainFrameStatus, routeVerdict };
      }
    }

    // --- Clustered state-space observation (valid states only) ---
    // Fold this state into its structural cluster (keyed by the normalized
    // structure sub-hash) BEFORE stagnation scoring, so coverage-gain markers
    // reflect controls discovered on this step.
    this.deps.clusterRegistry.observe(
      compound.structure,
      // Route-normalized, matching the key isSaturatedForRoute reads — and keeping
      // the cluster's instance set from fragmenting on cache-busters/pagination.
      visitedRouteKey(currentUrl),
      ranked.map((el) => el.selector),
      step,
    );

    // --- Adaptive stagnation scoring (coverage-blended) ---
    // Score BEFORE recording this structure so familiarity reflects prior steps.
    const stepsSinceCoverageGain = this.deps.clusterRegistry.stepsSinceCoverageGain(step);
    const coverageStagnant = stepsSinceCoverageGain >= ctx.coverageStallWindow;
    const stagnation = computeStagnation({
      currentHash,
      previousCombined: ctx.previousCombined,
      recentStructures: ctx.recentStructures,
      structure: compound.structure,
      structureWindow: ctx.structureWindow,
      coverageStagnant,
      // Depth past the stall window escalates the escape response on sustained stalls.
      coverageStallSteps: stepsSinceCoverageGain - ctx.coverageStallWindow,
    });
    ctx.recentStructures = stagnation.nextRecentStructures;
    ctx.previousCombined = stagnation.nextPreviousCombined;

    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'dom-state-hash',
      stateHash: currentHash,
      message: `DOM fingerprint captured. stagnationScore=${stagnation.stagnationScore} (shell x${stagnation.structureFamiliarity}${stagnation.combinedRepeated ? ', exact-repeat' : ''})`,
    });

    // Route-normalized so query-volatile SPAs can't defeat the URL half of the
    // revisit check (or report thousands of near-duplicate "visited routes").
    const currentRouteKey = visitedRouteKey(currentUrl);
    const revisitedPage = this.deps.visitedUrls.has(currentRouteKey) || this.deps.visitedHashes.has(currentHash);
    this.deps.visitedUrls.add(currentRouteKey);
    this.deps.visitedHashes.add(currentHash);
    // Record the structural shell so the structure-gated novelty reward can tell a
    // genuinely new region from the same page reloaded (distinct shells stay few).
    this.deps.visitedStructures.add(compound.structure);
    // Bound memory: evict the oldest entries (insertion-ordered Sets).
    boundSet(this.deps.visitedHashes, MAX_VISITED_HASHES);
    boundSet(this.deps.visitedUrls, MAX_VISITED_ROUTES);
    boundSet(this.deps.visitedStructures, MAX_VISITED_STRUCTURES);

    // Tick down any active escape window each step.
    if (ctx.penaltyStepsRemaining > 0) {
      ctx.penaltyStepsRemaining--;
    }

    // Progressive penalty: light nudge as the shell first recurs, escalating to a
    // full branch penalty on exact/persistent repeats. intensity ∈ (0,1] scales
    // both the per-element penalty and the escape-window length.
    if (stagnation.stagnationScore >= 2 && ctx.penaltyStepsRemaining === 0) {
      const intensity = computePenaltyIntensity(stagnation.stagnationScore, ctx.stagnationForceBacktrack);
      this.deps.telemetry.emitMilestone(
        ` Stagnation detected (score=${stagnation.stagnationScore}). Applying graduated penalty (${Math.round(intensity * 100)}%) to force deeper exploration.`,
      );
      for (const element of ranked) {
        this.deps.scorer.penalize(element.selector, (Math.abs(element.riskScore) + 1) * intensity);
      }
      // Longer escape window the deeper the stagnation, capped so it always recovers.
      ctx.penaltyStepsRemaining = computePenaltyWindow(stagnation.stagnationScore);
    }

    return {
      kind: 'ok',
      fingerprint: {
        compound,
        currentHash,
        currentUrl,
        revisitedPage,
        stagnationScore: stagnation.stagnationScore,
        // Unambiguously stuck: the EXACT same state came back AND no new coverage
        // has been reached for the whole stall window. Deliberately not a threshold
        // on stagnationScore — shell familiarity alone saturates that score on any
        // legitimately single-shell SPA, which would force-abandon live frontier.
        hardStagnation: stagnation.combinedRepeated && coverageStagnant,
      },
    };
  }

  /**
   * Run the static WCAG auditor against the current DOM and surface any NEW
   * violations. Findings are ephemeral, WebSocket-only events streamed on the
   * dedicated accessibility channel — never persisted or put in any Errors ledger.
   * Once the run has surfaced ACCESSIBILITY_BANNER_THRESHOLD distinct violations the
   * dashboard shows one aggregate warning banner, so auditing halts here to avoid
   * further per-view DOM scans. Isolated: a scan failure is logged and swallowed.
   */
  private async auditAccessibility(page: Page, structureHash: string): Promise<void> {
    // Banner already earned — stop scanning for the rest of the session.
    if (this.deps.accessibilityAuditor.totalFound() >= ACCESSIBILITY_BANNER_THRESHOLD) return;
    try {
      const violations = await this.deps.accessibilityAuditor.audit(page, structureHash);
      for (const v of violations) {
        this.deps.telemetry.emitAccessibility({
          timestamp: new Date().toISOString(),
          rule: v.rule,
          wcag: v.wcag,
          impact: v.impact,
          selector: v.selector,
          elementName: v.elementName,
          description: v.description,
          suggestedFix: v.suggestedFix,
        });
      }
    } catch (a11yErr) {
      obsLog.warn(
        '[ExplorationLoop] Accessibility audit failed:',
        a11yErr instanceof Error ? a11yErr.message : String(a11yErr),
      );
    }
  }

  /**
   * True when the Strict Page Boundary Lock — not the application — is what stopped
   * this control from navigating. Under the lock, only a destination sharing the
   * locked confinement key can commit; every other target is aborted pre-commit or
   * cancelled in the client sandbox, and a control with no statically resolvable
   * destination (router.push et al.) is cancelled invisibly. In all those cases the
   * absence of a route change carries no evidence about the app.
   */
  private navigationBlockedByLock(): boolean {
    if (this.deps.boundaryScope === 'site') return false;
    if (!this.lastProbedHref) return true;
    // Blocked iff the probed destination isn't allowed under the active scope,
    // referenced against the run's launch URL (exact pin or sub-tree prefix).
    return !StrictUrlLockGuard.isAllowed(
      this.lastProbedHref,
      this.deps.getTargetUrl(),
      this.deps.boundaryScope,
      this.deps.authOrigins,
    );
  }

  /** Feed the post-action outcome to the navigation-defect oracle (never derails the loop). */
  private observeNavigation(
    page: Page,
    compound: CompoundStateHash,
    target: InteractiveElement,
    outcome: { traversalOk: boolean; landedInvalid: boolean; actionThrew: boolean; actuated: boolean },
  ): void {
    try {
      const url = page.isClosed() ? '' : page.url();
      const defects = this.deps.navigationFinder.observeInteraction({
        selector: target.selector,
        elementLabel: resolveElementLabel(target),
        elementKind: elementNoun(target.tagName, target.type),
        fromStructure: compound.structure,
        fromRoute: compound.routePath,
        toRoute: normalizeRoutePath(url),
        probedRoute: this.lastProbedRoute,
        semanticRole: inferSemanticRole(target),
        traversalOk: outcome.traversalOk,
        landedInvalid: outcome.landedInvalid,
        actionThrew: outcome.actionThrew,
        actuated: outcome.actuated,
        networkActivity: this.deps.hadNetworkActivitySinceAction(),
        navigationBlocked: this.navigationBlockedByLock(),
        url,
        timestampMs: Date.now(),
      });
      this.deps.reportNavigationDefects(defects);
    } catch (navErr) {
      obsLog.warn(
        '[ExplorationLoop] Navigation observation failed:',
        navErr instanceof Error ? navErr.message : String(navErr),
      );
    }
  }

  /** Post-action bug-finder sweep (never derails the loop). */
  private async runBugFinders(
    page: Page,
    step: number,
    stateHash: string,
    target: InteractiveElement,
    ranked: readonly InteractiveElement[],
  ): Promise<void> {
    try {
      await this.deps.bugFinderRunner.sweep({
        page,
        targetUrl: this.deps.getTargetOrigin(),
        step,
        stateHash,
        // Always false: an operator-requested stop is not a crash, and finders treat
        // crashHalted as evidence of a catastrophic failure.
        crashHalted: false,
        element: target,
        // Page-mutating finders drive these instead of re-querying the DOM, so they
        // inherit the session-guard veto and overlay filtering the loop applied.
        rankedTargets: ranked,
      });
    } catch (finderErr) {
      obsLog.warn(
        '[ExplorationLoop] Bug-finder sweep failed:',
        finderErr instanceof Error ? finderErr.message : String(finderErr),
      );
    }
  }

  private decidePathfinderAction(
    ctx: RunContext,
    ranked: InteractiveElement[],
    fingerprint: StepFingerprint,
  ): PathfinderDecision {
    // Convert ranked elements to PathfinderElement format for StateGraphNavigator.
    // elementType and boundingBox feed the diversity penalty and tie-breaker sort.
    const pathfinderElements: PathfinderElement[] = ranked.map((el) => ({
      selector: el.selector,
      score: el.riskScore,
      elementType: el.tagName,
      boundingBox: el.boundingBox,
    }));

    // Soft pressure is deferrable in coverage-first modes; the hard ceiling is not,
    // so the graduated stagnation apparatus still governs the backtrack decision.
    const forcedBacktrack =
      ctx.penaltyStepsRemaining > 0 || fingerprint.stagnationScore >= ctx.stagnationForceBacktrack;

    // Only valid, traversable states reach here — error states are excluded
    // upstream (handleErrorState) before ever being registered as a graph node.
    return this.deps.pathNavigator.registerStateAndDecide(
      fingerprint.currentHash,
      fingerprint.currentUrl,
      pathfinderElements,
      forcedBacktrack,
      fingerprint.hardStagnation,
    );
  }

  /**
   * Operator-configured limits that make the traversable graph a strict SUBSET of
   * the application. When any is active, running out of frontier means the
   * configured boundary is saturated — never that the app was fully explored.
   */
  private boundaryConstraints(): string[] {
    const limits: string[] = [];
    if (this.deps.boundaryScope === 'exact') {
      limits.push('strict URL lock — exploration pinned to the launch URL');
    } else if (this.deps.boundaryScope === 'subtree') {
      limits.push('sub-tree lock — exploration pinned to the launch route and its child pages');
    }
    const active = this.deps.gate.activeCategories();
    if (active.length < ALL_TESTING_TYPE_IDS.length) {
      // A partial profile withholds interaction classes (fuzz/bypass/etc.), so states
      // reachable only through them were never actuated.
      limits.push(`partial infiltration profile — only ${active.join(', ')} active`);
    }
    // Node-budget exhaustion is a scope limit too: past the cap, evicted states are
    // re-admitted as tombstones and never re-explored, so "graph exhausted" would
    // otherwise claim full coverage the run never achieved (audit P3-06).
    const cap = this.deps.pathNavigator.graphCapStatus();
    if (cap.reached) {
      limits.push(
        `state-graph node cap reached (${cap.maxNodes} nodes; ${cap.evictions} evicted and not re-explored)`,
      );
    }
    return limits;
  }

  /**
   * Terminal completion after adaptive recovery finds no frontier: boundary
   * saturation when the run was scope-limited, true graph exhaustion otherwise.
   */
  private completionResult(): RunResult {
    const limits = this.boundaryConstraints();
    if (limits.length === 0) {
      const reason = 'Graph Exhausted — full reachable application graph explored (post-recovery).';
      this.deps.telemetry.emit('ACTION', { actionExecuted: 'graph-exhausted', message: reason });
      return { completed: true, reason, outcome: 'completed' };
    }

    const reason =
      `Boundary Saturation Reached — configured scope fully explored (${limits.join('; ')}). ` +
      'The application graph beyond the boundary was not explored.';
    this.deps.telemetry.emit('ACTION', { actionExecuted: 'boundary-saturation', message: reason });
    return { completed: true, reason, outcome: 'boundary-saturated' };
  }

  /**
   * Count one barren dead-end/recovery unwind since the last novel state. Every
   * coverageStallWindow consecutive barren unwinds escalates the navigator's
   * adaptive escape (novelty-first frontier + region cooldown), so a run that
   * stops gaining coverage CHANGES how it explores instead of re-selecting the
   * same dead attractor. Reset in applyNoveltyRewardAndTelemetry on any novel state.
   */
  private noteBarrenUnwind(ctx: RunContext): void {
    ctx.barrenRecoveries += 1;
    if (ctx.barrenRecoveries % ctx.coverageStallWindow === 0) {
      this.deps.pathNavigator.enterEscapeMode();
      this.deps.telemetry.emitMilestone(
        ` Stagnation escape (level ${ctx.barrenRecoveries / ctx.coverageStallWindow}) — diversifying frontier strategy toward unexplored regions.`,
      );
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'stagnation-escape',
        message: `No new coverage across ${ctx.barrenRecoveries} recovery unwinds — switching the global frontier to novelty-first selection.`,
      });
    }
  }

  private async handleExhaustedDecision(page: Page, ctx: RunContext, currentUrl: string, step: number): Promise<StepGate> {
    // Adaptive recovery before accepting termination: re-evaluate soft-blocked
    // edges (unstable/branch/sweep — never true cycles), reset the boredom
    // floor, and re-seed if needed. Only terminate after MAX_RECOVERY_ROUNDS
    // consecutive rounds (since the last novel state) yield no new frontier.
    if (ctx.recoveryRounds >= ctx.maxRecoveryRounds) {
      // Coverage guard against false exhaustion: grant one more recovery round
      // only when clusters still hold untriggered controls AND coverage is still
      // being gained (a new control discovered/triggered within the stall window).
      // Without the stall check, unreachable untriggered controls (external links,
      // blocked/invalid-context edges) would re-seed to the identical DOM up to
      // HARD_CAP with zero progress. Bounded by timebox + HARD_CAP.
      const coverageRemains =
        this.deps.clusterRegistry.hasUnexploredControls() &&
        this.deps.clusterRegistry.stepsSinceCoverageGain(step) < ctx.coverageStallWindow &&
        ctx.budget < ctx.hardCap &&
        !this.deps.isTimeboxExceeded();
      if (coverageRemains) {
        ctx.budget = Math.min(ctx.hardCap, ctx.budget + ctx.extensionSteps);
        ctx.recoveryRounds = ctx.maxRecoveryRounds - 1; // allow another round
        this.deps.telemetry.emitMilestone(
          ` Graph reported exhausted but ${this.deps.clusterRegistry.unexploredControlCount()} control(s) untriggered — extending budget to ${ctx.budget} and recovering.`,
        );
      } else {
        return { kind: 'return', result: this.completionResult() };
      }
    }

    ctx.recoveryRounds++;
    const recovery = this.deps.pathNavigator.recoverFromExhaustion();
    this.deps.telemetry.emitMilestone(
      `️ ${describeRecovery(recovery.requeuedEdges)} (round ${ctx.recoveryRounds}/${ctx.maxRecoveryRounds}).`,
    );
    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'adaptive-recovery',
      message: describeRecovery(recovery.requeuedEdges),
    });
    // Adaptive recovery is BugSafari-internal bookkeeping, not a target-facing
    // action — it is surfaced as ACTION telemetry above but deliberately kept OUT
    // of the reproduction playbook so it never appears in a finding's repro steps.

    if (recovery.requeuedEdges === 0) {
      // Nothing soft-blocked left to re-queue — re-seed from the origin once
      // to surface states the run may have drifted away from.
      const origin = this.deps.getTargetOrigin();
      if (this.deps.boundaryScope !== 'site') {
        // Under exact/sub-tree the origin re-seed leaves the boundary (the origin is
        // a parent of the launch route) and competes with the boundary-lock restore
        // for the page — the lock is the sole page-transition authority, so skip it.
        this.deps.telemetry.emitMilestone(' Boundary lock: skipping origin re-seed (lock owns navigation).');
      } else {
        this.deps.telemetry.emitMilestone(`️ Re-seeding exploration from origin: ${origin}`);
        await this.deps.stateRestorer.restoreToState(page, '', origin);
        await settle(page);
      }
    }
    return { kind: 'continue' };
  }

  /**
   * A page confirmed to have no interactive elements after the delayed-render
   * retries. Records it as a session dead-end, marks the graph node skipped, and
   * bypasses normal action selection to backtrack to the nearest unexplored branch
   * (via history/deep-link restoration) — or ends the run if the graph is exhausted.
   */
  private async handleStructuralDeadEnd(page: Page, ctx: RunContext, step: number): Promise<StepGate> {
    const url = page.url();
    const key = visitedRouteKey(url);
    ctx.deadEndUrls.add(key);
    // Feed the route to the navigator so the frontier scan never re-targets it.
    this.deps.pathNavigator.markRouteDeadEnd(key);
    this.noteBarrenUnwind(ctx);
    ctx.emptyCheckUrl = '';
    ctx.emptyCheckCount = 0;

    // Fingerprint the empty state so the navigator marks THIS node skipped.
    const compound = await this.deps.hashManager.hashCompound(page);
    const decision = this.deps.pathNavigator.markStructuralDeadEnd(compound.combined, url);

    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'structural-dead-end',
      url,
      stateHash: compound.combined,
      message: `Structural dead-end at ${url} — page skipped; ${
        decision.kind === 'backtrack' ? 'backtracking to unexplored branch' : 'graph exhausted'
      }.`,
    });

    return this.finishDeadEnd(page, ctx, decision, step);
  }

  /**
   * A page whose main-frame returned HTTP 4xx/5xx, or whose DOM is a re-rendered
   * error template (route-collapse). It is NOT a traversable application state:
   * it is kept out of the exploration graph, coverage clusters, visited-state
   * sets, and the backtracking history. Logged for telemetry, marked a structural
   * dead end in the navigator (its hash can never become a valid, backtrackable
   * node), then the run recovers to the nearest valid unexplored ancestor.
   */
  private async handleErrorState(
    page: Page,
    ctx: RunContext,
    result: Extract<FingerprintResult, { kind: 'error' }>,
    step: number,
  ): Promise<StepGate> {
    const url = page.url();
    const key = visitedRouteKey(url);
    ctx.deadEndUrls.add(key);
    // Feed the route to the navigator so the frontier scan never re-targets it.
    this.deps.pathNavigator.markRouteDeadEnd(key);
    this.noteBarrenUnwind(ctx);
    ctx.emptyCheckUrl = '';
    ctx.emptyCheckCount = 0;

    const { compound, mainFrameStatus, routeVerdict } = result;
    if (mainFrameStatus !== null) {
      this.deps.telemetry.emit('NETWORK', {
        statusCode: mainFrameStatus,
        url,
        method: 'GET',
        message: ` Error state excluded (HTTP ${mainFrameStatus}) at ${url} — not registered as a graph state.`,
      });
    }
    this.deps.telemetry.emitMilestone(
      ` Error/invalid page excluded from graph (${routeVerdict.reason}) — treating as a dead end and recovering to the nearest unexplored state.`,
    );

    //  Broken-route oracle: raise a navigation defect when this hard HTTP error
    // state was reached via a user-style interaction (never via engine recovery).
    this.deps.reportNavigationDefects(
      this.deps.navigationFinder.observeErrorState({
        route: compound.routePath,
        url,
        statusCode: mainFrameStatus,
        reason: routeVerdict.reason,
        timestampMs: Date.now(),
      }),
    );

    // Mark the error hash a structural dead end: registered only as an inert,
    // edge-less skipped tombstone (never a traversable node) and immediately
    // unwound off the breadcrumb stack, so it can never be backtracked into.
    const decision = this.deps.pathNavigator.markStructuralDeadEnd(compound.combined, url);
    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'error-state-excluded',
      url,
      stateHash: compound.combined,
      message: `Error state (${routeVerdict.reason}) excluded from graph and backtracking history; ${
        decision.kind === 'backtrack' ? 'recovering to nearest unexplored state' : 'frontier spent — evaluating completion'
      }.`,
    });

    return this.finishDeadEnd(page, ctx, decision, step);
  }

  /**
   * Shared unwind for any state removed from the graph as a dead end (structural
   * or error): drive the navigator's decision — backtrack to the nearest valid
   * unexplored ancestor, or run adaptive recovery when the graph is exhausted.
   */
  private async finishDeadEnd(
    page: Page,
    ctx: RunContext,
    decision: PathfinderDecision,
    step: number,
  ): Promise<StepGate> {
    if (decision.kind === 'exhausted') {
      return this.handleExhaustedDecision(page, ctx, page.url(), step);
    }
    if (decision.kind === 'backtrack') {
      await this.handleBacktrackDecision(page, decision);
    }
    return { kind: 'continue' };
  }

  private async handleBacktrackDecision(page: Page, decision: BacktrackDecision): Promise<void> {
    // Under the exact lock, backtracking through the recovery ladder (history.back
    // / deep-link goto / reload) would issue a page transition that races the
    // boundary-lock restore. Skip it — the lock keeps us on the single permitted
    // URL and the next parse re-reads the live DOM regardless. Sub-tree is
    // multi-page: backtracking among in-boundary descendants is how it advances, so
    // it is allowed (any out-of-boundary jump is still aborted by the guard).
    if (this.deps.boundaryScope === 'exact') {
      this.deps.telemetry.emitMilestone(' Strict URL Lock: backtrack navigation suppressed (boundary lock owns navigation).');
      return;
    }

    // Engine-initiated navigation ahead — suppress navigation-defect false positives.
    this.deps.navigationFinder.noteEngineNavigation();

    // Forensic log of the global frontier selection: priority breakdown + plan,
    // so every jump is attributable and reproducible from telemetry alone.
    if (decision.frontier) {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'frontier-selected',
        selector: decision.frontier.selector,
        score: Number(decision.frontier.priority.toFixed(3)),
        stateHash: decision.targetHash,
        message:
          ` Frontier target ${decision.targetHash.substring(0, 8)} — priority ${decision.frontier.priority.toFixed(2)} ` +
          `(risk ${decision.frontier.edgeScore.toFixed(2)} + novelty ${decision.frontier.noveltyBonus.toFixed(2)}); ` +
          `${decision.path?.length ? `${decision.path.length}-step BFS path` : 'no explored route — restore ladder'}.`,
      });
    }

    this.deps.telemetry.emitMilestone(`️ Backtracking to ${decision.targetUrl}`);
    this.deps.telemetry.emitSystemStatus(`Backtracking to ${decision.targetHash.substring(0, 8)}...`);

    // Preferred: replay the BFS-planned action sequence — deterministic,
    // SPA-state-preserving navigation to the frontier target.
    if (decision.path?.length) {
      if (await this.deps.stateRestorer.replayPath(page, decision.path)) {
        await settle(page);
        return;
      }
      // Replan: the graph route went stale (element detached / app state
      // changed) — log it and fall back to the restore ladder.
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'path-replanned',
        stateHash: decision.targetHash,
        message: `️ BFS path replay to ${decision.targetHash.substring(0, 8)} failed en route — replanning via restore ladder.`,
      });
    }

    // Fallback: SPA-friendly recovery ladder (history → deep-link → hard reload)
    // instead of a blind hard goto that would wipe client state.
    await this.deps.stateRestorer.restoreToState(page, decision.targetHash, decision.targetUrl);
    await settle(page);
  }

  private resolveExploreEdgeTarget(
    decision: ExploreEdgeDecision,
    ranked: InteractiveElement[],
  ): { kind: 'return'; result: LoopResult } | { kind: 'proceed'; target: InteractiveElement } {
    const foundTarget = ranked.find((el) => el.selector === decision.selector);
    const target = foundTarget ?? ranked[0];

    if (!target) {
      return { kind: 'return', result: { completed: true, reason: 'No ranked target found.', outcome: 'completed' } };
    }

    return { kind: 'proceed', target };
  }

  private async checkForwardLookaheadCycle(
    page: Page,
    currentHash: string,
    structureHash: string,
    target: InteractiveElement,
    step: number,
  ): Promise<boolean> {
    this.lastProbedRoute = null;
    this.lastProbedHref = null;
    // Session-wide transition-repeat cap: this exact control has already driven
    // its structural shell back to already-seen views `budget` times — a
    // navigation-loop source the combined-hash edge model can't see (each variant
    // reads as a fresh unvisited edge). Block it session-wide and account it
    // covered so the engine advances to unexplored routes instead of re-following it.
    if (this.deps.edgeRepeat.isExhausted(structureHash, target.selector, this.deps.transitionRepeatBudget)) {
      this.deps.pathNavigator.markEdgeCyclic(currentHash, target.selector);
      this.deps.clusterRegistry.markTriggered(structureHash, target.selector, step);
      // Reset the learning bias toward this deadlocked control: contrastive
      // perceptron nudge + persistent per-selector penalty so the model stops
      // steering back into the loop and the frontier redirects to unexplored branches.
      this.deps.scorer.penalizeRevisit(target);
      this.deps.scorer.penalize(target.selector, Math.abs(target.riskScore) + 1);
      const human = humanizeElement(target);
      this.deps.telemetry.emitMilestone(
        ` Transition budget reached: ${human} repeatedly returns to seen views (limit ${this.deps.transitionRepeatBudget}). Deprioritizing session-wide and choosing an unexplored route.`,
      );
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'transition-budget-exhausted',
        selector: target.selector,
        message: `${human} exceeded the transition-repeat budget on this structural shell; blocked session-wide.`,
      });
      return true;
    }

    const probe = await this.deps.stateRestorer.probeStaticTarget(page, target.selector);
    this.lastProbedHref = probe.href && !probe.deadEnd ? probe.href : null;
    this.lastProbedRoute = this.lastProbedHref ? normalizeRoutePath(this.lastProbedHref) || null : null;

    // Breadcrumb-ancestor cycle: clicking would drop straight back into a loop.
    // Route-normalize both sides — the rest of the engine keys cycles on the
    // normalized route (query dropped), so a raw-href match missed an ancestor
    // reached with a different ?page=/cache-buster and re-traversed the loop.
    const probedRoute = probe.href ? normalizeRoutePath(probe.href) : null;
    if (
      probedRoute &&
      this.deps.pathNavigator.ancestorUrls().some((u) => u && normalizeRoutePath(u) === probedRoute)
    ) {
      this.deps.pathNavigator.markEdgeCyclic(currentHash, target.selector);
      // Actuated-and-resolved: a cyclic control leads nowhere new — count it covered
      // so it stops inflating hasUnexploredControls() and driving endless re-seeds.
      this.deps.clusterRegistry.markTriggered(structureHash, target.selector, step);
      this.deps.telemetry.emitMilestone(
        ` Cyclic-loop avoided: ${humanizeElement(target)} leads back to a breadcrumb ancestor (${probe.href}). Choosing another pathway.`,
      );
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'cyclic-loop-detected',
        selector: target.selector,
        message: `Forward lookahead skipped ${humanizeElement(target)}: resolves to ancestor ${probe.href}.`,
      });
      return true;
    }

    // Off-site / new-tab / dead-end control: leaves the app under test (an
    // off-origin href), opens a separate tab (target="_blank"), or is a
    // non-navigational scheme (mailto/tel/javascript). Following it wastes the
    // whole budget wandering external sites (github/x.com credit links, etc.) —
    // the main app's state never advances. Permanently block it AND account it as
    // triggered so it neither re-queues nor inflates the untriggered count that
    // drives endless re-seeding, keeping exploration on the target origin.
    const offSite = probe.href !== null && this.leavesTargetOrigin(probe.href);

    // Same-origin target="_blank": drive the tab in a bounded sub-session instead of
    // blocking it forever, then record the same self-loop outcome below — from this
    // page's point of view the click changed nothing, so the graph is unaffected.
    if (!offSite && probe.newTab && !probe.deadEnd && this.deps.tabs.canExploreSecondary()) {
      if (await this.deps.tabs.exploreViaControl(page, target.selector)) {
        this.deps.pathNavigator.markEdgeCyclic(currentHash, target.selector);
        this.deps.clusterRegistry.markTriggered(structureHash, target.selector, step);
        this.deps.telemetry.emit('ACTION', {
          actionExecuted: 'secondary-tab-explored',
          selector: target.selector,
          message: `Explored the tab opened by ${humanizeElement(target)} and returned to the app under test.`,
        });
        return true;
      }
    }

    if (offSite || probe.newTab || probe.deadEnd) {
      this.deps.pathNavigator.markEdgeCyclic(currentHash, target.selector);
      this.deps.clusterRegistry.markTriggered(structureHash, target.selector, step);
      const reason = offSite
        ? 'leaves the site under test'
        : probe.newTab
          ? 'opens a new tab'
          : 'non-navigational link';
      this.deps.telemetry.emitMilestone(
        ` Skipping ${humanizeElement(target)} (${reason}) — keeping exploration on the app under test.`,
      );
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'off-site-control-skipped',
        selector: target.selector,
        message: `Forward lookahead skipped ${humanizeElement(target)}: ${reason}${probe.href ? ` (${probe.href})` : ''}.`,
      });
      return true;
    }

    return false;
  }

  /**
   * True when `href` leaves the target site (a different host that is not a
   * subdomain of the target). Subdomain links stay in scope and are followed.
   * Best-effort pre-click skip — unparseable hrefs fall through here and are
   * caught by the always-on boundary guard / post-click off-site demotion.
   */
  private leavesTargetOrigin(href: string): boolean {
    return !isWithinTargetSite(href, this.deps.getTargetOrigin());
  }

  private async executeAndVerifyAction(
    page: Page,
    ctx: RunContext,
    step: number,
    target: InteractiveElement,
    ranked: InteractiveElement[],
    revisitedPage: boolean,
    currentHash: string,
    exploreScore: number,
  ): Promise<{ traversalOk: boolean; childHash: string; childStructure: string; landedInvalid: boolean; actionThrew: boolean; interacted: boolean }> {
    // Emit exploration milestone
    const humanTarget = humanizeElement(target);
    this.deps.telemetry.emitMilestone(` Exploring ${humanTarget} (score: ${exploreScore.toFixed(3)})`);
    this.deps.telemetry.emitSystemStatus(`Clicking ${humanTarget}...`);

    this.deps.actionExecutor.logHighImpact(target);

    let traversalOk = false;
    let childHash = currentHash;
    let childStructure = '';
    let actionThrew = false;
    // Whether the target was ACTUALLY driven (click actuated / value delivered).
    // An unresolved click or rejected value is 0 successful interactions — a
    // BugSafari/driver miss, never evidence about the app under test.
    let interacted = false;
    // Armed across the action AND its verification, so the intercepted request is
    // one this interaction actually caused and a delayed response can still land.
    const armed = await this.armSabotageIfDue(page, ctx);
    try {
      // Attribute async signals (network xhr/fetch, detected faults) fired
      // during/after this action to the acting element for compound rewards.
      this.deps.noteActedTarget(target);
      const actionResult = await this.deps.actionExecutor.executeWeightedAction(page, target, ranked, revisitedPage);
      interacted = actionResult.interacted;
      const verification = await this.deps.stateRestorer.verifyTraversal(page, currentHash, 3000);
      traversalOk = verification.ok;
      childHash = verification.childHash;
      childStructure = verification.childStructure;
    } catch (actionErr) {
      // Operator-initiated stop must still propagate to the graceful handler.
      if (isBrowserClosedError(actionErr)) throw actionErr;
      // Detached element / intercepting overlay / click error → unstable edge.
      traversalOk = false;
      actionThrew = true;
      obsLog.warn(
        '[ExplorationLoop] Traversal action failed:',
        actionErr instanceof Error ? actionErr.message : String(actionErr),
      );
    } finally {
      if (armed) {
        await armed.disarm();
        // Report whether the window actually caught anything. A step that issues
        // no API call is a legitimate miss, not a failure — but it has to be
        // distinguishable from a sabotage that landed.
        const hit = armed.wasSabotaged();
        this.deps.telemetry.emit('ACTION', {
          actionExecuted: hit ? 'network-sabotage-hit' : 'network-sabotage-idle',
          message: hit
            ? ` Network sabotage (${armed.mode}) intercepted a live API call during this step.`
            : ` Network sabotage (${armed.mode}) disarmed — this step issued no API call to intercept.`,
        });
      }
    }

    // A click that drove the main page into an invalid context (about:blank /
    // chrome-error / closed) OR off the target site (a third-party host) is NOT a
    // real state transition — verifyTraversal otherwise sees the foreign
    // fingerprint as a novel state and rewards it, training the engine to leave
    // the app under test. Demote it to a failed, non-novel traversal so the caller
    // isolates and permanently blocks the edge (the boundary guard already aborted
    // the load; this keeps the edge from being rewarded or retried).
    const leftSite =
      !page.isClosed() && !isWithinTargetSite(page.url(), this.deps.getTargetOrigin());
    const landedInvalid =
      (!page.isClosed() && PageHealthGuard.isInvalidContext(page)) || leftSite;
    if (landedInvalid) {
      traversalOk = false;
      childHash = currentHash;
      this.deps.telemetry.emitMilestone(
        leftSite
          ? ` ${humanTarget} tried to leave the app under test (${page.url()}) — blocking edge.`
          : ` ${humanTarget} navigated to an invalid context (${page.url()}) — blocking edge.`,
      );
    }

    // Phase 3: Track interaction count — only a SUCCESSFUL interaction counts, so
    // the metric reflects real interactions with the app, not failed attempts.
    if (interacted) this.deps.runtimeMetrics.interactionCount++;

    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'action-executed',
      selector: target.selector,
      message: `Step ${step}: Action executed on ${humanTarget}`,
    });

    await this.deps.persistBrainSnapshot('runtime', step);

    return { traversalOk, childHash, childStructure, landedInvalid, actionThrew, interacted };
  }

  private async applyTraversalOutcome(
    page: Page,
    compound: CompoundStateHash,
    target: InteractiveElement,
    previousHashBeforeAction: string,
    currentUrl: string,
    traversalOk: boolean,
    childHash: string,
    step: number,
    landedInvalid = false,
  ): Promise<void> {
    if (traversalOk) {
      // Verified transition — record the REAL child hash (fixes the prior
      // bug that passed the pre-action hash as the child).
      this.deps.pathNavigator.confirmEdgeTraversal(previousHashBeforeAction, target.selector, childHash);

      // Mark this control triggered on its structural cluster so coverage
      // metrics and adaptive-budget decisions reflect real exploration.
      this.deps.clusterRegistry.markTriggered(compound.structure, target.selector, step);

      // Look-Ahead follow-up: the click landed on an already-saturated destination
      // — a wasted transition. Fire the strong contrastive perceptron update so the
      // model steers away; the destination is now recorded so future repeats of
      // this nav selector are suppressed pre-click.
      if (this.deps.pathNavigator.isStateSaturated(childHash)) {
        this.deps.scorer.penalizeSaturatedTransition(target);
        this.deps.telemetry.emit('ACTION', {
          actionExecuted: 'saturated-destination-penalized',
          selector: target.selector,
          stateHash: childHash,
          message: `Transition via ${humanizeElement(target)} landed on saturated state ${childHash.substring(0, 8)} — strong negative weight update; edge suppressed for future repeats.`,
        });
      }

      //  Forward lookahead (reactive): the click landed on a state that
      // is already an ancestor on our breadcrumb path — a genuine backward
      // loop the static probe couldn't predict (JS-driven navigation).
      // Permanently mark the edge cyclic so it's never retried. syncStack
      // will re-anchor the breadcrumb to the ancestor on the next step.
      if (this.deps.pathNavigator.isAncestorHash(childHash)) {
        this.deps.pathNavigator.markEdgeCyclic(previousHashBeforeAction, target.selector);
        this.deps.telemetry.emitMilestone(
          ` Cyclic-loop detected: ${humanizeElement(target)} returned to ancestor ${childHash.substring(0, 8)}. Edge blocked.`,
        );
        this.deps.telemetry.emit('ACTION', {
          actionExecuted: 'cyclic-loop-detected',
          selector: target.selector,
          stateHash: childHash,
          message: `Reactive lookahead: ${humanizeElement(target)} looped back to ancestor ${childHash.substring(0, 8)}.`,
        });
      }
    } else {
      // Unverified — isolate this single branch. An edge that drove the page into
      // an invalid context (about:blank) is permanently blocked (cyclic) so it's
      // never re-selected; ordinary unstable edges are only isolated so they may
      // be retried later. Normally we restore the parent locally; under the
      // boundary lock that restore is a competing navigation, so we only mark the
      // edge and defer any URL correction to the boundary-lock restore next step.
      if (landedInvalid) {
        this.deps.pathNavigator.markEdgeCyclic(previousHashBeforeAction, target.selector);
        // Account for this control in the coverage layer too — it WAS actuated,
        // it just leads nowhere. Otherwise it stays "discovered but untriggered"
        // forever and drives the exhaustion guard to re-seed to the hard cap.
        this.deps.clusterRegistry.markTriggered(compound.structure, target.selector, step);
      } else {
        this.deps.pathNavigator.markEdgeUnstable(previousHashBeforeAction, target.selector);
        // No-op action — the click produced no new state (same DOM signature).
        // Persistently deprioritise this exact control across all future rankings
        // so the engine advances to other controls instead of re-attempting it.
        this.deps.scorer.penalize(target.selector, Math.abs(target.riskScore) + 1);
        // Actuated-and-resolved: unstable/no-op controls yield no new state — count
        // them covered so they stop inflating hasUnexploredControls() and driving
        // endless recovery re-seeds back through the origin pages.
        this.deps.clusterRegistry.markTriggered(compound.structure, target.selector, step);
      }
      if (this.deps.boundaryScope === 'exact') {
        this.deps.telemetry.emitMilestone(' Strict URL Lock: unstable edge isolated; parent restore deferred to boundary lock.');
      } else {
        // Restore targets currentUrl (the in-boundary page we are on), so it is safe
        // under sub-tree and site alike — no out-of-boundary transition is issued.
        this.deps.telemetry.emitMilestone(` Edge unstable — restoring parent locally (no false exhaustion).`);
        this.deps.navigationFinder.noteEngineNavigation();
        await this.deps.stateRestorer.restoreToState(page, previousHashBeforeAction, currentUrl);
      }
    }
  }

  private applyNoveltyRewardAndTelemetry(
    target: InteractiveElement,
    traversalOk: boolean,
    childStructure: string,
    landedInvalid: boolean,
    decisionScore: number,
    ctx: RunContext,
    fromStructure: string,
  ): void {
    // Reward only a verified traversal that reached a structurally NEW shell.
    // Gating on the structure sub-hash (not the volatile combined hash) prevents
    // the false-novelty loop where re-clicking a control that merely reloads the
    // same ad-heavy/crashing page reads as an endless stream of novel states.
    const isNovelState = isNovelStructuralState({
      traversalOk,
      landedInvalid,
      childStructure,
      visitedStructures: this.deps.visitedStructures,
    });

    if (isNovelState) {
      // Genuine progress — refresh the adaptive-recovery budget and leave the
      // barren-stagnation escape (novelty-first frontier reverts to score-first).
      ctx.recoveryRounds = 0;
      ctx.barrenRecoveries = 0;
      this.deps.pathNavigator.noteProgress();
      // Productive transition — clear this control's accumulated loop repeats so a
      // sometimes-useful control (e.g. pagination) is never permanently blocked.
      this.deps.edgeRepeat.recordProductive(fromStructure, target.selector);
      // Novel state discovered — compound reward for a genuine structural change.
      this.deps.scorer.applyCompoundReward(target, { structuralChange: true });

      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'novelty-reward-triggered',
        selector: target.selector,
        message: `Novel state discovered (visitCount: 1). Fired Perceptron Delta Rule to reward weights for ${humanizeElement(target)}.`,
      });
    } else {
      // Unproductive action — it returned to an already-seen state. Beyond the
      // perceptron contrastive nudge, apply a significant, persistent per-selector
      // penalty (subtracted from this control's score on EVERY future ranking,
      // across all nodes) so the exact action that reproduced a seen signature is
      // hard-deprioritised and the same sequence cannot re-execute.
      // Count it toward the session-wide transition-repeat budget ONLY when it was
      // a real navigation back to a seen structure — failed/invalid traversals are
      // isolated elsewhere and must not inflate the loop cap.
      if (traversalOk && !landedInvalid) {
        this.deps.edgeRepeat.recordRepeat(fromStructure, target.selector);
      }
      // Distinguish a dead/no-op control (structure literally unchanged) from a
      // genuine revisit to a different already-seen state: the former is a milder
      // contrastive signal so a truly inert control isn't over-penalised like a loop.
      if (childStructure === fromStructure) {
        this.deps.scorer.penalizeNoOp(target);
      } else {
        this.deps.scorer.applyCompoundReward(target, { revisit: true });
      }
      this.deps.scorer.penalize(target.selector, Math.abs(target.riskScore) + 1);
      const visitCount = this.deps.visitedHashes.size;
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'state-revisited',
        selector: target.selector,
        message: `State revisited (visitCount: ${visitCount}). Applied Perceptron revisit penalty + priority penalty for ${humanizeElement(target)}.`,
      });
    }

    // Emit curiosity-driven selection telemetry
    const boredomThreshold = this.deps.pathNavigator.getBoredomThreshold();
    const curiosityDriven = decisionScore >= boredomThreshold;

    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'curiosity-decision',
      selector: target.selector,
      score: decisionScore,
      message: `Curiosity-driven: ${curiosityDriven ? 'EXPLORE' : 'BACKTRACK'} (topScore=${decisionScore.toFixed(2)}, boredomThreshold=${boredomThreshold})`,
    });

    const mlConfidence = this.deps.scorer.getConfidence(target.featureVector);
    this.deps.telemetry.emit('HEURISTIC_SCORE', {
      selector: target.selector,
      score: Number(target.riskScore.toFixed(4)),
      message: `Target scored ${target.riskScore.toFixed(4)} (ML confidence ${(mlConfidence * 100).toFixed(1)}%) and executed.`,
    });
  }

  // Terminal result for a requested stop, attributed to whoever requested it.
  // An unattributed stop can only be an internal shutdown, never operator intent.
  private stopResult(): LoopResult {
    const trigger = this.deps.getStopReason() ?? 'internal-shutdown';
    const outcome = STOP_REASON_OUTCOME[trigger];
    const reason = STOP_REASON_DETAIL[trigger];
    // No termination milestone here — StartExplorationUseCase emits the single
    // authoritative terminal line (engine-stopped) so it is never duplicated.
    return { completed: false, reason, outcome };
  }

  private async handleIterationError(
    err: unknown,
    page: Page,
    runtimeCrashReason: string | null,
    serverCrashReason: string | null,
  ): Promise<LoopResult> {
    // A Playwright lifecycle exception (closed page/context/browser, execution
    // context destroyed, in-flight goto/evaluate against a dying page) is only
    // expected when something actually asked the engine to stop — the teardown that
    // follows stop() closes the browser out from under the in-flight action. It is a
    // harness artifact, never a target-app defect, so settle on the stop outcome and
    // emit NO EXCEPTION, forensic record, or risk entry — log for debugging only.
    // With no stop recorded, the browser died on its own: a genuine fault that must
    // still be reported as an exception below.
    if (this.deps.isStopRequested() && isEngineLifecycleError(err)) {
      const sanitized = sanitizeException(err instanceof Error ? err : String(err));
      obsLog.debug(`[ExplorationLoop] Suppressed expected engine lifecycle exception during shutdown: ${sanitized.message}`);
      return this.stopResult();
    }

    // Phase 3: Track failure count on exception
    this.deps.runtimeMetrics.failureCount++;

    // Emergency Data Flush: flush the active scenario's deliberate steps
    // (falling back to the rolling action log) and emit EXCEPTION telemetry.
    const reproductionSteps = ActiveScenarioTracker.flushPlaybook();
    const sanitized = sanitizeException(err instanceof Error ? err : String(err));

    this.deps.telemetry.emit('EXCEPTION', {
      message: `Engine exception: ${sanitized.message}`,
      exceptionDetails: {
        message: sanitized.message,
        stackTrace: sanitized.stackTrace,
      },
      reproductionSteps,
      url: this.deps.getLastKnownUrl() || page.url(),
    });
    this.deps.setFreeze();
    await this.deps.persistBrainSnapshot('crash');

    // Do not remove existing crash reason logic; prefer already-known reasons.
    return {
      completed: false,
      reason: runtimeCrashReason ?? serverCrashReason ?? `Engine exception: ${sanitized.message}`,
      outcome: 'exception',
    };
  }

  private buildTerminalSummary(ctx: RunContext): LoopResult {
    const cov = this.deps.clusterRegistry.snapshot();
    const saturated = this.deps.clusterRegistry.saturatedClusterCount();
    this.deps.telemetry.emitMilestone(
      `Exploration Complete: ${ctx.budget} steps (${ctx.budgetExtensions} extension${ctx.budgetExtensions === 1 ? '' : 's'}), ` +
        `${cov.clusters} clusters (${saturated} fully explored), coverage ${(cov.coverage * 100).toFixed(0)}% ` +
        `(${cov.triggered}/${cov.discovered} controls).`,
    );
    return {
      completed: true,
      reason:
        cov.unexploredControls === 0
          ? 'Exploration budget reached — cluster coverage saturated.'
          : 'Exploration budget reached (hard cap or timebox).',
      outcome: 'completed',
    };
  }
}
