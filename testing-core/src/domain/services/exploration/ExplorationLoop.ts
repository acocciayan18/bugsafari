import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { CompoundStateHash } from '../../../ml/domHasher.js';
import type {
  PathfinderElement,
  PathfinderDecision,
  ExploreEdgeDecision,
  BacktrackDecision,
} from '../DIrectedPathFinder.js';
import { networkSaboteur } from '../../scenarios/index.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import { describeRecovery, humanizeElement } from '../forensics/narration.js';
import { isBrowserClosedError, sanitizeException } from '../telemetry/StabilityMonitor.js';
import { inferSemanticRole, settle } from './types.js';
import { attackTargetBoost, ATTACK_TARGET_SCORE_BOOST } from './interactionScope.js';
import type { ExplorationLoopDeps, RunResult } from './types.js';
import { computeStagnation, computePenaltyIntensity, computePenaltyWindow } from './stagnationScoring.js';
import { isNovelStructuralState } from './noveltyScoring.js';
import { PageHealthGuard } from './PageHealthGuard.js';
import type { RouteExhaustionVerdict } from './RouteExhaustionTracker.js';

// Upper bound on the per-run visited-hash Set so long runs can't grow memory without limit.
const MAX_VISITED_HASHES = 5000;

// Empty-DOM tolerance: allow this many retries (waiting for delayed SPA render)
// before declaring a page a Structural Dead-End on the next consecutive empty check.
const EMPTY_RETRY_LIMIT = 2;

// Session-wide coverage bias: fixed margin subtracted from any control already
// triggered ANYWHERE this run, so untested controls win best-first across page
// reloads. Large enough to sink below any untriggered element's natural score;
// applied as a demotion (not removal) so a tested control is still selectable as
// a last resort once the whole frontier is spent.
const TRIGGERED_SELECTOR_DEMOTION = 1000;

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

type LoopResult = RunResult;
type StepGate = { kind: 'proceed' } | { kind: 'continue' } | { kind: 'return'; result: LoopResult };

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
  sabotageStepCounter: number;
  budget: number;
  budgetExtensions: number;
  // Empty-DOM retry state (per-page): the URL currently under empty-check and its
  // consecutive empty-snapshot count. Reset when a non-empty page or a new URL is seen.
  emptyCheckUrl: string;
  emptyCheckCount: number;
  // URLs already classified as Structural Dead-Ends this run — revisits skip the
  // retry wait and backtrack immediately (prevents re-stalling on a known empty page).
  deadEndUrls: Set<string>;
  // URL at the start of the previous iteration — lets the loop reveal lazy content
  // only when we genuinely RETURN to a seen URL, not while parked on one.
  lastStepUrl: string;
  // Structural shells already announced as Fully Explored — bounds the saturation
  // skip milestone to once per page instead of once per redundant landing.
  saturatedLogged: Set<string>;
}

