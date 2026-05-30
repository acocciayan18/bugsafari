import type { BrowserContext, Page, Response } from 'playwright';
import type { DiscoveredElement } from '../../contracts.js';
import { DomHasher, type DomHashState, createStructuralFingerprint, MemoryTracker } from '../../ml/domHasher.js';
import { RiskScorer, type ActionFeedback, type ScoredElement } from '../../domain/services/RiskScorer.js';
import { scanInteractiveElements } from '../../domain/heuristics/domParser.js';
import { executeSpam, concurrentEventSpam } from '../../domain/scenarios/rapidClickerStress.js';
import { fuzzTextInput } from '../../domain/scenarios/dataFuzzer.js';
import { stripConstraints } from '../../domain/scenarios/formBypasser.js';
import { trashRoutes } from '../../domain/scenarios/routeTrasher.js';
import { ActionRecorder } from '../../infrastructure/monitoring/actionBuffer.js';
import { CrashSignal, setupExceptionCatcher } from '../../infrastructure/monitoring/RuntimeMonitor.js';
import { TelemetryHub } from '../../infrastructure/monitoring/socketServer.js';

import { restoreDomainIfNeeded } from './domainGuard.js';
import { getAllBugFinders } from '../../bugs/registry.js';
import type { BugContext } from '../../bugs/types.js';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';




export type RunController = {
  waitIfPaused: () => Promise<void>;
  requestStop: () => void;
  isStopRequested: () => boolean;
  getPaused: () => boolean;

  // Used by the API server to update pause state.
  setPaused: (paused: boolean) => void;
  togglePaused: () => void;
};



export interface AutonomousRunOptions {
  context: BrowserContext;
  page: Page;
  targetUrl: string;
  hub: TelemetryHub;
  maxSteps?: number;
  controller: RunController;
}


export interface AutonomousRunResult {
  completed: boolean;
  reason: string;
  stepsExecuted: number;
}

interface ActionMonitorResult extends ActionFeedback {
  durationMs: number;
}

export async function runAutonomousSafari(options: AutonomousRunOptions): Promise<AutonomousRunResult> {
  const controller = options.controller;

  const memory = new MemoryTracker();
  const scorer = new RiskScorer();
  const actionBuffer = new ActionRecorder(20);
  const maxSteps = options.maxSteps ?? 40;
  let page = options.page;
  let crashSignal = await setupExceptionCatcher(page, options.hub, actionBuffer);

  let previousActionSignature = '';
  let stepsExecuted = 0;

  options.hub.emitTelemetry({
    timestamp: new Date().toISOString(),
    type: 'ACTION',
    meta: {
      actionExecuted: 'session-start',
      url: options.targetUrl,
      message: `Starting BugSafari session for ${options.targetUrl}`,
    },
  });

  await page.goto(options.targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  await streamLiveFrame(page, options.hub);

  for (let step = 1; step <= maxSteps; step += 1) {
    if (controller.isStopRequested()) {
      return {
        completed: false,
        reason: 'Test stopped by user.',
        stepsExecuted,
      };
    }

    if (crashSignal.isHalted()) {
      return {
        completed: false,
        reason: crashSignal.getReason(),
        stepsExecuted,
      };
    }


    await controller.waitIfPaused();

    const pageState = await ensurePage(page, options.context, options.targetUrl, options.hub, actionBuffer);


    page = pageState.page;
    crashSignal = pageState.crashSignal ?? crashSignal;

    const stateHash = await createStructuralFingerprint(page);
    const stateVisit = memory.recordState(stateHash);

    if (stateVisit.isRepeat && previousActionSignature) {
      const penalty = memory.penalizeAction(previousActionSignature, 28 + stateVisit.visitCount * 8);
      options.hub.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'ACTION',
        meta: {
          actionExecuted: 'state-repeat-penalty',
          stateHash,
          message: `Repeated state detected; penalty for prior action is now ${penalty}`,
        },
      });
    }

    const parsedElements = await scanInteractiveElements(page);

    if (parsedElements.length === 0) {
      options.hub.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'ACTION',
        meta: {
          actionExecuted: 'dead-end',
          stateHash,
          message: 'No interactive elements found on the current page.',
        },
      });
      return { completed: true, reason: 'No interactive elements found.', stepsExecuted };
    }

    const rankedTargets = await scorer.scoreElements(page, parsedElements, memory, stateVisit.visitCount);


    for (const target of rankedTargets) {
      options.hub.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'HEURISTIC_SCORE',
        meta: {
          selector: target.selector,
          score: target.score,
          tagName: target.tagName,
          semanticRole: target.semanticRole,
          stateHash,
          message: `Scored ${target.selector} at ${target.score}`,
        },
      });
    }

    options.hub.emitTargets(rankedTargets.slice(0, 10).map(toDiscoveredElement));

    const target = rankedTargets[0];

    // Mark stress-test/payload phases aligned with the action we are about to perform.
    if (target) {
      if (['input', 'textarea', 'select'].includes(target.tagName) ||
      target.semanticRole === 'INPUT' ||
      target.semanticRole === 'LOGIN') {
      }
    }

    if (!target) {

      options.hub.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'ACTION',
        meta: {
          actionExecuted: 'no-visible-targets',
          stateHash,
          message: 'No visible interactive elements survived scoring.',
        },
      });
      return { completed: true, reason: 'No visible scored targets.', stepsExecuted };
    }

    const actionName = chooseActionName(target, step);
    previousActionSignature = target.featureSignature;

    const fallbackLabel = await resolveFallbackLabel(page, target);

    await dispatchBugFinders({
      page,
      hub: options.hub,
      actionBuffer,
      targetUrl: options.targetUrl,
      step,
      stateHash,
      crashHalted: crashSignal.isHalted(),
      element: target,
    }).catch(() => undefined);





    options.hub.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'ACTION',
      meta: {
        selector: target.selector,
        actionExecuted: actionName,
        stateHash,
        tagName: target.tagName,
        semanticRole: target.semanticRole,
        message: `Executing ${actionName} on ${target.selector}`,
      },
    });

    const feedback = await monitorAction(page, async () => {
      await controller.waitIfPaused();
      await executeTargetAction(page, target, step, actionBuffer, fallbackLabel);
    });



    if (feedback.causedException) {
      memory.penalizeAction(target.featureSignature, 40);
    }

    const adaptiveWeight = scorer.applyFeedback(target, feedback);

    options.hub.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'HEURISTIC_SCORE',
      meta: {
        selector: target.selector,
        score: adaptiveWeight,
        tagName: target.tagName,
        semanticRole: target.semanticRole,
        message: `Adaptive weight for ${target.selector} adjusted to ${adaptiveWeight}`,
      },
    });

    await restoreDomainIfNeeded(page, options.targetUrl, options.hub).catch(() => undefined);
    await streamLiveFrame(page, options.hub);

    stepsExecuted = step;

    if (crashSignal.isHalted()) {
      return {
        completed: false,
        reason: crashSignal.getReason(),
        stepsExecuted,
      };
    }

  }

  options.hub.emitTelemetry({
    timestamp: new Date().toISOString(),
    type: 'ACTION',
    meta: {
      actionExecuted: 'session-complete',
      url: options.targetUrl,
      message: `Autonomous Safari completed ${stepsExecuted} steps.`,
    },
  });

  return {
    completed: true,
    reason: 'Maximum exploration steps reached.',
    stepsExecuted,
  };
}

