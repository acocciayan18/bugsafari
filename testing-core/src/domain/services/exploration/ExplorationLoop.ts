import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { PathfinderElement } from '../DIrectedPathFinder.js';
import { networkSaboteur } from '../../scenarios/index.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import { describeRecovery } from '../forensics/narration.js';
import { isBrowserClosedError, sanitizeException } from '../telemetry/StabilityMonitor.js';
import { inferSemanticRole, wait } from './types.js';
import type { ExplorationLoopDeps } from './types.js';

// Upper bound on the per-run visited-hash Set so long runs can't grow memory without limit.
const MAX_VISITED_HASHES = 5000;

/**
 * Handles the incremental step-by-step exploration logic: per-step parse →
 * score → DOM-hash → loop detection → StateGraphNavigator decision → action
 * execution → traversal verification → novelty reward → telemetry. Returns the
 * run outcome to the parent ExplorationEngine.
 */
export class ExplorationLoop {
  constructor(private readonly deps: ExplorationLoopDeps) {}

  public async execute(page: Page, maxSteps: number): Promise<{ completed: boolean; reason: string }> {
    const telemetry = this.deps.telemetry;

    // Crash-reason sentinels preserved from the original engine: declared but
    // never assigned here, they keep the historical short-circuit/return shape.
    let serverCrashReason: string | null = null;
    let runtimeCrashReason: string | null = null;

    // --- 3-Strike Logic Loop State ---
    // Tracks consecutive steps where the DOM fingerprint did not change.
    let previousHash = '';
    let stagnationCounter = 0;
    // When > 0, the engine is in "escape mode": picks the lowest-scored target
    // instead of the highest, and all current-page elements carry a score penalty.
    let penaltyStepsRemaining = 0;

    // --- Adaptive exhaustion recovery state ---
    // Consecutive recovery rounds since the last genuine progress (novel state).
    // Bounded so the run terminates deterministically when truly exhausted.
    let recoveryRounds = 0;
    const MAX_RECOVERY_ROUNDS = 2;
    // Deterministic NetworkSaboteur cadence: fire on every Nth eligible step
    // instead of a random dice roll, so scenario execution is reproducible.
    let sabotageStepCounter = 0;
    const SABOTAGE_CADENCE = 10;

    for (let step = 1; step <= maxSteps; step++) {
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

      while (this.deps.isPaused()) {
        if (this.deps.isStopRequested()) {
          telemetry.emitMilestone(`Safari session manually stopped by user.`);
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


        // 📡 Network Sabotage: always-on background monitor, independent of the
        // selected infiltration profile. Fires on a deterministic cadence (every
        // Nth step) so execution stays reproducible across runs.
        sabotageStepCounter += 1;
        const sabotageThisStep = sabotageStepCounter % SABOTAGE_CADENCE === 0;
        if (sabotageThisStep) {
          telemetry.emitMilestone('📡 Chaos Mode: Sabotaging network requests for this step...');
          telemetry.emit('ACTION', {
            actionExecuted: 'network-sabotage',
            message: '📡 Chaos Mode: Sabotaging network requests for this step...',
          });
          // Execute the network sabotage - note: this remains active for subsequent interactions
          await networkSaboteur.execute(page);
        }

        // 🧠 Prioritization (milestone comes right after parse/scoring)
        telemetry.emitMilestone('👁️ Vision Active');

        await this.deps.ensureTargetDomain(page);
        await this.deps.ensureDomReady(page);

        const elements = await this.deps.parser.parse(page);

        telemetry.emit('ACTION', {
          actionExecuted: 'dom-elements-parsed',
          message: `Parsed ${elements.length} interactive elements from DOM`,
        });

        if (elements.length === 0) {
          // SPA may still be routing — don't hard-exit on an empty snapshot.
          // Wait 1 s and retry on the next iteration; the loop terminates
          // naturally at maxSteps if the DOM never populates.
          telemetry.emitMilestone('⏳ No interactive elements this step — waiting for DOM to settle...');
          await new Promise<void>((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        const ranked = this.deps.scorer.score(elements);
        telemetry.gateway.emitTargets(
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
        telemetry.emitSystemStatus('Hashing DOM state...');

        // --- 3-Strike Logic Loop Detection ---
        // The hash represents the structural fingerprint of the page AFTER the
        // previous action. If it stays identical for 3 consecutive steps the
        // engine is stuck clicking elements that have no effect on app state.
        const currentHash = await this.deps.hashManager.hash(page);

        // --- Visual Regression Detection (SSIM) ---
        // Visual regression detection disabled - baseline screenshot storage removed
        // Note: The visualRegressionDetector still exists but is not actively storing baselines
        // The SSIM comparison is skipped to avoid memory overhead

        telemetry.emit('ACTION', {
          actionExecuted: 'dom-state-hash',
          stateHash: currentHash,
          message: `DOM fingerprint captured. stagnation=${stagnationCounter}/3`,
        });

        // Track state changes.
        // Only increment the strike counter when no penalty is already active —
        // during escape mode the engine is deliberately trying new paths, so we
        // give it room to manoeuvre before counting fresh strikes.
        const currentUrl = page.url();
        const revisitedPage = this.deps.visitedUrls.has(currentUrl) || this.deps.visitedHashes.has(currentHash);
        this.deps.visitedUrls.add(currentUrl);
        this.deps.visitedHashes.add(currentHash);
        if (this.deps.visitedHashes.size > MAX_VISITED_HASHES) {
          // Bound memory: evict the oldest observed hash (insertion-ordered Set).
          const oldest = this.deps.visitedHashes.values().next().value;
          if (oldest !== undefined) this.deps.visitedHashes.delete(oldest);
        }

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
          telemetry.emitMilestone(
            '🚨 Logic Loop detected. Penalizing current UI branch to force deeper exploration.',
          );

          // Zero-out effective risk scores for every visible element on this
          // page for the next 5 steps by adding a penalty that exceeds each
          // element's current riskScore.
          for (const element of ranked) {
            this.deps.scorer.penalize(element.selector, Math.abs(element.riskScore) + 1);
          }

          penaltyStepsRemaining = 5;
          stagnationCounter = 0; // reset strike counter; fresh window after escape
        }

        // Convert ranked elements to PathfinderElement format for StateGraphNavigator.
        // elementType and boundingBox feed the diversity penalty and tie-breaker sort.
        const pathfinderElements: PathfinderElement[] = ranked.map(el => ({
          selector: el.selector,
          score: el.riskScore,
          elementType: el.tagName,
          boundingBox: el.boundingBox,
        }));

        // Use StateGraphNavigator to make decision
        const decision = this.deps.pathNavigator.registerStateAndDecide(
          currentHash,
          currentUrl,
          pathfinderElements,
          penaltyStepsRemaining > 0 || stagnationCounter >= 3,
        );

        // Initialize with default to satisfy TypeScript
        let target: InteractiveElement = ranked[0];

        if (decision.kind === 'exhausted') {
          // Adaptive recovery before accepting termination: re-evaluate soft-blocked
          // edges (unstable/branch/sweep — never true cycles), reset the boredom
          // floor, and re-seed if needed. Only terminate after MAX_RECOVERY_ROUNDS
          // consecutive rounds (since the last novel state) yield no new frontier.
          if (recoveryRounds >= MAX_RECOVERY_ROUNDS) {
            telemetry.emitMilestone('🔚 Graph exhausted after adaptive recovery. Exploration complete.');
            return { completed: true, reason: 'Full reachable graph exhausted (post-recovery).' };
          }

          recoveryRounds++;
          const recovery = this.deps.pathNavigator.recoverFromExhaustion();
          telemetry.emitMilestone(
            `♻️ ${describeRecovery(recovery.requeuedEdges)} (round ${recoveryRounds}/${MAX_RECOVERY_ROUNDS}).`,
          );
          telemetry.emit('ACTION', {
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
            telemetry.emitMilestone(`♻️ Re-seeding exploration from origin: ${origin}`);
            await this.deps.stateRestorer.restoreToState(page, '', origin);
            await wait(350);
          }
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
          // Restore the parent state via the SPA-friendly recovery ladder
          // (history → deep-link → hard reload) instead of a blind hard goto
          // that would wipe client state and false-trip graph exhaustion.
          telemetry.emitMilestone(`↩️ Backtracking to ${decision.targetUrl}`);
          telemetry.emitSystemStatus(`Backtracking to ${decision.targetHash.substring(0, 8)}...`);
          await this.deps.stateRestorer.restoreToState(page, decision.targetHash, decision.targetUrl);
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

        // 🔮 Forward lookahead (proactive): if this edge is an anchor/router-
        // link whose resolved URL is a breadcrumb ancestor, clicking it would
        // drop straight back into a loop. Mark it cyclic (score 0 + blocked),
        // emit telemetry, and skip to the next-best pathway WITHOUT clicking.
        const lookaheadHref = await this.deps.stateRestorer.probeStaticTarget(page, target.selector);
        if (lookaheadHref && this.deps.pathNavigator.ancestorUrls().includes(lookaheadHref)) {
          this.deps.pathNavigator.markEdgeCyclic(currentHash, target.selector);
          telemetry.emitMilestone(
            `🔁 Cyclic-loop avoided: ${target.selector} → ${lookaheadHref} is a breadcrumb ancestor. Choosing another pathway.`,
          );
          telemetry.emit('ACTION', {
            actionExecuted: 'cyclic-loop-detected',
            selector: target.selector,
            message: `Forward lookahead skipped ${target.selector}: resolves to ancestor ${lookaheadHref}.`,
          });
          continue;
        }

        // Emit exploration milestone
        telemetry.emitMilestone(`🎯 Exploring edge: ${target.selector} (score: ${decision.score.toFixed(3)})`);
        telemetry.emitSystemStatus(`Clicking element ${target.selector}...`);

        // Execute the action, then VERIFY the traversal before confirming it.
        // The edge stays 'traversing' in the navigator until we observe a new
        // stable DOM state; an unverified/failed click is isolated as unstable
        // and the parent is restored locally (never collapses the graph).
        this.deps.actionExecutor.logHighImpact(target);
        const previousHashBeforeAction = currentHash;

        let traversalOk = false;
        let childHash = previousHashBeforeAction;
        try {
          await this.deps.actionExecutor.executeWeightedAction(page, target, ranked, revisitedPage);
          const verification = await this.deps.stateRestorer.verifyTraversal(page, previousHashBeforeAction, 3000);
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

        telemetry.emit('ACTION', {
          actionExecuted: 'action-executed',
          selector: target.selector,
          message: `Step ${step}: Action executed on ${target.selector}`,
        });

        await this.deps.persistBrainSnapshot('runtime', step);

        if (traversalOk) {
          // Verified transition — record the REAL child hash (fixes the prior
          // bug that passed the pre-action hash as the child).
          this.deps.pathNavigator.confirmEdgeTraversal(
            previousHashBeforeAction,
            target.selector,
            childHash,
          );

          // 🔁 Forward lookahead (reactive): the click landed on a state that
          // is already an ancestor on our breadcrumb path — a genuine backward
          // loop the static probe couldn't predict (JS-driven navigation).
          // Permanently mark the edge cyclic so it's never retried. syncStack
          // will re-anchor the breadcrumb to the ancestor on the next step.
          if (this.deps.pathNavigator.isAncestorHash(childHash)) {
            this.deps.pathNavigator.markEdgeCyclic(previousHashBeforeAction, target.selector);
            telemetry.emitMilestone(
              `🔁 Cyclic-loop detected: ${target.selector} returned to ancestor ${childHash.substring(0, 8)}. Edge blocked.`,
            );
            telemetry.emit('ACTION', {
              actionExecuted: 'cyclic-loop-detected',
              selector: target.selector,
              stateHash: childHash,
              message: `Reactive lookahead: ${target.selector} looped back to ancestor ${childHash.substring(0, 8)}.`,
            });
          }
        } else {
          // Unverified — isolate this single branch and restore the parent
          // locally rather than letting the graph exhaust falsely.
          this.deps.pathNavigator.markEdgeUnstable(previousHashBeforeAction, target.selector);
          telemetry.emitMilestone(
            `🩹 Edge unstable — restoring parent locally (no false exhaustion).`,
          );
          await this.deps.stateRestorer.restoreToState(page, previousHashBeforeAction, currentUrl);
        }

        // Task 3: Observe novelty and fire Perceptron Delta Rule if state is highly novel
        // If the resulting state has low visitation count (novel), reward the weights.
        // Uses the verified post-action childHash so the reward reflects the
        // state the click actually produced, not the pre-action fingerprint.
        const currentNode = this.deps.pathNavigator.snapshot();
        const isNovelState = traversalOk && this.deps.visitedHashes.has(childHash) === false;

        if (isNovelState) {
          // Genuine progress — refresh the adaptive-recovery budget.
          recoveryRounds = 0;
          // Novel state discovered - fire Perceptron's Delta Rule to reward the element weights
          this.deps.scorer.rewardFromNetworkSignal(target);

          telemetry.emit('ACTION', {
            actionExecuted: 'novelty-reward-triggered',
            selector: target.selector,
            message: `Novel state discovered (visitCount: 1). Fired Perceptron Delta Rule to reward weights for ${target.selector}.`,
          });
        } else {
          // Non-novel state — feed the perceptron a contrastive target=0 example so weights can move down.
          this.deps.scorer.penalizeRevisit(target);
          const visitCount = this.deps.visitedHashes.size;
          telemetry.emit('ACTION', {
            actionExecuted: 'state-revisited',
            selector: target.selector,
            message: `State revisited (visitCount: ${visitCount}). Applied Perceptron revisit penalty for ${target.selector}.`,
          });
        }

        // Emit curiosity-driven selection telemetry
        const boredomThreshold = this.deps.pathNavigator.getBoredomThreshold();
        const topScore = decision.score;
        const curiosityDriven = topScore >= boredomThreshold;

        telemetry.emit('ACTION', {
          actionExecuted: 'curiosity-decision',
          selector: target.selector,
          score: topScore,
          message: `Curiosity-driven: ${curiosityDriven ? 'EXPLORE' : 'BACKTRACK'} (topScore=${topScore.toFixed(2)}, boredomThreshold=${boredomThreshold})`,
        });

        telemetry.emit('HEURISTIC_SCORE', {
          selector: target.selector,
          score: Number(target.riskScore.toFixed(4)),
          message: `Target scored ${target.riskScore.toFixed(4)} and executed.`,
        });

        await telemetry.emitLiveFrame(page);
        await wait(350);
      } catch (err: unknown) {
        // Check if this is a browser/context closed error - this happens when operator
        // manually stops the test. Treat it as graceful shutdown, not fatal exception.
        if (isBrowserClosedError(err)) {
          telemetry.emitMilestone('ℹ️ Session gracefully stopped by operator');
          return { completed: false, reason: 'Session gracefully stopped by operator' };
        }

        // Phase 3: Track failure count on exception
        this.deps.runtimeMetrics.failureCount++;

        // Emergency Data Flush: flush the active scenario's deliberate steps
        // (falling back to the rolling action log) and emit EXCEPTION telemetry.
        const reproductionSteps = ActiveScenarioTracker.flushPlaybook();
        const sanitized = sanitizeException(err instanceof Error ? err : String(err));

        telemetry.emit('EXCEPTION', {
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
    }

    telemetry.emitMilestone(`✅ Exploration Complete: 60 steps executed successfully`);
    return { completed: true, reason: 'Maximum exploration steps reached.' };
  }
}
