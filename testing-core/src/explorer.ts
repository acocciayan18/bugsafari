import type { BrowserContext, Page, Request, Response } from 'playwright';
import type { DiscoveredElement, ForensicCrashReport, TelemetryEvent, TelemetryMeta } from '../../shared/types.ts';
import { CircularBuffer } from './lib/circularBuffer.js';
import { DomHasher } from './ml/domHasher.js';
import { PayloadSynthesizer } from './ml/payloadSynthesizer.js';
import { SingleLayerPerceptron, buildFeatureVectorFromElement } from './ml/perceptron.js';
import type { ActionBreadcrumb, DomElementSnapshot, ExplorerHooks, FeatureVector } from './types.js';

export interface ExplorerOptions {
  context: BrowserContext;
  page: Page;
  targetUrl: string;
  hooks: ExplorerHooks;
  maxSteps?: number;
}

interface RunResult {
  completed: boolean;
  reason: string;
}

interface ExtractedElement {
  tagName: string;
  id: string;
  className: string;
  type: string;
  name: string;
  text: string;
  selector: string;
  role: string;
  href: string;
  disabled: boolean;
  isVisible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_BREADCRUMBS = 20;

export async function runExplorer(options: ExplorerOptions): Promise<RunResult> {
  const { context, hooks, targetUrl } = options;
  const maxSteps = options.maxSteps ?? 50;
  let page = options.page;
  const hasher = new DomHasher();
  const perceptron = new SingleLayerPerceptron();
  const payloadSynthesizer = new PayloadSynthesizer();
  const breadcrumbs = new CircularBuffer<ActionBreadcrumb>(MAX_BREADCRUMBS);

  let isCrashed = false;
  let crashReason = '';
  let crashStatusCode: number | undefined;
  let lastActionVector: FeatureVector | null = null;

  const emitTelemetry = (type: TelemetryEvent['type'], meta: TelemetryMeta): void => {
    hooks.emitTelemetry({
      timestamp: new Date().toISOString(),
      type,
      meta,
    });
  };

  const emitForensic = (reason: string, stackTrace?: string): void => {
    const report: ForensicCrashReport = {
      timestamp: new Date().toISOString(),
      reason,
      statusCode: crashStatusCode,
      url: page.url(),
      stackTrace,
      breadcrumbs: breadcrumbs.snapshot(),
    };

    hooks.emitForensicReport(report);
    emitTelemetry('EXCEPTION', {
      message: reason,
      statusCode: crashStatusCode,
      url: page.url(),
      exceptionDetails: stackTrace ? { message: reason, stackTrace } : undefined,
      reproductionSteps: report.breadcrumbs.map(
        (item, index) => `Step ${index + 1}: ${item.action} on ${item.selector} at ${item.timestamp}`,
      ),
    });
  };

  const requestListener = (request: Request): void => {
    if (!lastActionVector) {
      return;
    }
    if (request.resourceType() === 'xhr' || request.resourceType() === 'fetch') {
      perceptron.boostFromNetworkSignal(lastActionVector);
    }
  };

  const responseListener = (response: Response): void => {
    emitTelemetry('NETWORK', {
      url: response.url(),
      statusCode: response.status(),
      method: response.request().method(),
      message: `Network response ${response.status()} ${response.url()}`,
    });

    if (response.status() >= 500) {
      isCrashed = true;
      crashReason = `HTTP ${response.status()} detected on ${response.url()}`;
      crashStatusCode = response.status();
    }
  };

  const pageErrorListener = (error: Error): void => {
    isCrashed = true;
    crashReason = `Unhandled runtime error: ${error.message}`;
    emitForensic(crashReason, error.stack ?? error.message);
  };

  page.on('request', requestListener);
  page.on('response', responseListener);
  page.on('pageerror', pageErrorListener);

  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (isExternalDomain(url, targetUrl)) {
      emitTelemetry('ACTION', {
        actionExecuted: 'blocked-external-navigation',
        blockedUrl: url,
        message: `Blocked external domain navigation to ${url}`,
      });
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  emitTelemetry('ACTION', {
    actionExecuted: 'exploration-started',
    url: targetUrl,
    message: `Exploration started for ${targetUrl}`,
  });

  for (let step = 1; step <= maxSteps; step += 1) {
    if (isCrashed) {
      if (crashReason) {
        emitForensic(crashReason);
      }
      return { completed: false, reason: crashReason || 'Crash detected' };
    }

    const domState = await hasher.capture(page);
    emitTelemetry('ACTION', {
      actionExecuted: 'dom-hash-captured',
      stateHash: domState.hash,
      message: `DOM hash observed (visit #${domState.visits})`,
    });

    const rawElements = await extractInteractiveElements(page);
    const snapshots = rawElements
      .filter((item) => item.isVisible)
      .map<DomElementSnapshot>((item) => {
        const featureVector = buildFeatureVectorFromElement({
          tagName: item.tagName,
          id: item.id,
          className: item.className,
          type: item.type,
          text: item.text,
          disabled: item.disabled,
        });
        const score = perceptron.score(featureVector);
        return {
          selector: item.selector,
          tagName: item.tagName,
          id: item.id,
          className: item.className,
          type: item.type,
          name: item.name,
          text: item.text,
          role: item.role,
          href: item.href,
          isVisible: item.isVisible,
          disabled: item.disabled,
          featureVector,
          score,
        };
      });

    if (snapshots.length === 0) {
      return { completed: true, reason: 'No interactive visible elements found' };
    }

    for (const element of snapshots) {
      emitTelemetry('HEURISTIC_SCORE', {
        selector: element.selector,
        score: Number(element.score.toFixed(4)),
        message: `Risk score ${element.score.toFixed(4)} for ${element.selector}`,
      });
    }

    const ranked = snapshots
      .map((item) => ({
        item,
        adjustedScore: domState.visits >= 3 ? item.score - 0.75 : item.score,
      }))
      .sort((left, right) => right.adjustedScore - left.adjustedScore);

    const top = ranked[0]?.item;
    if (!top) {
      return { completed: true, reason: 'No target selected after scoring' };
    }

    if (domState.visits >= 3) {
      perceptron.penalizeRepeatedPath(top.featureVector);
      emitTelemetry('ACTION', {
        actionExecuted: 'cycle-penalty-applied',
        selector: top.selector,
        message: `State repeated ${domState.visits} times. Penalty applied.`,
      });
    }

    const discovered = snapshots.slice(0, 12).map<DiscoveredElement>((element) => ({
      tagName: element.tagName,
      id: element.id,
      className: element.className,
      type: element.type,
      name: element.name,
      text: element.text,
      selector: element.selector,
      semanticRole: inferSemanticRole(element),
      score: Number(element.score.toFixed(4)),
      isVisible: element.isVisible,
      boundingBox: { x: 0, y: 0, width: 0, height: 0 },
    }));
    hooks.emitTargets(discovered);

    const actionName = top.tagName === 'input' || top.tagName === 'textarea' ? 'payload-injection' : 'event-spam';
    const payload = top.tagName === 'input' || top.tagName === 'textarea' ? payloadSynthesizer.nextPayload() : undefined;

    breadcrumbs.push({
      timestamp: new Date().toISOString(),
      selector: top.selector,
      action: actionName,
      payload,
      score: Number(top.score.toFixed(4)),
    });

    emitTelemetry('ACTION', {
      selector: top.selector,
      actionExecuted: actionName,
      score: Number(top.score.toFixed(4)),
      message: `Executing ${actionName} on ${top.selector}`,
    });

    lastActionVector = top.featureVector;

    if (payload) {
      await stripInputConstraints(page);
      await injectPayload(page, top.selector, payload);
    } else {
      await buttonSpammer(page, top.selector);
      await concurrentClicker(page, snapshots.map((item) => item.selector).slice(0, 5));
    }

    await emitFrame(page, hooks);
    await page.waitForTimeout(350);
  }

  return { completed: true, reason: 'Maximum exploration steps reached' };
}

function isExternalDomain(candidateUrl: string, rootUrl: string): boolean {
  try {
    const root = new URL(rootUrl);
    const candidate = new URL(candidateUrl);
    return candidate.origin !== root.origin;
  } catch {
    return false;
  }
}

async function extractInteractiveElements(page: Page): Promise<ExtractedElement[]> {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('button, input, a, textarea, [role="button"]'));
    return nodes.map((node) => {
      const element = node as HTMLElement;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const isVisible =
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        Number(style.opacity) > 0;
      const tagName = element.tagName.toLowerCase();
      const inputElement = node as HTMLInputElement;
      const selector = buildSelector(element);
      return {
        tagName,
        id: element.id ?? '',
        className: element.className ?? '',
        type: inputElement.type ?? '',
        name: inputElement.name ?? '',
        text: element.innerText?.trim() || inputElement.value || inputElement.placeholder || '',
        selector,
        role: element.getAttribute('role') ?? '',
        href: (node as HTMLAnchorElement).href ?? '',
        disabled: Boolean((node as HTMLButtonElement).disabled ?? inputElement.disabled),
        isVisible,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    });

    function buildSelector(el: HTMLElement): string {
      if (el.id) {
        return `#${CSS.escape(el.id)}`;
      }
      const dataTestId = el.getAttribute('data-testid');
      if (dataTestId) {
        return `[data-testid="${CSS.escape(dataTestId)}"]`;
      }
      const name = (el as HTMLInputElement).name;
      if (name) {
        return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
      }
      const classList = [...el.classList].filter((value) => !value.includes(':'));
      if (classList.length > 0) {
        return `${el.tagName.toLowerCase()}.${CSS.escape(classList[0])}`;
      }
      return el.tagName.toLowerCase();
    }
  });
}

