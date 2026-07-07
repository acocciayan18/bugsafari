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
import { describeRecovery } from '../forensics/narration.js';
import { isBrowserClosedError, sanitizeException } from '../telemetry/StabilityMonitor.js';
import { inferSemanticRole, wait } from './types.js';
import type { ExplorationLoopDeps } from './types.js';
import { computeStagnation, computePenaltyIntensity, computePenaltyWindow } from './stagnationScoring.js';

// Upper bound on the per-run visited-hash Set so long runs can't grow memory without limit.
const MAX_VISITED_HASHES = 5000;

type LoopResult = { completed: boolean; reason: string };
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
}

/** Per-step DOM/graph fingerprint computed once per iteration. */
interface StepFingerprint {
  compound: CompoundStateHash;
  currentHash: string;
  currentUrl: string;
  revisitedPage: boolean;
  stagnationScore: number;
}

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
    };

    for (let step = 1; ; step++) {
      if (this.checkBudgetGate(step, ctx) === 'break') break;

      if (this.deps.isStopRequested()) {
        telemetry.emitMilestone(`Safari session manually stopped by user.`);
        return { completed: false, reason: 'Safari session manually stopped by user.' };
      }

      // ─────────────────────────────────────────────────────────────
      // TIMEBOX CHECK - CRITICAL: Must check at each iteration
      // Only terminates when elapsedActiveTimeMs reaches the configured limit AND NOT paused
      // ─────────────────────────────────────────────────────────────
      if (this.deps.checkTimebox()) {
        return {
          completed: false,
          reason: `Timebox of ${this.deps.getTimeboxMs()}ms (${this.deps.getTimeboxMs() / 60000}min) exceeded - active execution time only`,
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
          return { completed: false, reason: 'Unrecoverable invalid browser state (about:blank / closed page).' };
        }
        page = health.page;

        if (runtimeCrashReason) {
          return { completed: false, reason: runtimeCrashReason };
        }

        if (serverCrashReason) {
          return { completed: false, reason: serverCrashReason };
        }

        await this.maybeSabotageNetwork(page, ctx);

        const parseResult = await this.parseDomAndScore(page);
        if (parseResult.kind === 'continue') continue;
        const { ranked } = parseResult;

        const fingerprint = await this.computeFingerprintAndStagnation(page, step, ctx, ranked);

        const decision = this.decidePathfinderAction(ctx, ranked, fingerprint);

        // Initialize with default to satisfy TypeScript
        let target: InteractiveElement = ranked[0];

        if (decision.kind === 'exhausted') {
          const exhaustedGate = await this.handleExhaustedDecision(page, ctx, fingerprint.currentUrl);
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

        // 🔮 Forward lookahead (proactive): if this edge is an anchor/router-
        // link whose resolved URL is a breadcrumb ancestor, clicking it would
        // drop straight back into a loop. Mark it cyclic (score 0 + blocked),
        // emit telemetry, and skip to the next-best pathway WITHOUT clicking.
        const isCyclic = await this.checkForwardLookaheadCycle(page, fingerprint.currentHash, target);
        if (isCyclic) continue;

        // Execute the action, then VERIFY the traversal before confirming it.
        // The edge stays 'traversing' in the navigator until we observe a new
        // stable DOM state; an unverified/failed click is isolated as unstable
        // and the parent is restored locally (never collapses the graph).
        const { traversalOk, childHash } = await this.executeAndVerifyAction(
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
        );

        // Task 3: Observe novelty and fire Perceptron Delta Rule if state is highly novel
        this.applyNoveltyRewardAndTelemetry(target, traversalOk, childHash, decision.score, ctx);

        await telemetry.emitLiveFrame(page);
        await wait(350);
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
        return { kind: 'return', result: { completed: false, reason: 'Safari session manually stopped by user.' } };
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

  private async parseDomAndScore(
    page: Page,
  ): Promise<{ kind: 'continue' } | { kind: 'proceed'; ranked: InteractiveElement[] }> {
    // 🧠 Prioritization (milestone comes right after parse/scoring)
    this.deps.telemetry.emitMilestone('👁️ Vision Active');

    // Page-context validity + strict-lock confinement are enforced by the
    // per-iteration ensurePageHealth() gate in execute(); here we only wait for
    // interactive content to appear.
    await this.deps.ensureDomReady(page);

    const elements = await this.deps.parser.parse(page);

    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'dom-elements-parsed',
      message: `Parsed ${elements.length} interactive elements from DOM`,
    });

    if (elements.length === 0) {
      // SPA may still be routing — don't hard-exit on an empty snapshot.
      // Wait 1 s and retry on the next iteration; the loop terminates
      // naturally at maxSteps if the DOM never populates.
      this.deps.telemetry.emitMilestone('⏳ No interactive elements this step — waiting for DOM to settle...');
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      return { kind: 'continue' };
    }

    const ranked = this.deps.scorer.score(elements);
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
  ): Promise<StepFingerprint> {
    // Task 3: Emit granular status for dynamic UI - "Hashing DOM state..."
    this.deps.telemetry.emitSystemStatus('Hashing DOM state...');

    // --- Compound structural fingerprint ---
    // structure = layout shell, interactive = control surface + state,
    // combined = canonical node identity. combined is strictly finer-grained
    // than the old structure-only key, so states that differ only by a toggled
    // control are no longer conflated.
    const compound = await this.deps.hashManager.hashCompound(page);
    const currentHash = compound.combined;

    // --- Clustered state-space observation ---
    // Fold this state into its structural cluster (keyed by the normalized
    // structure sub-hash) BEFORE stagnation scoring, so coverage-gain markers
    // reflect controls discovered on this step.
    this.deps.clusterRegistry.observe(
      compound.structure,
      page.url(),
      ranked.map((el) => el.selector),
      step,
    );

    // --- Adaptive stagnation scoring (coverage-blended) ---
    // Score BEFORE recording this structure so familiarity reflects prior steps.
    const coverageStagnant = this.deps.clusterRegistry.stepsSinceCoverageGain(step) >= ctx.coverageStallWindow;
    const stagnation = computeStagnation({
      currentHash,
      previousCombined: ctx.previousCombined,
      recentStructures: ctx.recentStructures,
      structure: compound.structure,
      structureWindow: ctx.structureWindow,
      coverageStagnant,
    });
    ctx.recentStructures = stagnation.nextRecentStructures;
    ctx.previousCombined = stagnation.nextPreviousCombined;

    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'dom-state-hash',
      stateHash: currentHash,
      message: `DOM fingerprint captured. stagnationScore=${stagnation.stagnationScore} (shell x${stagnation.structureFamiliarity}${stagnation.combinedRepeated ? ', exact-repeat' : ''})`,
    });

    const currentUrl = page.url();
    const revisitedPage = this.deps.visitedUrls.has(currentUrl) || this.deps.visitedHashes.has(currentHash);
    this.deps.visitedUrls.add(currentUrl);
    this.deps.visitedHashes.add(currentHash);
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

    return { compound, currentHash, currentUrl, revisitedPage, stagnationScore: stagnation.stagnationScore };
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

    return this.deps.pathNavigator.registerStateAndDecide(
      fingerprint.currentHash,
      fingerprint.currentUrl,
      pathfinderElements,
      ctx.penaltyStepsRemaining > 0 || fingerprint.stagnationScore >= ctx.stagnationForceBacktrack,
    );
  }

  private async handleExhaustedDecision(page: Page, ctx: RunContext, currentUrl: string): Promise<StepGate> {
    // Adaptive recovery before accepting termination: re-evaluate soft-blocked
    // edges (unstable/branch/sweep — never true cycles), reset the boredom
    // floor, and re-seed if needed. Only terminate after MAX_RECOVERY_ROUNDS
    // consecutive rounds (since the last novel state) yield no new frontier.
    if (ctx.recoveryRounds >= ctx.maxRecoveryRounds) {
      // Coverage guard against false exhaustion: if clusters still hold
      // untriggered controls (and we're within timebox + hard cap), grant one
      // more recovery round instead of terminating. Bounded by HARD_CAP.
      const coverageRemains =
        this.deps.clusterRegistry.hasUnexploredControls() && ctx.budget < ctx.hardCap && !this.deps.checkTimebox();
      if (coverageRemains) {
        ctx.budget = Math.min(ctx.hardCap, ctx.budget + ctx.extensionSteps);
        ctx.recoveryRounds = ctx.maxRecoveryRounds - 1; // allow another round
        this.deps.telemetry.emitMilestone(
          `🔎 Graph reported exhausted but ${this.deps.clusterRegistry.unexploredControlCount()} control(s) untriggered — extending budget to ${ctx.budget} and recovering.`,
        );
      } else {
        this.deps.telemetry.emitMilestone('🔚 Graph exhausted after adaptive recovery. Exploration complete.');
        return { kind: 'return', result: { completed: true, reason: 'Full reachable graph exhausted (post-recovery).' } };
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
    // Record the recovery deliberately through centralized forensics so the
    // reproduction playbook reflects it.
    ActiveScenarioTracker.begin('AdaptiveRecovery', currentUrl);
    ActiveScenarioTracker.record(describeRecovery(recovery.requeuedEdges));
    ActiveScenarioTracker.end();

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
        await wait(350);
      }
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
    // Restore the parent state via the SPA-friendly recovery ladder
    // (history → deep-link → hard reload) instead of a blind hard goto
    // that would wipe client state and false-trip graph exhaustion.
    this.deps.telemetry.emitMilestone(`↩️ Backtracking to ${decision.targetUrl}`);
    this.deps.telemetry.emitSystemStatus(`Backtracking to ${decision.targetHash.substring(0, 8)}...`);
    await this.deps.stateRestorer.restoreToState(page, decision.targetHash, decision.targetUrl);
    await wait(350);
  }

  private resolveExploreEdgeTarget(
    decision: ExploreEdgeDecision,
    ranked: InteractiveElement[],
  ): { kind: 'return'; result: LoopResult } | { kind: 'proceed'; target: InteractiveElement } {
    const foundTarget = ranked.find((el) => el.selector === decision.selector);
    const target = foundTarget ?? ranked[0];

    if (!target) {
      return { kind: 'return', result: { completed: true, reason: 'No ranked target found.' } };
    }

    return { kind: 'proceed', target };
  }

  private async checkForwardLookaheadCycle(
    page: Page,
    currentHash: string,
    target: InteractiveElement,
  ): Promise<boolean> {
    const lookaheadHref = await this.deps.stateRestorer.probeStaticTarget(page, target.selector);
    if (lookaheadHref && this.deps.pathNavigator.ancestorUrls().includes(lookaheadHref)) {
      this.deps.pathNavigator.markEdgeCyclic(currentHash, target.selector);
      this.deps.telemetry.emitMilestone(
        `🔁 Cyclic-loop avoided: ${target.selector} → ${lookaheadHref} is a breadcrumb ancestor. Choosing another pathway.`,
      );
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'cyclic-loop-detected',
        selector: target.selector,
        message: `Forward lookahead skipped ${target.selector}: resolves to ancestor ${lookaheadHref}.`,
      });
      return true;
    }
    return false;
  }

  private async executeAndVerifyAction(
    page: Page,
    step: number,
    target: InteractiveElement,
    ranked: InteractiveElement[],
    revisitedPage: boolean,
    currentHash: string,
    exploreScore: number,
  ): Promise<{ traversalOk: boolean; childHash: string }> {
    // Emit exploration milestone
    this.deps.telemetry.emitMilestone(`🎯 Exploring edge: ${target.selector} (score: ${exploreScore.toFixed(3)})`);
    this.deps.telemetry.emitSystemStatus(`Clicking element ${target.selector}...`);

    this.deps.actionExecutor.logHighImpact(target);

    let traversalOk = false;
    let childHash = currentHash;
    try {
      // Attribute async signals (network xhr/fetch, detected faults) fired
      // during/after this action to the acting element for compound rewards.
      this.deps.noteActedTarget(target);
      await this.deps.actionExecutor.executeWeightedAction(page, target, ranked, revisitedPage);
      const verification = await this.deps.stateRestorer.verifyTraversal(page, currentHash, 3000);
      traversalOk = verification.ok;
      childHash = verification.childHash;
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

    // Phase 3: Track interaction count
    this.deps.runtimeMetrics.interactionCount++;

    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'action-executed',
      selector: target.selector,
      message: `Step ${step}: Action executed on ${target.selector}`,
    });

    await this.deps.persistBrainSnapshot('runtime', step);

    return { traversalOk, childHash };
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
  ): Promise<void> {
    if (traversalOk) {
      // Verified transition — record the REAL child hash (fixes the prior
      // bug that passed the pre-action hash as the child).
      this.deps.pathNavigator.confirmEdgeTraversal(previousHashBeforeAction, target.selector, childHash);

      // Mark this control triggered on its structural cluster so coverage
      // metrics and adaptive-budget decisions reflect real exploration.
      this.deps.clusterRegistry.markTriggered(compound.structure, target.selector, step);

      // 🔁 Forward lookahead (reactive): the click landed on a state that
      // is already an ancestor on our breadcrumb path — a genuine backward
      // loop the static probe couldn't predict (JS-driven navigation).
      // Permanently mark the edge cyclic so it's never retried. syncStack
      // will re-anchor the breadcrumb to the ancestor on the next step.
      if (this.deps.pathNavigator.isAncestorHash(childHash)) {
        this.deps.pathNavigator.markEdgeCyclic(previousHashBeforeAction, target.selector);
        this.deps.telemetry.emitMilestone(
          `🔁 Cyclic-loop detected: ${target.selector} returned to ancestor ${childHash.substring(0, 8)}. Edge blocked.`,
        );
        this.deps.telemetry.emit('ACTION', {
          actionExecuted: 'cyclic-loop-detected',
          selector: target.selector,
          stateHash: childHash,
          message: `Reactive lookahead: ${target.selector} looped back to ancestor ${childHash.substring(0, 8)}.`,
        });
      }
    } else {
      // Unverified — isolate this single branch. Normally we restore the parent
      // locally; under the boundary lock that restore is a competing navigation,
      // so we only mark the edge unstable and defer any URL correction to the
      // boundary-lock restore at the next iteration.
      this.deps.pathNavigator.markEdgeUnstable(previousHashBeforeAction, target.selector);
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
    childHash: string,
    decisionScore: number,
    ctx: RunContext,
  ): void {
    // If the resulting state has low visitation count (novel), reward the weights.
    // Uses the verified post-action childHash so the reward reflects the
    // state the click actually produced, not the pre-action fingerprint.
    const isNovelState = traversalOk && this.deps.visitedHashes.has(childHash) === false;

    if (isNovelState) {
      // Genuine progress — refresh the adaptive-recovery budget.
      ctx.recoveryRounds = 0;
      // Novel state discovered — compound reward for a genuine structural change.
      this.deps.scorer.applyCompoundReward(target, { structuralChange: true });

      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'novelty-reward-triggered',
        selector: target.selector,
        message: `Novel state discovered (visitCount: 1). Fired Perceptron Delta Rule to reward weights for ${target.selector}.`,
      });
    } else {
      // Non-novel state — contrastive negative so weights can move down.
      this.deps.scorer.applyCompoundReward(target, { revisit: true });
      const visitCount = this.deps.visitedHashes.size;
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'state-revisited',
        selector: target.selector,
        message: `State revisited (visitCount: ${visitCount}). Applied Perceptron revisit penalty for ${target.selector}.`,
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
      return { completed: false, reason: 'Session gracefully stopped by operator' };
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
    };
  }

  private buildTerminalSummary(ctx: RunContext): LoopResult {
    const cov = this.deps.clusterRegistry.snapshot();
    this.deps.telemetry.emitMilestone(
      `✅ Exploration Complete: ${ctx.budget} steps (${ctx.budgetExtensions} extension${ctx.budgetExtensions === 1 ? '' : 's'}), ` +
        `${cov.clusters} clusters, coverage ${(cov.coverage * 100).toFixed(0)}% ` +
        `(${cov.triggered}/${cov.discovered} controls).`,
    );
    return {
      completed: true,
      reason:
        cov.unexploredControls === 0
          ? 'Exploration budget reached — cluster coverage saturated.'
          : 'Exploration budget reached (hard cap or timebox).',
    };
  }
}