async function executeTargetAction(

  page: Page,
  target: ScoredElement,
  step: number,
  actionRecorder: ActionRecorder,
  fallbackLabel: string,
): Promise<void> {
  if (['input', 'textarea', 'select'].includes(target.tagName) || target.semanticRole === 'INPUT' || target.semanticRole === 'LOGIN') {
    // Payload injection milestone is emitted by caller to preserve phase ordering + throttle.
    const interactiveTarget: InteractiveElement = {
      selector: target.selector,
      id: target.id,
      className: target.className,
      innerText: target.text,
      type: target.type,
      tagName: target.tagName,
      isVisible: target.isVisible,
      isPointer: false,
      featureVector: {},
      riskScore: target.score,
    };
    const payload = await fuzzTextInput(page, interactiveTarget, step);

    actionRecorder.record({
      type: 'INPUT',
      selector: target.selector,
      url: page.url(),
      payload,
      fallbackLabel,
    });
    return;
  }

  await stripConstraints(page, target.selector).catch(() => undefined);

  if (step % 6 === 0) {
    await concurrentEventSpam(page);
    actionRecorder.record({
      type: 'CLICK',
      selector: `monkey:concurrent-event-spam:${target.selector}`,
      url: page.url(),
      fallbackLabel,
    });
    actionRecorder.record({
      type: 'NAVIGATION',
      selector: 'browser:back',
      url: page.url(),
    });
    actionRecorder.record({
      type: 'NAVIGATION',
      selector: 'browser:forward',
      url: page.url(),
    });
    actionRecorder.record({
      type: 'NAVIGATION',
      selector: 'browser:reload',
      url: page.url(),
    });
    await trashRoutes(page, 1);
    return;
  }

  await executeSpam(page, target.selector);
  actionRecorder.record({
    type: 'CLICK',
    selector: target.selector,
    url: page.url(),
    fallbackLabel,
  });

  if (target.semanticRole === 'NAVIGATE' || step % 4 === 0) {
    actionRecorder.record({
      type: 'NAVIGATION',
      selector: 'browser:back',
      url: page.url(),
    });
    actionRecorder.record({
      type: 'NAVIGATION',
      selector: 'browser:forward',
      url: page.url(),
    });
    actionRecorder.record({
      type: 'NAVIGATION',
      selector: 'browser:reload',
      url: page.url(),
    });
    await trashRoutes(page, 1);
  }
}