/** Per-step DOM/graph fingerprint computed once per iteration for a VALID state. */
interface StepFingerprint {
  compound: CompoundStateHash;
  currentHash: string;
  currentUrl: string;
  revisitedPage: boolean;
  stagnationScore: number;
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
      hardCap: maxSteps * 5,
      extensionSteps: Math.max(10, Math.ceil(maxSteps / 2)),
      coverageStallWindow: 12,
      previousCombined: '',
      recentStructures: [],
      penaltyStepsRemaining: 0,
      recoveryRounds: 0,
      sabotageStepCounter: 0,
      budget: maxSteps,
      budgetExtensions: 0,
      emptyCheckUrl: '',
      emptyCheckCount: 0,
      deadEndUrls: new Set<string>(),
      lastStepUrl: '',
      saturatedLogged: new Set<string>(),
    };

    for (let step = 1; ; step++) {
      if (this.checkBudgetGate(step, ctx) === 'break') break;

      if (this.deps.isStopRequested()) {
        telemetry.emitMilestone(`Safari session manually stopped by user.`);
        return { completed: false, reason: 'Safari session manually stopped by user.', outcome: 'user-stopped' };
      }

      // ─────────────────────────────────────────────────────────────
      // TIMEBOX CHECK - CRITICAL: Must check at each iteration
      // Only terminates when elapsedActiveTimeMs reaches the configured limit AND NOT paused
      // ─────────────────────────────────────────────────────────────
      if (this.deps.checkTimebox()) {
        return {
          completed: false,
          reason: `Timebox of ${this.deps.getTimeboxMs()}ms (${this.deps.getTimeboxMs() / 60000}min) exceeded - active execution time only`,
          outcome: 'timebox',
        };
      }

      const pauseGate = await this.waitWhilePaused();
      if (pauseGate.kind === 'return') return pauseGate.result;

      try {
        // Universal page-health gate: recover from invalid contexts (about:blank,
        // closed page, failed navigation) and strict-lock drift BEFORE parsing, so
        // exploration can never get trapped on a dead page. May hand back a
        // recreated page; `unrecoverable` ends the run cleanly.
        const health = await this.deps.ensurePageHealth(page);
        if (health.status === 'unrecoverable') {
          telemetry.emitMilestone('🛑 Unrecoverable invalid browser state — ending exploration.');
          return {
            completed: false,
            reason: 'Unrecoverable invalid browser state (about:blank / closed page).',
            outcome: 'graceful-shutdown',
          };
        }
        page = health.page;

        if (runtimeCrashReason) {
          return { completed: false, reason: runtimeCrashReason, outcome: 'exception' };
        }

        if (serverCrashReason) {
          return { completed: false, reason: serverCrashReason, outcome: 'exception' };
        }

        await this.maybeSabotageNetwork(page, ctx);

        // On genuinely RETURNING to a seen URL (not while parked on one), surface
        // lazy-loaded / infinite-scroll / IntersectionObserver content BEFORE
        // parsing so newly rendered controls are discovered instead of leaving the
        // page with a hidden frontier.
        const stepUrl = page.url();
        if (stepUrl !== ctx.lastStepUrl && this.deps.visitedUrls.has(stepUrl)) {
          await this.revealLazyContent(page);
        }
        ctx.lastStepUrl = stepUrl;

        // Page-saturation short-circuit: if this landing's structural shell is
        // already Fully Explored, skip all parse/score/interaction work, log once,
        // and unwind to the nearest unexplored branch. Suppressed under the strict
        // URL lock — there is nowhere to advance to, and skipping interactions
        // would starve the only path (DOM mutation) to any new locked-page state.
        if (!this.deps.strictUrlLock) {
          const saturationGate = await this.checkPageSaturation(page, ctx, step);
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
        const { ranked } = parseResult;

        const fpResult = await this.computeFingerprintAndStagnation(page, step, ctx, ranked);
        if (fpResult.kind === 'error') {
          // HTTP 4xx/5xx or a detected error template — never a traversable state.
          // Exclude it from the graph/backtracking history and recover to the
          // nearest valid unexplored state.
          const errorGate = await this.handleErrorState(page, ctx, fpResult, step);
          if (errorGate.kind === 'return') return errorGate.result;
          continue;
        }
        const fingerprint = fpResult.fingerprint;

        // ♿ Static WCAG audit of this state (runs once per novel structural shell;
        // fully isolated — an audit failure must never derail exploration).
        await this.auditAccessibility(page, fingerprint.compound.structure, step);

        const decision = this.decidePathfinderAction(ctx, ranked, fingerprint);

        // Initialize with default to satisfy TypeScript
        let target: InteractiveElement = ranked[0];

        if (decision.kind === 'exhausted') {
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

        // 🔮 Forward lookahead (proactive): skip WITHOUT clicking any edge that
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
        const { traversalOk, childHash, childStructure, landedInvalid } = await this.executeAndVerifyAction(
          page,
          step,
          target,
          ranked,
          fingerprint.revisitedPage,
          fingerprint.currentHash,
          decision.score,
        );

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

  /** Budget boundary: extend while unexplored controls remain, else signal loop termination. */
  private checkBudgetGate(step: number, ctx: RunContext): 'proceed' | 'break' {
    if (step > ctx.budget) {
      if (
        this.deps.clusterRegistry.hasUnexploredControls() &&
        !this.deps.checkTimebox() &&
        ctx.budget < ctx.hardCap
      ) {
        ctx.budget = Math.min(ctx.hardCap, ctx.budget + ctx.extensionSteps);
        ctx.budgetExtensions++;
        const remaining = this.deps.clusterRegistry.unexploredControlCount();
        this.deps.telemetry.emitMilestone(
          `🔎 ${remaining} unexplored control(s) remain — extending budget to ${ctx.budget} steps (extension ${ctx.budgetExtensions}).`,
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
        this.deps.telemetry.emitMilestone(`Safari session manually stopped by user.`);
        return {
          kind: 'return',
          result: { completed: false, reason: 'Safari session manually stopped by user.', outcome: 'user-stopped' },
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { kind: 'proceed' };
  }

  private async maybeSabotageNetwork(page: Page, ctx: RunContext): Promise<void> {
    // 📡 Network Sabotage: always-on background monitor, independent of the
    // selected infiltration profile. Fires on a deterministic cadence (every
    // Nth step) so execution stays reproducible across runs.
    ctx.sabotageStepCounter += 1;
    const sabotageThisStep = ctx.sabotageStepCounter % ctx.sabotageCadence === 0;
    if (sabotageThisStep) {
      this.deps.telemetry.emitMilestone('📡 Chaos Mode: Sabotaging network requests for this step...');
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'network-sabotage',
        message: '📡 Chaos Mode: Sabotaging network requests for this step...',
      });
      // Execute the network sabotage - note: this remains active for subsequent interactions
      await networkSaboteur.execute(page);
    }
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
    const MAX_REVEAL_SCROLLS = 4;
    try {
      let lastHeight = 0;
      for (let i = 0; i < MAX_REVEAL_SCROLLS; i++) {
        const height = await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
          return document.body.scrollHeight;
        });
        await settle(page);
        if (height === lastHeight) break; // page stopped growing — nothing new to reveal
        lastHeight = height;
      }
      // Restore the viewport so parsing/coordinate capture starts from the top.
      await page.evaluate(() => window.scrollTo(0, 0));
      await settle(page);
      this.deps.telemetry.emitMilestone('🔄 Revisit: scrolled to reveal lazy-loaded content before re-parsing.');
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
  ): Promise<InteractiveElement[] | null> {
    const seenSelectors = new Set(seen.map((el) => el.selector));
    try {
      for (let i = 0; i < MAX_FRONTIER_SCROLLS; i++) {
        // Advance one viewport; atBottom when the position no longer moved or the
        // scroll reached the document end.
        const atBottom = await page.evaluate(() => {
          const before = window.scrollY;
          window.scrollBy(0, window.innerHeight);
          return window.scrollY === before || window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
        });
        await settle(page);
        const reparsed = await this.deps.parser.parse(page);
        const hasNewUntriggered = reparsed.some(
          (el) => !seenSelectors.has(el.selector) && !this.deps.clusterRegistry.isSelectorTriggeredAnywhere(el.selector),
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
  private async checkPageSaturation(page: Page, ctx: RunContext, step: number): Promise<StepGate> {
    const { structure, combined } = await this.deps.hashManager.hashCompound(page);
    if (!this.deps.clusterRegistry.isSaturated(structure)) return { kind: 'proceed' };

    const url = page.url();
    if (!ctx.saturatedLogged.has(structure)) {
      ctx.saturatedLogged.add(structure);
      this.deps.telemetry.emitMilestone(
        `🧭 Page fully explored (${url}) — skipping re-parse/re-test; advancing to the nearest unexplored branch.`,
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

  private async parseDomAndScore(
    page: Page,
    ctx: RunContext,
  ): Promise<{ kind: 'continue' } | { kind: 'deadend' } | { kind: 'proceed'; ranked: InteractiveElement[] }> {
    // 🧠 Prioritization (milestone comes right after parse/scoring)
    this.deps.telemetry.emitMilestone('👁️ Vision Active');

    // Page-context validity + strict-lock confinement are enforced by the
    // per-iteration ensurePageHealth() gate in execute(); here we only wait for
    // interactive content to appear.
    await this.deps.ensureDomReady(page);

    let elements = await this.deps.parser.parse(page);

    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'dom-elements-parsed',
      message: `Parsed ${elements.length} interactive elements from DOM`,
    });

    if (elements.length === 0) {
      const url = page.url();
      // Known dead-end this session — skip the retry wait, backtrack immediately.
      if (ctx.deadEndUrls.has(url)) return { kind: 'deadend' };
      // Reset the per-page counter when the empty page differs from the last one.
      if (ctx.emptyCheckUrl !== url) {
        ctx.emptyCheckUrl = url;
        ctx.emptyCheckCount = 0;
      }
      ctx.emptyCheckCount += 1;
      // Up to EMPTY_RETRY_LIMIT retries for delayed SPA rendering — wait and retry.
      if (ctx.emptyCheckCount <= EMPTY_RETRY_LIMIT) {
        this.deps.telemetry.emitMilestone(
          `⏳ No interactive elements (check ${ctx.emptyCheckCount}/${EMPTY_RETRY_LIMIT + 1}) — waiting for delayed render...`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        return { kind: 'continue' };
      }
      // Still empty on the third consecutive check — classify as Structural Dead-End.
      this.deps.telemetry.emitMilestone(
        `🕳️ Structural Dead-End: no interactive elements after ${ctx.emptyCheckCount} checks — skipping page and backtracking.`,
      );
      return { kind: 'deadend' };
    }
    // Interactive content present — clear any pending empty-check retry state.
    ctx.emptyCheckUrl = '';
    ctx.emptyCheckCount = 0;

    // Frontier-exhaustion reveal: when every on-screen control has already been
    // triggered somewhere this run, the visible frontier is spent. Before leaving
    // the page, adaptively scroll — reparsing after each step — to surface lazy /
    // off-screen controls. New untriggered controls replace the parse and get
    // scored/interacted this step; reaching the bottom with nothing new means the
    // page is fully explored and the normal flow backtracks to an unexplored branch.
    if (elements.every((el) => this.deps.clusterRegistry.isSelectorTriggeredAnywhere(el.selector))) {
      const revealed = await this.scrollToRevealNewControls(page, elements);
      if (revealed) {
        this.deps.telemetry.emitMilestone('🔻 Frontier spent — adaptive scroll revealed new off-screen controls.');
        elements = revealed;
      } else {
        this.deps.telemetry.emitMilestone(
          '🔚 Page fully explored (frontier spent, nothing new on scroll) — backtracking to nearest unexplored branch.',
        );
      }
    }

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

    // Session-wide coverage bias: demote every control already triggered ANYWHERE
    // this run by a large fixed margin so untested controls win best-first across
    // page reloads. Non-decaying (recomputed from the registry each pass) — unlike
    // scorer penalties, which fade — so a tested element stays deprioritized instead
    // of recovering its rank and being re-selected. Demoted, not removed: still
    // selectable once the frontier is fully spent, and the pathfinder still explores
    // any unvisited edge from this node regardless of the demoted score.
    ranked = ranked
      .map((element) =>
        this.deps.clusterRegistry.isSelectorTriggeredAnywhere(element.selector)
          ? { ...element, riskScore: element.riskScore - TRIGGERED_SELECTOR_DEMOTION }
          : element,
      )
      .sort((left, right) => right.riskScore - left.riskScore);

    // Deep Semantic Data Attack prioritization: when the data-fuzzing gate is
    // active, fuzzable attack vectors must be selected BEFORE any navigation
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
        !this.deps.clusterRegistry.isSelectorTriggeredAnywhere(element.selector) &&
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
        !this.deps.clusterRegistry.isSelectorTriggeredAnywhere(el.selector);
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
            !!el.opensLayer && !this.deps.clusterRegistry.isSelectorTriggeredAnywhere(el.selector);
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

    return { kind: 'proceed', ranked };
  }

  private async computeFingerprintAndStagnation(
    page: Page,
    step: number,
    ctx: RunContext,
    ranked: InteractiveElement[],
  ): Promise<FingerprintResult> {
    // Task 3: Emit granular status for dynamic UI - "Hashing DOM state..."
    this.deps.telemetry.emitSystemStatus('Hashing DOM state...');

    // --- Compound structural fingerprint ---
    // structure = layout shell, interactive = control surface + state,
    // combined = canonical node identity. combined is strictly finer-grained
    // than the old structure-only key, so states that differ only by a toggled
    // control are no longer conflated.
    const compound = await this.deps.hashManager.hashCompound(page);
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

    // --- Clustered state-space observation (valid states only) ---
    // Fold this state into its structural cluster (keyed by the normalized
    // structure sub-hash) BEFORE stagnation scoring, so coverage-gain markers
    // reflect controls discovered on this step.
    this.deps.clusterRegistry.observe(
      compound.structure,
      currentUrl,
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

    const revisitedPage = this.deps.visitedUrls.has(currentUrl) || this.deps.visitedHashes.has(currentHash);
    this.deps.visitedUrls.add(currentUrl);
    this.deps.visitedHashes.add(currentHash);
    // Record the structural shell so the structure-gated novelty reward can tell a
    // genuinely new region from the same page reloaded (distinct shells stay few).
    this.deps.visitedStructures.add(compound.structure);
    if (this.deps.visitedHashes.size > MAX_VISITED_HASHES) {
      // Bound memory: evict the oldest observed hash (insertion-ordered Set).
      const oldest = this.deps.visitedHashes.values().next().value;
      if (oldest !== undefined) this.deps.visitedHashes.delete(oldest);
    }

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
        `🚨 Stagnation detected (score=${stagnation.stagnationScore}). Applying graduated penalty (${Math.round(intensity * 100)}%) to force deeper exploration.`,
      );
      for (const element of ranked) {
        this.deps.scorer.penalize(element.selector, (Math.abs(element.riskScore) + 1) * intensity);
      }
      // Longer escape window the deeper the stagnation, capped so it always recovers.
      ctx.penaltyStepsRemaining = computePenaltyWindow(stagnation.stagnationScore);
    }

    return {
      kind: 'ok',
      fingerprint: { compound, currentHash, currentUrl, revisitedPage, stagnationScore: stagnation.stagnationScore },
    };
  }

  /**
   * Run the static WCAG auditor against the current DOM and surface any NEW
   * violations as findings (live 'BUG' telemetry + the confirmed-bug ledger, so
   * they persist to saved history alongside runtime faults). The auditor dedupes
   * by (rule, selector) and audits each structural shell once, so this is cheap on
   * revisits. Isolated: a scan failure is logged and swallowed.
   */
  private async auditAccessibility(page: Page, structureHash: string, step: number): Promise<void> {
    try {
      const violations = await this.deps.accessibilityAuditor.audit(page, structureHash);
      for (const v of violations) {
        const severity = v.impact === 'critical' ? 'CRITICAL' : v.impact === 'minor' ? 'INFO' : 'WARNING';
        this.deps.telemetry.emit('BUG', {
          actionExecuted: 'accessibility-violation',
          selector: v.selector,
          severity,
          message: `♿ WCAG ${v.wcag} (${v.rule}): ${v.message}`,
        });
        this.deps.registerConfirmedBug({
          bugId: `a11y-${v.rule}-${step}-${v.selector || 'page'}`,
          type: 'ACCESSIBILITY',
          message: `WCAG ${v.wcag} — ${v.rule}: ${v.message}`,
          selector: v.selector,
          payloadUsed: '',
          advice: v.message,
          timestamp: new Date(),
        });
      }
      if (violations.length > 0) {
        this.deps.telemetry.emitMilestone(
          `♿ Accessibility: ${violations.length} new WCAG issue(s) on this view (${this.deps.accessibilityAuditor.totalFound()} total this run).`,
        );
      }
    } catch (a11yErr) {
      console.warn(
        '[ExplorationLoop] Accessibility audit failed:',
        a11yErr instanceof Error ? a11yErr.message : String(a11yErr),
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

    // Only valid, traversable states reach here — error states are excluded
    // upstream (handleErrorState) before ever being registered as a graph node.
    return this.deps.pathNavigator.registerStateAndDecide(
      fingerprint.currentHash,
      fingerprint.currentUrl,
      pathfinderElements,
      ctx.penaltyStepsRemaining > 0 || fingerprint.stagnationScore >= ctx.stagnationForceBacktrack,
    );
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
        !this.deps.checkTimebox();
      if (coverageRemains) {
        ctx.budget = Math.min(ctx.hardCap, ctx.budget + ctx.extensionSteps);
        ctx.recoveryRounds = ctx.maxRecoveryRounds - 1; // allow another round
        this.deps.telemetry.emitMilestone(
          `🔎 Graph reported exhausted but ${this.deps.clusterRegistry.unexploredControlCount()} control(s) untriggered — extending budget to ${ctx.budget} and recovering.`,
        );
      } else {
        this.deps.telemetry.emitMilestone('🔚 Graph exhausted after adaptive recovery. Exploration complete.');
        return {
          kind: 'return',
          result: { completed: true, reason: 'Full reachable graph exhausted (post-recovery).', outcome: 'completed' },
        };
      }
    }

    ctx.recoveryRounds++;
    const recovery = this.deps.pathNavigator.recoverFromExhaustion();
    this.deps.telemetry.emitMilestone(
      `♻️ ${describeRecovery(recovery.requeuedEdges)} (round ${ctx.recoveryRounds}/${ctx.maxRecoveryRounds}).`,
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
      if (this.deps.strictUrlLock) {
        // Under the boundary lock the origin re-seed is a competing navigation:
        // the boundary-lock restore is the sole page-transition authority, so skip it.
        this.deps.telemetry.emitMilestone('🔒 Strict URL Lock: skipping origin re-seed (boundary lock owns navigation).');
      } else {
        this.deps.telemetry.emitMilestone(`♻️ Re-seeding exploration from origin: ${origin}`);
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
    ctx.deadEndUrls.add(url);
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
    ctx.deadEndUrls.add(url);
    ctx.emptyCheckUrl = '';
    ctx.emptyCheckCount = 0;

    const { compound, mainFrameStatus, routeVerdict } = result;
    if (mainFrameStatus !== null) {
      this.deps.telemetry.emit('NETWORK', {
        statusCode: mainFrameStatus,
        url,
        method: 'GET',
        message: `⛔ Error state excluded (HTTP ${mainFrameStatus}) at ${url} — not registered as a graph state.`,
      });
    }
    this.deps.telemetry.emitMilestone(
      `⛔ Error/invalid page excluded from graph (${routeVerdict.reason}) — treating as a dead end and recovering to the nearest unexplored state.`,
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
        decision.kind === 'backtrack' ? 'recovering to nearest unexplored state' : 'graph exhausted'
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
    // Under the boundary lock, backtracking through the recovery ladder
    // (history.back / deep-link goto / reload) would issue a page transition that
    // races the boundary-lock restore. Skip it — the lock keeps us on the single
    // permitted URL and the next parse re-reads the live DOM regardless.
    if (this.deps.strictUrlLock) {
      this.deps.telemetry.emitMilestone('🔒 Strict URL Lock: backtrack navigation suppressed (boundary lock owns navigation).');
      return;
    }

    // Forensic log of the global frontier selection: priority breakdown + plan,
    // so every jump is attributable and reproducible from telemetry alone.
    if (decision.frontier) {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'frontier-selected',
        selector: decision.frontier.selector,
        score: Number(decision.frontier.priority.toFixed(3)),
        stateHash: decision.targetHash,
        message:
          `🧭 Frontier target ${decision.targetHash.substring(0, 8)} — priority ${decision.frontier.priority.toFixed(2)} ` +
          `(risk ${decision.frontier.edgeScore.toFixed(2)} + novelty ${decision.frontier.noveltyBonus.toFixed(2)}); ` +
          `${decision.path?.length ? `${decision.path.length}-step BFS path` : 'no explored route — restore ladder'}.`,
      });
    }

    this.deps.telemetry.emitMilestone(`↩️ Backtracking to ${decision.targetUrl}`);
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
        message: `♻️ BFS path replay to ${decision.targetHash.substring(0, 8)} failed en route — replanning via restore ladder.`,
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
        `🔁 Transition budget reached: ${human} repeatedly returns to seen views (limit ${this.deps.transitionRepeatBudget}). Deprioritizing session-wide and choosing an unexplored route.`,
      );
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'transition-budget-exhausted',
        selector: target.selector,
        message: `${human} exceeded the transition-repeat budget on this structural shell; blocked session-wide.`,
      });
      return true;
    }

    const probe = await this.deps.stateRestorer.probeStaticTarget(page, target.selector);

    // Breadcrumb-ancestor cycle: clicking would drop straight back into a loop.
    if (probe.href && this.deps.pathNavigator.ancestorUrls().includes(probe.href)) {
      this.deps.pathNavigator.markEdgeCyclic(currentHash, target.selector);
      // Actuated-and-resolved: a cyclic control leads nowhere new — count it covered
      // so it stops inflating hasUnexploredControls() and driving endless re-seeds.
      this.deps.clusterRegistry.markTriggered(structureHash, target.selector, step);
      this.deps.telemetry.emitMilestone(
        `🔁 Cyclic-loop avoided: ${humanizeElement(target)} leads back to a breadcrumb ancestor (${probe.href}). Choosing another pathway.`,
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
    if (offSite || probe.newTab || probe.deadEnd) {
      this.deps.pathNavigator.markEdgeCyclic(currentHash, target.selector);
      this.deps.clusterRegistry.markTriggered(structureHash, target.selector, step);
      const reason = offSite
        ? 'leaves the site under test'
        : probe.newTab
          ? 'opens a new tab'
          : 'non-navigational link';
      this.deps.telemetry.emitMilestone(
        `🚫 Skipping ${humanizeElement(target)} (${reason}) — keeping exploration on the app under test.`,
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

  /** True when `href` resolves to a different origin than the app under test. */
  private leavesTargetOrigin(href: string): boolean {
    try {
      return new URL(href).origin !== new URL(this.deps.getTargetOrigin()).origin;
    } catch {
      return false; // Unparseable → let the normal click path handle it.
    }
  }

  private async executeAndVerifyAction(
    page: Page,
    step: number,
    target: InteractiveElement,
    ranked: InteractiveElement[],
    revisitedPage: boolean,
    currentHash: string,
    exploreScore: number,
  ): Promise<{ traversalOk: boolean; childHash: string; childStructure: string; landedInvalid: boolean }> {
    // Emit exploration milestone
    const humanTarget = humanizeElement(target);
    this.deps.telemetry.emitMilestone(`🎯 Exploring ${humanTarget} (score: ${exploreScore.toFixed(3)})`);
    this.deps.telemetry.emitSystemStatus(`Clicking ${humanTarget}...`);

    this.deps.actionExecutor.logHighImpact(target);

    // 🔬 Decision Lens: publish the glass-box rationale for THIS pick (exact
    // per-feature attribution + runner-up counterfactual). Fully isolated — a
    // rationale failure must never derail the action about to execute.
    try {
      const runnerUp = ranked.find((el) => el.selector !== target.selector) ?? null;
      const rationale = this.deps.explainDecision({
        target,
        runnerUp,
        semanticRole: inferSemanticRole(target),
        step,
      });
      if (rationale) this.deps.telemetry.emitDecisionRationale(rationale);
    } catch (explainErr) {
      console.warn(
        '[ExplorationLoop] Decision rationale build failed:',
        explainErr instanceof Error ? explainErr.message : String(explainErr),
      );
    }

    let traversalOk = false;
    let childHash = currentHash;
    let childStructure = '';
    try {
      // Attribute async signals (network xhr/fetch, detected faults) fired
      // during/after this action to the acting element for compound rewards.
      this.deps.noteActedTarget(target);
      await this.deps.actionExecutor.executeWeightedAction(page, target, ranked, revisitedPage);
      const verification = await this.deps.stateRestorer.verifyTraversal(page, currentHash, 3000);
      traversalOk = verification.ok;
      childHash = verification.childHash;
      childStructure = verification.childStructure;
    } catch (actionErr) {
      // Operator-initiated stop must still propagate to the graceful handler.
      if (isBrowserClosedError(actionErr)) throw actionErr;
      // Detached element / intercepting overlay / click error → unstable edge.
      traversalOk = false;
      console.warn(
        '[ExplorationLoop] Traversal action failed:',
        actionErr instanceof Error ? actionErr.message : String(actionErr),
      );
    }

    // A click that drove the main page into an invalid context (about:blank /
    // chrome-error / closed) is NOT a real state transition — verifyTraversal
    // otherwise sees the blank fingerprint as a novel state and rewards it,
    // training the engine to seek the blank page. Demote it to a failed,
    // non-novel traversal so the caller isolates and permanently blocks the edge.
    const landedInvalid = !page.isClosed() && PageHealthGuard.isInvalidContext(page);
    if (landedInvalid) {
      traversalOk = false;
      childHash = currentHash;
      this.deps.telemetry.emitMilestone(
        `⛔ ${humanTarget} navigated to an invalid context (${page.url()}) — blocking edge.`,
      );
    }

    // Phase 3: Track interaction count
    this.deps.runtimeMetrics.interactionCount++;

    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'action-executed',
      selector: target.selector,
      message: `Step ${step}: Action executed on ${humanTarget}`,
    });

    await this.deps.persistBrainSnapshot('runtime', step);

    return { traversalOk, childHash, childStructure, landedInvalid };
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

      // 🔁 Forward lookahead (reactive): the click landed on a state that
      // is already an ancestor on our breadcrumb path — a genuine backward
      // loop the static probe couldn't predict (JS-driven navigation).
      // Permanently mark the edge cyclic so it's never retried. syncStack
      // will re-anchor the breadcrumb to the ancestor on the next step.
      if (this.deps.pathNavigator.isAncestorHash(childHash)) {
        this.deps.pathNavigator.markEdgeCyclic(previousHashBeforeAction, target.selector);
        this.deps.telemetry.emitMilestone(
          `🔁 Cyclic-loop detected: ${humanizeElement(target)} returned to ancestor ${childHash.substring(0, 8)}. Edge blocked.`,
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
      if (this.deps.strictUrlLock) {
        this.deps.telemetry.emitMilestone('🔒 Strict URL Lock: unstable edge isolated; parent restore deferred to boundary lock.');
      } else {
        this.deps.telemetry.emitMilestone(`🩹 Edge unstable — restoring parent locally (no false exhaustion).`);
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
      // Genuine progress — refresh the adaptive-recovery budget.
      ctx.recoveryRounds = 0;
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

  private async handleIterationError(
    err: unknown,
    page: Page,
    runtimeCrashReason: string | null,
    serverCrashReason: string | null,
  ): Promise<LoopResult> {
    // Check if this is a browser/context closed error - this happens when operator
    // manually stops the test. Treat it as graceful shutdown, not fatal exception.
    if (isBrowserClosedError(err)) {
      this.deps.telemetry.emitMilestone('ℹ️ Session gracefully stopped by operator');
      return { completed: false, reason: 'Session gracefully stopped by operator', outcome: 'user-stopped' };
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
      `✅ Exploration Complete: ${ctx.budget} steps (${ctx.budgetExtensions} extension${ctx.budgetExtensions === 1 ? '' : 's'}), ` +
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