async function stripInputConstraints(page: Page): Promise<void> {
  await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input, textarea'));
    for (const node of inputs) {
      node.removeAttribute('maxlength');
      node.removeAttribute('required');
      node.removeAttribute('disabled');
      node.removeAttribute('readonly');
      const input = node as HTMLInputElement;
      input.disabled = false;
      input.readOnly = false;
      input.required = false;
      input.maxLength = -1;
    }
  });
}

async function injectPayload(page: Page, selector: string, payload: string): Promise<void> {
  const locator = page.locator(selector).first();
  await locator.click({ force: true, timeout: 3000 }).catch(() => undefined);
  await locator.fill(payload, { force: true, timeout: 3000 }).catch(() => undefined);
  await locator.press('Enter').catch(() => undefined);
}

async function buttonSpammer(page: Page, selector: string): Promise<void> {
  const locator = page.locator(selector).first();
  const clicks = Array.from({ length: 16 }, () =>
    locator.click({ force: true, noWaitAfter: true, timeout: 1500 }).catch(() => undefined),
  );
  await Promise.all(clicks);
}

async function concurrentClicker(page: Page, selectors: string[]): Promise<void> {
  const tasks = selectors.map((selector) =>
    page.locator(selector).first().click({ force: true, noWaitAfter: true, timeout: 1200 }).catch(() => undefined),
  );
  await Promise.all(tasks);
}

async function emitFrame(page: Page, hooks: ExplorerHooks): Promise<void> {
  const frame = await page.screenshot({ type: 'jpeg', quality: 55, fullPage: false });
  hooks.emitLiveFrame(frame.toString('base64'));
}

function inferSemanticRole(element: DomElementSnapshot): DiscoveredElement['semanticRole'] {
  const source = `${element.id} ${element.className} ${element.text} ${element.type}`.toLowerCase();
  if (source.includes('login') || source.includes('password')) return 'LOGIN';
  if (source.includes('submit') || source.includes('checkout') || source.includes('pay')) return 'SUBMIT';
  if (source.includes('delete') || source.includes('remove')) return 'DESTRUCTIVE';
  if (source.includes('search')) return 'SEARCH';
  if (element.tagName === 'input' || element.tagName === 'textarea') return 'INPUT';
  if (element.tagName === 'a') return 'NAVIGATE';
  return 'UNKNOWN';
}
