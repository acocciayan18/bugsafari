import type { Dialog, Page, Request, Response } from 'playwright';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import type { ActionBreadcrumb, TelemetryEvent } from '../../../../shared/types.ts';
import { CircularBuffer } from '../../lib/circularBuffer.js';
import { PayloadSynthesizer } from '../../ml/payloadSynthesizer.js';
import { RecursiveDomParser } from './RecursiveDomParser.js';
import { StructuralHashManager } from './StructuralHashManager.js';
import { InteractionSimulator } from './InteractionSimulator.js';
import { ElementScorer } from './ElementScorer.js';
import type { InteractiveElement } from '../entities/InteractiveElement.js';

export class AutonomousExplorationEngine {
  private readonly parser = new RecursiveDomParser();
  private readonly hashManager = new StructuralHashManager();
  private readonly simulator = new InteractionSimulator();
  private readonly scorer = new ElementScorer();
  private readonly payloadSynthesizer = new PayloadSynthesizer();
  private readonly actions = new CircularBuffer<ActionBreadcrumb>(20);
  private targetOrigin = '';

  private emitMilestone(telemetry: TelemetryGateway, message: string): void {
    telemetry.emitTelemetry(
      this.event('ACTION', {
        actionExecuted: 'engine-milestone',
        message,
      }),
    );
  }