async function monitorAction(page: Page, action: () => Promise<void>): Promise<ActionMonitorResult> {
  const beforeUrl = page.url();
  const startedAt = Date.now();
  let networkTriggered = false;
  let highLatency = false;
  let causedException = false;

  const responseHandler = (response: Response): void => {
    networkTriggered = true;

    if (Date.now() - startedAt > 1000 || response.status() >= 500) {
      highLatency = true;
    }
  };

  page.on('response', responseHandler);

  try {
    await action();
  } catch (error) {
    causedException = true;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[BugSafari] Action failed: ${message}`);
  } finally {
    await page.waitForTimeout(1200).catch(() => undefined);
    page.off('response', responseHandler);
  }

  return {
    networkTriggered,
    routeChanged: beforeUrl !== page.url(),
    highLatency,
    causedException,
    durationMs: Date.now() - startedAt,
  };
}

async function streamLiveFrame(page: Page, hub: TelemetryHub): Promise<void> {
  try {
    const buffer = await page.screenshot({ type: 'jpeg', quality: 45, fullPage: false });
    hub.emitFrame(buffer.toString('base64'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    hub.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'EXCEPTION',
      meta: {
        message: `Live frame capture failed: ${message}`,
        exceptionDetails: {
          message,
          stackTrace: message,
        },
        reproductionSteps: [],
      },
    });
  }
}

async function ensurePage(
  page: Page,
  context: BrowserContext,
  targetUrl: string,
  hub: TelemetryHub,
  actionBuffer: ActionRecorder,
): Promise<{ page: Page; crashSignal: CrashSignal | null }> {
  if (!page.isClosed()) {
    return { page, crashSignal: null };
  }

  const replacement = await context.newPage();
  const crashSignal = await setupExceptionCatcher(replacement, hub, actionBuffer);
  await replacement.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  return { page: replacement, crashSignal };
}

async function resolveFallbackLabel(page: Page, target: ScoredElement): Promise<string> {
  if (target.text && target.text.trim().length > 0) {
    return target.text.trim().slice(0, 120);
  }

  const label = await page
    .evaluate((selector: string) => {
      const node = document.querySelector(selector) as HTMLElement | null;
      if (!node) return '';
      const aria = node.getAttribute('aria-label') ?? '';
      const text = node.innerText?.trim() ?? '';
      const title = node.getAttribute('title') ?? '';
      return aria || text || title || '';
    }, target.selector)
    .catch(() => '');

  return label.trim().slice(0, 120);
}

function chooseActionName(target: ScoredElement, step: number): string {
  if (['input', 'textarea', 'select'].includes(target.tagName) || target.semanticRole === 'INPUT' || target.semanticRole === 'LOGIN') {
    return 'strip-constraints-and-fuzz';
  }

  if (step % 6 === 0) {
    return 'concurrent-click-and-route-trash';
  }

  if (target.semanticRole === 'NAVIGATE' || step % 4 === 0) {
    return 'rapid-click-and-route-trash';
  }

  return 'rapid-click-burst';
}

async function dispatchBugFinders(params: {
  page: Page;
  hub: TelemetryHub;
  actionBuffer: ActionRecorder;
  targetUrl: string;
  step: number;
  stateHash: string;
  crashHalted: boolean;
  element?: ScoredElement;
}): Promise<void> {
  const finders = getAllBugFinders();
  const ctxBase: Omit<BugContext, 'crashHalted'> = {
    page: params.page,
    hub: params.hub,
    actionBuffer: params.actionBuffer,
    targetUrl: params.targetUrl,
    step: params.step,
    stateHash: params.stateHash,
    element: params.element,
  };

  for (const finder of finders) {
    try {
      const applicable = await finder.isApplicable({ ...ctxBase } as Omit<BugContext, 'crashHalted'>);
      if (!applicable) continue;

      const findings = await finder.run({ ...ctxBase, crashHalted: params.crashHalted });
      for (const finding of findings) {
        params.hub.emitTelemetry({
          timestamp: new Date().toISOString(),
          type: 'HEURISTIC_SCORE',
          meta: {
            actionExecuted: 'bug-finding',
            message: `${finding.title} (${finding.severity})`,
            stateHash: finding.evidence?.stateHash ?? params.stateHash,
            selector: finding.evidence?.selector ?? params.element?.selector,
            score: finding.severity === 'CRITICAL' ? 999 : finding.severity === 'HIGH' ? 200 : 100,
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      params.hub.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'EXCEPTION',
        meta: {
          message: `Bug finder failed (${finder.bugClass}): ${message}`,
          exceptionDetails: {
            message,
            stackTrace: message,
          },
          reproductionSteps: [],
        },
      });
    }
  }
}

function toDiscoveredElement(target: ScoredElement): DiscoveredElement {

  return {
    tagName: target.tagName,
    id: target.id,
    className: target.className,
    type: target.type,
    name: target.name,
    text: target.text,
    selector: target.selector,
    semanticRole: target.semanticRole,
    score: target.score,
    isVisible: target.isVisible,
    boundingBox: target.boundingBox,
  };
}
