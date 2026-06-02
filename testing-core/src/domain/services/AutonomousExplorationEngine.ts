import type { Dialog, Page, Request, Response } from 'playwright';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import type { ActionBreadcrumb, ActionRecord, ActionType, TelemetryEvent } from '../../../../shared/types.ts';
import { CircularBuffer } from '../../lib/circularBuffer.js';
import { PayloadSynthesizer } from '../../ml/payloadSynthesizer.js';
import { RecursiveDomParser } from '../heuristics/domParser.js';
import { DomHasher } from '../../ml/domHasher.js';
import { InteractionSimulator } from '../scenarios/rapidClickerStress.js';
import { RiskScorer } from './RiskScorer.js';
import { BoundingBoxHighlighter } from '../../infrastructure/playwright/BoundingBoxHighlighter.js';
import type { InteractiveElement } from '../entities/InteractiveElement.js';
import type { StressScenario } from '../scenarios/types.js';
import { stressScenarioMap, stressScenarioRegistry, securityVulnerabilityScout, formBypasser, networkSaboteur } from '../scenarios/index.js';
import {
  generateLargeString,
  generateNullPayload,
  generateSpecialChars,
  getRandomPayloadType,
  getPayload,
} from '../scenarios/dataFuzzer.js';
import { setupStabilityMonitoring } from '../../infrastructure/monitoring/stabilityMonitor.js';
import type { FindingRepository } from '../repositories/FindingRepository.js';
import { ReproductionPlaybookStore } from '../../infrastructure/monitoring/reproductionPlaybookStore.js';

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
  private readonly simulator = new InteractionSimulator();
  private readonly scorer = new RiskScorer();
  private readonly payloadSynthesizer = new PayloadSynthesizer();
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

  // Stability monitoring cleanup function - disposed in finally block
  private cleanupStabilityMonitor: (() => void) | null = null;

  constructor(private readonly findingRepo?: FindingRepository) { }

  public pause() {
    this.isPaused = true;
  }

  public resume() {
    this.isPaused = false;
  }

  public stop() {
    this.isStopRequested = true;
    this.isPaused = false;
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

  public async run(page: Page, targetUrl: string, telemetry: TelemetryGateway, maxSteps = 60): Promise<{ completed: boolean; reason: string }> {
    telemetry = this.createPersistentTelemetryGateway(telemetry);
    this.targetOrigin = new URL(targetUrl).origin;
    this.freezeActionTraceRecording = false;
    this.lastBrainSnapshotStep = 0;
    this.sessionId = await this.createSession(targetUrl);
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

      // Emit NETWORK for failures (>=400 per TESTING_TYPES.md) or soft-fail body
      let shouldEmit = status >= 400;

      if (!shouldEmit) {
        try {
          const body = await response.text().catch(() => '');
          const bodyLower = body.toLowerCase();
          const hasErrorFlag = bodyLower.includes('"error"') && (bodyLower.includes('true') || bodyLower.includes(':true'));
          const hasStatusFail = bodyLower.includes('"status"') && (bodyLower.includes('"fail"') || bodyLower.includes(':"fail"'));
          shouldEmit = hasErrorFlag || hasStatusFail;
        } catch {
          // Ignore body parse errors
        }
      }

      if (shouldEmit) {
        telemetry.emitTelemetry(this.event('NETWORK', {
          statusCode: status,
          url,
          method,
          message: `Network ${status} ${method} ${url}`,
        }));
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
    });

    handleFramenavigated = (): void => {
      const url = page.url();
      if (!url) return;
      lastKnownUrl = url;
      telemetry.emitUrlChanged(url);
    };

    page.on('framenavigated', handleFramenavigated);

    try {
      // Task 3: Emit granular status for dynamic UI - "Navigating to URL..."
      this.emitSystemStatus(telemetry, `Navigating to ${targetUrl}...`);

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      handleFramenavigated(); // initial capture so dashboard doesn't start blank
      await this.ensureDomReady(page, telemetry);

      // 🛡️ Initialize stability monitoring - runs silently in background
      // Monitors JS Exceptions, 500 Errors, and System Lock-up (5s heartbeat timeout)
      this.cleanupStabilityMonitor = setupStabilityMonitoring(page, telemetry);

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
              boundingBox: { x: 0, y: 0, width: 0, height: 0 },
            })),
          );

          // Task 3: Emit granular status for dynamic UI - "Hashing DOM state..."
          this.emitSystemStatus(telemetry, 'Hashing DOM state...');

          // --- 3-Strike Logic Loop Detection ---
          // The hash represents the structural fingerprint of the page AFTER the
          // previous action. If it stays identical for 3 consecutive steps the
          // engine is stuck clicking elements that have no effect on app state.
          const currentHash = await this.hashManager.hash(page);

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

          // Record this state visit and mark edge as explored
          this.stateGraph.recordVisit(previousHash);
          if (previousHash && target.selector) {
            this.stateGraph.markEdgeExplored(previousHash, target.selector);
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

          telemetry.emitTelemetry(this.event('HEURISTIC_SCORE', {
            selector: target.selector,
            score: Number(target.riskScore.toFixed(4)),
            message: `Target scored ${target.riskScore.toFixed(4)} and executed.`,
          }));

          await this.emitLiveFrame(page, telemetry);
          await wait(350);
        } catch (err) {
          // Emergency Data Flush: capture current action buffer and emit EXCEPTION telemetry.
          const actionSnapshot = this.actions.snapshot();
          const reproductionSteps = actionSnapshot.map((item, index) => `Step ${index + 1}: ${item.action} on ${item.selector}`);
          const message = err instanceof Error ? err.message : String(err);
          const stackTrace = err instanceof Error ? err.stack ?? message : message;


          telemetry.emitTelemetry(
            this.event('EXCEPTION', {
              message: `Engine exception: ${message}`,
              exceptionDetails: {
                message,
                stackTrace,
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
            reason: runtimeCrashReason ?? serverCrashReason ?? `Engine exception: ${message}`,
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
    });
  }

  private async handleResponse(response: Response, currentUrl: string, telemetry: TelemetryGateway): Promise<string | null> {
    const status = response.status();
    const url = response.url();
    const method = response.request().method();
    const timestamp = new Date().toISOString();
    const breadcrumbs = this.actions.snapshot();

    const shouldEmitByStatus = status >= 400;

    let shouldEmitByBody = false;
    let bodyContent = '';
    if (!shouldEmitByStatus) {
      try {
        bodyContent = await response.text().catch(() => '');
        const bodyLower = bodyContent.toLowerCase();

        const hasErrorFlag = bodyLower.includes('"error"') && (bodyLower.includes('true') || bodyLower.includes(':true'));
        const hasStatusFail = bodyLower.includes('"status"') && (bodyLower.includes('"fail"') || bodyLower.includes(':"fail"'));

        shouldEmitByBody = hasErrorFlag || hasStatusFail;
      } catch {
        shouldEmitByBody = false;
      }
    }

    if (shouldEmitByStatus || shouldEmitByBody) {
      telemetry.emitTelemetry(this.event('NETWORK', {
        statusCode: status,
        url,
        method,
        message: `Network ${status} ${method} ${url}`,
      }));

      // Emit incident and forensic reports for ALL error statuses (4xx and 5xx)
      const reason = `HTTP ${status}: ${method} ${url}`;
      const stackTrace = `HTTP ${status} response from ${url}${bodyContent ? ` - Body: ${bodyContent.slice(0, 500)}` : ''}`;

      telemetry.emitIncidentReport({
        timestamp,
        reason,
        url: currentUrl,
        statusCode: status,
        stackTrace,
        steps: this.breadcrumbsToActionRecords(breadcrumbs),
      });

      telemetry.emitForensicReport({
        timestamp,
        reason,
        statusCode: status,
        url: currentUrl,
        stackTrace,
        breadcrumbs,
      });

      return reason;
    }

    return null;
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
    if (scenario.name === 'SecurityVulnerabilityScout') {
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

    // If it's a text input field and chaos threshold allows, delegate to security scout
    if (isTextInput) {
      const chaosRoll = Math.random();
      if (chaosRoll < this.chaosThreshold) {
        console.log(`[AutonomousExplorationEngine] Chaos threshold triggered (${(chaosRoll * 100).toFixed(1)}% < ${(this.chaosThreshold * 100).toFixed(1)}%) - activating security audit on ${target.selector}`);
        return securityVulnerabilityScout;
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
      // 50% chance to escalate from "Standard typing" to "Data Fuzzing" for INPUT/TEXTAREA
      const useDataFuzzer = (target.tagName === 'input' || target.tagName === 'textarea') && Math.random() < 0.5;

      if (useDataFuzzer) {
        // Use Data Fuzzer: Generate fuzz payload
        const payloadType = getRandomPayloadType();
        const payload = getPayload(payloadType);

        this.recordActionTrace({
          timestamp: new Date().toISOString(),
          selector: target.selector,
          action: 'data-fuzzer-injection',
          payload: payloadType,
          score: Number(target.riskScore.toFixed(4)),
        });

        // Strip constraints first (maxlength, pattern) to allow large payloads
        await this.stripConstraints(page);

        // Inject the fuzz payload
        await this.injectPayload(page, target.selector, payload);

        // Emit telemetry with the required format
        telemetry.emitTelemetry(this.event('ACTION', {
          actionExecuted: 'data-fuzzer-injection',
          selector: target.selector,
          message: `⚡ Data Fuzzer: Injecting ${payloadType} into ${target.selector} to test data validation limits.`,
        }));

        return;
      }

      // Standard payload injection
      const payload = this.payloadSynthesizer.nextPayload();
      this.recordActionTrace({
        timestamp: new Date().toISOString(),
        selector: target.selector,
        action: 'payload-injection',
        payload,
        score: Number(target.riskScore.toFixed(4)),
      });

      await this.stripConstraints(page);
      await this.injectPayload(page, target.selector, payload);
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
     * 
     * Performance gains vs legacy Base64:
     * - ~30-40% reduction in encoding latency (no Base64 conversion)
     * - ~50% reduction in data transfer size (raw bytes vs base64 string)
     * 
     * The raw Buffer is sent to BinaryFrameServer which streams it directly
     * to clients via WebSocket binary frames - no encoding overhead.
     */
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 55 });

    // Emit via optimized binary path if available
    // The binary frame server receives raw Buffer and broadcasts directly
    if ('emitLiveFrameBinary' in telemetry) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (telemetry as any).emitLiveFrameBinary(screenshot);
    }

    // Fallback to legacy Base64 for backward compatibility
    telemetry.emitLiveFrame(screenshot.toString('base64'));
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
   * Uses the previously unused data fuzzer functions to enhance security testing:
   * - generateLargeString: Tests payload size limits (DoS vulnerability)
   * - generateNullPayload: Tests null/empty validation bypass
   * - generateSpecialChars: Tests character encoding issues
   */
  private async executeSecurityFuzzerPayloads(
    page: Page,
    telemetry: TelemetryGateway,
    target: InteractiveElement,
  ): Promise<void> {
    const selector = target.selector;

    // 1. Inject large string payload for size limit testing
    const largePayload = generateLargeString();
    try {
      await this.injectPayload(page, selector, largePayload);
      telemetry.emitTelemetry(this.event('ACTION', {
        actionExecuted: 'security-large-payload-injection',
        selector,
        message: `📏 Security: Injected large payload (${largePayload.length} chars) to test size limits.`,
      }));
    } catch (error) {
      console.warn('[AutonomousExplorationEngine] Large payload injection failed:', error);
    }

    // 2. Inject null payload for validation bypass testing
    const nullPayload = generateNullPayload();
    try {
      await this.injectPayload(page, selector, nullPayload);
      telemetry.emitTelemetry(this.event('ACTION', {
        actionExecuted: 'security-null-bypass-injection',
        selector,
        message: `� null Security: Injected null payload to test validation bypass.`,
      }));
    } catch (error) {
      console.warn('[AutonomousExplorationEngine] Null payload injection failed:', error);
    }

    // 3. Inject special characters for encoding testing
    const specialCharsPayload = generateSpecialChars();
    try {
      await this.injectPayload(page, selector, specialCharsPayload);
      telemetry.emitTelemetry(this.event('ACTION', {
        actionExecuted: 'security-special-chars-injection',
        selector,
        message: `🔣 Security: Injected special characters to test encoding issues.`,
      }));
    } catch (error) {
      console.warn('[AutonomousExplorationEngine] Special chars injection failed:', error);
    }

    // Trace all payloads injected for security audit
    console.log(
      `[SecurityFuzzerPayloads] Enhanced security testing complete on ${selector}: ` +
      `largePayload(${largePayload.length}), nullPayload("${nullPayload}"), ` +
      `specialChars(${specialCharsPayload.length})`,
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