  public async run(page: Page, targetUrl: string, telemetry: TelemetryGateway, maxSteps = 60): Promise<{ completed: boolean; reason: string }> {
    this.targetOrigin = new URL(targetUrl).origin;
    let lastTarget: InteractiveElement | null = null;
    let serverCrashReason: string | null = null;
    let runtimeCrashReason: string | null = null;
    let lastKnownUrl = '';

    let handleFramenavigated: (() => void) | null = null;

    // 🏁 Safari Initialized (milestone)
    this.emitMilestone(telemetry, '🏁 Safari Initialized');

    this.configureDialogAutoDismiss(page, telemetry);


    page.on('request', (request: Request) => {
      if (!lastTarget) {
        return;
      }
      const resourceType = request.resourceType();
      if (resourceType === 'xhr' || resourceType === 'fetch') {
        this.scorer.rewardFromNetworkSignal(lastTarget);
        telemetry.emitTelemetry(this.event('ACTION', {
          actionExecuted: 'dynamic-weight-update',
          selector: lastTarget.selector,
          message: `Boosted feature weights after ${resourceType.toUpperCase()} network signal.`,
        }));
      }
    });
    page.on('response', async (response: Response) => {
      const crashReason = await this.handleResponse(response, page.url(), telemetry);
      if (crashReason && !serverCrashReason) {
        serverCrashReason = crashReason;
      }
    });


    page.on('pageerror', (error: Error) => {
      if (runtimeCrashReason) {
        return;
      }
      runtimeCrashReason = `Unhandled runtime error: ${error.message}`;
      const stackTrace = error.stack ?? error.message;
      telemetry.emitForensicReport({
        timestamp: new Date().toISOString(),
        reason: runtimeCrashReason,
        url: page.url(),
        stackTrace,
        breadcrumbs: this.actions.snapshot(),
      });
      telemetry.emitTelemetry(this.event('EXCEPTION', {
        message: runtimeCrashReason,
        exceptionDetails: { message: error.message, stackTrace },
        reproductionSteps: this.actions
          .snapshot()
          .map((item, index) => `Step ${index + 1}: ${item.action} on ${item.selector}`),
      }));
    });

    handleFramenavigated = (): void => {
      const url = page.url();
      if (!url) return;
      lastKnownUrl = url;
      telemetry.emitUrlChanged(url);
    };

    page.on('framenavigated', handleFramenavigated);

    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      handleFramenavigated(); // initial capture so dashboard doesn't start blank
      await this.ensureDomReady(page, telemetry);

      for (let step = 1; step <= maxSteps; step += 1) {
        try {
          if (runtimeCrashReason) {
            return { completed: false, reason: runtimeCrashReason };
          }


          if (serverCrashReason) {
            return { completed: false, reason: serverCrashReason };
          }


          // 🧠 Prioritization (milestone comes right after parse/scoring)
          this.emitMilestone(telemetry, '👁️ Vision Active');

          await this.ensureTargetDomain(page, telemetry);
          await this.ensureDomReady(page, telemetry);

          const elements = await this.parser.parse(page);
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

          const hash = await this.hashManager.hash(page);
          const loop = this.hashManager.register(hash);
          telemetry.emitTelemetry(this.event('ACTION', {
            actionExecuted: 'dom-state-hash',
            stateHash: hash,
            message: `DOM fingerprint captured. repeats=${loop.repeatCount}`,
          }));

          const target = ranked[0];
          if (!target) {
            return { completed: true, reason: 'No ranked target found.' };
          }
          lastTarget = target;

          if (loop.logicLoop) {
            this.scorer.penalize(target.selector, 1.5);
            telemetry.emitTelemetry(this.event('ACTION', {
              actionExecuted: 'logic-loop-detected',
              selector: target.selector,
              message: 'Detected same state hash 3 times in a row; applying selector penalty.',
            }));
          }

          this.logHighImpact(target, telemetry);

          if (target.tagName === 'input' || target.tagName === 'textarea' || target.tagName === 'select') {
            const payload = this.payloadSynthesizer.nextPayload();
            this.actions.push({
              timestamp: new Date().toISOString(),
              selector: target.selector,
              action: 'payload-injection',
              payload,
              score: Number(target.riskScore.toFixed(4)),
            });

            await this.stripConstraints(page);
            await this.injectPayload(page, target.selector, payload);
          } else {
            this.actions.push({
              timestamp: new Date().toISOString(),
              selector: target.selector,
              action: 'button-spammer',
              score: Number(target.riskScore.toFixed(4)),
            });

            await this.safeButtonSpammer(page, target, telemetry);
            await this.simulator.concurrentClicker(page, ranked.slice(1, 6).map((item) => item.selector));
          }

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



          // Do not remove existing crash reason logic; prefer already-known reasons.
          return {
            completed: false,
            reason: runtimeCrashReason ?? serverCrashReason ?? `Engine exception: ${message}`,
          };
        }
      }

      return { completed: true, reason: 'Maximum exploration steps reached.' };
    } finally {
      if (handleFramenavigated) {
        page.off('framenavigated', handleFramenavigated);
      }
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

  private async handleResponse(response: Response, currentUrl: string, telemetry: TelemetryGateway): Promise<string | null> {
    const status = response.status();

    // Primary filter: only emit network telemetry for HTTP >= 400
    const shouldEmitByStatus = status >= 400;

    // Secondary filter: treat certain successful responses as failures (e.g. GraphQL soft errors)
    // Only attempt body inspection for non-4xx/5xx statuses to avoid wasted work.
    let shouldEmitByBody = false;
    if (!shouldEmitByStatus) {
      try {
        const body = await response.text().catch(() => '');
        const bodyLower = body.toLowerCase();

        // Heuristic keywords for soft-failure payloads.
        // Examples: GraphQL errors with {"error":true} or {"status":"fail"}
        const hasErrorFlag = bodyLower.includes('"error"') && (bodyLower.includes('true') || bodyLower.includes(':true'));
        const hasStatusFail = bodyLower.includes('"status"') && (bodyLower.includes('"fail"') || bodyLower.includes(':"fail"'));

        shouldEmitByBody = hasErrorFlag || hasStatusFail;
      } catch {
        // If body cannot be read, ignore secondary check.
        shouldEmitByBody = false;
      }
    }

    if (shouldEmitByStatus || shouldEmitByBody) {
      telemetry.emitTelemetry(this.event('NETWORK', {
        statusCode: status,
        url: response.url(),
        method: response.request().method(),
        message: `Network ${status} ${response.url()}`,
      }));
    }

    if (status >= 500) {
      const report = {

        timestamp: new Date().toISOString(),
        reason: `HTTP ${response.status()} detected on ${response.url()}`,
        statusCode: response.status(),
        url: currentUrl,
        breadcrumbs: this.actions.snapshot(),
      };
      telemetry.emitForensicReport(report);
      telemetry.emitTelemetry(this.event('EXCEPTION', {
        statusCode: response.status(),
        url: response.url(),
        message: report.reason,
        reproductionSteps: report.breadcrumbs.map(
          (item, index) => `Step ${index + 1}: ${item.action} on ${item.selector}`,
        ),
      }));
      return report.reason;
    }
    return null;
  }

  private async ensureTargetDomain(page: Page, telemetry: TelemetryGateway): Promise<void> {
    const current = page.url();
    if (!current) {
      return;
    }

    try {
      const currentOrigin = new URL(current).origin;
      if (currentOrigin !== this.targetOrigin) {
        telemetry.emitTelemetry(this.event('ACTION', {
          actionExecuted: 'external-redirect-detected',
          url: current,
          message: `Detected external redirect to ${currentOrigin}; navigating back.`,
        }));
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => undefined);
      }
    } catch {
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

          // Engine Suicide Prevention: never assign negative maxLength.
          const nextMaxLength = -1;
          if (nextMaxLength < 0) {
            // Avoid IndexSizeError from negative maxLength assignment.
            input.removeAttribute('maxLength');
            continue;
          }

          input.maxLength = nextMaxLength;
        }
      } catch (err) {
        // Ensure browser-side DOM errors do not crash the Node.js process.
        console.warn('[BugSafari] stripConstraints evaluate failed', err);
      }
    });
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
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 55 });
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
